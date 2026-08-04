# VaultFront Runtime Deployment Runbook

This runbook covers the 8 manual steps required to bring the VaultFront gameplay
runtime online. The CI/CD pipeline (`deploy.yml`, `promote.yml`) handles all
subsequent deployments automatically — this runbook only needs to be executed once
per environment.

**Target URLs:**

- Gameplay: `https://play-vaultfront.vaultsparkstudios.com`
- API: `https://api-vaultfront.vaultsparkstudios.com`
- Public page: `https://vaultsparkstudios.com/vaultfront/` (already live)

---

## Prerequisites

- Hetzner account with billing enabled
- Cloudflare account with `vaultsparkstudios.com` zone access
- GitHub org admin access to `VaultSparkStudios/VaultFront`
- GHCR write access (to push Docker images)
- Local: `ssh-keygen`, `hcloud` CLI, `gh` CLI

---

## Step 1 — Provision the VPS

**Spec:** 4 vCPU / 8 GB RAM / 80 GB disk — Hetzner CX32 or equivalent.

```bash
# Using hcloud CLI (Hetzner)
hcloud server create \
  --name vaultfront-runtime \
  --type cx32 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key your-key-name
```

Note the server's public IPv4 address — needed in Steps 3 and 4.

**Manual Hetzner UI path:**
Servers → Create Server → Ubuntu 24.04 → CX32 → Nuremberg → Add SSH key → Create

---

## Step 2 — Prepare the VPS

SSH in and run:

```bash
ssh root@<VPS_IP>

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Install Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Install Postgres + Redis
apt install -y postgresql redis-server
systemctl enable --now postgresql redis-server

# Create app user and deploy directory
useradd -m -s /bin/bash vaultfront
mkdir -p /opt/vaultfront
chown vaultfront:vaultfront /opt/vaultfront

# Allow vaultfront user to run docker
usermod -aG docker vaultfront
```

Upload the deploy scripts:

```bash
# From your local machine
scp update.sh root@ < VPS_IP > :/opt/vaultfront/update.sh
ssh root@ < VPS_IP > "chmod +x /opt/vaultfront/update.sh"
```

---

## Step 3 — Configure GitHub Secrets

In the GitHub UI: **Settings → Secrets and variables → Actions**

Add the following **Secrets**:

| Secret                        | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `DEPLOY_SERVER_HOST`          | VPS public IPv4 from Step 1                             |
| `DEPLOY_SSH_KEY`              | Private SSH key content for the VPS deploy user         |
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

| Variable                    | Value                          |
| --------------------------- | ------------------------------ |
| `DOMAIN`                    | `vaultsparkstudios.com`        |
| `GHCR_REPO`                 | `vaultsparkstudios/vaultfront` |
| `GHCR_USERNAME`             | Your GHCR org username         |
| `DEPLOY_REMOTE_USER`        | `vaultfront`                   |
| `DEPLOY_REMOTE_SCRIPT_PATH` | `/opt/vaultfront/update.sh`    |

---

## Step 4 — Configure Postgres and Redis

```bash
ssh vaultfront@<VPS_IP>

# Postgres: create vaultfront DB and user
sudo -u postgres psql <<EOF
CREATE USER vaultfront WITH PASSWORD 'changeme';
CREATE DATABASE vaultfront OWNER vaultfront;
GRANT ALL PRIVILEGES ON DATABASE vaultfront TO vaultfront;
EOF

# Test connection
psql -U vaultfront -d vaultfront -c "SELECT 1;"

# Redis: verify it's running
redis-cli ping  # should return PONG
```

Update `/opt/vaultfront/.env` with:

```env
DATABASE_URL=postgres://vaultfront:changeme@localhost:5432/vaultfront
REDIS_URL=redis://localhost:6379
```

---

## Step 5 — Configure DNS Records

Traefik is the sole runtime ingress authority. The production container starts
only Nginx and Node; it never creates a provider tunnel, rewrites DNS, or
receives Cloudflare control-plane credentials.

In Cloudflare DNS for `vaultsparkstudios.com`, point the proxied records at
the shared VPS:

| Type | Name              | Content    | Proxy   |
| ---- | ----------------- | ---------- | ------- |
| `A`  | `play-vaultfront` | `<VPS_IP>` | Proxied |
| `A`  | `api-vaultfront`  | `<VPS_IP>` | Proxied |

The remote updater joins the existing `web` network and supplies the exact
Traefik Host rule and internal port label. DNS, TLS termination, and routing
therefore have one declared owner.

---

## Step 6 — Verify the host ingress boundary

A host-level private transport may feed Traefik, but it is provisioned outside
the application image and must not create per-container DNS or tunnel state.
Confirm `update.sh` is the only application-owned routing path and that the
container exposes port 80 only to the shared `web` network.

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
