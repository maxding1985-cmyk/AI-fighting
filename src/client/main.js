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
  finished: "已结束"
};
const REQUEST_TIMEOUT_MS = 10000;
const SESSION_STORAGE_KEY = "ai-tank-duel:last-session";
const ACTIVE_SESSION_STORAGE_KEY = "ai-tank-duel:active-session";

const appState = {
  room: null,
  playerId: null,
  playerToken: null,
  generatedRuleSet: null,
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
        <strong>MVP-03</strong>
        <small>分享链接 + 身份恢复</small>
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

    <section class="layout" id="roomArea" hidden>
      <aside class="strategy-board">
        <article class="room-panel">
          <p class="eyebrow">Room State</p>
          <h2>房间 <span id="roomCodeText">-</span></h2>
          <p id="currentPlayerText">当前身份：-</p>
          <div class="status-chip wide" id="statusChip">等待中</div>
          <div class="players-list" id="playersList"></div>
          <button id="copyRoomButton">复制邀请链接</button>
          <p class="message" id="roomMessage"></p>
        </article>

        <article class="strategy-card" id="strategyCard">
          <div class="card-title">
            <span class="player-mark" id="playerMark">?</span>
            <div>
              <h2 id="strategyTitle">我的策略</h2>
              <p>本阶段使用本地策略生成器，后续可替换为真实 AI 接口。</p>
            </div>
          </div>
          <label>
            赛前策略描述
            <textarea id="strategyPrompt" rows="5"></textarea>
          </label>
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
  roomMessage: document.querySelector("#roomMessage"),
  strategyCard: document.querySelector("#strategyCard"),
  playerMark: document.querySelector("#playerMark"),
  strategyTitle: document.querySelector("#strategyTitle"),
  strategyPrompt: document.querySelector("#strategyPrompt"),
  generateButton: document.querySelector("#generateButton"),
  confirmButton: document.querySelector("#confirmButton"),
  presetButtons: document.querySelector("#presetButtons"),
  canvas: document.querySelector("#battleCanvas"),
  tickValue: document.querySelector("#tickValue"),
  tankAName: document.querySelector("#tankAName"),
  tankBName: document.querySelector("#tankBName"),
  actionA: document.querySelector("#actionA"),
  actionB: document.querySelector("#actionB"),
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
elements.restoreSessionButton.addEventListener("click", () => restoreSavedSession());
elements.generateButton.addEventListener("click", generateRules);
elements.confirmButton.addEventListener("click", confirmRules);
elements.restartButton.addEventListener("click", restartRoom);
elements.roomCodeInput.addEventListener("input", () => {
  elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase();
});
elements.presetButtons.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    appState.generatedRuleSet = cloneRuleSet(builtInRuleSets[button.dataset.preset]);
    setMessage(`已选择预设：${appState.generatedRuleSet.name}`);
    renderApp();
  });
});

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
    const response = await postJson(`/api/rooms/${appState.room.code}/strategy/generate`, {
      prompt: elements.strategyPrompt.value
    });
    appState.generatedRuleSet = response.ruleSet;
    setMessage(`规则已生成：${response.ruleSet.name}`);
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
    elements.strategyPrompt.value = DEFAULT_PROMPTS[appState.playerId] || DEFAULT_PROMPTS.A;
    setMessage("新一局已重置，请重新生成并确认规则。");
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
  const isLocked = currentPlayer?.ready || roomStatus === "fighting" || roomStatus === "finished";

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

  renderPlayers();
  renderRulePanels(currentPlayer, opponent);
  renderTelemetry();
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
        <em>${player.ready ? "已确认" : "编辑中"} · ${player.connected ? "在线" : "离线"}</em>
      </div>
    `;
  }).join("");
}

function renderRulePanels(currentPlayer, opponent) {
  const currentRuleSet = currentPlayer?.ruleSet || appState.generatedRuleSet;
  elements.rulePreview.innerHTML = currentRuleSet
    ? renderRuleSet(currentRuleSet)
    : `<p>输入战术后点击“生成规则”，或者直接选择一个预设策略。</p>`;

  elements.opponentRules.innerHTML = opponent?.ruleSet
    ? renderRuleSet(opponent.ruleSet)
    : `<p>${opponent ? "对手还没有确认规则。" : "等待第二名玩家加入。"}</p>`;
}

function renderRuleSet(ruleSet) {
  return `
    <h3>${escapeHtml(ruleSet.name)}</h3>
    <p>${escapeHtml(ruleSet.description || "暂无说明")}</p>
    <ul>
      ${ruleSet.rules.map((rule) => `
        <li>
          <span>P${rule.priority}</span>
          <strong>${escapeHtml(rule.when.map((item) => CONDITION_LABELS[item] || item).join(" + "))}</strong>
          <em>${escapeHtml(ACTION_LABELS[rule.action] || rule.action)}</em>
        </li>
      `).join("")}
    </ul>
  `;
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
    <strong>${escapeHtml(result.type === "draw" ? "平局" : `${result.winnerPlayerId} 方胜利`)}</strong>
    <p>${escapeHtml(result.message)}</p>
    <small>结束原因：${escapeHtml(result.reason)} · 用时 ${result.tick} tick</small>
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
  return "等待第一发炮弹。";
}

function getPlayer(playerId) {
  return appState.room?.players.find((player) => player.id === playerId) || null;
}

function getOpponent() {
  return getPlayer(appState.playerId === "A" ? "B" : "A");
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
