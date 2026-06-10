import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

test("HTTP E2E completes a two-player battle setup and verifies player A behavior", async (t) => {
  let port;
  try {
    port = await getFreePort();
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip(`Local server binding is not permitted in this environment: ${error.code}`);
      return;
    }
    throw error;
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startAppServer(port);

  try {
    const created = await postJson(baseUrl, "/api/rooms", { playerName: "Player A" });
    const code = created.room.code;
    const joined = await postJson(baseUrl, `/api/rooms/${code}/join`, { playerName: "Player B" });

    const generated = await postJson(baseUrl, `/api/rooms/${code}/strategy/generate`, {
      generationMode: "local",
      prompt: "随机运动，遇到子弹躲避，一直射击"
    });
    const ruleA = generated.ruleSet;
    const ruleB = {
      name: "测试靶车",
      description: "保持不动，用于验证玩家 A 的行为。",
      rules: [
        { priority: 1, when: ["always"], action: "wait" }
      ]
    };

    assert.equal(created.playerId, "A");
    assert.equal(joined.playerId, "B");
    assert.equal(generated.source, "local");
    assert.equal(ruleA.name, "随机游走火力型");

    await postJson(baseUrl, `/api/rooms/${code}/strategy/confirm`, {
      playerId: "A",
      playerToken: created.playerToken,
      ruleSet: ruleA
    });
    const ready = await postJson(baseUrl, `/api/rooms/${code}/strategy/confirm`, {
      playerId: "B",
      playerToken: joined.playerToken,
      ruleSet: ruleB
    });

    assert.equal(ready.room.status, "fighting");

    const evidence = await waitForPlayerABehavior(baseUrl, code);
    assert.equal(evidence.logs.some((message) => message.includes("Player A 开火")), true, evidence.debug);
    assert.equal(
      evidence.logs.some((message) =>
        message.includes("Player A 决策") && (message.includes("前进") || message.includes("后退"))
      ),
      true,
      evidence.debug
    );
    assert.equal(evidence.positions.size > 1, true, evidence.debug);
  } finally {
    await stopAppServer(server);
  }
});

async function waitForPlayerABehavior(baseUrl, code) {
  const deadline = Date.now() + 8000;
  const positions = new Set();
  const actions = new Set();
  let latestRoom = null;
  let latestLogs = [];

  while (Date.now() < deadline) {
    const { room } = await getJson(baseUrl, `/api/rooms/${code}`);
    latestRoom = room;

    const tankA = room.gameState?.tanks.find((tank) => tank.playerId === "A");
    if (tankA) {
      positions.add(`${tankA.x},${tankA.y}`);
    }

    const action = room.gameState?.lastActions?.A?.action;
    if (action) {
      actions.add(action);
    }

    latestLogs = room.gameState?.logs.map((entry) => entry.message) || [];
    if (
      positions.size > 1 &&
      latestLogs.some((message) => message.includes("Player A 开火")) &&
      latestLogs.some((message) =>
        message.includes("Player A 决策") && (message.includes("前进") || message.includes("后退"))
      )
    ) {
      return {
        positions,
        actions,
        logs: latestLogs,
        debug: formatDebug(latestRoom, positions, actions, latestLogs)
      };
    }

    await delay(100);
  }

  return {
    positions,
    actions,
    logs: latestLogs,
    debug: formatDebug(latestRoom, positions, actions, latestLogs)
  };
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return readJsonResponse(response);
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return readJsonResponse(response);
}

async function readJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  assert.equal(response.ok, true, JSON.stringify({ status: response.status, body }));
  return body;
}

async function startAppServer(port) {
  const child = spawn(process.execPath, ["src/server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new Error(`Server did not start in time.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("AI Tank Duel server running")) {
        finish(resolve, child);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(reject, error));
    child.on("exit", (code) => {
      finish(reject, new Error(`Server exited before ready with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

async function stopAppServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 1000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function formatDebug(room, positions, actions, logs) {
  return JSON.stringify({
    status: room?.status,
    tick: room?.gameState?.tick,
    actions: [...actions],
    positions: [...positions],
    playerA: room?.gameState?.tanks.find((tank) => tank.playerId === "A"),
    logs
  }, null, 2);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
