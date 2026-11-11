#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin"
cat >"$tmp_dir/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_TEST_LOG"

if [[ "${1:-}" == "build" ]]; then
  exit 0
fi

if [[ "${1:-}" == "run" ]]; then
  shift
  image=""
  while (($#)); do
    if [[ "$1" == "--entrypoint" ]]; then
      shift 2
      continue
    fi
    if [[ "$1" == -* ]]; then
      shift
      continue
    fi
    image="$1"
    break
  done
  if [[ "$image" == *"missing-auth-fixture"* ]]; then
    if [[ "${DOCKER_TEST_FIXTURE_WRONG_ERROR:-false}" == "true" ]]; then
      printf '%s\n' 'RuntimeError: unrelated failure' >&2
      exit 1
    fi
    printf '%s\n' "ModuleNotFoundError: No module named 'services.article_intel_auth'" >&2
    exit 1
  fi
  if [[ "$image" == *"baseline-"* && "${DOCKER_TEST_BASE_IMPORT_FAIL:-false}" == "true" ]]; then
    printf '%s\n' 'RuntimeError: unrelated baseline import failure' >&2
    exit 1
  fi
  exit 0
fi

printf 'unexpected fake Docker command: %s\n' "$*" >&2
exit 97
DOCKER
chmod +x "$tmp_dir/bin/docker"

fixture="$tmp_dir/missing-auth.Dockerfile"
cat >"$fixture" <<'DOCKERFILE'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN rm -rf /app/services/article_intel_auth
DOCKERFILE

export DOCKER_TEST_LOG="$tmp_dir/docker.log"
export PATH="$tmp_dir/bin:$PATH"
export CONTENT_FALLBACK_MISSING_DEPENDENCY_DOCKERFILE="$fixture"

source_sha="$(git -C "$repo_root" rev-parse HEAD)"
if ! output="$(bash "$repo_root/scripts/content-fallback-image-gate.sh" baseline "$source_sha" 2>&1)"; then
  printf '%s\n' 'BASELINE_GATE_TEST=FAIL' "$output" >&2
  exit 1
fi

for expected in \
  'DOCKER_BUILD_BASELINE=PASS' \
  'BASELINE_IMAGE_IMPORT=PASS' \
  'MISSING_DEPENDENCY_FIXTURE_BUILD=PASS' \
  'MISSING_DEPENDENCY_FIXTURE_IMPORT_RED=PASS'; do
  if ! grep -Fq "$expected" <<<"$output"; then
    printf 'BASELINE_GATE_TEST=FAIL missing output: %s\n' "$expected" >&2
    exit 1
  fi
done

if ! grep -Fq -- "--build-arg BASE_IMAGE=newsflux-content-fallback:baseline-${source_sha:0:12}" "$DOCKER_TEST_LOG"; then
  printf '%s\n' 'BASELINE_GATE_TEST=FAIL fixture was not based on the exact baseline image' >&2
  exit 1
fi
if ! grep -Fq -- "$fixture" "$DOCKER_TEST_LOG"; then
  printf '%s\n' 'BASELINE_GATE_TEST=FAIL isolated missing-dependency fixture was not built' >&2
  exit 1
fi

: >"$DOCKER_TEST_LOG"
if bash "$repo_root/scripts/content-fallback-image-gate.sh" baseline "${source_sha}bad" >/dev/null 2>&1; then
  printf '%s\n' 'BASELINE_GATE_TEST=FAIL source SHA mismatch was accepted' >&2
  exit 1
fi
if [[ -s "$DOCKER_TEST_LOG" ]]; then
  printf '%s\n' 'BASELINE_GATE_TEST=FAIL Docker ran before the exact SHA check' >&2
  exit 1
fi

if DOCKER_TEST_BASE_IMPORT_FAIL=true \
  bash "$repo_root/scripts/content-fallback-image-gate.sh" baseline "$source_sha" >/dev/null 2>&1; then
  printf '%s\n' 'BASELINE_GATE_TEST=FAIL baseline import failure was accepted' >&2
  exit 1
fi

if DOCKER_TEST_FIXTURE_WRONG_ERROR=true \
  bash "$repo_root/scripts/content-fallback-image-gate.sh" baseline "$source_sha" >/dev/null 2>&1; then
  printf '%s\n' 'BASELINE_GATE_TEST=FAIL unrelated fixture error was accepted' >&2
  exit 1
fi

printf '%s\n' 'BASELINE_GATE_TEST=PASS'
