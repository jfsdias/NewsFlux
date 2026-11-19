#!/usr/bin/env bash
# Test-only: builds the disposable Summary image from the deployed main SHA with the project Dockerfile.
# Optional R44_EXTRA_CA: a CA bundle for build-time pip behind an intercepting proxy (test-only change).
set -euo pipefail
repo="${1:?path to a NewsFlux checkout at the deployed SHA}"
df="$(mktemp)"; trap 'rm -f "$df" "$repo/.r44-ca.crt"' EXIT
if [ -n "${R44_EXTRA_CA:-}" ]; then
  cp "$R44_EXTRA_CA" "$repo/.r44-ca.crt"
  sed 's|^RUN pip install --no-cache-dir -r /app/requirements.lock|COPY .r44-ca.crt /tmp/r44-ca.crt\nRUN PIP_CERT=/tmp/r44-ca.crt pip install --no-cache-dir -r /app/requirements.lock|' \
    "$repo/services/article_intel_summary/Dockerfile" > "$df"
else
  cp "$repo/services/article_intel_summary/Dockerfile" "$df"
fi
if [ -n "${R44_EXTRA_CA:-}" ]; then export DOCKER_BUILDKIT=0; fi
docker build -q -f "$df" --build-arg SOURCE_COMMIT="$(git -C "$repo" rev-parse HEAD)" -t r44-summary:test "$repo"
