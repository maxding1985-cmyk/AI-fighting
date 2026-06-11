# Commit Note - Add LAN Onboarding Guidance

- **Timestamp:** 2026-06-11 18:12:38 CST
- **Branch:** main
- **Commit message:** Add LAN onboarding guidance
- **Commit hash:** Pending until commit is created
- **Scope:** Add first-use LAN and AI mode guidance to the game UI, tests, README, and MVP roadmap.

## Summary

- Added a lobby quick-start panel explaining LAN access, room flow, and AI generation modes.
- Added contextual room-state help and mode-specific generation guidance inside the room UI.
- Updated browser UI E2E coverage to assert the new onboarding and guidance surfaces.
- Updated README and GAME_MVP_ROADMAP.md to reflect the completed MVP 1 onboarding work.

## Changed Files

| File | Change | Notes |
|---|---|---|
| `src/client/main.js` | Changed | Adds quick-start markup, room help text, and generation-mode guidance rendering. |
| `src/client/styles.css` | Changed | Styles onboarding cards, room hints, mode guidance, and responsive layouts. |
| `tests/browserUi.e2e.test.js` | Changed | Verifies onboarding content, room help, and mode guidance in the browser flow. |
| `README.md` | Changed | Documents the first-use guidance and expanded UI E2E coverage. |
| `GAME_MVP_ROADMAP.md` | Changed | Marks MVP 1 onboarding guidance as done and records progress/decision updates. |

## Behavior / User Impact

- First-time LAN testers now see setup steps before creating or joining a room.
- Players get just-in-time hints for room status and clearer explanations of local, player AI, and server AI modes.
- Project planning now distinguishes lightweight MVP 1 onboarding from later public-test tutorial work.

## Validation

- `npm test`
- `npm run test:ui`
- In-app browser smoke check of the local page and room creation flow; no console errors observed.

## Follow-ups

- Validate whether the guidance reduces confusion during the next LAN playtest.
- Continue extending E2E coverage for strategy and error-path regressions.
