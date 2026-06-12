import {
  DEFAULT_WALLS,
  DIRECTION_ORDER,
  DIRECTIONS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_TICKS,
  SHOOT_COOLDOWN_TICKS
} from "./constants.js";
import { builtInRuleSets, cloneRuleSet, validateRuleSet } from "./rules.js";

function createRng(seed = Date.now()) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function createId(prefix, tick, index) {
  return `${prefix}-${tick}-${index}`;
}

function addVector(position, direction, multiplier = 1) {
  const vector = DIRECTIONS[direction];
  return {
    x: position.x + vector.dx * multiplier,
    y: position.y + vector.dy * multiplier
  };
}

function turn(direction, offset) {
  const index = DIRECTION_ORDER.indexOf(direction);
  return DIRECTION_ORDER[(index + offset + DIRECTION_ORDER.length) % DIRECTION_ORDER.length];
}

function oppositeDirection(direction) {
  return turn(direction, 2);
}

function positionKey(position) {
  return `${position.x},${position.y}`;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function createInitialState(options = {}) {
  const map = {
    width: options.map?.width || MAP_WIDTH,
    height: options.map?.height || MAP_HEIGHT,
    walls: options.map?.walls ? [...options.map.walls] : [...DEFAULT_WALLS]
  };

  return {
    status: "fighting",
    tick: 0,
    map,
    tanks: [
      {
        id: "tank-a",
        playerId: "A",
        name: options.playerAName || "玩家 A",
        x: 1,
        y: map.height - 2,
        direction: "right",
        alive: true,
        shootCooldown: 0
      },
      {
        id: "tank-b",
        playerId: "B",
        name: options.playerBName || "玩家 B",
        x: map.width - 2,
        y: 1,
        direction: "left",
        alive: true,
        shootCooldown: 0
      }
    ],
    bullets: [],
    lastActions: {},
    ruleStats: {
      A: {},
      B: {}
    },
    logs: [],
    result: null
  };
}

export class BattleEngine {
  constructor(options = {}) {
    this.maxTicks = options.maxTicks || MAX_TICKS;
    this.rng = createRng(options.seed);
    this.state = options.state ? cloneState(options.state) : createInitialState(options);
    this.ruleSets = normalizeRuleSets(options.ruleSets);
    this.ensureRuleStats();
  }

  reset(options = {}) {
    this.maxTicks = options.maxTicks || this.maxTicks;
    this.rng = createRng(options.seed);
    this.state = createInitialState(options);
    this.ruleSets = normalizeRuleSets(options.ruleSets || this.ruleSets);
    this.ensureRuleStats();
    return this.getState();
  }

  getState() {
    return cloneState(this.state);
  }

  step() {
    if (this.state.status === "finished") {
      return this.getState();
    }

    const state = this.state;
    state.tick += 1;
    state.lastActions = {};

    state.tanks.forEach((tank) => {
      tank.shootCooldown = Math.max(0, tank.shootCooldown - 1);
    });

    const snapshot = cloneState(state);
    const actionPlans = state.tanks
      .filter((tank) => tank.alive)
      .map((tank) => ({
        tankId: tank.id,
        playerId: tank.playerId,
        ...selectAction(snapshot, tank.id, this.ruleSets[tank.playerId], this.rng)
      }));

    actionPlans.forEach((plan) => {
      state.lastActions[plan.playerId] = {
        action: plan.action,
        rule: plan.rule,
        ruleKey: createRuleKey(plan.rule)
      };
      this.recordRuleTrigger(plan);
    });
    actionPlans.forEach((plan) => {
      const tank = this.findTank(plan.tankId);
      if (tank) {
        this.addDecisionLog(tank, plan);
      }
    });

    this.applyTurns(actionPlans);
    this.applyMovement(actionPlans);
    this.applyShooting(actionPlans);
    this.moveBulletsAndResolveHits();

    if (state.status !== "finished" && state.tick >= this.maxTicks) {
      this.finishBattle({
        type: "draw",
        reason: "timeout",
        message: "战斗超时，双方平局"
      });
    }

    return this.getState();
  }

  applyTurns(actionPlans) {
    actionPlans.forEach((plan) => {
      const tank = this.findTank(plan.tankId);
      if (!tank || !tank.alive) {
        return;
      }

      if (plan.action === "turn_left") {
        tank.direction = turn(tank.direction, -1);
      }

      if (plan.action === "turn_right") {
        tank.direction = turn(tank.direction, 1);
      }
    });
  }

  applyMovement(actionPlans) {
    const desiredMoves = [];

    actionPlans.forEach((plan) => {
      if (plan.action !== "move_forward" && plan.action !== "move_backward") {
        return;
      }

      const tank = this.findTank(plan.tankId);
      if (!tank || !tank.alive) {
        return;
      }

      const direction = plan.action === "move_forward"
        ? tank.direction
        : oppositeDirection(tank.direction);
      const to = addVector(tank, direction);

      if (!this.isCellOpen(to, tank.id)) {
        this.addLog(`${tank.name} 移动受阻`);
        return;
      }

      desiredMoves.push({ tank, to });
    });

    const targetCounts = desiredMoves.reduce((counts, move) => {
      const key = positionKey(move.to);
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map());

    desiredMoves.forEach((move) => {
      const key = positionKey(move.to);
      if (targetCounts.get(key) > 1 || this.isTankSwap(move)) {
        this.addLog(`${move.tank.name} 与对手抢位失败`);
        return;
      }

      move.tank.x = move.to.x;
      move.tank.y = move.to.y;
    });
  }

  applyShooting(actionPlans) {
    actionPlans.forEach((plan, index) => {
      if (plan.action !== "shoot") {
        return;
      }

      const tank = this.findTank(plan.tankId);
      if (!tank || !tank.alive || !this.canTankShoot(tank)) {
        return;
      }

      this.state.bullets.push({
        id: createId("bullet", this.state.tick, index),
        ownerTankId: tank.id,
        ownerPlayerId: tank.playerId,
        sourceRule: cloneRuleForTelemetry(plan.rule),
        sourceRuleKey: createRuleKey(plan.rule),
        x: tank.x,
        y: tank.y,
        direction: tank.direction
      });
      tank.shootCooldown = SHOOT_COOLDOWN_TICKS;
      this.addLog(`${tank.name} 开火`);
    });
  }

  moveBulletsAndResolveHits() {
    const nextBullets = [];
    const hits = [];

    this.state.bullets.forEach((bullet) => {
      const next = addVector(bullet, bullet.direction);
      if (this.isOutOfBounds(next) || this.isWall(next)) {
        return;
      }

      const hitTank = this.state.tanks.find((tank) =>
        tank.alive &&
        tank.id !== bullet.ownerTankId &&
        tank.x === next.x &&
        tank.y === next.y
      );

      if (hitTank) {
        hits.push({ bullet, tank: hitTank });
        return;
      }

      nextBullets.push({ ...bullet, x: next.x, y: next.y });
    });

    this.state.bullets = nextBullets;

    if (hits.length === 0) {
      return;
    }

    const hitTankIds = new Set(hits.map((hit) => hit.tank.id));
    this.state.tanks.forEach((tank) => {
      if (hitTankIds.has(tank.id)) {
        tank.alive = false;
      }
    });

    if (hitTankIds.size > 1) {
      this.finishBattle({
        type: "draw",
        reason: "both_hit",
        message: "双方同时被击中，平局"
      });
      return;
    }

    const loser = hits[0].tank;
    const winner = this.state.tanks.find((tank) => tank.id !== loser.id);
    const decisiveRule = hits[0].bullet.sourceRule
      ? {
          playerId: hits[0].bullet.ownerPlayerId || winner.playerId,
          rule: hits[0].bullet.sourceRule,
          ruleKey: hits[0].bullet.sourceRuleKey || createRuleKey(hits[0].bullet.sourceRule)
        }
      : null;
    this.finishBattle({
      type: "win",
      reason: `${winner.playerId.toLowerCase()}_hit_${loser.playerId.toLowerCase()}`,
      winnerPlayerId: winner.playerId,
      loserPlayerId: loser.playerId,
      decisiveRule,
      message: `${winner.name} 击中 ${loser.name}，获得胜利`
    });
  }

  finishBattle(result) {
    this.state.status = "finished";
    this.state.result = {
      ...result,
      tick: this.state.tick
    };
    this.addLog(result.message);
  }

  canTankShoot(tank) {
    return (
      tank.shootCooldown <= 0 &&
      !this.state.bullets.some((bullet) => bullet.ownerTankId === tank.id)
    );
  }

  findTank(tankId) {
    return this.state.tanks.find((tank) => tank.id === tankId);
  }

  isOutOfBounds(position) {
    return (
      position.x < 0 ||
      position.y < 0 ||
      position.x >= this.state.map.width ||
      position.y >= this.state.map.height
    );
  }

  isWall(position) {
    return this.state.map.walls.some((wall) => wall.x === position.x && wall.y === position.y);
  }

  isCellOpen(position, movingTankId) {
    if (this.isOutOfBounds(position) || this.isWall(position)) {
      return false;
    }

    return !this.state.tanks.some((tank) =>
      tank.alive &&
      tank.id !== movingTankId &&
      tank.x === position.x &&
      tank.y === position.y
    );
  }

  isTankSwap(move) {
    const other = this.state.tanks.find((tank) => tank.alive && tank.id !== move.tank.id);
    if (!other) {
      return false;
    }

    return move.to.x === other.x && move.to.y === other.y;
  }

  addLog(message) {
    this.state.logs.unshift({
      tick: this.state.tick,
      message
    });
    this.state.logs = this.state.logs.slice(0, 40);
  }

  addDecisionLog(tank, plan) {
    const ruleText = plan.rule
      ? `P${plan.rule.priority} ${formatConditions(plan.rule.when)}`
      : "无可执行规则";
    const skippedText = plan.debug?.skipped?.length
      ? `；已跳过 ${formatSkippedRule(plan.debug.skipped[0])}`
      : "";
    this.addLog(`${tank.name} 决策：${ruleText} -> ${formatAction(plan.action)}${skippedText}`);
  }

  ensureRuleStats() {
    this.state.ruleStats = this.state.ruleStats || {};
    ["A", "B"].forEach((playerId) => {
      this.state.ruleStats[playerId] = this.state.ruleStats[playerId] || {};
    });
  }

  recordRuleTrigger(plan) {
    if (!plan.rule) {
      return;
    }

    this.ensureRuleStats();
    const ruleKey = createRuleKey(plan.rule);
    const playerStats = this.state.ruleStats[plan.playerId];
    if (!playerStats[ruleKey]) {
      playerStats[ruleKey] = {
        ruleKey,
        rule: cloneRuleForTelemetry(plan.rule),
        count: 0,
        firstTick: this.state.tick,
        lastTick: this.state.tick
      };
    }

    playerStats[ruleKey].count += 1;
    playerStats[ruleKey].lastTick = this.state.tick;
  }
}

const ACTION_DEBUG_LABELS = Object.freeze({
  move_forward: "前进",
  move_backward: "后退",
  turn_left: "左转",
  turn_right: "右转",
  shoot: "射击",
  wait: "等待"
});

const CONDITION_DEBUG_LABELS = Object.freeze({
  always: "始终",
  enemy_in_line: "敌人在炮线",
  enemy_near: "敌人较近",
  enemy_on_left: "敌人在左侧",
  enemy_on_right: "敌人在右侧",
  enemy_behind: "敌人在身后",
  wall_ahead: "前方受阻",
  wall_behind: "后方受阻",
  can_shoot: "可以射击",
  bullet_in_front: "正前方有子弹",
  bullet_near: "附近有子弹",
  path_forward_clear: "前方可走",
  random_30: "30%随机"
});

function normalizeRuleSets(ruleSets = {}) {
  const fallback = {
    A: cloneRuleSet(builtInRuleSets.aggressive),
    B: cloneRuleSet(builtInRuleSets.defensive)
  };

  const normalized = {};
  ["A", "B"].forEach((playerId) => {
    const validation = validateRuleSet(ruleSets[playerId] || fallback[playerId]);
    if (!validation.ok) {
      throw new Error(`玩家 ${playerId} 规则无效: ${validation.errors.join("; ")}`);
    }
    normalized[playerId] = validation.ruleSet;
  });

  return normalized;
}

function createRuleKey(rule) {
  if (!rule) {
    return "";
  }

  return `${rule.priority}|${rule.when.join("&")}|${rule.action}`;
}

function cloneRuleForTelemetry(rule) {
  if (!rule) {
    return null;
  }

  return {
    priority: rule.priority,
    when: [...rule.when],
    action: rule.action
  };
}

function selectAction(state, tankId, ruleSet, rng) {
  const tank = state.tanks.find((item) => item.id === tankId);
  if (!tank || !tank.alive) {
    return { action: "wait", rule: null, debug: { skipped: [] } };
  }

  const skipped = [];
  for (const rule of ruleSet.rules) {
    const checks = rule.when.map((condition) => ({
      condition,
      passed: evaluateCondition(condition, state, tank, rng)
    }));
    const matched = checks.every((check) => check.passed);
    if (!matched) {
      continue;
    }

    const executable = getActionExecution(rule.action, state, tank);
    if (executable.ok) {
      return { action: rule.action, rule, debug: { checks, skipped } };
    }

    skipped.push({ rule, reason: executable.reason });
  }

  return { action: "wait", rule: null, debug: { skipped } };
}

function getActionExecution(action, state, tank) {
  if (action === "shoot") {
    if (tank.shootCooldown > 0) {
      return { ok: false, reason: `射击冷却 ${tank.shootCooldown} tick` };
    }
    if (state.bullets.some((bullet) => bullet.ownerTankId === tank.id)) {
      return { ok: false, reason: "已有己方炮弹在场" };
    }
    return { ok: true };
  }

  if (action === "move_forward" || action === "move_backward") {
    const direction = action === "move_forward"
      ? tank.direction
      : oppositeDirection(tank.direction);
    const to = addVector(tank, direction);
    if (!isBlockedForState(state, to, tank.id)) {
      return { ok: true };
    }

    const label = action === "move_forward" ? "前方" : "后方";
    return { ok: false, reason: describeBlockedCell(state, to, tank.id, label) };
  }

  return { ok: true };
}

function evaluateCondition(condition, state, tank, rng) {
  const enemy = state.tanks.find((item) => item.id !== tank.id && item.alive);

  switch (condition) {
    case "always":
      return true;
    case "enemy_in_line":
      return Boolean(enemy && isEnemyInLine(state, tank, enemy));
    case "enemy_near":
      return Boolean(enemy && manhattan(tank, enemy) <= 4);
    case "enemy_on_left":
      return Boolean(enemy && relativeEnemyDirection(tank, enemy) === "left");
    case "enemy_on_right":
      return Boolean(enemy && relativeEnemyDirection(tank, enemy) === "right");
    case "enemy_behind":
      return Boolean(enemy && relativeEnemyDirection(tank, enemy) === "behind");
    case "wall_ahead":
      return isBlockedForState(state, addVector(tank, tank.direction));
    case "wall_behind":
      return isBlockedForState(state, addVector(tank, oppositeDirection(tank.direction)));
    case "can_shoot":
      return canShootInState(state, tank);
    case "bullet_in_front":
      return hasBulletInFront(state, tank);
    case "bullet_near":
      return state.bullets.some((bullet) =>
        bullet.ownerTankId !== tank.id && manhattan(tank, bullet) <= 3
      );
    case "path_forward_clear":
      return !isBlockedForState(state, addVector(tank, tank.direction), tank.id);
    case "random_30":
      return rng() < 0.3;
    default:
      return false;
  }
}

function canShootInState(state, tank) {
  return tank.shootCooldown <= 0 &&
    !state.bullets.some((bullet) => bullet.ownerTankId === tank.id);
}

function isEnemyInLine(state, tank, enemy) {
  if (tank.direction === "up" && enemy.x === tank.x && enemy.y < tank.y) {
    return hasClearLine(state, tank, enemy);
  }
  if (tank.direction === "down" && enemy.x === tank.x && enemy.y > tank.y) {
    return hasClearLine(state, tank, enemy);
  }
  if (tank.direction === "left" && enemy.y === tank.y && enemy.x < tank.x) {
    return hasClearLine(state, tank, enemy);
  }
  if (tank.direction === "right" && enemy.y === tank.y && enemy.x > tank.x) {
    return hasClearLine(state, tank, enemy);
  }
  return false;
}

function hasClearLine(state, from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let cursor = { x: from.x + dx, y: from.y + dy };

  while (cursor.x !== to.x || cursor.y !== to.y) {
    if (state.map.walls.some((wall) => wall.x === cursor.x && wall.y === cursor.y)) {
      return false;
    }
    cursor = { x: cursor.x + dx, y: cursor.y + dy };
  }

  return true;
}

function relativeEnemyDirection(tank, enemy) {
  const dx = enemy.x - tank.x;
  const dy = enemy.y - tank.y;
  const absoluteDirection = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "down" : "up");

  if (absoluteDirection === tank.direction) {
    return "front";
  }
  if (absoluteDirection === oppositeDirection(tank.direction)) {
    return "behind";
  }
  if (absoluteDirection === turn(tank.direction, -1)) {
    return "left";
  }
  return "right";
}

function hasBulletInFront(state, tank) {
  return state.bullets.some((bullet) => {
    if (bullet.ownerTankId === tank.id || bullet.direction !== oppositeDirection(tank.direction)) {
      return false;
    }
    if (tank.direction === "up") {
      return bullet.x === tank.x && bullet.y < tank.y && hasClearLine(state, bullet, tank);
    }
    if (tank.direction === "down") {
      return bullet.x === tank.x && bullet.y > tank.y && hasClearLine(state, bullet, tank);
    }
    if (tank.direction === "left") {
      return bullet.y === tank.y && bullet.x < tank.x && hasClearLine(state, bullet, tank);
    }
    if (tank.direction === "right") {
      return bullet.y === tank.y && bullet.x > tank.x && hasClearLine(state, bullet, tank);
    }
    return false;
  });
}

function isBlockedForState(state, position, movingTankId = null) {
  const outOfBounds =
    position.x < 0 ||
    position.y < 0 ||
    position.x >= state.map.width ||
    position.y >= state.map.height;

  if (outOfBounds) {
    return true;
  }

  const wall = state.map.walls.some((item) => item.x === position.x && item.y === position.y);
  if (wall) {
    return true;
  }

  return state.tanks.some((other) =>
    other.alive &&
    other.id !== movingTankId &&
    other.x === position.x &&
    other.y === position.y
  );
}

function describeBlockedCell(state, position, movingTankId, label) {
  if (
    position.x < 0 ||
    position.y < 0 ||
    position.x >= state.map.width ||
    position.y >= state.map.height
  ) {
    return `${label}越界`;
  }

  if (state.map.walls.some((wall) => wall.x === position.x && wall.y === position.y)) {
    return `${label}有墙`;
  }

  const tank = state.tanks.find((other) =>
    other.alive &&
    other.id !== movingTankId &&
    other.x === position.x &&
    other.y === position.y
  );
  if (tank) {
    return `${label}被${tank.name}占据`;
  }

  return `${label}受阻`;
}

function formatConditions(conditions) {
  return conditions
    .map((condition) => CONDITION_DEBUG_LABELS[condition] || condition)
    .join("+");
}

function formatAction(action) {
  return ACTION_DEBUG_LABELS[action] || action;
}

function formatSkippedRule(item) {
  return `P${item.rule.priority} ${formatAction(item.rule.action)}（${item.reason}）`;
}
