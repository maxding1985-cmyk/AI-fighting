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
      maxTicks: 60
    }
  });
  const events = [];
  const created = manager.createRoom({ playerName: "Alpha" });
  const code = created.room.code;
  manager.subscribe(code, (event) => events.push(event));
  manager.joinRoom(code, { playerName: "Bravo" });

  const ruleA = manager.generateStrategy("我要主动进攻，看到敌人在直线上就开炮。");
  const ruleB = manager.generateStrategy("我要灵活游走，发现直线机会就反击。");
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
