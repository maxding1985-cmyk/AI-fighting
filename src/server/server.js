import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { RoomError, RoomManager } from "./roomManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "../..");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const manager = new RoomManager();
const SSE_HEARTBEAT_MS = 10000;
const SSE_RETRY_MS = 2000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    sendError(res, error);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用。请关闭占用进程，或使用 PORT=其他端口 npm start。`);
    process.exit(1);
  }

  console.error("服务器启动失败：", error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`AI Tank Duel server running at http://${host}:${port}`);
});

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(req);
    sendJson(res, manager.createRoom({ playerName: body.playerName }));
    return;
  }

  if (method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "join") {
    const body = await readJson(req);
    sendJson(res, manager.joinRoom(parts[2], { playerName: body.playerName }));
    return;
  }

  if (method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "restore") {
    const body = await readJson(req);
    sendJson(res, manager.restorePlayer(parts[2], body.playerId, body.playerToken));
    return;
  }

  if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "rooms") {
    sendJson(res, { room: manager.getSnapshot(parts[2]) });
    return;
  }

  if (method === "GET" && parts.length === 4 && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "events") {
    handleEvents(req, res, parts[2], url.searchParams.get("playerId"), url.searchParams.get("playerToken"));
    return;
  }

  if (method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "strategy" && parts[4] === "generate") {
    const body = await readJson(req);
    sendJson(res, { ruleSet: manager.generateStrategy(body.prompt) });
    return;
  }

  if (method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "strategy" && parts[4] === "confirm") {
    const body = await readJson(req);
    manager.verifyPlayerToken(parts[2], body.playerId, body.playerToken);
    sendJson(res, { room: manager.confirmStrategy(parts[2], body.playerId, body.ruleSet) });
    return;
  }

  if (method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "restart") {
    const body = await readJson(req);
    manager.verifyPlayerToken(parts[2], body.playerId, body.playerToken);
    sendJson(res, { room: manager.restartRoom(parts[2]) });
    return;
  }

  throw new RoomError(404, "接口不存在");
}

function handleEvents(req, res, code, playerId, playerToken) {
  manager.verifyPlayerToken(code, playerId, playerToken);

  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();

  let closed = false;
  let heartbeat = null;
  let unsubscribe = () => {};

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    unsubscribe();
    manager.disconnectPlayer(code, playerId);
  };

  const write = (payload) => {
    if (closed || res.destroyed || res.writableEnded) {
      return;
    }

    try {
      res.write(payload);
    } catch {
      close();
    }
  };

  const send = (event, data) => {
    write(`event: ${event}\n`);
    write(`data: ${JSON.stringify(data)}\n\n`);
  };

  write(`retry: ${SSE_RETRY_MS}\n\n`);
  unsubscribe = manager.subscribe(code, send);
  manager.connectPlayer(code, playerId);
  send("room:update", manager.getSnapshot(code));

  heartbeat = setInterval(() => {
    write(`: ping ${Date.now()}\n\n`);
  }, SSE_HEARTBEAT_MS);

  req.on("close", close);
  req.on("aborted", close);
  res.on("error", close);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RoomError(400, "请求 JSON 格式错误");
  }
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = resolve(rootDir, `.${safePath}`);

  if (!filePath.startsWith(rootDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendError(res, new RoomError(404, "文件不存在"));
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }

  const statusCode = error instanceof RoomError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "服务器错误";
  sendJson(res, { error: message }, statusCode);
}
