#!/usr/bin/env bash
# Canonical immutable deployment transport. Set DEPLOY_DRY_RUN=1 for validation only.
set -euo pipefail

if [[ $# -ne 4 ]]; then
    echo "Usage: $0 <staging|prod> <host_label> <sha256:digest> <subdomain>" >&2
    exit 2
fi

ENVIRONMENT="$1"
HOST_LABEL="$2"
IMAGE_DIGEST="$3"
SUBDOMAIN="$4"

[[ "$ENVIRONMENT" =~ ^(staging|prod)$ ]] || {
    echo "Invalid environment" >&2
    exit 2
}
[[ "$HOST_LABEL" =~ ^[a-z0-9-]+$ ]] || {
    echo "Invalid host label" >&2
    exit 2
}
[[ "$SUBDOMAIN" =~ ^[a-z0-9-]+$ ]] || {
    echo "Invalid subdomain" >&2
    exit 2
}
[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "Deployment requires an immutable sha256 digest" >&2
    exit 2
}

: "${GHCR_USERNAME:?GHCR_USERNAME is required}"
: "${GHCR_REPO:?GHCR_REPO is required}"
: "${DEPLOY_HEALTH_URL:?DEPLOY_HEALTH_URL is required}"
: "${DEPLOY_INGRESS_PORT:?DEPLOY_INGRESS_PORT is required from the CANON-038 allocation}"
[[ "$DEPLOY_HEALTH_URL" =~ ^https://[^[:space:]]+$ ]] || {
    echo "DEPLOY_HEALTH_URL must be an https URL" >&2
    exit 2
}
[[ "$DEPLOY_INGRESS_PORT" =~ ^[0-9]+$ ]] \
    && ((DEPLOY_INGRESS_PORT >= 8110 && DEPLOY_INGRESS_PORT <= 8999)) || {
    echo "DEPLOY_INGRESS_PORT must be an allocated CANON-038 port in 8110-8999" >&2
    exit 2
}

if [[ "$ENVIRONMENT" == "prod" ]]; then
    : "${DEPLOY_STAGING_ATTESTATION:?Production requires the verified staging digest}"
    [[ "$DEPLOY_STAGING_ATTESTATION" == "$IMAGE_DIGEST" ]] || {
        echo "Production digest does not match staging attestation" >&2
        exit 2
    }
fi

IMAGE_RETENTION_COUNT="${DEPLOY_IMAGE_RETENTION:-5}"
[[ "$IMAGE_RETENTION_COUNT" =~ ^[0-9]+$ ]] \
    && ((IMAGE_RETENTION_COUNT >= 2 && IMAGE_RETENTION_COUNT <= 20)) || {
    echo "DEPLOY_IMAGE_RETENTION must be between 2 and 20" >&2
    exit 2
}

GHCR_IMAGE="ghcr.io/${GHCR_USERNAME}/${GHCR_REPO}@${IMAGE_DIGEST}"
if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'deploy-contract ok environment=%s host=%s subdomain=%s image=%s health=%s ingress=127.0.0.1:%s retention=%s\n' \
        "$ENVIRONMENT" "$HOST_LABEL" "$SUBDOMAIN" "$GHCR_IMAGE" "$DEPLOY_HEALTH_URL" "$DEPLOY_INGRESS_PORT" "$IMAGE_RETENTION_COUNT"
    exit 0
fi

: "${SSH_KEY:?SSH_KEY is required}"
: "${DATABASE_URL:?DATABASE_URL is required for staging and production}"
: "${OBELISK_ISSUER:?OBELISK_ISSUER is required for staging and production}"
: "${OBELISK_CLIENT_ID:?OBELISK_CLIENT_ID is required for staging and production}"
: "${OBELISK_REDIRECT_URI:?OBELISK_REDIRECT_URI is required for staging and production}"
: "${OBELISK_COOKIE_SECRET:?OBELISK_COOKIE_SECRET is required for staging and production}"
SERVER_HOST="${DEPLOY_SERVER_HOST:-}"
if [[ -z "$SERVER_HOST" ]]; then
    case "$HOST_LABEL" in
        staging) SERVER_HOST="${SERVER_HOST_STAGING:-}" ;;
        nbg1) SERVER_HOST="${SERVER_HOST_NBG1:-}" ;;
        masters) SERVER_HOST="${SERVER_HOST_MASTERS:-}" ;;
        falk2) SERVER_HOST="${SERVER_HOST_FALK2:-}" ;;
        *) SERVER_HOST="${SERVER_HOST_FALK1:-}" ;;
    esac
fi
[[ -n "$SERVER_HOST" ]] || {
    echo "No server configured for $HOST_LABEL" >&2
    exit 2
}

REMOTE_USER="${DEPLOY_REMOTE_USER:-vaultfront}"
APP_NAME="${APP_NAME:-vaultfront}"
REMOTE_DIR="/home/${REMOTE_USER}"
REMOTE_SCRIPT="${DEPLOY_REMOTE_SCRIPT_PATH:-${REMOTE_DIR}/update-${APP_NAME}.sh}"
REMOTE_ENV="${REMOTE_DIR}/${APP_NAME}-${SUBDOMAIN}-${RANDOM}.env"
LOCAL_ENV="$(mktemp)"
trap 'rm -f "$LOCAL_ENV"' EXIT

write_env() { printf '%s=%q\n' "$1" "$2" >> "$LOCAL_ENV"; }
write_env GAME_ENV "$ENVIRONMENT"
write_env ENV "$ENVIRONMENT"
write_env HOST "$HOST_LABEL"
write_env GHCR_IMAGE "$GHCR_IMAGE"
write_env GHCR_USERNAME "$GHCR_USERNAME"
write_env GHCR_REPO "$GHCR_REPO"
write_env APP_NAME "$APP_NAME"
write_env DEPLOY_ALWAYS_RESTART "${DEPLOY_ALWAYS_RESTART:-}"
write_env DEPLOY_HEALTH_URL "$DEPLOY_HEALTH_URL"
write_env DEPLOY_INGRESS_PORT "$DEPLOY_INGRESS_PORT"
write_env DEPLOY_IMAGE_RETENTION "$IMAGE_RETENTION_COUNT"
write_env DEPLOY_DRAIN_TIMEOUT_SECONDS "${DEPLOY_DRAIN_TIMEOUT_SECONDS:-900}"
write_env GHCR_TOKEN "${GHCR_TOKEN:-}"
write_env CF_ACCOUNT_ID "${CF_ACCOUNT_ID:-}"
write_env CF_API_TOKEN "${CF_API_TOKEN:-}"
write_env TURNSTILE_SECRET_KEY "${TURNSTILE_SECRET_KEY:-}"
write_env API_KEY "${API_KEY:-}"
write_env DOMAIN "${DOMAIN:-}"
write_env SUBDOMAIN "$SUBDOMAIN"
write_env OTEL_EXPORTER_OTLP_ENDPOINT "${OTEL_EXPORTER_OTLP_ENDPOINT:-}"
write_env OTEL_AUTH_HEADER "${OTEL_AUTH_HEADER:-}"
write_env DATABASE_URL "$DATABASE_URL"
write_env DATABASE_DOCKER_CONTAINER "${DATABASE_DOCKER_CONTAINER:-supabase-db}"
write_env OBELISK_ISSUER "$OBELISK_ISSUER"
write_env OBELISK_CLIENT_ID "$OBELISK_CLIENT_ID"
write_env OBELISK_REDIRECT_URI "$OBELISK_REDIRECT_URI"
write_env OBELISK_COOKIE_SECRET "$OBELISK_COOKIE_SECRET"

scp -i "$SSH_KEY" ./update.sh "$LOCAL_ENV" \
    "${REMOTE_USER}@${SERVER_HOST}:${REMOTE_DIR}/"
ssh -i "$SSH_KEY" "${REMOTE_USER}@${SERVER_HOST}" \
    "mv '${REMOTE_DIR}/update.sh' '$REMOTE_SCRIPT' && mv '${REMOTE_DIR}/$(basename "$LOCAL_ENV")' '$REMOTE_ENV' && chmod 700 '$REMOTE_SCRIPT' && chmod 600 '$REMOTE_ENV' && '$REMOTE_SCRIPT' '$REMOTE_ENV'"

echo "Deployment command completed; live evidence remains the workflow health/commit verification."
