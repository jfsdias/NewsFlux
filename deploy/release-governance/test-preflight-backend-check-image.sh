#!/usr/bin/env bash
# R4.1: the read-only preflight's backend origin check, run EXACTLY as on the host:
#   docker exec <summary> python -I -c BACKEND_ORIGIN_CHECK
# against the real Summary image built from this commit (its own Dockerfile, user 10001, WORKDIR /app).
# RED control: the R4 check string (805e6d1, no fixed code root) must fail to import under -I.
# Synthetic, disposable, no network access from the container, never a real host.
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
sha="$(git -C "$repo" rev-parse HEAD)"
R4_REF="${R4_PREFLIGHT_REF:-805e6d14d77c1602850ebe26be0b37d4830e6a2e}"
image="newsflux-summary-preflight-check:${sha:0:12}"
pass=0
fail=0
ok() { echo "PREFLIGHT_IMAGE_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "PREFLIGHT_IMAGE_GATE $1=FAIL"; fail=$((fail + 1)); }
cid=""
cleanup() {
  [[ -n "$cid" ]] && docker rm -f "$cid" >/dev/null 2>&1 || true
  docker image rm -f "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

extract() { # file -> BACKEND_ORIGIN_CHECK string literal value
  python3 -I - "$1" <<'PY'
import ast, re, sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r"^BACKEND_ORIGIN_CHECK = (\(.*?\n\))", text, flags=re.M | re.S)
sys.stdout.write(ast.literal_eval(match.group(1)))
PY
}
current_check="$(extract "$here/ai-settings-readonly-preflight.sh")"
r4_file="$(mktemp)"
git -C "$repo" show "$R4_REF:deploy/release-governance/ai-settings-readonly-preflight.sh" >"$r4_file"
r4_check="$(extract "$r4_file")"
rm -f "$r4_file"

docker build -q -f "$repo/services/article_intel_summary/Dockerfile" --build-arg SOURCE_COMMIT="$sha" -t "$image" "$repo" >/dev/null
[[ "$(docker image inspect -f '{{.Config.User}} {{.Config.WorkingDir}}' "$image")" == "10001:10001 /app" ]] \
  && ok IMAGE_USER_10001_WORKDIR_APP || ko IMAGE_USER_10001_WORKDIR_APP

start() { # origins -> running container id (healthy)
  local id i
  id="$(docker run -d --network none \
    -e NEWSFLUX_AI_MINIFLUX_BASE_URL=https://miniflux.invalid \
    -e "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=$1" "$image")"
  for i in $(seq 1 40); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" == healthy ]] && break
    sleep 1
  done
  printf '%s\n' "$id"
}

cid="$(start https://news.rehearsal.test)"
[[ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" == healthy ]] && ok SUMMARY_HEALTHY || ko SUMMARY_HEALTHY

# RED control: the R4 check cannot import the backend under -I in the real image.
r4_out="$(docker exec "$cid" python -I -c "$r4_check" 2>&1)" && r4_rc=0 || r4_rc=$?
if [[ "$r4_rc" -ne 0 ]] && grep -q "No module named 'services'" <<<"$r4_out"; then
  ok R4_CHECK_FAILS_UNDER_ISOLATED_MODE_RED
else
  echo "r4 rc=$r4_rc"; ko R4_CHECK_FAILS_UNDER_ISOLATED_MODE_RED
fi

# GREEN: the current check, exactly as the preflight runs it.
got="$(docker exec "$cid" python -I -c "$current_check")"
[[ "$got" == VALID ]] && ok CHECK_VALID_SINGLE_HTTPS || { echo "got=$got"; ko CHECK_VALID_SINGLE_HTTPS; }
# Isolation preserved: an attacker-style PYTHONPATH/user site in the exec env is ignored.
got="$(docker exec -e PYTHONPATH=/tmp/evil -e PYTHONUSERBASE=/tmp/evil "$cid" python -I -c "$current_check")"
[[ "$got" == VALID ]] && ok CHECK_IGNORES_PYTHONPATH || ko CHECK_IGNORES_PYTHONPATH
# The check reads the container's own env; a mixed list is rejected by the backend validator.
got="$(docker exec -e NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://a.example,http://b.example "$cid" python -I -c "$current_check")"
[[ "$got" == INVALID ]] && ok CHECK_INVALID_MIXED_HTTP || { echo "got=$got"; ko CHECK_INVALID_MIXED_HTTP; }
got="$(docker exec -e "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://a.example,," "$cid" python -I -c "$current_check")"
[[ "$got" == INVALID ]] && ok CHECK_INVALID_EMPTY_ENTRY || { echo "got=$got"; ko CHECK_INVALID_EMPTY_ENTRY; }
got="$(docker exec -e NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://u:p@a.example "$cid" python -I -c "$current_check")"
[[ "$got" == INVALID ]] && ok CHECK_INVALID_CREDENTIALS || { echo "got=$got"; ko CHECK_INVALID_CREDENTIALS; }
out_all="$(docker exec "$cid" python -I -c "$current_check" 2>&1)"
grep -q "rehearsal.test" <<<"$out_all" && ko CHECK_NEVER_PRINTS_ORIGIN || ok CHECK_NEVER_PRINTS_ORIGIN
[[ "$(docker exec "$cid" id -u)" == 10001 ]] && ok EXEC_RUNS_AS_UID_10001 || ko EXEC_RUNS_AS_UID_10001

# R4.1 hardening: the FULL read-only preflight end to end against this exact image, and an unsafe
# (group/other-writable, transitively imported) code root must be UNSAFE_IMPORT_PATH, never VALID.
if (cd "$here" && RELEASE_DOCKER_TESTS=1 NEWSFLUX_SUMMARY_TEST_IMAGE="$image" python3 -m unittest -v test_preflight_origin_image); then
  ok FULL_PREFLIGHT_AND_CODE_ROOT_SAFETY
else
  ko FULL_PREFLIGHT_AND_CODE_ROOT_SAFETY
fi

echo "PREFLIGHT_IMAGE_PASSED=$pass PREFLIGHT_IMAGE_FAILED=$fail"
[[ "$fail" -eq 0 ]]
