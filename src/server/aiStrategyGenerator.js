import { MAX_RULES, RULE_CONDITIONS, TANK_ACTIONS } from "../shared/constants.js";
import { generateLocalStrategyRules } from "../shared/localStrategyGenerator.js";
import { validateRuleSet } from "../shared/rules.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 12000;

export function createAiStrategyGenerator(options = {}) {
  const defaultConfig = {
    apiKey: options.apiKey ?? process.env.AI_RULES_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseUrl: trimTrailingSlash(options.baseUrl ?? process.env.AI_RULES_BASE_URL ?? DEFAULT_BASE_URL),
    model: options.model ?? process.env.AI_RULES_MODEL ?? DEFAULT_MODEL,
    timeoutMs: Number(options.timeoutMs ?? process.env.AI_RULES_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    forceLocal: parseBoolean(options.forceLocal ?? process.env.AI_RULES_FORCE_LOCAL),
    fetchImpl: options.fetchImpl ?? globalThis.fetch
  };

  return {
    isAiEnabled(overrides = {}) {
      const config = createRequestConfig(defaultConfig, overrides);
      return Boolean(config.apiKey && config.model && !config.forceLocal);
    },

    async generate(prompt, overrides = {}) {
      const mode = normalizeGenerationMode(overrides.mode || overrides.generationMode);
      if (mode === "local") {
        return createLocalGeneration(prompt, "用户选择本地生成器");
      }

      if (mode === "player-ai") {
        const playerOverrides = normalizeOverrides(overrides);
        if (!playerOverrides.apiKey) {
          throw new Error("请填写 API Key 后再使用“我的 AI”生成");
        }

        const config = createRequestConfig({ ...defaultConfig, apiKey: "" }, playerOverrides);
        return createAiGeneration(prompt, config);
      }

      if (mode === "server-ai") {
        const config = createRequestConfig(defaultConfig, {});
        if (!config.apiKey || config.forceLocal) {
          throw new Error("服务端默认 AI 未配置，请改用“我的 AI”或“本地生成器”");
        }

        return createAiGeneration(prompt, config);
      }

      const config = createRequestConfig(defaultConfig, overrides);
      if (!this.isAiEnabled(overrides)) {
        return createLocalGeneration(
          prompt,
          config.forceLocal ? "AI_RULES_FORCE_LOCAL 已开启" : "未提供玩家 API Key，也未配置服务端 AI_RULES_API_KEY"
        );
      }

      try {
        const ruleSet = await requestAiRuleSet(prompt, config);
        return {
          ruleSet,
          source: "ai",
          model: config.model
        };
      } catch (error) {
        return createLocalGeneration(prompt, `AI 生成失败，已使用本地生成器：${error.message}`);
      }
    }
  };
}

async function createAiGeneration(prompt, config) {
  try {
    const ruleSet = await requestAiRuleSet(prompt, config);
    return {
      ruleSet,
      source: "ai",
      model: config.model
    };
  } catch (error) {
    throw new Error(`AI 生成失败：${error.message}`);
  }
}

function createLocalGeneration(prompt, fallbackReason = "") {
  return {
    ruleSet: generateLocalStrategyRules(prompt),
    source: "local",
    fallbackReason
  };
}

function createRequestConfig(defaultConfig, overrides) {
  const cleanOverrides = normalizeOverrides(overrides);
  return {
    ...defaultConfig,
    ...cleanOverrides,
    baseUrl: trimTrailingSlash(cleanOverrides.baseUrl || defaultConfig.baseUrl || DEFAULT_BASE_URL),
    model: cleanOverrides.model || defaultConfig.model || DEFAULT_MODEL,
    timeoutMs: toPositiveNumber(cleanOverrides.timeoutMs ?? defaultConfig.timeoutMs, DEFAULT_TIMEOUT_MS),
    forceLocal: defaultConfig.forceLocal || cleanOverrides.forceLocal
  };
}

function normalizeOverrides(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return {};
  }

  const normalized = {};
  const apiKey = cleanString(overrides.apiKey, 240);
  const baseUrl = normalizeBaseUrl(cleanString(overrides.baseUrl, 300));
  const model = cleanString(overrides.model, 100);
  const timeoutMs = toPositiveNumber(overrides.timeoutMs, 0);

  if (apiKey) {
    normalized.apiKey = apiKey;
  }
  if (baseUrl) {
    normalized.baseUrl = baseUrl;
  }
  if (model) {
    normalized.model = model;
  }
  if (timeoutMs) {
    normalized.timeoutMs = timeoutMs;
  }
  if (parseBoolean(overrides.forceLocal)) {
    normalized.forceLocal = true;
  }

  return normalized;
}

function normalizeGenerationMode(value) {
  const mode = String(value || "auto").trim();
  return ["auto", "local", "player-ai", "server-ai"].includes(mode) ? mode : "auto";
}

async function requestAiRuleSet(prompt, config) {
  if (typeof config.fetchImpl !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await config.fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(createChatCompletionBody(prompt, config.model)),
      signal: controller.signal
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(formatApiError(response.status, text));
    }

    const completion = JSON.parse(text);
    const content = extractMessageContent(completion);
    const candidate = parseJsonObject(content);
    const validation = validateRuleSet(candidate);
    if (!validation.ok) {
      throw new Error(validation.errors.join("；"));
    }

    return validation.ruleSet;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("AI 请求超时");
    }
    if (error instanceof SyntaxError) {
      throw new Error("AI 响应不是合法 JSON");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createChatCompletionBody(prompt, model) {
  return {
    model,
    temperature: 0.25,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "你是一个坦克自动对战游戏的策略编译器。",
          "你必须只输出一个 JSON 对象，不要输出 Markdown、代码围栏或解释。",
          `JSON 顶层字段必须是 name、description、rules。rules 最多 ${MAX_RULES} 条。`,
          "每条规则格式：{\"priority\": 1-100整数, \"when\": [条件...], \"action\": 动作}。",
          `允许条件：${RULE_CONDITIONS.join(", ")}。`,
          `允许动作：${TANK_ACTIONS.join(", ")}。`,
          "必须包含一条 when 含 always 的兜底规则，通常使用较低 priority。",
          "优先级越高越先执行；规则要短小、可执行、不要发明新字段。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "把玩家的自然语言战术改写成可执行规则。",
          `玩家战术：${String(prompt || "").trim() || "主动寻找敌人并安全开火。"}`
        ].join("\n")
      }
    ]
  };
}

function extractMessageContent(completion) {
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => part.text || "").join("");
  }

  throw new Error("AI 响应缺少 message.content");
}

function parseJsonObject(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    throw new Error("AI 响应为空");
  }

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("AI 响应中没有 JSON 对象");
    }
    return JSON.parse(match[0]);
  }
}

function formatApiError(status, bodyText) {
  const message = parseApiErrorMessage(bodyText);
  return `AI 接口返回 ${status}${message ? `：${message}` : ""}`;
}

function parseApiErrorMessage(bodyText) {
  try {
    const body = JSON.parse(bodyText);
    return body.error?.message || body.message || "";
  } catch {
    return String(bodyText || "").slice(0, 180);
  }
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeBaseUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return trimTrailingSlash(url.toString());
  } catch {
    return "";
  }
}

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}
