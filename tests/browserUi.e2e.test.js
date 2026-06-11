import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  getFreePort,
  startAppServer,
  stopAppServer
} from "./helpers/testServer.js";

const require = createRequire(import.meta.url);

test("browser UI E2E covers two-player setup, battle behavior, and exit confirmation", async (t) => {
  if (process.env.RUN_UI_E2E !== "1") {
    t.skip("Set RUN_UI_E2E=1 to run Playwright browser UI E2E tests.");
    return;
  }

  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip("Playwright is not installed; install dev dependencies to run UI E2E tests.");
    return;
  }

  let port;
  try {
    port = await getFreePort();
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip(`Local server binding is not permitted in this environment: ${error.code}`);
      return;
    }
    throw error;
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startAppServer(port);
  let browser = null;

  try {
    browser = await launchBrowser(playwright);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const playerA = await contextA.newPage();
    const playerB = await contextB.newPage();

    await playerA.goto(baseUrl);
    await expectText(playerA.locator("#onboardingSection"), "第一次局域网试玩");
    await expectText(playerA.locator("#onboardingSection"), "HOST=0.0.0.0");
    await expectText(playerA.locator("#onboardingSection"), "本地生成器");
    await playerA.locator("#playerNameInput").fill("Player A");
    await playerA.locator("#createRoomButton").click();
    await expectText(playerA.locator("#currentPlayerText"), "当前身份：A 方");
    await expectText(playerA.locator("#roomHelp"), "复制邀请链接发给同 Wi-Fi 对手");
    await expectText(playerA.locator("#modeGuide"), "第一次试玩推荐");
    const roomCode = (await playerA.locator("#roomCodeText").textContent()).trim();
    assert.match(roomCode, /^[A-Z0-9]{6}$/);

    await playerB.goto(`${baseUrl}?room=${roomCode}`);
    await playerB.locator("#playerNameInput").fill("Player B");
    await playerB.locator("#joinRoomButton").click();
    await expectText(playerB.locator("#currentPlayerText"), "当前身份：B 方");
    await expectText(playerA.locator("#playersList"), "Player B");
    await expectText(playerB.locator("#modeGuide"), "第一次试玩推荐");

    await chooseLocalGeneration(playerA);
    await chooseLocalGeneration(playerB);
    await playerA.locator("#strategyPrompt").fill("随机运动，遇到子弹躲避，一直射击");
    await playerB.locator("#strategyPrompt").fill("保持不动，用于 UI E2E 验证。");

    await playerA.locator("#generateButton").click();
    await expectText(playerA.locator("#rulePreview"), "随机游走火力型");
    await expectText(playerA.locator("#rulePreview"), "会移动");
    await expectText(playerA.locator("#rulePreview"), "会射击");
    await expectText(playerA.locator("#rulePreview"), "会躲子弹");
    await playerA.locator("#confirmButton").click();
    await expectText(playerA.locator("#roomMessage"), "规则已确认");

    await playerB.locator("[data-preset='defensive']").click();
    await expectText(playerB.locator("#rulePreview"), "稳健防守型");
    await playerB.locator("#confirmButton").click();
    await expectText(playerA.locator("#statusChip"), "战斗中");
    await expectText(playerB.locator("#statusChip"), "战斗中");

    await expectAction(playerA.locator("#actionA"), "射击");
    await expectAction(playerA.locator("#actionA"), /前进|后退/);
    await expectText(playerA.locator("#logList"), "Player A 开火");
    await expectText(playerA.locator("#logList"), "Player A 决策");

    await playerA.locator("#exitRoomButton").click();
    await expectText(playerA.locator("#roomMessage"), "等待对手确认");
    await expectText(playerB.locator("#exitNotice"), "请求退出");
    await expectText(playerB.locator("#exitRoomButton"), "确认退出");
    await playerB.locator("#exitRoomButton").click();
    await expectText(playerB.locator("#lobbyMessage"), "游戏已退出");
    await expectText(playerA.locator("#lobbyMessage"), "游戏已退出");
  } finally {
    await browser?.close();
    await stopAppServer(server);
  }
});

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return null;
  }
}

async function launchBrowser(playwright) {
  try {
    return await playwright.chromium.launch();
  } catch (error) {
    if (String(error?.message || "").includes("Executable doesn't exist")) {
      throw new Error("Playwright Chromium is not installed. Run `npx playwright install chromium` and retry.");
    }
    throw error;
  }
}

async function chooseLocalGeneration(page) {
  await page.locator("input[name='generationMode'][value='local']").check();
}

async function expectText(locator, expected, timeout = 5000) {
  const matcher = expected instanceof RegExp
    ? (text) => expected.test(text)
    : (text) => text.includes(expected);

  await waitFor(async () => {
    const text = await locator.textContent();
    assert.equal(matcher(text || ""), true, `Expected text ${JSON.stringify(text)} to contain ${expected}`);
  }, timeout);
}

async function expectAction(locator, expected, timeout = 8000) {
  const matcher = expected instanceof RegExp
    ? (text) => expected.test(text)
    : (text) => text === expected;

  await waitFor(async () => {
    const text = (await locator.textContent())?.trim() || "";
    assert.equal(matcher(text), true, `Expected action ${JSON.stringify(text)} to match ${expected}`);
  }, timeout);
}

async function waitFor(assertion, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
