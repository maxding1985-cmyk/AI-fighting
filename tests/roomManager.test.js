import test from "node:test";
import assert from "node:assert/strict";
import { RoomError, RoomManager } from "../src/server/roomManager.js";

test("room manager creates and joins a two-player room", () => {
  let tokenIndex = 0;
  const manager = new RoomManager({
    autoTick: false,
    tokenFactory: () => `token-${tokenIndex += 1}`
  });
  const created = manager.createRoom({ playerName: "Alpha" });
  const joined = manager.joinRoom(created.room.code, { playerName: "Bravo" });

  assert.equal(created.playerId, "A");
  assert.equal(created.playerToken, "token-1");
  assert.equal(joined.playerId, "B");
  assert.equal(joined.playerToken, "token-2");
  assert.equal(joined.room.status, "preparing");
  assert.equal(joined.room.players.length, 2);
  assert.equal(joined.room.players[0].name, "Alpha");
  assert.equal(joined.room.players[1].name, "Bravo");
  assert.equal("token" in joined.room.players[0], false);
});

test("room manager rejects a third player", () => {
  const manager = new RoomManager({ autoTick: false });
  const created = manager.createRoom({ playerName: "Alpha" });
  manager.joinRoom(created.room.code, { playerName: "Bravo" });

  assert.throws(
    () => manager.joinRoom(created.room.code, { playerName: "Charlie" }),
    (error) => error instanceof RoomError && error.statusCode === 409
  );
});

test("room manager restores players only with a valid credential", () => {
  let tokenIndex = 0;
  const manager = new RoomManager({
    autoTick: false,
    tokenFactory: () => `token-${tokenIndex += 1}`
  });
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;
  manager.joinRoom(code, { playerName: "Bravo" });

  const restored = manager.restorePlayer(code, "A", created.playerToken);

  assert.equal(restored.playerId, "A");
  assert.equal(restored.playerToken, "token-1");
  assert.equal(restored.room.code, code);
  assert.throws(
    () => manager.restorePlayer(code, "A", "wrong-token"),
    (error) => error instanceof RoomError && error.statusCode === 403
  );
});

test("confirming both strategies starts and resolves a server-authoritative battle", () => {
  const manager = new RoomManager({
    autoTick: false,
    battleOptions: {
      seed: 1,
      maxTicks: 60,
      map: { width: 7, height: 3, walls: [] }
    }
  });
  const events = [];
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;
  manager.subscribe(code, (event) => events.push(event));
  manager.joinRoom(code, { playerName: "Bravo" });

  const ruleA = manager.generateStrategy("我要主动进攻，看到敌人在直线上就开炮。");
  const ruleB = {
    name: "测试等待",
    description: "保持不动，验证服务端战斗能结束。",
    rules: [
      { priority: 1, when: ["always"], action: "wait" }
    ]
  };
  manager.confirmStrategy(code, "A", ruleA);
  const readyRoom = manager.confirmStrategy(code, "B", ruleB);

  assert.equal(readyRoom.status, "fighting");
  assert.equal(events.includes("battle:state"), true);

  let snapshot = readyRoom;
  while (snapshot.status !== "finished") {
    snapshot = manager.tickRoom(code);
  }

  assert.equal(snapshot.result.type, "win");
  assert.equal(snapshot.result.winnerPlayerId, "A");
  assert.equal(events.includes("battle:end"), true);
});


test("two-player flow makes player A fire and move for random shooting prompt", () => {
  const manager = new RoomManager({
    autoTick: false,
    battleOptions: {
      seed: 21,
      maxTicks: 40,
      map: { width: 9, height: 7, walls: [] }
    }
  });
  const events = [];
  const created = manager.createRoom({ playerName: "Player A" });
  const code = created.room.code;

  manager.subscribe(code, (event, data) => events.push({ event, data }));
  manager.joinRoom(code, { playerName: "Player B" });
  manager.connectPlayer(code, "A");
  manager.connectPlayer(code, "B");

  const ruleA = manager.generateStrategy("随机运动，遇到子弹躲避，一直射击");
  const ruleB = {
    name: "测试靶车",
    description: "保持不动，用于验证玩家 A 的行为。",
    rules: [
      { priority: 1, when: ["always"], action: "wait" }
    ]
  };

  assert.equal(ruleA.name, "随机游走火力型");
  manager.confirmStrategy(code, "A", ruleA);
  let room = manager.confirmStrategy(code, "B", ruleB);

  assert.equal(room.status, "fighting");

  const positions = new Set([positionOf(room, "A")]);
  const actions = [];
  const logs = [];

  for (let index = 0; index < 18 && room.status === "fighting"; index += 1) {
    room = manager.tickRoom(code);
    const gameState = room.gameState;
    const action = gameState?.lastActions?.A?.action;

    if (action) {
      actions.push(action);
    }
    if (gameState) {
      positions.add(positionOf(room, "A"));
      logs.push(...gameState.logs.map((item) => item.message));
    }
  }

  assert.equal(events.some((item) => item.event === "battle:state"), true);
  assert.equal(actions.includes("shoot"), true, formatRegressionDebug(room, actions, logs));
  assert.equal(
    actions.some((action) => action === "move_forward" || action === "move_backward"),
    true,
    formatRegressionDebug(room, actions, logs)
  );
  assert.equal(positions.size > 1, true, formatRegressionDebug(room, actions, logs));
  assert.equal(logs.some((message) => message.includes("Player A 开火")), true);
  assert.equal(
    logs.some((message) => message.includes("Player A 决策") && (message.includes("前进") || message.includes("后退"))),
    true
  );
});

test("disconnect grace keeps player online through quick reconnects", async () => {
  const manager = new RoomManager({
    autoTick: false,
    disconnectGraceMs: 20
  });
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;

  manager.connectPlayer(code, "A");
  manager.disconnectPlayer(code, "A");
  assert.equal(manager.getSnapshot(code).players[0].connected, true);

  manager.connectPlayer(code, "A");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(manager.getSnapshot(code).players[0].connected, true);

  manager.disconnectPlayer(code, "A");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(manager.getSnapshot(code).players[0].connected, false);
});

test("exit request requires the other player to confirm before closing room", () => {
  const manager = new RoomManager({ autoTick: false });
  const events = [];
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;
  manager.joinRoom(code, { playerName: "Bravo" });
  manager.connectPlayer(code, "A");
  manager.connectPlayer(code, "B");
  manager.subscribe(code, (event) => events.push(event));

  const requested = manager.requestExit(code, "A");

  assert.equal(requested.status, "preparing");
  assert.equal(requested.exitRequest.requesterId, "A");
  assert.throws(
    () => manager.confirmExit(code, "A"),
    (error) => error instanceof RoomError && error.statusCode === 409
  );

  const closed = manager.confirmExit(code, "B");

  assert.equal(closed.status, "closed");
  assert.equal(closed.result.type, "exit");
  assert.equal(closed.exitRequest.confirmerId, "B");
  assert.equal(events.includes("room:closed"), true);
});

test("exit closes immediately when there is no opponent", () => {
  const manager = new RoomManager({ autoTick: false });
  const created = manager.createRoom({ playerName: "Alpha" });

  const closed = manager.requestExit(created.room.code, "A");

  assert.equal(closed.status, "closed");
  assert.equal(closed.result.type, "exit");
  assert.equal(closed.exitRequest.requesterId, "A");
  assert.equal(closed.exitRequest.confirmerId, "A");
});

test("exit closes immediately when opponent is offline", () => {
  const manager = new RoomManager({
    autoTick: false,
    disconnectGraceMs: 0
  });
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;
  manager.joinRoom(code, { playerName: "Bravo" });
  manager.connectPlayer(code, "A");
  manager.connectPlayer(code, "B");
  manager.disconnectPlayer(code, "B");

  const closed = manager.requestExit(code, "A");

  assert.equal(closed.status, "closed");
  assert.equal(closed.exitRequest.requesterId, "A");
  assert.equal(closed.exitRequest.confirmerId, "A");
});

test("cleanup removes idle rooms only after all players are offline", () => {
  let now = 1000;
  const manager = new RoomManager({
    autoTick: false,
    autoCleanup: false,
    disconnectGraceMs: 0,
    roomIdleTtlMs: 100,
    now: () => now
  });
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;
  manager.connectPlayer(code, "A");

  now += 1000;
  assert.deepEqual(manager.cleanupExpiredRooms(), []);
  assert.equal(manager.getSnapshot(code).code, code);

  manager.disconnectPlayer(code, "A");
  now += 99;
  assert.deepEqual(manager.cleanupExpiredRooms(), []);

  now += 1;
  assert.deepEqual(manager.cleanupExpiredRooms(), [code]);
  assert.throws(
    () => manager.getSnapshot(code),
    (error) => error instanceof RoomError && error.statusCode === 404
  );
});

test("cleanup removes closed rooms using shorter closed-room ttl", () => {
  let now = 2000;
  const manager = new RoomManager({
    autoTick: false,
    autoCleanup: false,
    roomIdleTtlMs: 10000,
    closedRoomTtlMs: 50,
    now: () => now
  });
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;

  manager.requestExit(code, "A");
  now += 49;
  assert.deepEqual(manager.cleanupExpiredRooms(), []);

  now += 1;
  assert.deepEqual(manager.cleanupExpiredRooms(), [code]);
  assert.throws(
    () => manager.getSnapshot(code),
    (error) => error instanceof RoomError && error.statusCode === 404
  );
});

test("destroy clears all rooms and timers", () => {
  const manager = new RoomManager({
    autoTick: false,
    autoCleanup: true,
    cleanupIntervalMs: 10
  });
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;
  manager.disconnectPlayer(code, "A");

  manager.destroy();

  assert.equal(manager.cleanupTimer, null);
  assert.equal(manager.rooms.size, 0);
});

function positionOf(room, playerId) {
  const tank = room.gameState?.tanks.find((item) => item.playerId === playerId);
  return tank ? `${tank.x},${tank.y}` : "missing";
}

function formatRegressionDebug(room, actions, logs) {
  return JSON.stringify({
    status: room.status,
    tick: room.gameState?.tick,
    actions,
    playerA: room.gameState?.tanks.find((tank) => tank.playerId === "A"),
    recentLogs: logs.slice(-12)
  }, null, 2);
}
