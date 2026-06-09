import { builtInRuleSets, cloneRuleSet, validateRuleSet } from "./rules.js";

const keywordProfiles = [
  {
    words: ["进攻", "攻击", "主动", "冲", "压制", "追击"],
    key: "aggressive"
  },
  {
    words: ["防守", "保守", "躲", "避开", "生存", "稳健"],
    key: "defensive"
  },
  {
    words: ["狙击", "瞄准", "直线", "等待", "炮线"],
    key: "sniper"
  },
  {
    words: ["随机", "游走", "扰动", "绕", "灵活"],
    key: "wanderer"
  }
];

export function generateLocalStrategyRules(prompt) {
  const source = String(prompt || "").trim();
  const matched = keywordProfiles
    .map((profile) => ({
      ...profile,
      score: profile.words.filter((word) => source.includes(word)).length
    }))
    .sort((left, right) => right.score - left.score)
    .find((profile) => profile.score > 0);
  const key = matched?.key || "aggressive";
  const ruleSet = cloneRuleSet(builtInRuleSets[key]);

  ruleSet.description = source
    ? `${ruleSet.description} 玩家意图：${source}`
    : ruleSet.description;

  const validation = validateRuleSet(ruleSet);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  return validation.ruleSet;
}
