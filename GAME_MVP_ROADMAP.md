# Game MVP Roadmap

_Last updated: 2026-06-11_

## 1. Game Vision

- **Game title:** AI Tank Duel
- **Genre:** Browser-based strategy autobattler / tactical programming duel
- **Target platform:** Desktop and mobile browsers, first for local / LAN play
- **Target player:** Players who enjoy AI prompts, lightweight tactics, and watching strategy rules fight automatically
- **One-sentence pitch:** Two players write natural-language tank strategies, turn them into executable rules, and watch a server-authoritative pixel tank duel play out.
- **Core experience:** Plan before battle, commit to a rule set, then observe whether the strategy works under pressure.
- **Core loop:**
  1. Create or join a room.
  2. Describe a tank strategy in natural language.
  3. Generate and confirm executable rules.
  4. Watch the tanks fight automatically.
  5. Review logs, adjust strategy, and play again.

## 2. Current Snapshot

| Field | Value |
|---|---|
| Current MVP | MVP 1 - LAN Playable Duel |
| Overall status | In Progress / 可局域网试玩 |
| Recently completed | Server-authoritative rooms, SSE sync, explicit AI generation modes, exit confirmation flow, decision logs, automated API/UI E2E tests, room cleanup, first-use LAN/AI onboarding |
| Current focus | Make the two-player loop understandable, debuggable, and repeatable |
| Current blockers | No persistence, no public deployment security, first playtest feedback not collected yet |
| Next review date | 2026-06-17 |

## 3. MVP Overview

| MVP | Goal | Status | Core Scope | Acceptance Criteria |
|---|---|---|---|---|
| MVP 0 - Core Combat Prototype | Validate rule-driven automatic tank combat | Done | Local battle engine, rule validation, canvas rendering, basic shooting/movement | A user can run a local match and see rules drive tank actions |
| MVP 1 - LAN Playable Duel | Complete a two-player room-based duel over LAN | In Progress | Rooms, joining, AI/local rule generation, ready flow, SSE sync, restart, exit, logs | Two players on different browsers/devices can complete one duel and understand what happened |
| MVP 2 - Replayable Strategy Lab | Make repeated strategy iteration valuable | Planned | Rule editor, richer conditions/actions, battle replay/history, tuning tools | Players can iterate multiple strategies without developer help and compare outcomes |
| MVP 3 - Public Test Build | Prepare for external testing | Not Started | HTTPS-ready deployment, auth/key safety, persistence, onboarding, E2E tests, polish | External testers can play safely without local setup |

## 4. Feature Backlog

| Feature | System | Priority | MVP | Status | Notes |
|---|---|---|---|---|---|
| Rule-driven battle engine | Combat | Must | MVP 0 | Done | Movement, turning, shooting, cooldown, collision, win/draw |
| Canvas battlefield | Client UI | Must | MVP 0 | Done | Pixel-style board and tank rendering |
| Local strategy generator | Strategy | Must | MVP 0 | Done | Keyword/template generator with Chinese prompt support |
| Room creation and joining | Multiplayer | Must | MVP 1 | Done | Room code and invitation link |
| SSE state sync | Multiplayer | Must | MVP 1 | Done | Server-authoritative state broadcast |
| Refresh/session restore | Multiplayer | Should | MVP 1 | Done | Local/session storage identity restore |
| Explicit AI generation modes | Strategy / AI | Must | MVP 1 | Done | Local / player AI / server AI are separated |
| Decision and battle logs | Debugging | Must | MVP 1 | Done | Shows selected rule, action, and skip reasons |
| Exit confirmation flow | Room flow | Should | MVP 1 | Done | Solo/offline direct exit; online needs confirmation |
| First-use LAN/AI onboarding | UX | Must | MVP 1 | Done | Lobby checklist, room-state hints, and generation-mode guidance |
| End-to-end tests | QA | Must | MVP 1 | Testing | HTTP and browser UI E2E cover create, join, generate, confirm, battle behavior, and exit confirmation |
| Rule editor | Strategy | Should | MVP 2 | Planned | Manual edit after AI generation |
| More tactical conditions/actions | Combat / Strategy | Should | MVP 2 | Planned | Distance control, dodge directions, chase/retreat |
| Battle history and replay | Meta | Should | MVP 2 | Planned | Needs persistence |
| Room cleanup | Server | Must | MVP 1 | Done | Expires offline idle rooms and closed rooms with configurable TTLs |
| Public deployment hardening | Platform | Must | MVP 3 | Not Started | HTTPS, auth, rate limits, API key safety |
| Public onboarding/tutorial | UX | Should | MVP 3 | Not Started | Full external tester tutorial beyond MVP 1 quick-start guidance |

## 5. MVP Details

### MVP 0 - Core Combat Prototype

- **Goal:** Validate that JSON rules can drive an automatic tank fight.
- **Included:** Battle engine, rule validation, built-in rule sets, local strategy generation, canvas rendering.
- **Excluded:** Multiplayer rooms, real AI calls, persistence, public deployment.
- **Acceptance criteria:**
  - A battle can start locally.
  - Tanks can move, turn, shoot, hit, and finish a match.
  - Invalid rules are rejected.
- **Status:** Done.

### MVP 1 - LAN Playable Duel

- **Goal:** Let two players complete a full browser-based duel over the same LAN.
- **Included:**
  - Create/join rooms.
  - Share invitation links.
  - Generate strategy rules via local, player AI, or server AI mode.
  - Confirm strategies and start a server-authoritative battle.
  - Show battle state, results, and logs through SSE.
  - Restart or exit with clear room flow.
  - Show lightweight first-use guidance for LAN setup and AI generation modes.
- **Excluded:**
  - Public-hosting security.
  - Persistent accounts or match history.
  - Full replay/tournament systems.
- **Acceptance criteria:**
  - Two devices on the same network can join one room.
  - Both players can generate and confirm rules.
  - The match starts without manual server intervention.
  - The UI clearly shows whether rules came from local generation or AI.
  - First-time players can see LAN setup and AI mode guidance before battle.
  - Players can understand why a tank moved, fired, waited, or skipped an action.
  - A player can exit cleanly, with confirmation when both players are online.
- **Risks:**
  - AI-generated rules may still be hard for players to judge before battle.
  - LAN/firewall/proxy issues may confuse first-time setup.
  - SSE is adequate now but may become limiting for richer real-time interactions.
- **Next actions:**
  1. Validate first-use guidance during LAN playtest.
  2. Extend E2E tests for more strategy and error-path regressions.
  3. Collect playtest feedback on whether strategy iteration feels fun.
  4. Decide whether MVP 2 should start with rule editor or battle history.

### MVP 2 - Replayable Strategy Lab

- **Goal:** Make repeated strategy experiments satisfying and easier to compare.
- **Included:** Rule editor, richer action/condition vocabulary, replay/history, strategy comparison, room cleanup.
- **Excluded:** Public account system unless needed for persistence.
- **Acceptance criteria:**
  - Players can edit generated rules without writing raw JSON.
  - Players can run multiple matches and compare outcomes.
  - Strategy changes are easy to reason about from logs/replays.
- **Risks:** Rule complexity may outgrow the UI; AI prompts may need stricter schemas.
- **Next actions:** Define rule editor UX and choose persistence model.

### MVP 3 - Public Test Build

- **Goal:** Prepare a stable and safe build for external testers.
- **Included:** Deployment, HTTPS, authentication or room access controls, API key isolation, rate limiting, onboarding, E2E coverage, visual polish.
- **Excluded:** Large-scale matchmaking unless public tests prove demand.
- **Acceptance criteria:**
  - Testers can play from a public URL.
  - User-provided API keys are handled safely or avoided.
  - Basic abuse/rate limits exist.
  - The game can collect useful feedback without developer supervision.
- **Risks:** Security and operational scope may be larger than gameplay scope.
- **Next actions:** Decide deployment target and key-management strategy.

## 6. Current Sprint / Next Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| Add full browser E2E test for two-player duel | TBD | Testing | Covers two browser contexts, strategy generation/confirmation, battle behavior, and exit confirmation |
| Add room cleanup / expiry | TBD | Done | Offline idle rooms and closed rooms now expire automatically |
| Improve onboarding copy for AI modes and LAN access | TBD | Done | Added lobby checklist, room-state hints, and mode-specific generation guidance |
| Collect first playtest feedback | TBD | Planned | Validate whether strategy iteration is fun |
| Decide persistence approach | TBD | Needs Decision | Required for MVP 2 history/replay |

## 7. Feedback Inbox

| Date | Feedback | Type | Affected MVP | Decision | Status |
|---|---|---|---|---|---|
| 2026-06-10 | Player command “随机运动 一直开炮 遇到子弹躲避” caused confusion when strategy appeared to spin and not fire | Usability / AI strategy | MVP 1 | Added explicit AI/local modes, decision logs, and local keyword handling for “开炮” | Addressed |
| 2026-06-10 | Exit should be direct when only one player is in the room | Usability | MVP 1 | Solo/offline exit now closes immediately; online opponent still confirms | Addressed |
| 2026-06-10 | AI generation logic was unclear | Usability / Product | MVP 1 | Split generation into local, player AI, and server AI modes | Addressed |

## 8. Risks & Dependencies

| Risk / Dependency | Impact | Affected MVP | Mitigation | Status |
|---|---|---|---|---|
| Browser or LAN caching makes testers see old code | Medium | MVP 1 | Static responses use `Cache-Control: no-store`; UI also reminds testers to check cache/proxy/VPN when LAN access fails | Mitigated |
| AI API keys are unsafe on public deployment if forwarded casually | High | MVP 3 | Require HTTPS, auth, server-side key isolation, or server-only AI mode | Open |
| In-memory rooms vanish on restart | Medium | MVP 2 | Add persistence or communicate MVP limitation; cleanup prevents stale memory growth only | Open |
| Browser UI regressions in multi-browser flow | Medium | MVP 1 | Browser UI E2E now covers the main happy path; extend edge cases over time | Mitigated |
| Rule vocabulary may limit strategy expression | Medium | MVP 2 | Add richer conditions/actions and manual editor | Open |

## 9. Progress Log

| Date | Update | Impact | Roadmap Change |
|---|---|---|---|
| 2026-06-10 | Created living MVP roadmap and aligned it with current repository state | Establishes single source of truth for game MVP planning | Added MVP 0-3 structure and current MVP 1 status |
| 2026-06-10 | Explicit AI generation modes, decision logs, exit flow, README updates, and tests were completed | Makes LAN playable loop clearer and easier to debug | Marked several MVP 1 features Done; kept E2E tests and cleanup as next actions |
| 2026-06-10 | Backfilled timestamped commit notes for existing repository history | Improves traceability of completed MVP work and future submissions | Added `commit-notes/` as the per-commit documentation trail |
| 2026-06-10 | Added automated test coverage for player A movement/fire regression and CI/pre-commit test flow | Reduces risk that AI battle behavior regresses after future changes | Marked E2E coverage In Progress and kept browser UI automation as next gap |
| 2026-06-11 | Added browser UI E2E for the two-player room flow, player A behavior, and exit confirmation | Validates the real user path through two independent browser sessions | Marked E2E coverage Testing; moved room cleanup to the next highest gap |
| 2026-06-11 | Added automatic cleanup for offline idle rooms and closed rooms | Reduces stale in-memory room buildup during LAN testing | Moved room cleanup into MVP 1 and marked it Done |
| 2026-06-11 | Added first-use onboarding for LAN setup, room flow, and AI generation modes | Makes the two-player loop easier to start and reduces mode-selection confusion | Marked MVP 1 onboarding guidance Done; left full public tutorial for MVP 3 |

## 10. Decision Log

| Date | Decision | Reason | Impact |
|---|---|---|---|
| 2026-06-10 | Keep current milestone as MVP 1 - LAN Playable Duel | The core combat prototype is already done; current risk is complete two-player usability | Focus next work on E2E coverage, onboarding, and LAN play stability |
| 2026-06-10 | Separate AI generation into explicit modes | Users need to know whether rules came from local templates, their own AI, or server AI | Reduces confusion and prevents silent AI fallback |
| 2026-06-10 | Update roadmap during commit workflow for game projects | Planning should evolve with actual committed progress | Added `commit-code` skill workflow requirement to update `GAME_MVP_ROADMAP.md` |
| 2026-06-10 | Create timestamped commit notes for every commit | Each submission should leave a durable change record beyond the git message | Added `commit-note` workflow and backfilled historical notes |
| 2026-06-10 | Run `npm test` automatically in CI and optional local pre-commit hooks | Battle regressions should be caught before merging or local commits | Added GitHub Actions test workflow and hook installer |
| 2026-06-11 | Run browser UI E2E separately from default local tests | Full UI tests require Playwright/browser setup and are better suited for CI or explicit local validation | Added `npm run test:ui` and CI Playwright installation |
| 2026-06-11 | Keep room cleanup in-memory and configurable before adding persistence | MVP 1 needs stability without introducing a database yet | Added TTL environment variables and left battle history/persistence for MVP 2 |
| 2026-06-11 | Keep MVP 1 onboarding lightweight and embedded in the main UI | First LAN testers need just-in-time guidance more than a separate tutorial system | Added quick-start cards and contextual room/mode hints; reserved full tutorial for MVP 3 |

## 11. Open Questions

- What deployment target should MVP 3 use?
- Should public testers use server-provided AI only, or can players safely bring their own API keys?
- What is the first external playtest group?
- Should battle history be stored locally, server-side, or exported as files?
- How complex should the rule editor become before it stops feeling like a lightweight game?
