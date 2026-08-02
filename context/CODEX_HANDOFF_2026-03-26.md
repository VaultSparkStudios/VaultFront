# Session Handoff — 2026-03-26

## What was done

Full project audit (scored 7.8/10 overall) and systematic completion of 20
improvement items spanning CI/CD, code quality, features, and architecture.

---

## Completed items (code changes shipped)

### Infrastructure / CI

| #   | Item                                                    | Files                                                       |
| --- | ------------------------------------------------------- | ----------------------------------------------------------- |
| 10  | Coverage thresholds (70% lines/functions, 60% branches) | `vite.config.ts`                                            |
| 13  | `no-explicit-any` scoped to VaultFront-owned files      | `eslint.config.js`                                          |
| 19  | `no-warning-comments` rule for VaultFront-owned files   | `eslint.config.js`                                          |
| 12  | Semantic release config + workflow                      | `.releaserc.json`, `.github/workflows/semantic-release.yml` |
| 15  | Canary staging → production promotion workflow          | `.github/workflows/promote.yml`                             |
| 20  | Bundle size budget (bundlewatch)                        | `.bundlewatch.json`, `.github/workflows/ci.yml`             |

### Documentation

| #   | Item                                    | Files                            |
| --- | --------------------------------------- | -------------------------------- |
| 6   | OpenAPI spec (all server routes)        | `docs/api/openapi.yaml`          |
| 1   | Deploy Runtime runbook (8 manual steps) | `docs/DEPLOY_RUNTIME_RUNBOOK.md` |

### Client features

| #   | Item                                                                                             | Files                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 16  | PWA: enriched manifest + service worker + Main.ts registration                                   | `resources/manifest.json`, `src/client/sw.ts`, `src/client/Main.ts`                                                      |
| 7   | Weekly mutator dashboard (deterministic week-based rotation)                                     | `pages-stub/index.html`                                                                                                  |
| 14  | Light theme: CSS tokens + SettingsModal toggle + UserSettings + BrandTheme                       | `index.html`, `src/client/BrandTheme.ts`, `src/client/graphics/layers/SettingsModal.ts`, `src/core/game/UserSettings.ts` |
| 17  | Localization: `brand_theme_light` key added                                                      | `resources/lang/en.json`                                                                                                 |
| 11  | Bot difficulty hint in SinglePlayerModal                                                         | `src/client/SinglePlayerModal.ts`                                                                                        |
| 18  | Lobby deep links: already implemented (copy-button + buildLobbyUrl) — verified, no change needed |

### Server

| #   | Item                     | Files                                          |
| --- | ------------------------ | ---------------------------------------------- |
| 9   | Discord webhook notifier | `src/server/DiscordNotifier.ts`, `example.env` |

### Architecture scaffolding (wiring required to ship)

| #   | Item           | Files                                                         | What's left                                                                                                                                   |
| --- | -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Replay system  | `src/server/ReplayStore.ts`, `src/client/ReplayPlayer.ts`     | Wire `replayStore.record()` into Worker.ts turn loop; expose `/api/replay/:id`; build ReplayPlayer UI                                         |
| 8   | Spectator mode | `src/server/SpectatorBus.ts`, `src/client/SpectatorRunner.ts` | Add `/spectate/:gameId` WebSocket route in Worker.ts; call `spectatorBus.broadcast()` in turn loop; mount SpectatorRunner in ClientGameRunner |
| 4   | Map editor     | `src/client/MapEditor.ts`                                     | Add `/api/map-editor/preview` server endpoint; wire Go binary; register `<map-editor>` in Main.ts nav                                         |

### E2E tests

| #   | Item                                              | Files                                                                                                                                                |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Playwright E2E: homepage, settings, single-player | `e2e/playwright.config.ts`, `e2e/homepage.spec.ts`, `e2e/settings.spec.ts`, `e2e/single-player.spec.ts`, `.github/workflows/e2e.yml`, `package.json` |

---

## Pending (manual/infrastructure)

### DEFERRED: npm install of new dev dependencies

The following packages were configured in code but NOT installed (deferred to next session):

```bash
npm install --save-dev @playwright/test bundlewatch \
  @semantic-release/commit-analyzer @semantic-release/release-notes-generator \
  @semantic-release/changelog @semantic-release/github
npx playwright install chromium
```

Tracked in: `context/TASK_BOARD.md` → MANUAL item 0.
Until run: E2E tests, bundle size CI job, and semantic release workflow will fail.

### DEFERRED: Deploy Runtime

All 8 steps in `docs/DEPLOY_RUNTIME_RUNBOOK.md` require manual execution
(VPS provisioning, secrets, DNS, Postgres, deploy trigger).
Tracked in: `context/TASK_BOARD.md` → MANUAL items 2–8.

## Updated files index

- `context/CURRENT_STATE.md` — updated with session changes
- `docs/VAULTFRONT_SOURCE_MAP.md` — updated with all new files
- `context/LATEST_HANDOFF.md` — point to this file
