#!/usr/bin/env bash
# Install an already signed and locally verified evidence bundle atomically.
set -euo pipefail

if [[ $# -ne 6 ]]; then
    echo "Usage: $0 <staging|prod> <host-label> <subdomain> <bundle> <git-sha> <image-digest>" >&2
    exit 2
fi
ENVIRONMENT="$1"
HOST_LABEL="$2"
SUBDOMAIN="$3"
BUNDLE="$4"
GIT_SHA="$5"
IMAGE_DIGEST="$6"
[[ "$ENVIRONMENT" =~ ^(staging|prod)$ ]] || exit 2
[[ "$HOST_LABEL" =~ ^[a-z0-9-]+$ ]] || exit 2
[[ "$SUBDOMAIN" =~ ^[a-z0-9-]+$ ]] || exit 2
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
[[ -f "$BUNDLE" ]] || exit 2
: "${SSH_KEY:?SSH_KEY is required}"
: "${DOMAIN:?DOMAIN is required}"

FQDN="${SUBDOMAIN}.${DOMAIN}"
if [[ "$SUBDOMAIN" == "main" ]]; then FQDN="$DOMAIN"; fi
node scripts/runtime-release-evidence.mjs verify \
    --bundle "$BUNDLE" \
    --environment "$ENVIRONMENT" \
    --origin "https://${FQDN}" \
    --git-sha "$GIT_SHA" \
    --image-digest "$IMAGE_DIGEST"

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
DEPLOYMENT_KEY="${APP_NAME}-${ENVIRONMENT}-${SUBDOMAIN}"
REMOTE_DIR="/home/${REMOTE_USER}/.${APP_NAME}/${DEPLOYMENT_KEY}/release-evidence"
REMOTE_TEMP="/home/${REMOTE_USER}/${DEPLOYMENT_KEY}-evidence-${RANDOM}.json"

scp -i "$SSH_KEY" "$BUNDLE" "${REMOTE_USER}@${SERVER_HOST}:${REMOTE_TEMP}"
ssh -i "$SSH_KEY" "${REMOTE_USER}@${SERVER_HOST}" \
    "mkdir -p '${REMOTE_DIR}' && chmod 755 '${REMOTE_DIR}' && chmod 644 '${REMOTE_TEMP}' && mv '${REMOTE_TEMP}' '${REMOTE_DIR}/bundle.json'"
echo "Installed signed release evidence atomically for ${DEPLOYMENT_KEY}."
