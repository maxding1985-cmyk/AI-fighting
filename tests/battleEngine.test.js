import test from "node:test";
import assert from "node:assert/strict";
import { BattleEngine } from "../src/shared/battleEngine.js";
import { validateRuleSet } from "../src/shared/rules.js";
import { generateLocalStrategyRules } from "../src/shared/localStrategyGenerator.js";

const shooter = {
  name: "测试射击",
  description: "敌人在直线时射击",
  rules: [
    { priority: 100, when: ["enemy_in_line", "can_shoot"], action: "shoot" },
    { priority: 1, when: ["always"], action: "wait" }
  ]
};

const walker = {
  name: "测试前进",
  description: "一直向前",
  rules: [
    { priority: 1, when: ["always"], action: "move_forward" }
  ]
};

const waiter = {
  name: "测试等待",
  description: "一直等待",
  rules: [
    { priority: 1, when: ["always"], action: "wait" }
  ]
};

test("validateRuleSet rejects unknown actions", () => {
  const result = validateRuleSet({
    name: "非法规则",
    rules: [
      { priority: 100, when: ["always"], action: "teleport" }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /未知动作/);
});

test("a bullet hit finishes the battle and sets winner", () => {
  const engine = new BattleEngine({
    seed: 7,
    maxTicks: 10,
    map: { width: 7, height: 3, walls: [] },
    ruleSets: { A: shooter, B: waiter }
  });

  engine.state.tanks[0] = {
    ...engine.state.tanks[0],
    x: 1,
    y: 1,
    direction: "right"
  };
  engine.state.tanks[1] = {
    ...engine.state.tanks[1],
    x: 5,
    y: 1,
    direction: "left"
  };

  let state = engine.getState();
  while (state.status !== "finished") {
    state = engine.step();
  }

  assert.equal(state.result.winnerPlayerId, "A");
  assert.equal(state.tanks.find((tank) => tank.playerId === "B").alive, false);
});

test("battle records rule trigger stats and decisive hit rule", () => {
  const engine = new BattleEngine({
    seed: 7,
    maxTicks: 10,
    map: { width: 7, height: 3, walls: [] },
    ruleSets: { A: shooter, B: waiter }
  });

  engine.state.tanks[0] = {
    ...engine.state.tanks[0],
    x: 1,
    y: 1,
    direction: "right"
  };
  engine.state.tanks[1] = {
    ...engine.state.tanks[1],
    x: 5,
    y: 1,
    direction: "left"
  };

  let state = engine.getState();
  while (state.status !== "finished") {
    state = engine.step();
  }

  const playerAStats = Object.values(state.ruleStats.A);
  const shootStats = playerAStats.find((item) => item.rule.action === "shoot");

  assert.equal(Boolean(shootStats), true);
  assert.equal(shootStats.count > 0, true);
  assert.equal(state.result.decisiveRule.playerId, "A");
  assert.equal(state.result.decisiveRule.rule.action, "shoot");
});

test("tank cannot move outside the map", () => {
  const engine = new BattleEngine({
    seed: 8,
    maxTicks: 3,
    map: { width: 5, height: 5, walls: [] },
    ruleSets: { A: walker, B: waiter }
  });

  engine.state.tanks[0] = {
    ...engine.state.tanks[0],
    x: 0,
    y: 1,
    direction: "left"
  };

  const state = engine.step();
  assert.equal(state.tanks[0].x, 0);
  assert.equal(state.tanks[0].y, 1);
});

test("battle ends in draw on timeout", () => {
  const engine = new BattleEngine({
    seed: 9,
    maxTicks: 2,
    map: { width: 7, height: 3, walls: [] },
    ruleSets: { A: waiter, B: waiter }
  });

  engine.step();
  const state = engine.step();

  assert.equal(state.status, "finished");
  assert.equal(state.result.type, "draw");
  assert.equal(state.result.reason, "timeout");
});

test("local random movement shooting prompt generates movement and fire rules", () => {
  const ruleSet = generateLocalStrategyRules("随机运动 一直开炮 遇到子弹躲避");
  const actions = new Set(ruleSet.rules.map((rule) => rule.action));

  assert.equal(ruleSet.name, "随机游走火力型");
  assert.equal(actions.has("shoot"), true);
  assert.equal(actions.has("move_forward") || actions.has("move_backward"), true);
  assert.equal(ruleSet.rules.some((rule) => rule.when.includes("bullet_in_front") || rule.when.includes("bullet_near")), true);
});

test("shoot rule falls through to movement while weapon is cooling down", () => {
  const alwaysShootThenMove = {
    name: "一直射击后移动",
    description: "冷却时继续移动",
    rules: [
      { priority: 100, when: ["always"], action: "shoot" },
      { priority: 50, when: ["path_forward_clear"], action: "move_forward" },
      { priority: 1, when: ["always"], action: "wait" }
    ]
  };
  const engine = new BattleEngine({
    seed: 12,
    maxTicks: 4,
    map: { width: 7, height: 5, walls: [] },
    ruleSets: { A: alwaysShootThenMove, B: waiter }
  });

  engine.state.tanks[0] = {
    ...engine.state.tanks[0],
    x: 1,
    y: 2,
    direction: "right"
  };
  engine.state.tanks[1] = {
    ...engine.state.tanks[1],
    x: 5,
    y: 4,
    direction: "left"
  };

  engine.step();
  const state = engine.step();

  assert.equal(state.lastActions.A.action, "move_forward");
  assert.equal(state.tanks.find((tank) => tank.playerId === "A").x, 2);
});
