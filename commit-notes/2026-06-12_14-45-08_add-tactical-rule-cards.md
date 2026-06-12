# Commit Note - Add Tactical Rule Cards

- **Timestamp:** 2026-06-12 14:45:08 CST
- **Branch:** main
- **Commit message:** Add tactical rule cards
- **Commit hash:** Pending until commit is created
- **Scope:** Add a fun spike that makes AI-generated rules visible as tactical cards, live triggers, and post-battle summaries.

## Summary

- Added battle-engine telemetry for rule trigger counts and decisive hit rules.
- Reworked rule preview into tactical cards with trigger counts, readable names, and risk/value hints.
- Added live trigger feedback during battle and a tactical recap after battle ends.
- Updated tests, README, and MVP roadmap to capture the fun-factor experiment.

## Changed Files

| File | Change | Notes |
|---|---|---|
| `src/shared/battleEngine.js` | Changed | Tracks rule usage stats, source rules for bullets, and decisive hit rule metadata. |
| `src/client/main.js` | Changed | Renders tactical rule cards, live trigger cards, and post-battle rule summaries. |
| `src/client/styles.css` | Changed | Adds visual styling for tactical cards, active trigger states, and battle recap panels. |
| `tests/battleEngine.test.js` | Changed | Covers rule trigger stats and decisive rule telemetry. |
| `tests/browserUi.e2e.test.js` | Changed | Verifies rule-card and trigger-feed UI surfaces in the browser flow. |
| `README.md` | Changed | Documents the new tactical-card, live-trigger, and recap behavior. |
| `GAME_MVP_ROADMAP.md` | Changed | Records the boredom/fun-factor feedback and prioritizes rule visibility as the current fun spike. |

## Behavior / User Impact

- Players can see generated rules as readable tactical cards instead of only implementation-like rule rows.
- During battle, players can see which rule just fired, reducing the feeling that AI rules are hidden background logic.
- After battle, players get a quick recap of key rule impact and unused cards to guide iteration.

## Validation

- `node --check src/shared/battleEngine.js`
- `node --check src/client/main.js`
- `npm test` (HTTP E2E skipped in the sandbox because local port binding was not permitted)
- `npm run test:ui`
- In-app browser smoke check for rule-card rendering and trigger-feed rendering
- `git diff --check`

## Follow-ups

- Playtest whether tactical cards and live triggers make players want to iterate strategies.
- If the game still feels flat, test a stronger fun spike such as pre-battle mind-game choices, richer tactical vocabulary, or direct rule editing.
