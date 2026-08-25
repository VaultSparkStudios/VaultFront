# Project Memory

This file is the stable memory layer for fresh AI sessions.

Read this after `AGENTS.md` and before the dated handoff file.

## Identity

- Game: `VaultFront`
- Repo: `VaultSparkStudios/VaultFront`
- Public slug: `vaultfront`
- Studio site repo: `VaultSparkStudios/VaultSparkStudios.github.io`

## Canonical URLs

- Studio root:
  - `https://vaultsparkstudios.com/`
- Public game path:
  - `https://vaultsparkstudios.com/vaultfront/`
- Gameplay runtime target:
  - `https://play-vaultfront.vaultsparkstudios.com`
- API runtime target:
  - `https://api-vaultfront.vaultsparkstudios.com`

## Current public state

- The public `vaultfront` path is a project page, not a playable client.
- The studio homepage VaultFront card CTA is `View Project`.
- The project page content is published from this repo's own GitHub Pages
  workflow, not from the studio-site repo.
- The repo-local launch stub has already been pushed and verified live over
  HTTPS at `https://vaultsparkstudios.com/vaultfront/`.
- A gameplay/HUD clarity and tuning pass was pushed to `vaultfront/main` on
  March 12, 2026.
- GitHub Actions `CI` on `main` was repaired and verified green on March 12, 2026.
- The playable launch remains blocked on the dedicated runtime/backend rollout.

## Deployment posture

- Frontend Pages deployment and backend/runtime deployment stay separate.
- `deploy-pages.yml` is manual-only until runtime launch readiness exists.
- `deploy-pages.yml` currently publishes `pages-stub/` as the public project
  page artifact.
- The public path must not be overwritten with the static client until the
  backend stack is live and verified.
- The repo-local `build:pages` client bundle remains for future launch
  readiness, but it is not the current public publish source.
- Backend naming stays on the studio default:
  - `play-{slug}.vaultsparkstudios.com`
  - `api-{slug}.vaultsparkstudios.com`

## Repo memory stack

Read order for future sessions:

1. `AGENTS.md`
2. `PROJECT_MEMORY.md`
3. latest `CODEX_HANDOFF_YYYY-MM-DD.md`
4. deployment/runtime docs referenced by the task

## Canonical repo docs

- `docs/VAULTFRONT_SOURCE_MAP.md`
- `docs/STUDIO_DEPLOYMENT_STANDARD.md`
- `docs/STUDIO_BACKEND_PLAN.md`
- `docs/DEPLOY_PAGES.md`
- `docs/templates/deploy-pages.template.yml`
- `docs/templates/deploy-backend.docker-compose.template.yml`
- `docs/templates/Caddyfile.studio-backend.template`
- `docs/templates/GAME_LAUNCH_CHECKLIST.template.md`

## Session context folder

All session-state files live under `context/`:

- `context/CURRENT_STATE.md` — repo and deployment state at last closeout
- `context/TASK_BOARD.md` — task status
- `context/LATEST_HANDOFF.md` — pointer to current handoff file
- `context/SESSION_LOG.md` — running session log

## Remotes and branches

- canonical working remote:
  - `origin -> https://github.com/VaultSparkStudios/vaultfront.git`
- upstream reference remote:
  - `openfront-upstream -> https://github.com/openfrontio/OpenFrontIO.git`
- canonical local branch for day-to-day VaultFront work:
  - `main -> origin/main`
- archived pre-migration local branch:
  - `openfront-main-archive-2026-03-12`
- clean publish worktree branch used for curated pushes:
  - `.codex-temp-vaultfront-clean`
  - branch: `codex/project-memory-stack`

## Resume pointers

- Latest operational handoff file:
  - `context/CODEX_HANDOFF_2026-03-12.md`
- The canonical repo of record is now `VaultSparkStudios/VaultFront`.
- Do not treat `openfront-upstream/main` as the branch to push VaultFront work.
- The archived branch `openfront-main-archive-2026-03-12` preserves the old
  OpenFront-tracking local history and should not be used as the default
  working branch.
- A temporary studio-site clone has been used for studio homepage and project
  page work:
  - `.codex-temp-studio-site`
- Local tooling now ignores `.codex-temp-*` temp worktrees in normal Vitest and
  git-ignore flows.

## Next launch-critical work

1. Keep the public path on the repo-local launch stub until runtime readiness
   exists.
2. Provision the shared VPS runtime stack.
3. Bring up Caddy, Postgres, Redis, and the VaultFront play/api services.
4. Configure DNS and TLS for `play-vaultfront` and `api-vaultfront`.
5. Verify websocket, CORS, and health endpoints from the public game path.
6. Only then replace the stub workflow with the real Pages client rollout.

## Maintenance rule

When canonical state changes, update this file and the latest handoff so a new
session can resume from repo state without relying on prior chat.

## 2026-08-16 — Session 106 certified rewards and exact release admission

- Fortune collection now requires a certificate-bound authoritative victory and returns an awaited durable idempotent receipt; never reintroduce caller-authored match authority or fire-and-forget persistence.
- Production promotion calls the exact canonical release-admission authority before any mutating step. Healthy staging is insufficient when a mandatory observation is red.
- Obelisk redirects and unauthenticated 401 responses are configuration smoke only; identity readiness requires a real callback/session/identity/logout journey.
- Exact candidate `6398ff2a` is healthy on stable staging at image `sha256:6c0cd340a8f9ee464b09a1326826c55b0b7d8c897e610a89898a3891985fa937`; observation `31932651393` and rollback `31932798320` pass.
- Production remains fail-closed on Zoho reply identity, authenticated Obelisk, genuine human Alpha, positive live revenue, and portable exact-artifact founder approval.

## 2026-08-23 — Session 108 release-evidence arc

- Release evidence must remain chronological and exact-artifact-bound. Provider run IDs for the current implementation are CI `32624397469`, E2E `32624397463`, deploy `32624581625`, observation `32624675990`, rollback `32624833208`, and promotion dry-run `32624982318`.
- Hidden language-modal options are precomputed during selector initialization and synchronized only on state changes; avoid rebuilding all options in the interaction handler because live INP regressed above the 200 ms bar.
- Stable staging is exact at `1a89688c` / image `sha256:720b0cad2478d894ad136185617e003bd73943ab6f1d609c117fcb11cd0a8780` and healthy after an observed rollback/restoration.
- Production remains fail-closed until Zoho reply identity, authenticated Obelisk, genuine human Alpha, positive live revenue, and portable exact-artifact founder approval are independently observed.

## 2026-08-25 — Session 109 propagation recovery and release requalification

- Studio propagation can replace project-specific release verification while leaving generic protocol content valid; preserve the incoming protocol and restore only the proven project surfaces, then ship the recurrence through Ark.
- Repair commit `03887080` passed CI `32883787037`, E2E `32883787049`, staging `32886877642`, observation `32887206185`, and promotion dry-run `32887551349`.
- Implementation-record revision `1149d78b` passed CI `32890831350`, E2E `32890831315`, Release `32890831316`, and staging `32891518865`; it is the fresh main-sourced known-good image for the final closeout rollback drill.
- Keep both performance observations: the primary nine-cell run passed, while repeat `32889128703` recorded one 232 ms INP cell. Do not weaken the 200 ms threshold; recapture the immutable closeout SHA.
- Production remains HTTP 503 / NO-GO until Zoho reply identity, authenticated Obelisk, three genuine authenticated humans, positive live revenue, and portable exact-artifact founder approval are independently observed.
