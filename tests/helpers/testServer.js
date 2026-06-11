import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function startAppServer(port) {
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

export async function stopAppServer(child) {
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

export async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return readJsonResponse(response);
}

export async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return readJsonResponse(response);
}

async function readJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  assert.equal(response.ok, true, JSON.stringify({ status: response.status, body }));
  return body;
}
