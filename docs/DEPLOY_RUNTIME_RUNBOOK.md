# VaultFront Runtime Deployment Runbook

This runbook covers the one-time shared-host admission and the automated path that
brings the VaultFront gameplay runtime online. The CI/CD pipeline (`deploy.yml`,
`promote.yml`) handles subsequent deployments after Studio Ops allocates an isolated
CANON-038 block, database role, deploy user, DNS record, and Caddy route.

**Target URLs:**

- Gameplay: `https://play-vaultfront.vaultsparkstudios.com`
- API: `https://api-vaultfront.vaultsparkstudios.com`
- Public page: `https://vaultsparkstudios.com/vaultfront/` (already live)

---

## Prerequisites

- A recorded VaultFront allocation in the shared-host registry
- Cloudflare account with `vaultsparkstudios.com` zone access
- GitHub org admin access to `VaultSparkStudios/VaultFront`
- GHCR write access (to push Docker images)
- A scoped VaultFront database role and deploy user issued by Studio Ops
- Local: `ssh-keygen`, `gh` CLI

---

## Step 1 — Admit VaultFront to the shared host

Do not provision a project-specific server. CANON-038 assigns VaultFront one
live-reconciled 10-port block on the existing `studio-db-us-east` shared host.
The allocation authority is `portfolio/SHARED_SERVER_PORTS.json` plus current
`ss` and Docker listener evidence. Record the assigned loopback ingress port as
the protected GitHub environment variable `DEPLOY_INGRESS_PORT` only after that
authority names VaultFront; a nominal free port is not an allocation.

---

## Step 2 — Prepare the isolated project namespace

Studio Ops owns the one-time shared-host work. It creates the unprivileged
`vaultfront` deploy user, `/opt/vaultfront`, the scoped database role/database,
and the Caddy site that proxies both VaultFront hostnames to the allocated
`127.0.0.1:<DEPLOY_INGRESS_PORT>` listener. The project never receives the
shared PostgreSQL administrator DSN.

Upload `update.sh` to `/opt/vaultfront/update.sh`, make it executable, and grant
the deploy user only the Docker and project-directory access required by the
workflow. The updater creates `${DEPLOYMENT_KEY}-private` plus a stable Nginx
router container; neither resource is shared with another project.

---

## Step 3 — Configure GitHub Secrets

In the GitHub UI: **Settings → Secrets and variables → Actions**

Add the following **Secrets**:

| Secret                        | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `DEPLOY_SERVER_HOST`          | Shared-host address recorded by the allocation          |
| `DEPLOY_SSH_KEY`              | Private SSH key for the scoped VaultFront deploy user   |
| `GHCR_TOKEN`                  | GitHub PAT with `write:packages` scope                  |
| `API_KEY`                     | Internal API key shared with api-vaultfront service     |
| `CF_ACCOUNT_ID`               | Cloudflare account ID                                   |
| `CF_API_TOKEN`                | Cloudflare API token with Tunnel + DNS write scope      |
| `TURNSTILE_SECRET_KEY`        | Cloudflare Turnstile secret for the domain              |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Your observability endpoint (or leave blank)            |
| `OTEL_AUTH_HEADER`            | Auth header for OTEL (or leave blank)                   |
| `DATABASE_URL`                | Durable PostgreSQL connection used by migration/runtime |
| `DEPLOY_KNOWN_HOSTS`          | Reviewed OpenSSH known_hosts line for the deploy host   |

Add the following **Variables**:

| Variable                    | Value                           |
| --------------------------- | ------------------------------- |
| `DOMAIN`                    | `vaultsparkstudios.com`         |
| `GHCR_REPO`                 | `vaultfront`                    |
| `GHCR_USERNAME`             | `vaultsparkstudios`             |
| `DEPLOY_REMOTE_USER`        | `vaultfront`                    |
| `DEPLOY_REMOTE_SCRIPT_PATH` | `/opt/vaultfront/update.sh`     |
| `DEPLOY_INGRESS_PORT`       | Allocated loopback ingress port |

---

## Step 4 — Verify project data isolation

Studio Ops provisions the database through the shared-host database tool and
places only the scoped `DATABASE_URL` in the protected GitHub environments.
Verify that the VaultFront role can connect and migrate its own database, cannot
enumerate or mutate sibling databases, and has no role-management privileges.
If Redis is enabled, use a project-scoped credential and key prefix; do not use
an unauthenticated shared endpoint.

---

## Step 5 — Configure DNS Records

Caddy is the sole public ingress authority. The production container starts
only Nginx and Node; it never creates a provider tunnel, rewrites DNS, or
receives Cloudflare control-plane credentials.

In Cloudflare DNS for `vaultsparkstudios.com`, point the proxied records at
the shared VPS:

| Type | Name              | Content     | Proxy   |
| ---- | ----------------- | ----------- | ------- |
| `A`  | `play-vaultfront` | Shared host | Proxied |
| `A`  | `api-vaultfront`  | Shared host | Proxied |

The remote updater binds its stable project router only to the allocated
loopback port. Caddy owns DNS-facing TLS and proxies the exact hostnames to that
listener, so public ingress has one declared owner.

---

## Step 6 — Verify the host ingress boundary

Confirm Caddy is active and its VaultFront route resolves to the allocated
loopback listener. Confirm the stable project router publishes only
`127.0.0.1:<DEPLOY_INGRESS_PORT>:80`, app candidates expose no host ports, and
both are attached only to `${DEPLOYMENT_KEY}-private`. The updater must verify
health and the expected revision through both the loopback router and public
Caddy path before draining the incumbent.

---

## Step 7 — Trigger the Deploy Workflow

The **Deploy staging** workflow is staging-only. It cannot promote production.

1. Go to GitHub Actions → **Deploy staging**.
2. Click **Run workflow**.
3. Set:
   - `target_host`: `staging`
   - `target_subdomain`: `staging`
   - `dry_run`: `true`
4. Run the workflow and require the repository contract plus dry-run to pass.
5. After the dry-run is green, rerun the same inputs with `dry_run: false`.

A non-dry staging run:

- validates `scripts/check-deploy-contract.mjs`
- builds and pushes an immutable GitHub Container Registry image
- deploys the digest to the staging host
- transactionally applies the idempotent database schema before traffic
- verifies `/_health` and `/commit.txt` against the workflow commit SHA
- uploads `staging-attestation-<run-id>` with hash-bound repository, run, origin, health, revision, and image evidence

Record the successful staging workflow run ID. The image digest is derived from
its retained attestation and is never re-entered by an operator.

### Promote the verified staging digest

1. Go to GitHub Actions → **Promote verified digest**.
2. Click **Run workflow**.
3. Set:
   - `staging_run_id`: the successful **Deploy staging** run ID from this repository
   - `operation`: `promotion`
   - `target_subdomain`: `play-vaultfront`
   - `dry_run`: `true`
4. Run the dry-run contract validation. It downloads the named staging artifact,
   verifies the GitHub run succeeded in this repository, verifies freshness and
   every bound digest, exercises the production transport without connecting, and
   retains `promotion-validation-<run-id>`.
5. Record that successful dry-run run ID as `validation_run_id`.
6. Only after all release gates and founder approval are recorded, rerun with
   identical inputs, `validation_run_id`, and `dry_run: false`. The workflow rejects
   a receipt from another repository, failed workflow, target, staging run, intent,
   or attestation digest.

Promotion pulls the already-verified image; it does not rebuild source. After
canonical health and revision verification, the workflow self-verifies and retains
`promotion-outcome-<run-id>` for 90 days. That receipt chains the deployed image and
staging attestation to the exact successful dry run and observed production bytes.

Never invoke production deployment through **Deploy staging**, and never substitute
a mutable image tag or caller-authored digest for a staging run attestation.

---

## Step 8 — Swap Pages to the Real Client

Once the gameplay backend health check passes:

1. Go to GitHub Actions → **Deploy Pages** workflow
2. Change the deploy target from `pages-stub/` to the built `static/` output
3. Update `docs/DEPLOY_PAGES.md` to reflect the live state
4. Update `context/CURRENT_STATE.md` — remove the "Pending" flags for the runtime URLs

Optionally update `pages-stub/index.html` hero text from "Under Development" to
a live link pointing to `https://play-vaultfront.vaultsparkstudios.com`.

---

## Verification Checklist

Capture a release receipt instead of relying on a green workflow badge alone.

```bash
# Canonical health endpoint
curl https://play-vaultfront.vaultsparkstudios.com/_health
# Expected: {"status":"ok"}

# Commit SHA matches the revision label embedded in the promoted image
curl https://play-vaultfront.vaultsparkstudios.com/commit.txt
# Must equal the EXPECTED_GIT_SHA resolved by promote.yml

# Staging observation bundle
# Record the staging URL, image digest, observed time, health response digest,
# parity evidence, and workflow run URL before production promotion.

# WebSocket connectivity (use wscat or browser dev tools)
wscat -c wss://play-vaultfront.vaultsparkstudios.com/lobbies

# Env config reachable
curl https://play-vaultfront.vaultsparkstudios.com/api/env
```

Before promotion, verify:

- the staging run is successful, same-repository, fresh, and its artifact digest verifies
- staging health, parity, Zoho project-domain send/receive reply-as-alias, Obelisk, theme/web, and Alpha observations are fresh
- `/commit.txt` matches the immutable image revision
- `static/release-evidence.json` remains blocked until every external gate and founder approval is recorded

---

## Rollback

Rollback is a promotion of a previously verified immutable digest, never a mutable tag.

1. Identify both the previous known-good successful staging workflow run ID (the
   rollback target) and the staging workflow run ID for the currently deployed
   revision (the revision being replaced).
2. Confirm both retained attestations describe their intended images, revisions,
   and staging origin.
3. Go to GitHub Actions → **Promote verified digest**.
4. Set:
   - `staging_run_id`: the previous known-good staging run
   - `operation`: `rollback`
   - `replaced_staging_run_id`: the currently deployed revision's staging run
   - `rollback_reason`: the incident or decision reference
   - `target_subdomain`: `play-vaultfront`
   - `dry_run`: `true`
5. Run the validation-only promotion and require its retained
   `promotion-validation-<run-id>` artifact.
6. Require digest validation and `scripts/check-deploy-contract.mjs` to pass.
7. With the rollback decision approved, rerun the exact same inputs with that run
   ID as `validation_run_id` and `dry_run: false`.
8. Verify `/_health`, `/commit.txt`, WebSocket connectivity, and the environment
   payload, then retain `promotion-outcome-<run-id>`.

A rollback must never bypass the admitted staging-run artifact or use `latest`, a
branch name, a version tag, a caller-entered digest, or a bare commit SHA.

### Rollback receipt

The workflow creates, independently verifies, and retains a hash-bound receipt
instead of relying on an operator-authored note. It records:

- candidate and restored image digests
- admitted staging run ID and attestation digest
- promotion workflow run URL
- start/end timestamps
- health and revision verification results
- rollback reason and the exact successful dry-run decision lineage

The receipt is invalid if any recorded field changes, if production reports a
revision other than the admitted target, or if the health response is not ready.

Rollback duration is measured from workflow start to verified revision, not estimated in advance.
