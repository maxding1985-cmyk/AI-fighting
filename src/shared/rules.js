import { MAX_RULES, RULE_CONDITIONS, TANK_ACTIONS } from "./constants.js";

const conditionSet = new Set(RULE_CONDITIONS);
const actionSet = new Set(TANK_ACTIONS);

export const builtInRuleSets = Object.freeze({
  aggressive: {
    name: "强攻压制型",
    description: "优先寻找直线开炮机会，平时主动向敌人方向靠近。",
    rules: [
      { priority: 100, when: ["enemy_in_line", "can_shoot"], action: "shoot" },
      { priority: 80, when: ["wall_ahead"], action: "turn_right" },
      { priority: 70, when: ["enemy_on_left"], action: "turn_left" },
      { priority: 70, when: ["enemy_on_right"], action: "turn_right" },
      { priority: 40, when: ["path_forward_clear"], action: "move_forward" },
      { priority: 10, when: ["always"], action: "wait" }
    ]
  },
  defensive: {
    name: "稳健防守型",
    description: "优先避开来袭子弹，看到敌人进入直线才反击。",
    rules: [
      { priority: 100, when: ["bullet_in_front"], action: "move_backward" },
      { priority: 90, when: ["bullet_near", "path_forward_clear"], action: "move_forward" },
      { priority: 80, when: ["enemy_in_line", "can_shoot"], action: "shoot" },
      { priority: 60, when: ["wall_behind"], action: "turn_left" },
      { priority: 30, when: ["random_30"], action: "turn_right" },
      { priority: 10, when: ["always"], action: "wait" }
    ]
  },
  sniper: {
    name: "直线狙击型",
    description: "尽量调整朝向让敌人进入炮线，并在冷却完成后射击。",
    rules: [
      { priority: 100, when: ["enemy_in_line", "can_shoot"], action: "shoot" },
      { priority: 75, when: ["enemy_on_left"], action: "turn_left" },
      { priority: 75, when: ["enemy_on_right"], action: "turn_right" },
      { priority: 55, when: ["enemy_behind"], action: "turn_right" },
      { priority: 35, when: ["wall_ahead"], action: "turn_left" },
      { priority: 10, when: ["always"], action: "wait" }
    ]
  },
  wanderer: {
    name: "游走扰动型",
    description: "带一点随机性地游走，遇到机会就开炮。",
    rules: [
      { priority: 100, when: ["enemy_in_line", "can_shoot"], action: "shoot" },
      { priority: 80, when: ["bullet_in_front"], action: "turn_right" },
      { priority: 65, when: ["wall_ahead"], action: "turn_left" },
      { priority: 45, when: ["random_30", "path_forward_clear"], action: "move_forward" },
      { priority: 20, when: ["random_30"], action: "turn_right" },
      { priority: 15, when: ["path_forward_clear"], action: "move_forward" },
      { priority: 10, when: ["always"], action: "wait" }
    ]
  },
  randomShooter: {
    name: "随机游走火力型",
    description: "随机游走，遇到子弹先躲避，并在冷却结束后持续开火。",
    rules: [
      { priority: 100, when: ["bullet_in_front"], action: "move_backward" },
      { priority: 92, when: ["bullet_near", "path_forward_clear"], action: "move_forward" },
      { priority: 86, when: ["can_shoot"], action: "shoot" },
      { priority: 70, when: ["wall_ahead"], action: "turn_right" },
      { priority: 54, when: ["random_30", "path_forward_clear"], action: "move_forward" },
      { priority: 36, when: ["random_30"], action: "turn_left" },
      { priority: 24, when: ["path_forward_clear"], action: "move_forward" },
      { priority: 12, when: ["always"], action: "turn_right" }
    ]
  }
});

export function cloneRuleSet(ruleSet) {
  return JSON.parse(JSON.stringify(ruleSet));
}

export function validateRuleSet(candidate) {
  const errors = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, errors: ["规则必须是对象"], ruleSet: null };
  }

  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim().slice(0, 30)
    : "未命名策略";
  const description = typeof candidate.description === "string"
    ? candidate.description.trim().slice(0, 160)
    : "";

  if (!Array.isArray(candidate.rules) || candidate.rules.length === 0) {
    errors.push("rules 必须是非空数组");
  }

  const normalizedRules = [];
  const inputRules = Array.isArray(candidate.rules) ? candidate.rules.slice(0, MAX_RULES) : [];

  inputRules.forEach((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      errors.push(`第 ${index + 1} 条规则必须是对象`);
      return;
    }

    const priority = Number(rule.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
      errors.push(`第 ${index + 1} 条规则 priority 必须是 1-100 的整数`);
    }

    if (!Array.isArray(rule.when) || rule.when.length === 0) {
      errors.push(`第 ${index + 1} 条规则 when 必须是非空数组`);
    }

    const when = Array.isArray(rule.when) ? rule.when : [];
    when.forEach((condition) => {
      if (!conditionSet.has(condition)) {
        errors.push(`未知条件: ${condition}`);
      }
    });

    if (!actionSet.has(rule.action)) {
      errors.push(`未知动作: ${rule.action}`);
    }

    if (
      Number.isInteger(priority) &&
      priority >= 1 &&
      priority <= 100 &&
      when.length > 0 &&
      when.every((condition) => conditionSet.has(condition)) &&
      actionSet.has(rule.action)
    ) {
      normalizedRules.push({
        priority,
        when: [...new Set(when)],
        action: rule.action
      });
    }
  });

  if (candidate.rules?.length > MAX_RULES) {
    errors.push(`最多只能配置 ${MAX_RULES} 条规则`);
  }

  const hasFallback = normalizedRules.some((rule) => rule.when.includes("always"));
  if (!hasFallback) {
    normalizedRules.push({ priority: 1, when: ["always"], action: "wait" });
  }

  normalizedRules.sort((left, right) => right.priority - left.priority);

  return {
    ok: errors.length === 0,
    errors,
    ruleSet: {
      name,
      description,
      rules: normalizedRules
    }
  };
}
