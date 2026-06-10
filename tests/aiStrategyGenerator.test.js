import test from "node:test";
import assert from "node:assert/strict";
import { createAiStrategyGenerator } from "../src/server/aiStrategyGenerator.js";

test("AI strategy generator falls back to local rules without credentials", async () => {
  const generator = createAiStrategyGenerator({
    apiKey: "",
    model: "test-model"
  });

  const result = await generator.generate("我要稳健防守，优先躲避炮弹。");

  assert.equal(result.source, "local");
  assert.match(result.fallbackReason, /未配置/);
  assert.equal(result.ruleSet.rules.some((rule) => rule.when.includes("always")), true);
});

test("AI strategy generator requests chat completions and validates rule JSON", async () => {
  const calls = [];
  const generator = createAiStrategyGenerator({
    apiKey: "test-key",
    baseUrl: "https://ai.example.test/v1/",
    model: "test-model",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createJsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "AI 强攻策略",
                description: "直线开火，受阻转向。",
                rules: [
                  { priority: 100, when: ["enemy_in_line", "can_shoot"], action: "shoot" },
                  { priority: 70, when: ["wall_ahead"], action: "turn_right" },
                  { priority: 1, when: ["always"], action: "move_forward" }
                ]
              })
            }
          }
        ]
      });
    }
  });

  const result = await generator.generate("看到敌人就在直线上开炮。");
  const body = JSON.parse(calls[0].options.body);

  assert.equal(result.source, "ai");
  assert.equal(result.model, "test-model");
  assert.equal(result.ruleSet.name, "AI 强攻策略");
  assert.equal(calls[0].url, "https://ai.example.test/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
  assert.equal(body.model, "test-model");
  assert.equal(body.response_format.type, "json_object");
});

test("AI strategy generator accepts per-request player credentials", async () => {
  const calls = [];
  const generator = createAiStrategyGenerator({
    apiKey: "",
    baseUrl: "https://server-default.example.test/v1",
    model: "server-model",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createJsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "玩家自带 AI",
                description: "使用玩家自己的接口生成。",
                rules: [
                  { priority: 90, when: ["enemy_in_line", "can_shoot"], action: "shoot" },
                  { priority: 1, when: ["always"], action: "wait" }
                ]
              })
            }
          }
        ]
      });
    }
  });

  const result = await generator.generate("我用自己的 AI。", {
    apiKey: "player-key",
    baseUrl: "https://player.example.test/v1",
    model: "player-model"
  });
  const body = JSON.parse(calls[0].options.body);

  assert.equal(result.source, "ai");
  assert.equal(result.model, "player-model");
  assert.equal(result.ruleSet.name, "玩家自带 AI");
  assert.equal(calls[0].url, "https://player.example.test/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer player-key");
  assert.equal(body.model, "player-model");
});

test("AI strategy generator falls back when model output is invalid", async () => {
  const generator = createAiStrategyGenerator({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async () => createJsonResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: "非法策略",
              rules: [
                { priority: 100, when: ["always"], action: "teleport" }
              ]
            })
          }
        }
      ]
    })
  });

  const result = await generator.generate("随便打。");

  assert.equal(result.source, "local");
  assert.match(result.fallbackReason, /AI 生成失败/);
  assert.equal(result.ruleSet.rules.some((rule) => rule.action === "teleport"), false);
});

test("explicit local mode uses local rules without AI credentials", async () => {
  const generator = createAiStrategyGenerator({
    apiKey: "server-key",
    model: "server-model"
  });

  const result = await generator.generate("随机运动 一直开炮 遇到子弹躲避", {
    mode: "local"
  });

  assert.equal(result.source, "local");
  assert.equal(result.ruleSet.name, "随机游走火力型");
});

test("explicit player AI mode requires a player API key", async () => {
  const generator = createAiStrategyGenerator({
    apiKey: "server-key",
    model: "server-model"
  });

  await assert.rejects(
    () => generator.generate("我要开炮。", { mode: "player-ai" }),
    /请填写 API Key/
  );
});

test("explicit player AI mode does not fall back when AI output is invalid", async () => {
  const generator = createAiStrategyGenerator({
    apiKey: "",
    model: "server-model",
    fetchImpl: async () => createJsonResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: "非法策略",
              rules: [
                { priority: 100, when: ["always"], action: "teleport" }
              ]
            })
          }
        }
      ]
    })
  });

  await assert.rejects(
    () => generator.generate("我要开炮。", {
      mode: "player-ai",
      apiKey: "player-key",
      baseUrl: "https://player.example.test/v1",
      model: "player-model"
    }),
    /AI 生成失败/
  );
});

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}
