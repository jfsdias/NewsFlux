#!/usr/bin/env bash
# R12F-09 regression: the Summary image built from a checkout made under `umask 077` (as the
# operator script did) must start as its non-root user and serve /healthz.
# RED before the fix: PermissionError on /app/services/__init__.py, exit code 1.
#
#   bash ops/deploy/release-governance/test-r12f09-image-umask.sh [commit]
# In sandboxes whose containers reach PyPI only through a TLS-inspecting proxy, set
# NEWSFLUX_TEST_PIP_CA=/path/ca.pem: only the dependency-install line is adapted; every line that
# copies sources, sets permissions, user, healthcheck and command is the repository's own.
set -Eeuo pipefail
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
commit="${1:-$(git -C "$repo" rev-parse HEAD)}"
work="$(mktemp -d /tmp/r12f09.XXXXXX)"; tag="r12f09-regression:$RANDOM"; cid=""
cleanup() { [[ -n "$cid" ]] && docker rm -f "$cid" >/dev/null 2>&1; docker image rm -f "$tag" >/dev/null 2>&1; rm -rf "$work"; }
trap cleanup EXIT
(
  umask 077
  git init -q --bare "$work/origin.git"
  git -C "$work/origin.git" fetch -q --depth=1 "file://$repo" "$commit:refs/heads/main"
  git clone -q --no-checkout "file://$work/origin.git" "$work/src"
  git -C "$work/src" -c advice.detachedHead=false checkout -q --force "$commit"
)
[[ "$(stat -c '%a' "$work/src/services/__init__.py")" == 600 ]] || { echo "R12F09_SETUP=FAIL (checkout not restrictive)"; exit 1; }
dockerfile="$work/src/services/article_intel_summary/Dockerfile"
args=()
if [[ -n "${NEWSFLUX_TEST_PIP_CA:-}" ]]; then
  cp "$NEWSFLUX_TEST_PIP_CA" "$work/src/.pip-ca.pem"
  python3 - "$dockerfile" "$work/Dockerfile.sandbox" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r"^FROM (\S+)@sha256:\S+", r"FROM \1", src, count=1, flags=re.M)
src = src.replace("RUN pip install", "COPY .pip-ca.pem /tmp/ca.pem\nARG HTTPS_PROXY\nRUN PIP_CERT=/tmp/ca.pem pip install", 1)
open(sys.argv[2], "w").write(src)
PY
  dockerfile="$work/Dockerfile.sandbox"
  args=(--network host --build-arg "HTTPS_PROXY=${HTTPS_PROXY:-}")
fi
docker build -q "${args[@]}" -f "$dockerfile" --build-arg SOURCE_COMMIT="$commit" -t "$tag" "$work/src" >/dev/null
cid="$(docker run -d --network none -e NEWSFLUX_AI_MINIFLUX_BASE_URL=https://miniflux.invalid -e NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://newsflux.invalid "$tag")"
for _ in $(seq 1 30); do
  if docker exec "$cid" python -c "import json,urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=2))['status']=='ok'" >/dev/null 2>&1; then
    echo "R12F09_IMAGE_STARTS_FROM_UMASK_077_CHECKOUT=PASS user=$(docker inspect -f '{{.Config.User}}' "$tag")"
    exit 0
  fi
  [[ "$(docker inspect -f '{{.State.Running}}' "$cid")" == true ]] || break
  sleep 1
done
echo "R12F09_IMAGE_STARTS_FROM_UMASK_077_CHECKOUT=FAIL $(docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}}' "$cid")"
docker logs --tail 3 "$cid" 2>&1 | sed 's/^/LOG: /'
exit 1
