# Commit Note - Add Automated Test Gates

- **Timestamp:** 2026-06-10 10:56:25 CST
- **Branch:** main
- **Commit message:** Add automated test gates
- **Commit hash:** Pending until commit is created
- **Scope:** Add CI, local pre-commit checks, and E2E/regression coverage for the AI battle flow.

## Summary

- Added a GitHub Actions workflow that runs `npm test` on pushes to `main`, pull requests, and manual dispatches.
- Added a local git hook installer and pre-commit hook so local commits run `npm test` before completing.
- Added HTTP/API and service-level regression coverage for the two-player setup where player A should move and fire after the prompt `随机运动，遇到子弹躲避，一直射击`.
- Updated README and `GAME_MVP_ROADMAP.md` to reflect the new automated test workflow and remaining browser UI E2E gap.

## Changed Files

| File | Change | Notes |
|---|---|---|
| `.github/workflows/test.yml` | Added | Runs the Node test suite in GitHub Actions. |
| `.githooks/pre-commit` | Added | Runs `npm test` before local commits when hooks are installed. |
| `scripts/install-git-hooks.sh` | Added | Configures `core.hooksPath` to use repository hooks. |
| `package.json` | Changed | Adds `npm run install-hooks`. |
| `tests/roomManager.test.js` | Changed | Adds service-level movement/fire regression coverage for player A. |
| `tests/serverApi.e2e.test.js` | Added | Starts the app server and verifies the HTTP two-player strategy/battle path. |
| `README.md` | Changed | Documents automated tests, hooks, and E2E coverage. |
| `GAME_MVP_ROADMAP.md` | Changed | Updates MVP test coverage status and decisions. |
| `commit-notes/2026-06-10_10-56-25_add-automated-test-gates.md` | Added | Records this commit's scope and validation. |

## Behavior / User Impact

- Future pushes and pull requests will automatically run the test suite on GitHub.
- Local commits can be protected by the pre-commit hook; it is already installed in the current checkout.
- The previous player A movement/fire regression now has automated coverage.

## Validation

- Ran `npm test`: 23 tests passed, 0 failed, 0 skipped.
- Ran `npm run install-hooks`: installed `.githooks` as the repository hook path.

## Follow-ups

- Add full browser UI automation for create/join/generate/confirm/battle/exit flows.
- Consider adding branch protection in GitHub so CI must pass before merging.
