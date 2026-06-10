import { randomBytes } from "node:crypto";
import { BattleEngine } from "../shared/battleEngine.js";
import { TICK_MS } from "../shared/constants.js";
import { generateLocalStrategyRules } from "../shared/localStrategyGenerator.js";
import { validateRuleSet } from "../shared/rules.js";

const PLAYER_IDS = Object.freeze(["A", "B"]);

export class RoomError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class RoomManager {
  constructor(options = {}) {
    this.rooms = new Map();
    this.autoTick = options.autoTick ?? true;
    this.tickMs = options.tickMs || TICK_MS;
    this.battleOptions = options.battleOptions || {};
    this.codeLength = options.codeLength || 6;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 5000;
    this.tokenFactory = options.tokenFactory || createPlayerToken;
    this.strategyGenerator = options.strategyGenerator || {
      generate: (prompt) => generateLocalStrategyRules(prompt)
    };
  }

  createRoom({ playerName = "玩家 A" } = {}) {
    const code = this.createUniqueCode();
    const room = {
      code,
      status: "waiting",
      players: {
        A: createPlayer("A", playerName, this.tokenFactory()),
        B: null
      },
      connections: { A: 0, B: 0 },
      disconnectTimers: { A: null, B: null },
      listeners: new Set(),
      engine: null,
      timer: null,
      gameState: null,
      result: null,
      exitRequest: null,
      closedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.rooms.set(code, room);
    return {
      playerId: "A",
      playerToken: room.players.A.token,
      room: this.getSnapshot(code)
    };
  }

  joinRoom(code, { playerName = "玩家 B" } = {}) {
    const room = this.getRoom(code);
    if (room.status === "closed") {
      throw new RoomError(409, "房间已退出");
    }

    if (room.players.B) {
      throw new RoomError(409, "房间已满");
    }

    room.players.B = createPlayer("B", playerName, this.tokenFactory());
    room.status = "preparing";
    this.touch(room);
    this.emit(room, "room:update", this.toSnapshot(room));

    return {
      playerId: "B",
      playerToken: room.players.B.token,
      room: this.toSnapshot(room)
    };
  }

  restorePlayer(code, playerId, token) {
    const { room, player } = this.verifyPlayerToken(code, playerId, token);
    return {
      playerId: player.id,
      playerToken: player.token,
      room: this.toSnapshot(room)
    };
  }

  generateStrategy(prompt, options = {}) {
    return this.strategyGenerator.generate(prompt, options);
  }

  confirmStrategy(code, playerId, ruleSet) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, playerId);
    const validation = validateRuleSet(ruleSet);

    if (!validation.ok) {
      throw new RoomError(400, validation.errors.join("；"));
    }

    if (room.status === "fighting") {
      throw new RoomError(409, "战斗已经开始，不能修改规则");
    }
    if (room.status === "closed") {
      throw new RoomError(409, "房间已退出，不能修改规则");
    }
    if (room.exitRequest) {
      throw new RoomError(409, "退出请求待确认，不能修改规则");
    }

    player.ruleSet = validation.ruleSet;
    player.ready = true;
    room.status = room.players.B ? "preparing" : "waiting";
    this.touch(room);
    this.emit(room, "room:update", this.toSnapshot(room));

    if (this.areBothPlayersReady(room)) {
      this.startBattle(room);
    }

    return this.toSnapshot(room);
  }

  restartRoom(code) {
    const room = this.getRoom(code);
    if (room.status === "closed") {
      throw new RoomError(409, "房间已退出，不能再来一局");
    }
    if (room.exitRequest) {
      throw new RoomError(409, "退出请求待确认，不能再来一局");
    }

    this.stopTimer(room);

    PLAYER_IDS.forEach((playerId) => {
      const player = room.players[playerId];
      if (player) {
        player.ready = false;
        player.ruleSet = null;
      }
    });

    room.engine = null;
    room.gameState = null;
    room.result = null;
    room.exitRequest = null;
    room.status = room.players.B ? "preparing" : "waiting";
    this.touch(room);
    this.emit(room, "room:update", this.toSnapshot(room));
    return this.toSnapshot(room);
  }

  requestExit(code, playerId) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, playerId);

    if (room.status === "closed") {
      return this.toSnapshot(room);
    }

    const opponentId = getOpponentId(playerId);
    if (!room.players[opponentId] || !room.players[opponentId].connected) {
      return this.closeRoom(room, {
        requesterId: playerId,
        confirmerId: playerId,
        message: `${player.name} 已退出房间`
      });
    }

    if (room.exitRequest?.requesterId === playerId) {
      return this.toSnapshot(room);
    }

    if (room.exitRequest && room.exitRequest.requesterId !== playerId) {
      return this.confirmExit(code, playerId);
    }

    room.exitRequest = {
      requesterId: playerId,
      requestedAt: Date.now()
    };
    this.touch(room);
    this.emit(room, "room:update", this.toSnapshot(room));
    return this.toSnapshot(room);
  }

  confirmExit(code, playerId) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, playerId);

    if (room.status === "closed") {
      return this.toSnapshot(room);
    }

    if (!room.exitRequest) {
      throw new RoomError(409, "当前没有待确认的退出请求");
    }

    if (room.exitRequest.requesterId === playerId) {
      throw new RoomError(409, "退出请求需要另一名玩家确认");
    }

    const requester = this.getPlayer(room, room.exitRequest.requesterId);
    return this.closeRoom(room, {
      requesterId: requester.id,
      confirmerId: player.id,
      message: `${requester.name} 请求退出，${player.name} 已确认，游戏已退出`
    });
  }

  tickRoom(code) {
    const room = this.getRoom(code);
    if (!room.engine || room.status !== "fighting") {
      return this.toSnapshot(room);
    }

    room.gameState = room.engine.step();
    this.touch(room);
    this.emit(room, "battle:state", {
      room: this.toSnapshot(room),
      gameState: room.gameState
    });

    if (room.gameState.status === "finished") {
      room.status = "finished";
      room.result = room.gameState.result;
      this.stopTimer(room);
      this.touch(room);
      this.emit(room, "battle:end", {
        room: this.toSnapshot(room),
        gameState: room.gameState,
        result: room.result
      });
      this.emit(room, "room:update", this.toSnapshot(room));
    }

    return this.toSnapshot(room);
  }

  subscribe(code, listener) {
    const room = this.getRoom(code);
    room.listeners.add(listener);
    return () => {
      room.listeners.delete(listener);
    };
  }

  connectPlayer(code, playerId) {
    const room = this.getRoom(code);
    this.getPlayer(room, playerId);
    if (room.disconnectTimers[playerId]) {
      clearTimeout(room.disconnectTimers[playerId]);
      room.disconnectTimers[playerId] = null;
    }

    room.connections[playerId] += 1;
    room.players[playerId].connected = true;
    this.touch(room);
    this.emit(room, "room:update", this.toSnapshot(room));
    return this.toSnapshot(room);
  }

  disconnectPlayer(code, playerId) {
    const room = this.rooms.get(code);
    if (!room || !room.players[playerId]) {
      return null;
    }

    room.connections[playerId] = Math.max(0, room.connections[playerId] - 1);
    if (room.connections[playerId] > 0) {
      return this.toSnapshot(room);
    }

    if (room.disconnectTimers[playerId]) {
      return this.toSnapshot(room);
    }

    if (this.disconnectGraceMs <= 0) {
      this.markPlayerDisconnected(code, playerId);
      return this.toSnapshot(room);
    }

    room.disconnectTimers[playerId] = setTimeout(() => {
      this.markPlayerDisconnected(code, playerId);
    }, this.disconnectGraceMs);
    return this.toSnapshot(room);
  }

  getSnapshot(code) {
    return this.toSnapshot(this.getRoom(code));
  }

  getRoom(code) {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) {
      throw new RoomError(404, "房间不存在");
    }
    return room;
  }

  getPlayer(room, playerId) {
    if (!PLAYER_IDS.includes(playerId) || !room.players[playerId]) {
      throw new RoomError(404, "玩家不存在");
    }
    return room.players[playerId];
  }

  verifyPlayerToken(code, playerId, token) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, playerId);
    if (!isSameToken(player.token, token)) {
      throw new RoomError(403, "玩家身份凭证无效，请重新加入房间");
    }

    return { room, player };
  }

  startBattle(room) {
    if (room.status === "closed") {
      throw new RoomError(409, "房间已退出，不能开始战斗");
    }

    this.stopTimer(room);
    const ruleSets = {
      A: room.players.A.ruleSet,
      B: room.players.B.ruleSet
    };
    room.engine = new BattleEngine({
      ...this.battleOptions,
      playerAName: room.players.A.name,
      playerBName: room.players.B.name,
      ruleSets
    });
    room.gameState = room.engine.getState();
    room.status = "fighting";
    room.result = null;
    room.exitRequest = null;
    this.touch(room);
    this.emit(room, "room:update", this.toSnapshot(room));
    this.emit(room, "battle:state", {
      room: this.toSnapshot(room),
      gameState: room.gameState
    });

    if (this.autoTick) {
      room.timer = setInterval(() => this.tickRoom(room.code), this.tickMs);
    }
  }

  areBothPlayersReady(room) {
    return Boolean(room.players.A?.ready && room.players.B?.ready);
  }

  stopTimer(room) {
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
  }

  markPlayerDisconnected(code, playerId) {
    const room = this.rooms.get(code);
    if (!room || !room.players[playerId] || room.connections[playerId] > 0) {
      return;
    }

    room.disconnectTimers[playerId] = null;
    room.players[playerId].connected = false;
    this.touch(room);
    this.emit(room, "room:update", this.toSnapshot(room));
  }

  createUniqueCode() {
    let code = "";
    do {
      code = Array.from({ length: this.codeLength }, () =>
        Math.floor(Math.random() * 36).toString(36).toUpperCase()
      ).join("");
    } while (this.rooms.has(code));
    return code;
  }

  touch(room) {
    room.updatedAt = Date.now();
  }

  emit(room, event, data) {
    room.listeners.forEach((listener) => {
      listener(event, data);
    });
  }

  closeRoom(room, { requesterId, confirmerId, message }) {
    this.stopTimer(room);
    room.status = "closed";
    room.closedAt = Date.now();
    room.exitRequest = {
      requesterId,
      confirmerId,
      requestedAt: room.exitRequest?.requestedAt || Date.now(),
      confirmedAt: Date.now()
    };
    room.result = {
      type: "exit",
      reason: "player_exit",
      requesterPlayerId: requesterId,
      confirmerPlayerId: confirmerId,
      message,
      tick: room.gameState?.tick || 0
    };
    this.touch(room);
    const snapshot = this.toSnapshot(room);
    this.emit(room, "room:update", snapshot);
    this.emit(room, "room:closed", {
      room: snapshot,
      result: room.result
    });
    return snapshot;
  }

  toSnapshot(room) {
    return {
      code: room.code,
      status: room.status,
      players: PLAYER_IDS.map((playerId) => room.players[playerId]).filter(Boolean).map((player) => ({
        id: player.id,
        name: player.name,
        connected: player.connected,
        ready: player.ready,
        strategyName: player.ruleSet?.name || null,
        strategyDescription: player.ruleSet?.description || null,
        ruleSet: player.ruleSet
      })),
      gameState: room.gameState,
      result: room.result,
      exitRequest: room.exitRequest,
      closedAt: room.closedAt,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt
    };
  }
}

function createPlayer(id, name, token) {
  return {
    id,
    name: String(name || `玩家 ${id}`).trim().slice(0, 18) || `玩家 ${id}`,
    token,
    connected: false,
    ready: false,
    ruleSet: null
  };
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function getOpponentId(playerId) {
  return playerId === "A" ? "B" : "A";
}

function createPlayerToken() {
  return randomBytes(24).toString("base64url");
}

function isSameToken(expected, actual) {
  return typeof actual === "string" && actual.length > 0 && expected === actual;
}
