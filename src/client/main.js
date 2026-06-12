import { createInitialState } from "../shared/battleEngine.js";
import { builtInRuleSets, cloneRuleSet, validateRuleSet } from "../shared/rules.js";

const TILE_SIZE = 34;
const DEFAULT_PROMPTS = {
  A: "我要主动进攻，看到敌人在直线上就开炮，遇到墙就转向继续追击。",
  B: "我要灵活游走，绕开敌人正面火力，发现直线机会就立刻反击。"
};
const PLAYER_COLORS = {
  A: "#29f0a0",
  B: "#ffbd3f"
};
const ACTION_LABELS = {
  move_forward: "前进",
  move_backward: "后退",
  turn_left: "左转",
  turn_right: "右转",
  shoot: "射击",
  wait: "等待"
};
const CONDITION_LABELS = {
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
  random_30: "30% 随机"
};
const STATUS_LABELS = {
  waiting: "等待第二名玩家",
  preparing: "策略准备中",
  fighting: "战斗中",
  finished: "已结束",
  closed: "已退出"
};
const REQUEST_TIMEOUT_MS = 10000;
const SESSION_STORAGE_KEY = "ai-tank-duel:last-session";
const ACTIVE_SESSION_STORAGE_KEY = "ai-tank-duel:active-session";
const AI_CONFIG_STORAGE_KEY = "ai-tank-duel:ai-config";
const AI_KEY_SESSION_STORAGE_KEY = "ai-tank-duel:ai-key";
const GENERATION_MODE_STORAGE_KEY = "ai-tank-duel:generation-mode";
const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-4.1-mini";
const GENERATION_MODE_LABELS = {
  local: "本地生成器",
  "player-ai": "我的 AI",
  "server-ai": "服务端 AI"
};
const GENERATION_MODE_GUIDANCE = {
  local: {
    title: "第一次试玩推荐：本地生成器",
    body: "不需要联网或 API Key，适合先验证房间、准备、开战和日志流程是否正常。",
    notes: ["理解能力有限", "常见中文战术已优化", "生成失败风险最低"]
  },
  "player-ai": {
    title: "进阶：我的 AI",
    body: "使用你自己的 OpenAI-compatible 配置；API Key 只保存在当前浏览器会话，生成时会发送给当前 Node 服务端代调。",
    notes: ["需要 Base URL / Model / API Key", "适合复杂战术", "公网部署前不要在不可信服务端输入 Key"]
  },
  "server-ai": {
    title: "房主统一配置：服务端 AI",
    body: "使用服务端环境变量里的默认 AI 配置；如果房主没有配置 AI_RULES_API_KEY，会直接提示错误而不是静默降级。",
    notes: ["玩家无需填写 Key", "适合 LAN 试玩统一模型", "需要重启服务读取环境变量"]
  }
};

const appState = {
  room: null,
  playerId: null,
  playerToken: null,
  generatedRuleSet: null,
  generationResult: null,
  eventSource: null,
  connectionState: "idle",
  gameState: null,
  message: "创建房间后，把房间码发给第二名玩家加入。"
};

const app = document.querySelector("#app");
app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">AI RULES · PIXEL TANK DUEL</p>
        <h1>坦克不听手速，只听你的战术。</h1>
        <p class="hero-copy">
          两名玩家进入同一房间，赛前把自然语言策略转成可执行规则；开战后由服务端驱动坦克自动移动、转向和射击。
        </p>
      </div>
      <div class="hero-card">
        <span>当前版本</span>
        <strong>MVP-1</strong>
        <small>局域网双人试玩</small>
      </div>
    </section>

    <section class="room-gate" id="lobbySection">
      <div>
        <p class="eyebrow">Room</p>
        <h2>创建或加入对战房间</h2>
        <p>现在可以用两个浏览器窗口模拟双人对战：第一个窗口创建房间，第二个窗口输入房间码加入。</p>
      </div>
      <label>
        昵称
        <input id="playerNameInput" maxlength="18" value="玩家" />
      </label>
      <div class="room-actions">
        <button class="primary" id="createRoomButton">创建房间</button>
        <input id="roomCodeInput" maxlength="6" placeholder="输入房间码" />
        <button id="joinRoomButton">加入房间</button>
      </div>
      <button class="restore-button" id="restoreSessionButton" hidden>恢复上次身份</button>
      <p class="message" id="lobbyMessage"></p>
    </section>

    <section class="onboarding-panel" id="onboardingSection" aria-labelledby="onboardingTitle">
      <div class="onboarding-heading">
        <div>
          <p class="eyebrow">Quick Start</p>
          <h2 id="onboardingTitle">第一次局域网试玩，先看这 3 件事</h2>
        </div>
        <p>先确认访问方式，再选择生成模式；这样两名玩家更容易完成一整局并看懂发生了什么。</p>
      </div>
      <div class="onboarding-grid">
        <article class="onboarding-card">
          <span>01</span>
          <h3>局域网访问</h3>
          <ol>
            <li>房主用 <code>HOST=0.0.0.0 PORT=5173 npm start</code> 启动。</li>
            <li>两台设备连同一个 Wi-Fi，并用房主局域网 IP 打开页面。</li>
            <li>如果打不开，先检查 macOS 防火墙、VPN、代理和浏览器缓存。</li>
          </ol>
        </article>
        <article class="onboarding-card">
          <span>02</span>
          <h3>双人流程</h3>
          <ol>
            <li>A 创建房间并复制邀请链接。</li>
            <li>B 通过链接或房间码加入。</li>
            <li>双方生成规则、确认准备，战斗会自动开始。</li>
          </ol>
        </article>
        <article class="onboarding-card">
          <span>03</span>
          <h3>AI 生成方式</h3>
          <ul>
            <li><strong>本地生成器</strong>：最快、无 Key，适合首测。</li>
            <li><strong>我的 AI</strong>：用自己的兼容接口，适合复杂战术。</li>
            <li><strong>服务端 AI</strong>：由房主环境变量统一配置。</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="layout" id="roomArea" hidden>
      <aside class="strategy-board">
        <article class="room-panel">
          <p class="eyebrow">Room State</p>
          <h2>房间 <span id="roomCodeText">-</span></h2>
          <p id="currentPlayerText">当前身份：-</p>
          <div class="status-chip wide" id="statusChip">等待中</div>
          <div class="players-list" id="playersList"></div>
          <div class="room-controls">
            <button id="copyRoomButton">复制邀请链接</button>
            <button class="danger" id="exitRoomButton">退出游戏</button>
          </div>
          <p class="room-help" id="roomHelp"></p>
          <div class="exit-notice" id="exitNotice" hidden></div>
          <p class="message" id="roomMessage"></p>
        </article>

        <article class="strategy-card" id="strategyCard">
          <div class="card-title">
            <span class="player-mark" id="playerMark">?</span>
            <div>
              <h2 id="strategyTitle">我的策略</h2>
              <p>先选择生成方式，再把自然语言战术编译成可执行规则。</p>
            </div>
          </div>
          <label>
            赛前策略描述
            <textarea id="strategyPrompt" rows="5"></textarea>
          </label>
          <div class="generation-modes" id="generationModeGroup">
            <strong>生成方式</strong>
            <label>
              <input type="radio" name="generationMode" value="local" />
              <span>本地生成器</span>
              <small>不需要 Key，速度快，但理解能力有限。</small>
            </label>
            <label>
              <input type="radio" name="generationMode" value="player-ai" />
              <span>我的 AI</span>
              <small>使用你填写的 OpenAI-compatible 配置生成。</small>
            </label>
            <label>
              <input type="radio" name="generationMode" value="server-ai" />
              <span>服务端 AI</span>
              <small>使用服务器环境变量里的默认 AI 配置。</small>
            </label>
          </div>
          <div class="mode-guide" id="modeGuide"></div>
          <div class="ai-settings" id="aiSettings">
            <div>
              <strong>我的 AI 接口</strong>
              <small>仅在选择“我的 AI”时使用；Key 只保存在当前浏览器会话，生成时发送给房间服务端代调。</small>
            </div>
            <label>
              Base URL
              <input id="aiBaseUrlInput" placeholder="https://api.openai.com/v1" />
            </label>
            <label>
              Model
              <input id="aiModelInput" placeholder="gpt-4.1-mini" />
            </label>
            <label>
              API Key
              <input id="aiApiKeyInput" type="password" autocomplete="off" placeholder="留空则使用服务端默认或本地生成器" />
            </label>
          </div>
          <button class="primary stretch" id="generateButton">生成规则</button>
          <button class="stretch" id="confirmButton">确认规则并准备</button>
          <div class="presets" id="presetButtons"></div>
          <div class="rule-preview" id="rulePreview"></div>
        </article>
      </aside>

      <section class="arena-card">
        <div class="arena-head">
          <div>
            <p class="eyebrow">Battlefield</p>
            <h2>服务端像素战场</h2>
          </div>
          <button id="restartButton">再来一局</button>
        </div>

        <div class="battle-wrap">
          <canvas id="battleCanvas" width="510" height="510" aria-label="坦克对战画面"></canvas>
        </div>

        <div class="telemetry">
          <div>
            <span>Tick</span>
            <strong id="tickValue">0</strong>
          </div>
          <div>
            <span id="tankAName">玩家 A</span>
            <strong id="actionA">-</strong>
          </div>
          <div>
            <span id="tankBName">玩家 B</span>
            <strong id="actionB">-</strong>
          </div>
        </div>

        <div class="trigger-feed" id="triggerFeed"></div>

        <div class="result-panel" id="resultPanel" hidden></div>
      </section>

      <aside class="log-card">
        <p class="eyebrow">Opponent & Log</p>
        <h2>对手策略 / 战斗日志</h2>
        <div class="rule-preview opponent" id="opponentRules"></div>
        <ol id="logList"></ol>
      </aside>
    </section>
  </main>
`;

const elements = {
  lobbySection: document.querySelector("#lobbySection"),
  onboardingSection: document.querySelector("#onboardingSection"),
  roomArea: document.querySelector("#roomArea"),
  playerNameInput: document.querySelector("#playerNameInput"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  restoreSessionButton: document.querySelector("#restoreSessionButton"),
  lobbyMessage: document.querySelector("#lobbyMessage"),
  roomCodeText: document.querySelector("#roomCodeText"),
  currentPlayerText: document.querySelector("#currentPlayerText"),
  statusChip: document.querySelector("#statusChip"),
  playersList: document.querySelector("#playersList"),
  copyRoomButton: document.querySelector("#copyRoomButton"),
  exitRoomButton: document.querySelector("#exitRoomButton"),
  roomHelp: document.querySelector("#roomHelp"),
  exitNotice: document.querySelector("#exitNotice"),
  roomMessage: document.querySelector("#roomMessage"),
  strategyCard: document.querySelector("#strategyCard"),
  playerMark: document.querySelector("#playerMark"),
  strategyTitle: document.querySelector("#strategyTitle"),
  strategyPrompt: document.querySelector("#strategyPrompt"),
  generationModeGroup: document.querySelector("#generationModeGroup"),
  generationModeInputs: [...document.querySelectorAll("input[name='generationMode']")],
  modeGuide: document.querySelector("#modeGuide"),
  aiSettings: document.querySelector("#aiSettings"),
  aiBaseUrlInput: document.querySelector("#aiBaseUrlInput"),
  aiModelInput: document.querySelector("#aiModelInput"),
  aiApiKeyInput: document.querySelector("#aiApiKeyInput"),
  generateButton: document.querySelector("#generateButton"),
  confirmButton: document.querySelector("#confirmButton"),
  presetButtons: document.querySelector("#presetButtons"),
  rulePreview: document.querySelector("#rulePreview"),
  canvas: document.querySelector("#battleCanvas"),
  tickValue: document.querySelector("#tickValue"),
  tankAName: document.querySelector("#tankAName"),
  tankBName: document.querySelector("#tankBName"),
  actionA: document.querySelector("#actionA"),
  actionB: document.querySelector("#actionB"),
  triggerFeed: document.querySelector("#triggerFeed"),
  restartButton: document.querySelector("#restartButton"),
  resultPanel: document.querySelector("#resultPanel"),
  opponentRules: document.querySelector("#opponentRules"),
  logList: document.querySelector("#logList")
};
const ctx = elements.canvas.getContext("2d");

elements.presetButtons.innerHTML = Object.keys(builtInRuleSets)
  .map((key) => `<button class="preset" data-preset="${escapeHtml(key)}">${escapeHtml(builtInRuleSets[key].name)}</button>`)
  .join("");

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.copyRoomButton.addEventListener("click", copyRoomCode);
elements.exitRoomButton.addEventListener("click", handleExitRoom);
elements.restoreSessionButton.addEventListener("click", () => restoreSavedSession());
elements.generateButton.addEventListener("click", generateRules);
elements.confirmButton.addEventListener("click", confirmRules);
elements.restartButton.addEventListener("click", restartRoom);
elements.roomCodeInput.addEventListener("input", () => {
  elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase();
});
[elements.aiBaseUrlInput, elements.aiModelInput, elements.aiApiKeyInput].forEach((input) => {
  input.addEventListener("input", saveAiSettings);
});
elements.generationModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    saveGenerationMode(input.value);
    appState.generationResult = null;
    renderApp();
  });
});
elements.presetButtons.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    appState.generatedRuleSet = cloneRuleSet(builtInRuleSets[button.dataset.preset]);
    appState.generationResult = {
      ruleSet: appState.generatedRuleSet,
      source: "preset"
    };
    setMessage(`已选择预设：${appState.generatedRuleSet.name}`);
    renderApp();
  });
});

initializeAiSettings();
initializeGenerationMode();
initializeFromLocation();
renderApp();

function initializeFromLocation() {
  const urlRoomCode = normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
  if (urlRoomCode) {
    elements.roomCodeInput.value = urlRoomCode;
    setMessage(`已从邀请链接填入房间 ${urlRoomCode}，输入昵称后点击加入房间。`);
  }

  const activeSession = loadActiveSession();
  if (activeSession && (!urlRoomCode || urlRoomCode === activeSession.roomCode)) {
    void restoreSavedSession({ session: activeSession, auto: true });
    return;
  }

  const session = loadSession();
  if (!session) {
    return;
  }

  elements.restoreSessionButton.hidden = false;
  elements.restoreSessionButton.textContent = `恢复 ${session.playerId} 方身份（${session.roomCode}）`;
  if (!urlRoomCode) {
    elements.roomCodeInput.value = session.roomCode;
    setMessage(`检测到上次房间 ${session.roomCode}，可恢复 ${session.playerId} 方身份。`);
  }
}

async function createRoom() {
  try {
    const response = await postJson("/api/rooms", {
      playerName: elements.playerNameInput.value || "玩家 A"
    });
    enterRoom(response.room, response.playerId, response.playerToken);
  } catch (error) {
    setMessage(error.message);
  }
}

async function joinRoom() {
  try {
    const code = normalizeRoomCode(elements.roomCodeInput.value);
    if (!code) {
      setMessage("请输入房间码");
      return;
    }

    const response = await postJson(`/api/rooms/${encodeURIComponent(code)}/join`, {
      playerName: elements.playerNameInput.value || "玩家 B"
    });
    enterRoom(response.room, response.playerId, response.playerToken);
  } catch (error) {
    setMessage(error.message);
  }
}

async function restoreSavedSession({ session = loadSession(), auto = false } = {}) {
  if (!session) {
    elements.restoreSessionButton.hidden = true;
    if (!auto) {
      setMessage("没有可恢复的玩家身份。");
    }
    return;
  }

  try {
    const response = await postJson(`/api/rooms/${encodeURIComponent(session.roomCode)}/restore`, {
      playerId: session.playerId,
      playerToken: session.playerToken
    });
    enterRoom(response.room, response.playerId, response.playerToken);
    setMessage(`${auto ? "刷新后已自动恢复" : "已恢复"} ${session.playerId} 方身份，回到房间 ${session.roomCode}。`);
  } catch (error) {
    if ([403, 404].includes(error.status)) {
      clearSession();
      clearActiveSession();
      elements.restoreSessionButton.hidden = true;
      setMessage(`${error.message} 请重新创建或加入房间。`);
      return;
    }

    setMessage(`${error.message} 稍后可再次尝试恢复。`);
  }
}

function enterRoom(room, playerId, playerToken) {
  appState.room = room;
  appState.playerId = playerId;
  appState.playerToken = playerToken;
  appState.generatedRuleSet = null;
  appState.generationResult = null;
  appState.gameState = room.gameState;
  elements.strategyPrompt.value = DEFAULT_PROMPTS[playerId] || DEFAULT_PROMPTS.A;
  saveSession(room.code, playerId, playerToken);
  updateRoomUrl(room.code);
  connectEvents(room.code, playerId, playerToken);
  setMessage(`你已作为 ${playerId} 方进入房间 ${room.code}`);
  renderApp();
}

function connectEvents(code, playerId, playerToken) {
  if (appState.eventSource) {
    appState.eventSource.close();
  }

  appState.connectionState = "connecting";
  const params = new URLSearchParams({
    playerId,
    playerToken
  });
  const source = new EventSource(`/api/rooms/${encodeURIComponent(code)}/events?${params.toString()}`);
  appState.eventSource = source;

  source.addEventListener("open", async () => {
    appState.connectionState = "connected";
    if (appState.room) {
      await refreshRoomSnapshot(appState.room.code, { quiet: true });
    }
    setMessage(`房间 ${code} 已连接。`);
  });

  source.addEventListener("room:update", (event) => {
    applyRoomSnapshot(JSON.parse(event.data));
  });

  source.addEventListener("battle:end", (event) => {
    applyBattlePayload(JSON.parse(event.data));
  });

  source.addEventListener("battle:state", (event) => {
    applyBattlePayload(JSON.parse(event.data));
  });

  source.addEventListener("room:closed", (event) => {
    const payload = JSON.parse(event.data);
    leaveRoomLocally(payload.result?.message || "游戏已退出。");
  });

  source.addEventListener("error", async () => {
    if (source.readyState === EventSource.CLOSED) {
      appState.connectionState = "closed";
      setMessage("房间连接已关闭，请刷新页面或重新加入。");
      return;
    }

    appState.connectionState = "reconnecting";
    setMessage("房间连接波动，正在自动重连...");
    if (appState.room) {
      await refreshRoomSnapshot(appState.room.code, { quiet: true });
    }
  });
}

function applyRoomSnapshot(room) {
  appState.room = room;
  appState.gameState = room.gameState;
  renderApp();
}

function applyBattlePayload(payload) {
  appState.room = payload.room;
  appState.gameState = payload.gameState;
  renderApp();
}

async function refreshRoomSnapshot(code, { quiet = false } = {}) {
  try {
    const response = await getJson(`/api/rooms/${encodeURIComponent(code)}`);
    if (!appState.room || appState.room.code === response.room.code) {
      applyRoomSnapshot(response.room);
    }
  } catch (error) {
    if (!quiet) {
      setMessage(error.message);
    }
  }
}

async function getJson(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    method: "GET"
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throwHttpError(response, data);
  }

  return data;
}

async function generateRules() {
  if (!appState.room) {
    return;
  }

  try {
    const generationMode = getGenerationMode();
    if (generationMode === "player-ai" && !elements.aiApiKeyInput.value.trim()) {
      setMessage("请选择“本地生成器”，或填写 API Key 后再使用“我的 AI”。");
      return;
    }

    const response = await postJson(`/api/rooms/${appState.room.code}/strategy/generate`, {
      prompt: elements.strategyPrompt.value,
      generationMode,
      aiConfig: generationMode === "player-ai" ? getPlayerAiConfig() : null
    });
    appState.generatedRuleSet = response.ruleSet;
    appState.generationResult = {
      ...response,
      mode: generationMode
    };
    setMessage(formatGenerationMessage(appState.generationResult));
    renderApp();
  } catch (error) {
    setMessage(error.message);
  }
}

async function confirmRules() {
  if (!appState.room) {
    return;
  }

  try {
    if (!appState.generatedRuleSet) {
      await generateRules();
    }
    if (!appState.generatedRuleSet) {
      return;
    }

    const validation = validateRuleSet(appState.generatedRuleSet);
    if (!validation.ok) {
      setMessage(validation.errors.join("；"));
      return;
    }

    const response = await postJson(`/api/rooms/${appState.room.code}/strategy/confirm`, {
      playerId: appState.playerId,
      playerToken: appState.playerToken,
      ruleSet: validation.ruleSet
    });
    appState.room = response.room;
    appState.generatedRuleSet = validation.ruleSet;
    appState.generationResult = {
      ...(appState.generationResult || {}),
      ruleSet: validation.ruleSet
    };
    setMessage("规则已确认，等待对手准备。");
    renderApp();
  } catch (error) {
    setMessage(error.message);
  }
}

async function restartRoom() {
  if (!appState.room) {
    return;
  }

  try {
    const response = await postJson(`/api/rooms/${appState.room.code}/restart`, {
      playerId: appState.playerId,
      playerToken: appState.playerToken
    });
    appState.room = response.room;
    appState.gameState = null;
    appState.generatedRuleSet = null;
    appState.generationResult = null;
    elements.strategyPrompt.value = DEFAULT_PROMPTS[appState.playerId] || DEFAULT_PROMPTS.A;
    setMessage("新一局已重置，请重新生成并确认规则。");
    renderApp();
  } catch (error) {
    setMessage(error.message);
  }
}

async function handleExitRoom() {
  if (!appState.room) {
    return;
  }

  const room = appState.room;
  if (room.status === "closed") {
    leaveRoomLocally(room.result?.message || "游戏已退出。");
    return;
  }

  const hasOpponentRequest = room.exitRequest && room.exitRequest.requesterId !== appState.playerId;
  const endpoint = hasOpponentRequest ? "confirm" : "request";

  if (room.exitRequest?.requesterId === appState.playerId) {
    setMessage("已发送退出请求，等待对手确认。");
    return;
  }

  try {
    const response = await postJson(`/api/rooms/${room.code}/exit/${endpoint}`, {
      playerId: appState.playerId,
      playerToken: appState.playerToken
    });
    appState.room = response.room;
    appState.gameState = response.room.gameState;

    if (response.room.status === "closed") {
      leaveRoomLocally(response.room.result?.message || "游戏已退出。");
      return;
    }

    setMessage("已发送退出请求，等待对手确认后退出。");
    renderApp();
  } catch (error) {
    setMessage(error.message);
  }
}

async function copyRoomCode() {
  if (!appState.room) {
    return;
  }

  const inviteUrl = createInviteUrl(appState.room.code);
  try {
    await navigator.clipboard.writeText(inviteUrl);
    setMessage("邀请链接已复制，发给对手即可加入。");
  } catch {
    setMessage(`邀请链接：${inviteUrl}`);
  }
}

function renderApp() {
  const room = appState.room;
  const savedSession = loadSession();
  elements.lobbySection.hidden = Boolean(room);
  elements.onboardingSection.hidden = Boolean(room);
  elements.roomArea.hidden = !room;
  elements.restoreSessionButton.hidden = Boolean(room) || !savedSession;
  if (savedSession) {
    elements.restoreSessionButton.textContent = `恢复 ${savedSession.playerId} 方身份（${savedSession.roomCode}）`;
  }
  elements.lobbyMessage.textContent = appState.message;
  elements.roomMessage.textContent = appState.message;

  if (!room) {
    return;
  }

  const currentPlayer = getPlayer(appState.playerId);
  const opponent = getOpponent();
  const roomStatus = room.status;
  const exitRequest = room.exitRequest;
  const isLocked = currentPlayer?.ready ||
    roomStatus === "fighting" ||
    roomStatus === "finished" ||
    roomStatus === "closed" ||
    Boolean(exitRequest);

  elements.roomCodeText.textContent = room.code;
  elements.currentPlayerText.textContent = `当前身份：${appState.playerId} 方 · ${currentPlayer?.name || "-"}`;
  elements.statusChip.textContent = STATUS_LABELS[roomStatus] || roomStatus;
  elements.playerMark.textContent = appState.playerId || "?";
  elements.playerMark.style.setProperty("--player-color", PLAYER_COLORS[appState.playerId] || PLAYER_COLORS.A);
  elements.strategyTitle.textContent = `${appState.playerId} 方策略`;
  elements.strategyPrompt.disabled = Boolean(isLocked);
  elements.generateButton.disabled = Boolean(isLocked);
  elements.confirmButton.disabled = Boolean(isLocked);
  elements.restartButton.disabled = roomStatus !== "finished";
  elements.roomHelp.textContent = getRoomHelpText(room, opponent);
  renderGenerationControls(isLocked);
  renderExitControls();

  renderPlayers();
  renderRulePanels(currentPlayer, opponent);
  renderTelemetry();
  renderLiveTriggers();
  renderLogs();
  renderResult();
  renderCanvas();
}

function renderPlayers() {
  const players = ["A", "B"].map((playerId) => getPlayer(playerId));
  elements.playersList.innerHTML = players.map((player, index) => {
    const playerId = index === 0 ? "A" : "B";
    if (!player) {
      return `
        <div class="player-row empty">
          <span>${playerId}</span>
          <strong>等待加入</strong>
          <em>未准备</em>
        </div>
      `;
    }

    return `
      <div class="player-row" style="--player-color: ${PLAYER_COLORS[player.id]}">
        <span>${escapeHtml(player.id)}</span>
        <strong>${escapeHtml(player.name)}</strong>
        <em>${escapeHtml(getPlayerStatusText(player))}</em>
      </div>
    `;
  }).join("");
}

function renderExitControls() {
  const room = appState.room;
  if (!room) {
    return;
  }

  const request = room.exitRequest;
  const requester = request ? getPlayer(request.requesterId) : null;

  elements.exitNotice.hidden = !request || room.status === "closed";
  elements.exitNotice.textContent = request && room.status !== "closed"
    ? `${requester?.name || request.requesterId} 请求退出，需要另一名玩家确认。`
    : "";

  elements.exitRoomButton.disabled = false;
  elements.exitRoomButton.textContent = "退出游戏";

  if (room.status === "closed") {
    elements.exitRoomButton.textContent = "返回大厅";
    return;
  }

  if (request?.requesterId === appState.playerId) {
    elements.exitRoomButton.textContent = "等待对手确认退出";
    elements.exitRoomButton.disabled = true;
    return;
  }

  if (request) {
    elements.exitRoomButton.textContent = "确认退出";
  }
}

function renderRulePanels(currentPlayer, opponent) {
  const currentRuleSet = currentPlayer?.ruleSet || appState.generatedRuleSet;
  const currentMeta = currentRuleSet ? appState.generationResult : null;
  elements.rulePreview.innerHTML = currentRuleSet
    ? renderRuleSet(currentRuleSet, currentMeta, { playerId: appState.playerId })
    : `<p>输入战术后点击“生成规则”，或者直接选择一个预设策略。</p>`;

  elements.opponentRules.innerHTML = opponent?.ruleSet
    ? renderRuleSet(opponent.ruleSet, null, { playerId: opponent.id })
    : `<p>${opponent ? "对手还没有确认规则。" : "等待第二名玩家加入。"}</p>`;
}

function renderRuleSet(ruleSet, meta = null, { playerId = null } = {}) {
  const activeRuleKey = getActiveRuleKey(playerId);
  const stats = getRuleStatsMap(playerId);
  return `
    <h3>${escapeHtml(ruleSet.name)}</h3>
    <p>${escapeHtml(ruleSet.description || "暂无说明")}</p>
    <div class="rule-meta">
      ${meta ? `<span>来源：${escapeHtml(formatGenerationSource(meta))}</span>` : ""}
      <span>${escapeHtml(formatRuleCapabilities(ruleSet))}</span>
    </div>
    <strong class="rule-section-label">战术卡</strong>
    <div class="rule-cards" aria-label="战术卡">
      ${ruleSet.rules.map((rule) => {
        const ruleKey = createRuleKey(rule);
        const triggerCount = stats[ruleKey]?.count || 0;
        const isActive = ruleKey && ruleKey === activeRuleKey;
        return `
          <article class="rule-card ${isActive ? "active" : ""}" data-rule-key="${escapeHtml(ruleKey)}">
            <div class="rule-card-head">
              <span>P${rule.priority}</span>
              <strong>${escapeHtml(getRuleCardTitle(rule))}</strong>
            </div>
            <p>${escapeHtml(formatRuleTrigger(rule))}</p>
            <div class="rule-card-meta">
              <em>${escapeHtml(ACTION_LABELS[rule.action] || rule.action)}</em>
              <small>触发 ${triggerCount} 次</small>
            </div>
            <small class="rule-risk">${escapeHtml(getRuleRiskText(rule))}</small>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderLiveTriggers() {
  const state = getVisibleGameState();
  elements.triggerFeed.innerHTML = ["A", "B"].map((playerId) => {
    const player = getPlayer(playerId);
    const action = state.lastActions?.[playerId];
    const rule = action?.rule;
    const playerName = player?.name || `玩家 ${playerId}`;

    if (!rule) {
      return `
        <article class="trigger-card idle" style="--player-color: ${PLAYER_COLORS[playerId]}">
          <span>${escapeHtml(playerId)}</span>
          <div>
            <strong>${escapeHtml(playerName)}</strong>
            <p>等待规则触发</p>
          </div>
        </article>
      `;
    }

    return `
      <article class="trigger-card active" style="--player-color: ${PLAYER_COLORS[playerId]}">
        <span>${escapeHtml(playerId)}</span>
        <div>
          <strong>${escapeHtml(playerName)}：${escapeHtml(getRuleCardTitle(rule))}</strong>
          <p>${escapeHtml(formatRuleTrigger(rule))} -> ${escapeHtml(ACTION_LABELS[action.action] || action.action)}</p>
        </div>
      </article>
    `;
  }).join("");
}

function getActiveRuleKey(playerId) {
  if (!playerId) {
    return "";
  }

  const action = getVisibleGameState()?.lastActions?.[playerId];
  return action?.ruleKey || createRuleKey(action?.rule);
}

function getRuleStatsMap(playerId) {
  if (!playerId) {
    return {};
  }

  return getVisibleGameState()?.ruleStats?.[playerId] || {};
}

function createRuleKey(rule) {
  if (!rule) {
    return "";
  }

  return `${rule.priority}|${rule.when.join("&")}|${rule.action}`;
}

function formatRuleTrigger(rule) {
  return rule.when.map((item) => CONDITION_LABELS[item] || item).join(" + ");
}

function getRuleCardTitle(rule) {
  const conditions = new Set(rule.when);
  if (rule.action === "shoot" && conditions.has("enemy_in_line")) {
    return "直线开炮";
  }
  if (rule.action === "shoot") {
    return "压制射击";
  }
  if (conditions.has("bullet_in_front") || conditions.has("bullet_near")) {
    return rule.action === "move_backward" ? "遇弹后撤" : "遇弹闪避";
  }
  if (conditions.has("wall_ahead") || conditions.has("wall_behind")) {
    return "撞墙改向";
  }
  if (conditions.has("enemy_on_left") || conditions.has("enemy_on_right") || conditions.has("enemy_behind")) {
    return "调整炮线";
  }
  if (conditions.has("random_30")) {
    return "随机扰动";
  }
  if (rule.action === "move_forward") {
    return "推进压迫";
  }
  if (rule.action === "move_backward") {
    return "拉开距离";
  }
  if (rule.action === "wait") {
    return "等待观察";
  }
  return ACTION_LABELS[rule.action] || "战术动作";
}

function getRuleRiskText(rule) {
  const conditions = new Set(rule.when);
  if (rule.action === "shoot" && !conditions.has("enemy_in_line")) {
    return "风险：可能空放火力，冷却期会错过机会";
  }
  if (conditions.has("random_30")) {
    return "风险：带随机性，可能制造惊喜也可能打乱节奏";
  }
  if (rule.action === "wait") {
    return "风险：保守兜底，触发太多说明前置策略不够明确";
  }
  if (conditions.has("bullet_in_front") || conditions.has("bullet_near")) {
    return "价值：把生存优先级提前，适合反制火力压制";
  }
  if (conditions.has("wall_ahead") || conditions.has("wall_behind")) {
    return "价值：避免卡墙，让策略持续执行";
  }
  return "价值：让自然语言战术变成可观察的触发规则";
}

function renderTelemetry() {
  const state = getVisibleGameState();
  const playerA = getPlayer("A");
  const playerB = getPlayer("B");
  elements.tickValue.textContent = String(state?.tick || 0);
  elements.tankAName.textContent = playerA?.name || "玩家 A";
  elements.tankBName.textContent = playerB?.name || "玩家 B";
  elements.actionA.textContent = getActionText("A", state);
  elements.actionB.textContent = getActionText("B", state);
}

function renderLogs() {
  const logs = getVisibleGameState()?.logs || [];
  elements.logList.innerHTML = logs.length
    ? logs.map((log) => `<li><span>#${log.tick}</span>${escapeHtml(log.message)}</li>`).join("")
    : `<li><span>#0</span>${escapeHtml(getWaitingLog())}</li>`;
}

function renderResult() {
  const result = appState.room?.result || getVisibleGameState()?.result;
  if (!result) {
    elements.resultPanel.hidden = true;
    elements.resultPanel.innerHTML = "";
    return;
  }

  elements.resultPanel.hidden = false;
  elements.resultPanel.innerHTML = `
    <strong>${escapeHtml(getResultTitle(result))}</strong>
    <p>${escapeHtml(result.message)}</p>
    <small>结束原因：${escapeHtml(result.reason)} · 用时 ${result.tick} tick</small>
    ${renderBattleSummary(result)}
  `;
}

function renderBattleSummary(result) {
  const summaries = ["A", "B"]
    .map((playerId) => renderPlayerRuleSummary(playerId))
    .filter(Boolean)
    .join("");
  const decisive = result.decisiveRule?.rule
    ? `
      <p class="decisive-rule">
        关键命中：${escapeHtml(result.decisiveRule.playerId)} 方的
        「${escapeHtml(getRuleCardTitle(result.decisiveRule.rule))}」
      </p>
    `
    : "";

  if (!summaries && !decisive) {
    return "";
  }

  return `
    <div class="battle-summary">
      <h3>战术复盘</h3>
      ${decisive}
      <div class="summary-grid">${summaries}</div>
    </div>
  `;
}

function renderPlayerRuleSummary(playerId) {
  const player = getPlayer(playerId);
  const ruleSet = player?.ruleSet;
  if (!ruleSet) {
    return "";
  }

  const stats = getRuleStatsMap(playerId);
  const triggered = Object.values(stats).sort((left, right) => right.count - left.count);
  const top = triggered[0];
  const unusedCount = ruleSet.rules.filter((rule) => !stats[createRuleKey(rule)]).length;
  const topText = top
    ? `最常触发：「${getRuleCardTitle(top.rule)}」${top.count} 次`
    : "本局没有触发可统计规则";

  return `
    <article>
      <strong>${escapeHtml(playerId)} 方 · ${escapeHtml(player.name)}</strong>
      <p>${escapeHtml(topText)}</p>
      <small>${unusedCount > 0 ? `${unusedCount} 张战术卡没有触发` : "所有战术卡都至少触发过一次"}</small>
    </article>
  `;
}

function renderCanvas() {
  const state = getVisibleGameState();
  const width = state.map.width * TILE_SIZE;
  const height = state.map.height * TILE_SIZE;
  elements.canvas.width = width;
  elements.canvas.height = height;

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#10221b";
  ctx.fillRect(0, 0, width, height);

  drawFloor(state, width, height);
  drawWalls(state);
  state.bullets.forEach((bullet) => drawBullet(bullet));
  state.tanks.forEach((tank) => drawTank(tank));

  if (state.status === "finished") {
    drawFinishOverlay(state);
  }
}

function drawFloor(state, width, height) {
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#163327" : "#132d23";
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      ctx.strokeStyle = "rgba(95, 255, 174, 0.12)";
      ctx.strokeRect(x * TILE_SIZE + 0.5, y * TILE_SIZE + 0.5, TILE_SIZE, TILE_SIZE);
    }
  }

  ctx.strokeStyle = "#7cffb6";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
}

function drawWalls(state) {
  state.map.walls.forEach((wall) => {
    const x = wall.x * TILE_SIZE;
    const y = wall.y * TILE_SIZE;
    ctx.fillStyle = "#3e4b38";
    ctx.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
    ctx.fillStyle = "#70845f";
    ctx.fillRect(x + 6, y + 6, TILE_SIZE - 12, 7);
    ctx.fillStyle = "#1d261d";
    ctx.fillRect(x + 6, y + TILE_SIZE - 12, TILE_SIZE - 12, 6);
  });
}

function drawTank(tank) {
  const px = tank.x * TILE_SIZE;
  const py = tank.y * TILE_SIZE;
  const color = tank.alive ? PLAYER_COLORS[tank.playerId] : "#5c625d";
  const dark = tank.alive ? "#06140f" : "#2c312d";

  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(px + 8, py + 25, TILE_SIZE - 12, 6);
  ctx.fillStyle = dark;
  ctx.fillRect(px + 6, py + 8, TILE_SIZE - 12, TILE_SIZE - 14);
  ctx.fillStyle = color;
  ctx.fillRect(px + 9, py + 6, TILE_SIZE - 18, TILE_SIZE - 16);
  ctx.fillStyle = "#fff7c7";
  ctx.fillRect(px + 13, py + 11, 6, 6);
  ctx.fillRect(px + TILE_SIZE - 19, py + 11, 6, 6);
  ctx.fillStyle = dark;
  drawTurret(px, py, tank.direction);

  if (!tank.alive) {
    drawExplosion(px, py);
  }
}

function drawTurret(px, py, direction) {
  const mid = px + TILE_SIZE / 2;
  const center = py + TILE_SIZE / 2;

  if (direction === "up") {
    ctx.fillRect(mid - 3, py + 1, 6, 16);
  } else if (direction === "down") {
    ctx.fillRect(mid - 3, py + TILE_SIZE - 17, 6, 16);
  } else if (direction === "left") {
    ctx.fillRect(px + 1, center - 3, 16, 6);
  } else {
    ctx.fillRect(px + TILE_SIZE - 17, center - 3, 16, 6);
  }
}

function drawBullet(bullet) {
  const x = bullet.x * TILE_SIZE + TILE_SIZE / 2;
  const y = bullet.y * TILE_SIZE + TILE_SIZE / 2;
  ctx.fillStyle = "#ffe36f";
  ctx.fillRect(x - 4, y - 4, 8, 8);
  ctx.fillStyle = "rgba(255, 227, 111, 0.32)";
  ctx.fillRect(x - 8, y - 8, 16, 16);
}

function drawExplosion(px, py) {
  ctx.fillStyle = "#ff6b35";
  ctx.fillRect(px + 4, py + 4, 8, 8);
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(px + TILE_SIZE - 12, py + 8, 8, 8);
  ctx.fillRect(px + 13, py + 16, 10, 10);
  ctx.fillStyle = "#ff6b35";
  ctx.fillRect(px + 8, py + TILE_SIZE - 12, 8, 8);
}

function drawFinishOverlay(state) {
  ctx.fillStyle = "rgba(5, 12, 10, 0.56)";
  ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  ctx.fillStyle = "#fff7c7";
  ctx.font = "bold 24px monospace";
  ctx.textAlign = "center";
  ctx.fillText("BATTLE OVER", elements.canvas.width / 2, elements.canvas.height / 2 - 8);
  ctx.font = "14px monospace";
  ctx.fillText(state.result?.message || "战斗结束", elements.canvas.width / 2, elements.canvas.height / 2 + 22);
}

function getVisibleGameState() {
  if (appState.gameState) {
    return appState.gameState;
  }

  const playerA = getPlayer("A");
  const playerB = getPlayer("B");
  return createInitialState({
    playerAName: playerA?.name || "玩家 A",
    playerBName: playerB?.name || "玩家 B"
  });
}

function getActionText(playerId, state) {
  const action = state?.lastActions?.[playerId]?.action;
  return action ? ACTION_LABELS[action] || action : "-";
}

function getWaitingLog() {
  if (!appState.room) {
    return "等待创建房间。";
  }
  if (appState.room.status === "waiting") {
    return "等待第二名玩家加入。";
  }
  if (appState.room.status === "preparing") {
    return "等待双方确认规则。";
  }
  if (appState.room.exitRequest) {
    return "等待退出确认。";
  }
  if (appState.room.status === "closed") {
    return "游戏已退出。";
  }
  return "等待第一发炮弹。";
}

function getRoomHelpText(room, opponent) {
  if (room.status === "waiting") {
    return "复制邀请链接发给同 Wi-Fi 对手；若打不开，请确认房主用 HOST=0.0.0.0 启动、设备在同一局域网，并允许 Node 通过防火墙。";
  }
  if (room.status === "preparing") {
    return opponent
      ? "双方都需要生成并确认规则；确认后规则会锁定，本局结束前不能再修改。"
      : "等待第二名玩家加入后，再一起生成并确认策略。";
  }
  if (room.status === "fighting") {
    return "战斗由服务端自动执行；观察右侧日志可以看到每 tick 的规则命中、移动、射击和跳过原因。";
  }
  if (room.status === "finished") {
    return "本局已结束，可以点击“再来一局”重置策略，也可以退出回到大厅。";
  }
  if (room.status === "closed") {
    return "房间已关闭，返回大厅后可以重新创建或加入房间。";
  }
  return "复制邀请链接后，对手可以直接打开链接加入当前房间。";
}

function getPlayerStatusText(player) {
  const request = appState.room?.exitRequest;
  const exitText = request?.requesterId === player.id ? "请求退出" : "";
  const readyText = player.ready ? "已确认" : "编辑中";
  const connectionText = player.connected ? "在线" : "离线";
  return [exitText, readyText, connectionText].filter(Boolean).join(" · ");
}

function getResultTitle(result) {
  if (result.type === "draw") {
    return "平局";
  }
  if (result.type === "exit") {
    return "游戏已退出";
  }
  return `${result.winnerPlayerId} 方胜利`;
}

function getPlayer(playerId) {
  return appState.room?.players.find((player) => player.id === playerId) || null;
}

function getOpponent() {
  return getPlayer(appState.playerId === "A" ? "B" : "A");
}

function initializeGenerationMode() {
  const mode = loadGenerationMode();
  elements.generationModeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
}

function renderGenerationControls(isLocked) {
  const mode = getGenerationMode();
  elements.generationModeInputs.forEach((input) => {
    input.disabled = Boolean(isLocked);
  });

  const usesPlayerAi = mode === "player-ai";
  [elements.aiBaseUrlInput, elements.aiModelInput, elements.aiApiKeyInput].forEach((input) => {
    input.disabled = Boolean(isLocked || !usesPlayerAi);
  });
  elements.aiSettings.classList.toggle("inactive", !usesPlayerAi);
  elements.modeGuide.dataset.mode = mode;
  elements.modeGuide.innerHTML = renderGenerationModeGuide(mode);
  elements.generateButton.textContent = getGenerateButtonText(mode);
}

function renderGenerationModeGuide(mode) {
  const guide = GENERATION_MODE_GUIDANCE[mode] || GENERATION_MODE_GUIDANCE.local;
  return `
    <strong>${escapeHtml(guide.title)}</strong>
    <p>${escapeHtml(guide.body)}</p>
    <ul>
      ${guide.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
    </ul>
  `;
}

function getGenerationMode() {
  const selected = elements.generationModeInputs.find((input) => input.checked);
  return selected?.value || "local";
}

function saveGenerationMode(mode) {
  const normalizedMode = GENERATION_MODE_LABELS[mode] ? mode : "local";
  try {
    localStorage.setItem(GENERATION_MODE_STORAGE_KEY, normalizedMode);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

function loadGenerationMode() {
  try {
    const mode = localStorage.getItem(GENERATION_MODE_STORAGE_KEY);
    return GENERATION_MODE_LABELS[mode] ? mode : "local";
  } catch {
    return "local";
  }
}

function getGenerateButtonText(mode) {
  if (mode === "player-ai") {
    return "调用我的 AI 生成";
  }
  if (mode === "server-ai") {
    return "调用服务端 AI 生成";
  }
  return "本地生成规则";
}

function formatGenerationMessage(result) {
  const source = formatGenerationSource(result);
  const reason = result.fallbackReason ? `。${result.fallbackReason}` : "";
  return `${source} 已生成：${result.ruleSet.name}${reason}`;
}

function formatGenerationSource(result = {}) {
  if (result.source === "preset") {
    return "预设策略";
  }
  if (result.source === "ai") {
    const label = GENERATION_MODE_LABELS[result.mode] || "AI";
    return `${label}${result.model ? ` / ${result.model}` : ""}`;
  }
  return GENERATION_MODE_LABELS.local;
}

function formatRuleCapabilities(ruleSet) {
  const actions = new Set(ruleSet.rules.map((rule) => rule.action));
  const conditions = new Set(ruleSet.rules.flatMap((rule) => rule.when));
  const capabilities = [];
  if (actions.has("move_forward") || actions.has("move_backward")) {
    capabilities.push("会移动");
  }
  if (actions.has("shoot")) {
    capabilities.push("会射击");
  }
  if (conditions.has("bullet_in_front") || conditions.has("bullet_near")) {
    capabilities.push("会躲子弹");
  }
  if (actions.has("turn_left") || actions.has("turn_right")) {
    capabilities.push("会转向");
  }
  return `能力：${capabilities.length ? capabilities.join(" / ") : "仅等待"}`;
}

function initializeAiSettings() {
  const config = loadAiConfig();
  elements.aiBaseUrlInput.value = config.baseUrl || DEFAULT_AI_BASE_URL;
  elements.aiModelInput.value = config.model || DEFAULT_AI_MODEL;
  elements.aiApiKeyInput.value = loadAiKey();
}

function getPlayerAiConfig() {
  const apiKey = elements.aiApiKeyInput.value.trim();
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: elements.aiBaseUrlInput.value.trim() || DEFAULT_AI_BASE_URL,
    model: elements.aiModelInput.value.trim() || DEFAULT_AI_MODEL
  };
}

function saveAiSettings() {
  try {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify({
      baseUrl: elements.aiBaseUrlInput.value.trim(),
      model: elements.aiModelInput.value.trim()
    }));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }

  try {
    const apiKey = elements.aiApiKeyInput.value.trim();
    if (apiKey) {
      sessionStorage.setItem(AI_KEY_SESSION_STORAGE_KEY, apiKey);
    } else {
      sessionStorage.removeItem(AI_KEY_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

function loadAiConfig() {
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const config = JSON.parse(raw);
    return {
      baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "",
      model: typeof config.model === "string" ? config.model : ""
    };
  } catch {
    return {};
  }
}

function loadAiKey() {
  try {
    return sessionStorage.getItem(AI_KEY_SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveSession(roomCode, playerId, playerToken) {
  const payload = JSON.stringify({
    roomCode,
    playerId,
    playerToken,
    savedAt: Date.now()
  });

  try {
    localStorage.setItem(SESSION_STORAGE_KEY, payload);
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }

  try {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, payload);
  } catch {
    // sessionStorage may be unavailable in private or restricted browser contexts.
  }
}

function loadSession() {
  return parseSessionStorage(localStorage, SESSION_STORAGE_KEY);
}

function loadActiveSession() {
  return parseSessionStorage(sessionStorage, ACTIVE_SESSION_STORAGE_KEY);
}

function parseSessionStorage(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }

    const session = JSON.parse(raw);
    const roomCode = normalizeRoomCode(session.roomCode);
    const playerId = session.playerId;
    const playerToken = typeof session.playerToken === "string" ? session.playerToken : "";
    if (!roomCode || !["A", "B"].includes(playerId) || !playerToken) {
      return null;
    }

    return {
      roomCode,
      playerId,
      playerToken
    };
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function clearActiveSession() {
  try {
    sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function leaveRoomLocally(message) {
  appState.eventSource?.close();
  appState.eventSource = null;
  appState.connectionState = "closed";
  appState.room = null;
  appState.playerId = null;
  appState.playerToken = null;
  appState.generatedRuleSet = null;
  appState.generationResult = null;
  appState.gameState = null;
  clearSession();
  clearActiveSession();
  clearRoomUrl();
  setMessage(message);
  renderApp();
}

function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function createInviteUrl(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  return url.toString();
}

function updateRoomUrl(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  window.history.replaceState({}, "", url);
}

function clearRoomUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
}

function setMessage(message) {
  appState.message = message;
  elements.lobbyMessage.textContent = message;
  elements.roomMessage.textContent = message;
}

async function postJson(url, body) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throwHttpError(response, data);
  }

  return data;
}

function throwHttpError(response, data) {
  const error = new Error(data.error || "请求失败");
  error.status = response.status;
  throw error;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("请求超时，请检查服务是否仍在运行。");
    }
    throw new Error("网络连接失败，请稍后重试。");
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: response.ok ? "响应格式错误" : `服务器错误：${response.status}`
    };
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("beforeunload", () => {
  appState.eventSource?.close();
});
