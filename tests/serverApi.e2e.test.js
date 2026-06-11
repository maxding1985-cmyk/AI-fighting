import test from "node:test";
import assert from "node:assert/strict";
import {
  getFreePort,
  getJson,
  postJson,
  startAppServer,
  stopAppServer
} from "./helpers/testServer.js";

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
