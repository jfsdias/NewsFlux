#!/usr/bin/env bash
# S5-R3A: the auditor's strict binding and effective-flag gates against REAL containers in a disposable lab:
# a Summary image built from this checkout, the pinned LiteLLM + Postgres, synthetic keys, an --internal network
# (no egress, no inference). The real receipt is validated with the OMV wrapper's own embedded contract.
#
#   bash rehearse-s5-r3a-strict-binding.sh      # exit 0 only if every check PASSes and cleanup is proven
#   S5R3_LITELLM_IMAGE=<repo>@sha256:<d> S5R3_EXPECTED_LITELLM_VERSION=<x.y.z> bash ...   (exact-image replay)
#   NEWSFLUX_TEST_PIP_CA=<ca.pem> for TLS-inspecting sandboxes (same pattern as rehearse-s5-db-audit.sh)
#
# Ownership: unique run ID + random nonce label on every container, network and image; names checked first;
# cleanup removes only resources carrying this run's nonce, by ID; a run that creates nothing removes nothing.
set -Eeuo pipefail
umask 022
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
DEFAULT_LITELLM_IMAGE="litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9"
LITELLM_IMAGE="${S5R3_LITELLM_IMAGE:-$DEFAULT_LITELLM_IMAGE}"
if [[ "$LITELLM_IMAGE" == "$DEFAULT_LITELLM_IMAGE" ]]; then LITELLM_VERSION="1.109.1"; else LITELLM_VERSION="${S5R3_EXPECTED_LITELLM_VERSION:-}"; fi
[[ "$LITELLM_IMAGE" =~ @sha256:[0-9a-f]{64}$ && "$LITELLM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "S5R3A LAB_IMAGE_PINNED=FAIL"; exit 1; }
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
run="s5r3a-$(date -u +%Y%m%d%H%M%S)-${nonce:0:6}"
net="$run-net"
OWNER="org.newsflux.s5r3a.owner"
docker_used=0
work=""
rc=0
pass=0
fail=0
[[ "$nonce" =~ ^[0-9a-f]{16}$ ]] || { echo "S5R3A NONCE=FAIL"; exit 1; }
ok() { echo "S5R3A $1=PASS${2:+ ($2)}"; pass=$((pass + 1)); }
ko() { echo "S5R3A $1=FAIL${2:+ ($2)}"; fail=$((fail + 1)); }

cleanup() {
  local status=0 id ids
  if [[ "$docker_used" == 1 ]]; then
    ids="$(docker ps -a -q --no-trunc --filter "label=$OWNER=$nonce")" || status=1
    for id in $ids; do docker rm -f -v "$id" >/dev/null 2>&1 || status=1; done
    ids="$(docker network ls -q --no-trunc --filter "label=$OWNER=$nonce")" || status=1
    for id in $ids; do docker network rm "$id" >/dev/null 2>&1 || status=1; done
    ids="$(docker image ls -q --no-trunc --filter "label=$OWNER=$nonce")" || status=1
    for id in $ids; do docker image rm -f "$id" >/dev/null 2>&1 || status=1; done
    [[ "$( { docker ps -a -q --filter "label=$OWNER=$nonce"; docker network ls -q --filter "label=$OWNER=$nonce";
             docker image ls -q --filter "label=$OWNER=$nonce"; } | wc -l)" == 0 ]] || status=1
  fi
  if [[ -n "$work" && -d "$work" && "$work" == "${TMPDIR:-/tmp}"/s5r3a.* ]]; then rm -rf -- "$work" || status=1; fi
  if [[ "$status" == 0 ]]; then echo "S5R3A CLEANUP=PASS"; else echo "S5R3A CLEANUP=FAIL"; fi
  return "$status"
}
finish() { local code=$?; trap - EXIT ERR; set +e; [[ "$code" != 0 ]] && rc=1; cleanup || rc=1; echo "S5R3A_EXIT=$rc"; exit "$rc"; }
trap 'echo "S5R3A SETUP_STEP=FAIL (line $LINENO)"' ERR
trap finish EXIT

work="$(mktemp -d "${TMPDIR:-/tmp}/s5r3a.XXXXXXXX")"
cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: hosted_vllm/synthetic-s5, api_base: "https://s5.invalid/v1", api_key: synthetic}
YAML
chmod 0644 "$work/config.yaml"
MASTER="sk-synthetic-master-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# Names must be provably free: a Docker query that fails is never read as "absent".
docker info >/dev/null 2>&1 || { echo "S5R3A DOCKER_UNAVAILABLE=FAIL"; exit 1; }
for name in "$run-pg" "$run-litellm" "$run-summary"; do
  found="$(docker ps -a -q --filter "name=^/$name\$")" || { echo "S5R3A OWNERSHIP_CHECK=FAIL"; exit 1; }
  [[ -z "$found" ]] || { echo "S5R3A OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
done
found="$(docker network ls -q --filter "name=^$net\$")" || { echo "S5R3A OWNERSHIP_CHECK=FAIL"; exit 1; }
[[ -z "$found" ]] || { echo "S5R3A OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
docker_used=1

# Summary image from this checkout (owned by label).
build_args=(-f "$repo/services/article_intel_summary/Dockerfile")
context="$repo"
if [[ -n "${NEWSFLUX_TEST_PIP_CA:-}" ]]; then
  context="$work/ctx"
  mkdir -p "$context"
  cp -R "$repo/services" "$context/services"
  cp "$NEWSFLUX_TEST_PIP_CA" "$context/.pip-ca.pem"
  python3 - "$repo/services/article_intel_summary/Dockerfile" "$context/Dockerfile.sandbox" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r"^FROM (\S+)@sha256:\S+", r"FROM \1", s, count=1, flags=re.M)
s = s.replace("RUN pip install", "COPY .pip-ca.pem /tmp/ca.pem\nARG HTTPS_PROXY\nRUN PIP_CERT=/tmp/ca.pem pip install", 1)
open(sys.argv[2], "w").write(s)
PY
  build_args=(-f "$context/Dockerfile.sandbox" --network host --build-arg "HTTPS_PROXY=${HTTPS_PROXY:-}")
fi
summary_image="$(docker build -q --label "$OWNER=$nonce" "${build_args[@]}" "$context")"

docker network create --internal --label "$OWNER=$nonce" "$net" >/dev/null
pg_id="$(docker run -d --name "$run-pg" --label "$OWNER=$nonce" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE")"
for _ in $(seq 1 30); do docker exec "$pg_id" pg_isready -q -U postgres >/dev/null 2>&1 && break; sleep 1; done
ll_id="$(docker run -d --name "$run-litellm" --label "$OWNER=$nonce" --network "$net" -e LITELLM_MASTER_KEY="$MASTER" \
  -e LITELLM_LOCAL_MODEL_COST_MAP=True -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" \
  -v "$work/config.yaml:/app/config.yaml:ro" "$LITELLM_IMAGE" --config /app/config.yaml --port 4000)"
ready=0
for _ in $(seq 1 150); do
  if docker exec "$ll_id" python3 -B -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]] || { echo "S5R3A SETUP_STEP=FAIL (litellm)"; exit 1; }
[[ "$(docker exec "$ll_id" python3 -B -I -c 'import importlib.metadata as m; print(m.version("litellm"))')" == "$LITELLM_VERSION" ]] \
  || { echo "S5R3A LAB_LITELLM_VERSION=FAIL"; exit 1; }
key="$(docker exec -i "$ll_id" python3 -B -I - "$MASTER" <<'PY'
import json, sys, urllib.request
req = urllib.request.Request("http://127.0.0.1:4000/key/generate", method="POST", data=json.dumps({
    "models": ["newsflux-s5-free"], "allowed_routes": ["llm_api_routes"], "rpm_limit": 5, "tpm_limit": 20000,
    "max_budget": 0.5, "budget_duration": "30d"}).encode(), headers={"Authorization": "Bearer " + sys.argv[1], "Content-Type": "application/json"})
print(json.load(urllib.request.urlopen(req, timeout=30))["key"])
PY
)"
[[ "$key" == sk-* ]] || { echo "S5R3A SETUP_STEP=FAIL (key)"; exit 1; }
secrets="$work/secrets"
mkdir -p "$secrets"
printf '%s\n' "$key" >"$secrets/key"
chmod 0755 "$secrets"
chmod 0400 "$secrets/key"
chown -R 10001:10001 "$secrets"

summary_id=""
start_summary() { # $@ extra docker run args (flag environment)
  if [[ -n "$summary_id" ]]; then docker rm -f -v "$summary_id" >/dev/null; fi
  summary_id="$(docker run -d --name "$run-summary" --label "$OWNER=$nonce" --label "com.docker.compose.project=$run-proj" \
    --label com.docker.compose.service=summary-api --network "$net" --read-only --cap-drop ALL --tmpfs /tmp \
    -v "$secrets:/run/secrets/litellm:ro" -e NEWSFLUX_AI_LITELLM_BASE_URL=https://litellm.invalid \
    -e NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE=/run/secrets/litellm/key -e NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS=newsflux-s5-free \
    -e NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS=mistral-small -e NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION=0 \
    -e NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION=0 -e NEWSFLUX_AI_MONTHLY_BUDGET_USD=1.00 \
    -e NEWSFLUX_AI_MAX_INPUT_TOKENS=4096 -e NEWSFLUX_AI_MAX_OUTPUT_TOKENS=512 -e NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE=5 \
    -e NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE=20000 -e NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS=15 \
    -e NEWSFLUX_AI_USAGE_DATABASE_PATH=/tmp/usage.sqlite3 "$@" \
    --entrypoint python "$summary_image" -c "import time; time.sleep(900)")"
}
ident() { docker inspect --format "$(python3 -I -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import s5_db_readonly_audit as a; print(a.IDENTITY_FORMAT)' "$here")" "$1"; }
litellm_image_id="$(docker inspect --format '{{.Image}}' "$ll_id")"
auditor() { # $1 expected summary snapshot, $2 expected litellm snapshot, $3 expected summary image, [$4 extra env]
  env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ${4:-} python3 -B -I "$here/s5_db_readonly_audit.py" \
    --litellm-container "$ll_id" --summary-container "$summary_id" --project "$run-proj" --summary-service summary-api \
    --expect-summary-image "$3" --expect-litellm-image "$litellm_image_id" \
    --expect-summary-snapshot "$1" --expect-litellm-snapshot "$2" 2>/dev/null
}
validate() { # $1 receipt, $2 exit code -> prints the contract verdict
  python3 -I -B - "$here/s5-r3-omv-readonly-run.sh" "$2" "${LITELLM_VERSION//./_}" "$1" <<'PY'
import sys
text = open(sys.argv[1]).read()
block = text.split("# ---BEGIN RECEIPT CONTRACT---", 1)[1].split("# ---END RECEIPT CONTRACT---", 1)[0]
ns = {"__name__": "contract"}
exec(compile(block.split("<<'PY'\n", 1)[1].rsplit("\nPY\n", 1)[0], "receipt_contract", "exec"), ns)
print(ns["validate"](sys.argv[4] + "\n", int(sys.argv[2]), sys.argv[3])[0])
PY
}

# 1. Exact binding, flags explicit false: complete, contract-valid receipt.
start_summary -e NEWSFLUX_AI_INFERENCE_ENABLED=false -e NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=false
s_snap="$(ident "$summary_id")"; l_snap="$(ident "$ll_id")"; s_img="$(docker inspect --format '{{.Image}}' "$summary_id")"
out="$(auditor "$s_snap" "$l_snap" "$s_img")" && code=0 || code=$?
verdict="$(validate "$out" "$code")"
if [[ "$code" == 0 && "$verdict" == OK ]] && grep -qx "S5R1_SUMMARY_BINDING=EXACT_ID_IMAGE_LABELS_LIFECYCLE" <<<"$out" \
   && grep -qx "S5R1_INFERENCE_EFFECTIVE=OFF_EXPLICIT" <<<"$out" && grep -qx "S5R1_FLAGS_RUNTIME_PARSER=CONFIRMED_OFF" <<<"$out" \
   && grep -qx "S5R1_KEY_POLICY_GATE=PASS" <<<"$out"; then ok STRICT_COMPLETE_CONTRACT_VALID
else ko STRICT_COMPLETE_CONTRACT_VALID "exit $code, contract $verdict"; fi
leak=0
for secret in "$key" "$MASTER" postgresql:// newsflux-s5-free litellm.invalid "$(printf '%s' "$key" | sha256sum | cut -c1-64)"; do
  grep -qF -- "$secret" <<<"$out" && leak=1
done
[[ "$leak" == 0 ]] && ok OUTPUT_HAS_NO_SECRET || ko OUTPUT_HAS_NO_SECRET

# 2. Divergent environment, wrong image, restart after the gate snapshot: hold before any exec.
expect_hold() { # $1 check name, $2 expected line, $3 receipt, $4 exit code
  if [[ "$4" == 2 && "$3" == "$2" ]]; then ok "$1"; else ko "$1" "exit $4"; fi
}
out="$(auditor "$s_snap" "$l_snap" "$s_img" "NEWSFLUX_PROJECT=other")" && code=0 || code=$?
expect_hold ENV_DIVERGENT_HOLDS "S5R1_AUDIT=HOLD_ENV_DIVERGENT" "$out" "$code"
out="$(auditor "$s_snap" "$l_snap" "sha256:$(printf '1%.0s' $(seq 64))")" && code=0 || code=$?
expect_hold WRONG_SUMMARY_IMAGE_HOLDS "S5R1_AUDIT=HOLD_IDENTITY_MISMATCH_SUMMARY" "$out" "$code"
docker restart -t 1 "$summary_id" >/dev/null
out="$(auditor "$s_snap" "$l_snap" "$s_img")" && code=0 || code=$?
expect_hold RESTART_AFTER_GATE_HOLDS "S5R1_AUDIT=HOLD_IDENTITY_MISMATCH_SUMMARY" "$out" "$code"
docker restart -t 1 "$ll_id" >/dev/null
for _ in $(seq 1 150); do
  docker exec "$ll_id" python3 -B -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1 && break; sleep 2
done
out="$(auditor "$(ident "$summary_id")" "$l_snap" "$s_img")" && code=0 || code=$?
expect_hold LITELLM_RESTART_HOLDS "S5R1_AUDIT=HOLD_IDENTITY_MISMATCH_LITELLM" "$out" "$code"
l_snap="$(ident "$ll_id")"

# 3. Effective flags on real containers (the real runtime parser runs inside the Summary).
flag_case() { # $1 name, $2 expected first line or COMPLETE, $3.. docker -e args
  local name="$1" expected="$2"; shift 2
  start_summary "$@"
  local snapshot; snapshot="$(ident "$summary_id")"
  local result; result="$(auditor "$snapshot" "$l_snap" "$s_img")" && code=0 || code=$?
  if [[ "$expected" == COMPLETE* ]]; then
    if [[ "$code" == 0 && "$(validate "$result" "$code")" == OK ]] && grep -qx "S5R1_${expected#COMPLETE:}" <<<"$result"; then ok "$name"; else ko "$name" "exit $code"; fi
  else
    expect_hold "$name" "S5R1_AUDIT=HOLD_$expected" "$result" "$code"
  fi
}
flag_case FLAG_ONE_IS_AMBIGUOUS AI_FLAGS_AMBIGUOUS -e NEWSFLUX_AI_INFERENCE_ENABLED=1
flag_case FLAG_YES_IS_AMBIGUOUS AI_FLAGS_AMBIGUOUS -e NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=yes
flag_case FLAG_SPACED_TRUE_IS_ON AI_FLAGS_NOT_OFF -e "NEWSFLUX_AI_INFERENCE_ENABLED= TRUE "
flag_case FLAG_EMPTY_IS_AMBIGUOUS AI_FLAGS_AMBIGUOUS -e NEWSFLUX_AI_INFERENCE_ENABLED=
flag_case FLAG_ABSENT_IS_DEFAULT_OFF "COMPLETE:INFERENCE_EFFECTIVE=OFF_DEFAULT_RUNTIME"
flag_case FLAG_CASED_FALSE_IS_OFF "COMPLETE:INFERENCE_EFFECTIVE=OFF_EXPLICIT" -e "NEWSFLUX_AI_INFERENCE_ENABLED= FALSE " \
  -e NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=false
start_summary -e NEWSFLUX_AI_INFERENCE_ENABLED=false -e NEWSFLUX_AI_INFERENCE_ENABLED=false
dupes="$(docker inspect --format '{{json .Config.Env}}' "$summary_id" | python3 -I -c 'import json,sys; print(sum(1 for e in json.load(sys.stdin) if e.startswith("NEWSFLUX_AI_INFERENCE_ENABLED=")))')"
result="$(auditor "$(ident "$summary_id")" "$l_snap" "$s_img")" && code=0 || code=$?
if [[ "$dupes" -gt 1 ]]; then expect_hold FLAG_DUPLICATE_HOLDS "S5R1_AUDIT=HOLD_AI_FLAGS_DUPLICATE" "$result" "$code"
else echo "S5R3A INFO DOCKER_DEDUPLICATES_REPEATED_ENV=YES (duplicate case covered by unit tests)"; fi

echo "S5R3A_PASSED=$pass S5R3A_FAILED=$fail"
[[ "$fail" == 0 ]] || rc=1
