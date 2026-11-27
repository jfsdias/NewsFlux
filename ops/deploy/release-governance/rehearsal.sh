#!/usr/bin/env bash
# Synthetic CI-only exercise; this is not a deploy or rollback tool.
set -Eeuo pipefail
project="newsflux-release-ci-${GITHUB_RUN_ID:-$$}-${RANDOM}"
here="$(cd "$(dirname "$0")" && pwd)"
previous_tag="${project}-previous:synthetic"
candidate_tag="${project}-candidate:synthetic"
compose=(docker compose -p "$project" -f "$here/compose.rehearsal.json")
cleanup() {
  status=$?
  trap - EXIT
  "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || status=1
  docker image rm "$previous_tag" "$candidate_tag" >/dev/null 2>&1 || status=1
  exit "$status"
}
trap cleanup EXIT
[[ "$project" == newsflux-release-ci-* ]] || exit 1
for revision in previous candidate; do
  docker build -q -f "$here/Dockerfile.rehearsal" --build-arg "REHEARSAL_REVISION=$revision" --build-arg "REHEARSAL_RUN=$project" -t "${project}-${revision}:synthetic" "$here" >/dev/null
done
previous=$(docker image inspect --format '{{.Id}}' "$previous_tag")
candidate=$(docker image inspect --format '{{.Id}}' "$candidate_tag")
[[ "$previous" == sha256:* && "$candidate" == sha256:* && "$previous" != "$candidate" ]]
export REHEARSAL_READER_IMAGE="$previous" REHEARSAL_SUMMARY_IMAGE="$previous"
"${compose[@]}" up -d --no-build
reader=$("${compose[@]}" ps -q reader)
summary=$("${compose[@]}" ps -q summary-api)
[[ -n "$reader" && -n "$summary" ]]
[[ "$(docker inspect --format '{{.Image}}|{{len .HostConfig.PortBindings}}' "$summary")" == "$previous|0" ]]
[[ "$(docker network inspect --format '{{.Internal}}' "${project}_private")" == true ]]
current_image() { docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q summary-api)"; }
guarded_transition() {
  local expected=$1 target=$2 expected_reader=$3 current
  [[ "$("${compose[@]}" ps -q reader)" == "$expected_reader" ]] || return 1
  current=$(current_image)
  [[ "$current" == "$expected" || "$current" == "$target" ]] || return 1
  if [[ "$current" != "$target" ]]; then
    export REHEARSAL_SUMMARY_IMAGE="$target"
    "${compose[@]}" up -d --no-deps --no-build summary-api >/dev/null
  fi
  [[ "$(current_image)" == "$target" && "$("${compose[@]}" ps -q reader)" == "$expected_reader" ]]
}
# All actions are scoped to an isolated synthetic project; reject a stale guard.
if guarded_transition sha256:stale "$candidate" "$reader"; then exit 1; fi
[[ "$(current_image)" == "$previous" ]]
guarded_transition "$previous" "$candidate" "$reader"
if guarded_transition "$candidate" "$previous" stale-reader; then exit 1; fi
[[ "$(current_image)" == "$candidate" ]]
guarded_transition "$candidate" "$previous" "$reader"
restored=$("${compose[@]}" ps -q summary-api)
guarded_transition "$candidate" "$previous" "$reader"
[[ "$("${compose[@]}" ps -q summary-api)" == "$restored" ]]
printf 'SYNTHETIC_DOCKER_PROMOTION_ROLLBACK=PASS\n'
