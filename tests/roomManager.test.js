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
