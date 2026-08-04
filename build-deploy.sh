#!/usr/bin/env bash
# Canonical build -> immutable-digest deploy entrypoint. Production uses promote.yml.
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "Usage: $0 staging <host_label> <subdomain>" >&2
    exit 2
fi

ENVIRONMENT="$1"
HOST_LABEL="$2"
SUBDOMAIN="$3"
if [[ "$ENVIRONMENT" != "staging" ]]; then
    echo "build-deploy.sh only builds staging; promote the verified digest to production" >&2
    exit 2
fi

VERSION_TAG="sha-$(git rev-parse --short=12 HEAD)"
METADATA_FILE="$(mktemp)"
trap 'rm -f "$METADATA_FILE"' EXIT

./build.sh "$ENVIRONMENT" "$VERSION_TAG" "" "" "$METADATA_FILE"
IMAGE_DIGEST="$(jq -r '."containerimage.digest" // empty' "$METADATA_FILE")"
if [[ ! "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Build did not produce a valid immutable image digest" >&2
    exit 1
fi

./deploy.sh "$ENVIRONMENT" "$HOST_LABEL" "$IMAGE_DIGEST" "$SUBDOMAIN"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'image_digest=%s\n' "$IMAGE_DIGEST" >> "$GITHUB_OUTPUT"
fi
