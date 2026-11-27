#!/usr/bin/env bash
# S5-R3: the read-only auditor increment against a REAL, disposable LiteLLM + Postgres (pinned lab
# images, synthetic master key and keys, unreachable *.invalid providers). No inference, no production.
#
# Proves with LiteLLM's real schema (1.109.1): the exact budget cause, individual RPM/TPM classes, the
# wildcard keyword, effective object-permission counts (EMPTY vs GRANTS_PRESENT), extra mechanisms,
# schema compatibility (an added column blocks KEY_POLICY_GATE_R3), the strict R3 gate, the R1 gate
# unchanged, and the opt-in private prestate (0600, redacted, bound to the key fingerprint).
#
#   bash rehearse-s5-r3-readonly-increment.sh                  # exit 0 only if every check PASSes
#   bash rehearse-s5-r3-readonly-increment.sh --ownership-test # Docker ownership guard tests
#   S5R3_FAULT=partial_create|setup_mktemp bash ...            # MUST exit non-zero
#
# Ownership: unique run ID + random nonce label; names must not pre-exist; created IDs are recorded;
# cleanup removes only resources whose owner label equals this run's nonce, by ID; a run that fails
# before creating anything issues no Docker removal.
set -Eeuo pipefail
umask 022
here="$(cd "$(dirname "$0")" && pwd)"
self="$here/$(basename "$0")"
DEFAULT_LITELLM_IMAGE="litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9"
# Another image (e.g. the exact production digest) only by @sha256 and with its expected version.
LITELLM_IMAGE="${S5R3_LITELLM_IMAGE:-$DEFAULT_LITELLM_IMAGE}"
if [[ "$LITELLM_IMAGE" == "$DEFAULT_LITELLM_IMAGE" ]]; then LITELLM_VERSION="1.109.1"; else LITELLM_VERSION="${S5R3_EXPECTED_LITELLM_VERSION:-}"; fi
if [[ ! "$LITELLM_IMAGE" =~ @sha256:[0-9a-f]{64}$ || ! "$LITELLM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "S5R3 LAB_IMAGE_PINNED=FAIL (digest-pinned image and S5R3_EXPECTED_LITELLM_VERSION required)"; exit 1
fi
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
FAULT="${S5R3_FAULT:-}"
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
run="${S5R3_RUN_ID:-s5r3-$(date -u +%Y%m%d%H%M%S)-${nonce:0:6}}"
net="$run-net"
RUN_LABEL="org.newsflux.s5r3.run"
OWNER_LABEL="org.newsflux.s5r3.owner"
owned_containers=()
owned_networks=()
pg_id=""
litellm_id=""
work=""
work_ok=0
docker_used=0
rc=0
if [[ ! "$run" =~ ^s5r3-[a-z0-9-]+$ || ! "$nonce" =~ ^[0-9a-f]{16}$ ]]; then echo "S5R3 RUN_ID=FAIL"; exit 1; fi

absent() {
  local out
  if [[ "$1" == container ]]; then out="$(docker ps -a --filter "name=^/?$2\$" --format '{{.Names}}' 2>/dev/null)" || return 2
  else out="$(docker network ls --filter "name=^$2\$" --format '{{.Name}}' 2>/dev/null)" || return 2; fi
  [[ -z "$out" ]] && return 0
  return 1
}

preflight_names() {
  local ok=0 name state
  for name in "container:$run-pg" "container:$run-litellm" "network:$net"; do
    absent "${name%%:*}" "${name#*:}" && state=0 || state=$?
    if [[ "$state" != 0 ]]; then echo "S5R3 OWNERSHIP_PREEXISTING=FAIL (${name%%:*} ${name#*:}; nothing created or removed)"; ok=1; fi
  done
  return "$ok"
}

record_owned() {
  if [[ ! "$2" =~ ^[0-9a-f]{64}$ ]]; then echo "S5R3 OWNERSHIP_RECORD=FAIL ($1)"; return 1; fi
  if [[ "$1" == container ]]; then owned_containers+=("$2"); else owned_networks+=("$2"); fi
  echo "S5R3 INFO OWNED_${1^^}=${2:0:12}"
}

owner_of() {
  if [[ "$1" == container ]]; then docker inspect --format "{{index .Config.Labels \"$OWNER_LABEL\"}}" "$2" 2>/dev/null
  else docker network inspect --format "{{index .Labels \"$OWNER_LABEL\"}}" "$2" 2>/dev/null; fi
}

run_owned() {
  local role="$1" id
  shift
  if id="$(docker run -d --name "$run-$role" --label "$RUN_LABEL=$run" --label "$OWNER_LABEL=$nonce" "$@")"; then
    record_owned container "$id"
    printf -v "${role}_id" '%s' "$id"
    return 0
  fi
  id="$(docker ps -a -q --no-trunc --filter "label=$OWNER_LABEL=$nonce" --filter "name=^/$run-$role\$")" || id=""
  if [[ -n "$id" ]]; then record_owned container "$id" || true; fi
  return 1
}

cleanup() {
  local status=0 id owner kind ids remaining
  if [[ "$docker_used" != 1 ]]; then
    echo "S5R3 INFO CLEANUP_DOCKER=NOT_NEEDED (no Docker resource was created; no removal issued)"
  elif ! docker info >/dev/null 2>&1; then
    echo "S5R3 CLEANUP_DOCKER_VERIFY=FAIL"; status=1
  else
    for kind in container network; do
      if [[ "$kind" == container ]]; then
        ids="$(docker ps -a -q --no-trunc --filter "label=$OWNER_LABEL=$nonce")" || { status=1; ids=""; }
        ids="$(printf '%s\n' $ids "${owned_containers[@]}" | sort -u)"
      else
        ids="$(docker network ls -q --no-trunc --filter "label=$OWNER_LABEL=$nonce")" || { status=1; ids=""; }
        ids="$(printf '%s\n' $ids "${owned_networks[@]}" | sort -u)"
      fi
      for id in $ids; do
        [[ -n "$id" ]] || continue
        owner="$(owner_of "$kind" "$id")" || owner=""
        if [[ "$owner" != "$nonce" ]]; then echo "S5R3 CLEANUP_OWNERSHIP=FAIL ($kind ${id:0:12} not removed)"; status=1; continue; fi
        if [[ "$kind" == container ]]; then docker rm -f -v "$id" >/dev/null 2>&1 || status=1; else docker network rm "$id" >/dev/null 2>&1 || status=1; fi
        if [[ "$kind" == container ]]; then remaining="$(docker ps -a -q --no-trunc --filter "id=$id")" || remaining="?"
        else remaining="$(docker network ls -q --no-trunc --filter "id=$id")" || remaining="?"; fi
        if [[ -z "$remaining" ]]; then echo "S5R3 CLEANUP_${kind^^}_ABSENT=PASS (${id:0:12})"; else echo "S5R3 CLEANUP_${kind^^}_ABSENT=FAIL (${id:0:12})"; status=1; fi
      done
    done
    remaining="$( { docker ps -a -q --filter "label=$OWNER_LABEL=$nonce"; docker network ls -q --filter "label=$OWNER_LABEL=$nonce"; } 2>/dev/null | wc -l)" || remaining=1
    if [[ "$remaining" == 0 ]]; then echo "S5R3 CLEANUP_OWNED_REMAINING=PASS (0)"; else echo "S5R3 CLEANUP_OWNED_REMAINING=FAIL ($remaining)"; status=1; fi
  fi
  if [[ "$work_ok" == 1 ]]; then rm -rf -- "$work" || status=1; [[ -e "$work" ]] && status=1; fi
  if [[ "$status" == 0 ]]; then echo "S5R3 CLEANUP=PASS"; else echo "S5R3 CLEANUP=FAIL"; fi
  return "$status"
}

finish() {
  local code=$?
  trap - EXIT ERR
  set +e
  [[ "$code" != 0 ]] && rc=1
  cleanup || rc=1
  echo "S5R3_EXIT=$rc"
  exit "$rc"
}

ownership_test() {
  local sandbox failed=0 out code decoy decoy_net bystander
  docker info >/dev/null 2>&1 || { echo "S5R3 OWNERSHIP_TEST=FAIL (docker unavailable)"; return 1; }
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/s5r3-owntest.XXXXXXXX")"
  decoy="$(docker create --name s5r3-owntest-a-pg "$PG_IMAGE")"
  decoy_net="$(docker network create s5r3-owntest-a-net)"
  out="$(TMPDIR="$sandbox" S5R3_RUN_ID=s5r3-owntest-a S5R3_FAULT=setup_mktemp bash "$self" 2>&1)" && code=0 || code=$?
  if [[ "$code" != 0 ]] && grep -q CLEANUP_DOCKER=NOT_NEEDED <<<"$out" && [[ -n "$(docker ps -a -q --filter "id=$decoy")" && -n "$(docker network ls -q --filter "id=$decoy_net")" ]]; then
    echo "S5R3 OWN_EARLY_FAILURE_NEVER_REMOVES_DECOYS=PASS"; else echo "S5R3 OWN_EARLY_FAILURE_NEVER_REMOVES_DECOYS=FAIL"; printf '%s\n' "$out"; failed=1; fi
  out="$(TMPDIR="$sandbox" S5R3_RUN_ID=s5r3-owntest-a bash "$self" 2>&1)" && code=0 || code=$?
  if [[ "$code" != 0 ]] && grep -q OWNERSHIP_PREEXISTING=FAIL <<<"$out" && ! grep -q OWNED_ <<<"$out" && [[ -n "$(docker ps -a -q --filter "id=$decoy")" ]]; then
    echo "S5R3 OWN_COLLISION_REFUSED=PASS"; else echo "S5R3 OWN_COLLISION_REFUSED=FAIL"; printf '%s\n' "$out"; failed=1; fi
  bystander="$(docker create --name s5r3-owntest-b-bystander --label "$RUN_LABEL=s5r3-owntest-b" --label "$OWNER_LABEL=00000000deadbeef" "$PG_IMAGE")"
  out="$(TMPDIR="$sandbox" S5R3_RUN_ID=s5r3-owntest-b S5R3_FAULT=partial_create bash "$self" 2>&1)" && code=0 || code=$?
  if [[ "$code" != 0 ]] && grep -q 'OWNED_CONTAINER=' <<<"$out" && grep -q 'S5R3 CLEANUP=PASS' <<<"$out" && [[ -n "$(docker ps -a -q --filter "id=$bystander")" ]] \
     && [[ "$( { docker ps -a -q --filter "label=$RUN_LABEL=s5r3-owntest-b"; docker network ls -q --filter "label=$RUN_LABEL=s5r3-owntest-b"; } | wc -l)" == 1 ]]; then
    echo "S5R3 OWN_PARTIAL_CREATION_OWNED_ONLY=PASS"; else echo "S5R3 OWN_PARTIAL_CREATION_OWNED_ONLY=FAIL"; printf '%s\n' "$out"; failed=1; fi
  docker rm -f -v "$decoy" "$bystander" >/dev/null 2>&1 || failed=1
  docker network rm "$decoy_net" >/dev/null 2>&1 || failed=1
  rm -rf -- "$sandbox"
  if [[ "$failed" == 0 ]]; then echo "S5R3_OWNERSHIP_TEST=PASS"; else echo "S5R3_OWNERSHIP_TEST=FAIL"; fi
  return "$failed"
}

if [[ "${1:-}" == "--ownership-test" ]]; then ownership_test; exit $?; fi

trap 'echo "S5R3 SETUP_STEP=FAIL (line $LINENO)"' ERR
trap finish EXIT

tmp_base="${TMPDIR:-/tmp}"
if [[ "$FAULT" == setup_mktemp ]]; then tmp_base="$tmp_base/does-not-exist"; fi
work="$(mktemp -d "$tmp_base/s5r3.XXXXXXXX")"
if [[ -z "$work" || ! -d "$work" || -L "$work" || "$work" != "$tmp_base"/s5r3.* ]]; then echo "S5R3 SETUP_STEP=FAIL (workspace)"; exit 1; fi
work_ok=1
cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: hosted_vllm/synthetic-s5, api_base: "https://s5.invalid/v1", api_key: synthetic}
  - model_name: other-model
    litellm_params: {model: openai/synthetic-other, api_base: "https://other.invalid/v1", api_key: synthetic}
YAML
chmod 0644 "$work/config.yaml"
MASTER="sk-synthetic-master-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

preflight_names
docker_used=1
net_id="$(docker network create --label "$RUN_LABEL=$run" --label "$OWNER_LABEL=$nonce" "$net")"
record_owned network "$net_id"
run_owned pg --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE"
ready=0
for _ in $(seq 1 30); do if docker exec "$pg_id" pg_isready -q -U postgres >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done
[[ "$ready" == 1 ]] || { echo "S5R3 SETUP_STEP=FAIL (postgres)"; exit 1; }
if [[ "$FAULT" == partial_create ]]; then echo "S5R3 SETUP_STEP=FAIL (injected partial creation)"; exit 1; fi
run_owned litellm --network "$net" -e LITELLM_MASTER_KEY="$MASTER" -e LITELLM_LOCAL_MODEL_COST_MAP=True \
  -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" -v "$work/config.yaml:/app/config.yaml:ro" \
  "$LITELLM_IMAGE" --config /app/config.yaml --port 4000
ready=0
for _ in $(seq 1 120); do
  if docker exec "$litellm_id" python3 -B -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]] || { echo "S5R3 SETUP_STEP=FAIL (litellm)"; exit 1; }

# Host driver: stdlib only; imports the auditor under test from this checkout.
cat >"$work/driver.py" <<'PY'
import hashlib, json, os, re, stat, subprocess, sys
here, litellm_id, pg_id, master, version, work = sys.argv[1:7]
sys.path.insert(0, here)
import s5_db_readonly_audit as audit

ALIAS = "newsflux-s5-free"
CAPS = {"rpm": 5, "tpm": 20000, "budget": 1.0}
RESULTS = []
OUTPUTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))


API = r'''
import json, sys, urllib.request, urllib.error
req = json.loads(sys.stdin.read())
r = urllib.request.Request("http://127.0.0.1:4000" + req["path"], method="POST", data=json.dumps(req["body"]).encode(),
                           headers={"Authorization": "Bearer " + req["master"], "Content-Type": "application/json"})
try:
    with urllib.request.urlopen(r, timeout=30) as resp:
        print(json.dumps({"status": resp.status, "body": json.load(resp)}))
except urllib.error.HTTPError as e:
    print(json.dumps({"status": e.code, "body": None}))
'''


def api(path, body):
    out = subprocess.run(["docker", "exec", "-i", litellm_id, "python3", "-B", "-c", API], input=json.dumps(
        {"path": path, "body": body, "master": master}), capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout or '{"status": null, "body": null}')


def key(name, body):
    response = api("/key/generate", dict({"allowed_routes": ["llm_api_routes"], "key_alias": f"synthetic-{name}"}, **body))
    check(f"GENERATE_{name.upper()}", response["status"] == 200, f"status {response['status']}")
    return (response["body"] or {}).get("key", "")


def probe(virtual_key, prestate=False):
    payload = {"fingerprint": audit.fingerprint_token_hash(hashlib.sha256(virtual_key.encode()).hexdigest()), "alias": ALIAS,
               "caps": CAPS, "allowed_callbacks": [], "private_prestate": prestate}
    with open(os.path.join(here, "s5_db_readonly_audit.py"), encoding="utf-8") as handle:
        source = handle.read()
    out = subprocess.run(["docker", "exec", "-i", litellm_id, "python3", "-B", "-c", audit.PROBE_BOOTSTRAP],
                         input=json.dumps(payload) + "\n" + source, capture_output=True, text=True, timeout=120)
    lines = out.stdout.strip().splitlines()
    facts = json.loads(lines[-1]) if lines else {}
    OUTPUTS.append(json.dumps(facts))
    extra = [json.loads(line) for line in lines[:-1] if line.startswith("{")]
    return facts, extra


api("/budget/new", {"budget_id": "bud-r3-synthetic", "max_budget": 0.5, "budget_duration": "30d"})
keys = {
    "nobudget": key("nobudget", {"models": ["all-proxy-models"]}),
    "above": key("above", {"models": [ALIAS], "rpm_limit": 6, "tpm_limit": 20000, "max_budget": 2.0, "budget_duration": "30d"}),
    "clean": key("clean", {"models": [ALIAS], "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 0.5, "budget_duration": "30d"}),
    "budgetrow": key("budgetrow", {"models": [ALIAS], "rpm_limit": 5, "tpm_limit": 20000, "budget_id": "bud-r3-synthetic"}),
    "permempty": key("permempty", {"models": [ALIAS], "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 0.5,
                                   "budget_duration": "30d", "object_permission": {"vector_stores": []}}),
    "permgrants": key("permgrants", {"models": [ALIAS], "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 0.5, "budget_duration": "30d",
                                     "object_permission": {"vector_stores": ["vs-a", "vs-b"], "mcp_servers": ["mcp-a"]}}),
    "agent": key("agent", {"models": [ALIAS], "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 0.5, "budget_duration": "30d",
                           "agent_id": "agent-synthetic"}),
}

f, _ = probe(keys["nobudget"])
check("NOBUDGET_CAUSE_EXACT", f.get("KEY_BUDGET") == "FAIL" and f.get("KEY_BUDGET_CAUSE") == "BUDGET_DURATION_MISSING,MAX_BUDGET_MISSING", f.get("KEY_BUDGET_CAUSE"))
check("NOBUDGET_RPM_TPM_MISSING", (f.get("KEY_RPM"), f.get("KEY_TPM")) == ("MISSING", "MISSING"))
check("NOBUDGET_SCOPE_TOKEN", f.get("KEY_SCOPE_TOKEN") == "ALL_PROXY_MODELS" and f.get("KEY_SCOPE_DETAIL") == "WILDCARD")
check("READ_ONLY_TRANSACTION", f.get("DB_READ_ONLY") == "VERIFIED")
f, _ = probe(keys["above"])
check("ABOVE_CAPS_EXACT", (f.get("KEY_MAX_BUDGET"), f.get("KEY_RPM"), f.get("KEY_TPM"), f.get("KEY_BUDGET_CAUSE")) ==
      ("ABOVE_APP_CAP", "ABOVE_APP_CAP", "OK", "MAX_BUDGET_ABOVE_APP_CAP"), json.dumps({k: f.get(k) for k in ("KEY_MAX_BUDGET", "KEY_RPM", "KEY_BUDGET_CAUSE")}))
f, _ = probe(keys["clean"])
check("CLEAN_SCHEMA_LAB_EXACT", (f.get("KEY_SCHEMA_COMPAT"), f.get("KEY_SCHEMA_COLUMNS")) == ("LAB_EXACT", "48"), f.get("KEY_SCHEMA_COMPAT"))
# Literal expectations per exact lab image, independent of the auditor's own allowlist (S5-R3 admission).
EXPECTED_VERSION_CLASS = {"1.109.1": "LAB_REHEARSED", "1.110.0": "LAB_REHEARSED"}
rehearsed = EXPECTED_VERSION_CLASS.get(version) == "LAB_REHEARSED"
check("CLEAN_VERSION_CLASS", (f.get("LITELLM_VERSION"), f.get("LITELLM_VERSION_CLASS")) ==
      (version.replace(".", "_"), "LAB_REHEARSED" if rehearsed else "NOT_REHEARSED"), f.get("LITELLM_VERSION_CLASS"))
check("CLEAN_EXTRA_NONE", (f.get("KEY_EXTRA_INDIRECTION"), f.get("KEY_EXTRA_LIMITS"), f.get("KEY_AGENT_ID")) == ("NONE", "NONE", "NONE"),
      json.dumps({k: f.get(k) for k in ("KEY_EXTRA_INDIRECTION", "KEY_EXTRA_LIMITS", "KEY_TYPE")}))
# A version not yet in LAB_REHEARSED_VERSIONS must keep R3 at NOT_VERIFIED for that reason alone.
expected_r3 = ("PASS", "NONE") if rehearsed else ("NOT_VERIFIED", "VERSION_NOT_REHEARSED")
check("CLEAN_R1_PASS_AND_R3_AS_EXPECTED", (f.get("KEY_POLICY_GATE"), f.get("KEY_POLICY_GATE_R3"), f.get("KEY_POLICY_GATE_R3_REASONS"),
      f.get("KEY_BUDGET_CAUSE")) == ("PASS", *expected_r3, "NONE"),
      json.dumps({k: f.get(k) for k in ("KEY_POLICY_GATE", "KEY_POLICY_GATE_R3", "KEY_POLICY_GATE_R3_REASONS")}))
f, _ = probe(keys["budgetrow"])
check("BUDGET_TABLE_SOURCE", (f.get("KEY_LIMIT_SOURCE"), f.get("KEY_MAX_BUDGET"), f.get("KEY_BUDGET_DURATION"), f.get("KEY_BUDGET_CAUSE")) ==
      ("BUDGET_TABLE", "OK", "CALENDAR_MONTH", "NONE"), json.dumps({k: f.get(k) for k in ("KEY_LIMIT_SOURCE", "KEY_BUDGET_CAUSE")}))
f, _ = probe(keys["permempty"])
check("OBJPERM_EMPTY_STILL_NOT_VERIFIED", (f.get("OBJPERM_ROW"), f.get("OBJPERM_EFFECTIVE"), f.get("KEY_POLICY_GATE"), f.get("KEY_POLICY_GATE_R3")) ==
      ("PRESENT", "EMPTY", "NOT_VERIFIED", "NOT_VERIFIED"), json.dumps({k: f.get(k) for k in ("OBJPERM_ROW", "OBJPERM_EFFECTIVE", "OBJPERM_UNKNOWN_COLUMNS")}))
f, extra = probe(keys["permgrants"], prestate=True)
# Ground truth read directly from the disposable lab DB (LiteLLM may drop a grant it cannot resolve,
# e.g. an unknown MCP server name): the auditor must report what is stored, not what was requested.
truth = subprocess.run(["docker", "exec", pg_id, "psql", "-At", "-U", "postgres", "-d", "litellm", "-c",
                        'SELECT coalesce(array_length(p."vector_stores", 1), 0) || \',\' || coalesce(array_length(p."mcp_servers", 1), 0) '
                        'FROM "LiteLLM_VerificationToken" t JOIN "LiteLLM_ObjectPermissionTable" p USING ("object_permission_id") '
                        "WHERE t.\"token\" = '" + hashlib.sha256(keys["permgrants"].encode()).hexdigest() + "'"],
                       capture_output=True, text=True, timeout=60).stdout.strip()
check("OBJPERM_GRANTS_COUNTED_AS_STORED", f.get("OBJPERM_EFFECTIVE") == "GRANTS_PRESENT" and truth.startswith("2,")
      and f"{f.get('OBJPERM_VECTOR_STORES_COUNT')},{f.get('OBJPERM_MCP_SERVERS_COUNT')}" == truth,
      f"stored vector_stores,mcp_servers={truth}")
f2, _ = probe(keys["agent"])
check("AGENT_ID_IS_EXTRA_INDIRECTION", (f2.get("KEY_AGENT_ID"), f2.get("KEY_EXTRA_INDIRECTION"), f2.get("KEY_POLICY_GATE"), f2.get("KEY_POLICY_GATE_R3")) ==
      ("PRESENT", "AGENT", "PASS", "NOT_VERIFIED"), json.dumps({k: f2.get(k) for k in ("KEY_AGENT_ID", "KEY_EXTRA_INDIRECTION", "KEY_POLICY_GATE_R3")}))

# Private prestate: written by the host functions into a 0700 directory of the disposable workspace.
documents = [d["PRIVATE_PRESTATE"] for d in extra if isinstance(d, dict) and "PRIVATE_PRESTATE" in d]
check("PRESTATE_EMITTED_ONLY_WHEN_REQUESTED", len(documents) == 1)
private = os.path.join(work, "private")
os.mkdir(private, 0o700)
path = os.path.join(private, "prestate.json")
problem = audit.validate_prestate_path(path, euid=os.geteuid())
digest = audit.write_private_prestate(path, documents[0]) if documents and problem is None else ""
with open(path, "rb") as handle:
    raw = handle.read()
stored = json.loads(raw)
fingerprint = audit.fingerprint_token_hash(hashlib.sha256(keys["permgrants"].encode()).hexdigest())
check("PRESTATE_FILE_0600", stat.S_IMODE(os.stat(path).st_mode) == 0o600 and hashlib.sha256(raw).hexdigest() == digest)
check("PRESTATE_BOUND_TO_KEY", stored["binding"]["fingerprint"] == fingerprint and stored["binding"]["litellm_version"] == version)
check("PRESTATE_POLICY_VALUES", stored["key"]["models"] == [ALIAS] and stored["key"]["rpm_limit"] == 5
      and stored["object_permission"]["vector_stores"] == ["vs-a", "vs-b"])
text = raw.decode()
check("PRESTATE_REDACTED", all(s not in text for s in (keys["permgrants"], hashlib.sha256(keys["permgrants"].encode()).hexdigest(), master))
      and "token" not in stored["key"] and "key_name" not in stored["key"])
try:
    audit.write_private_prestate(path, documents[0])
    check("PRESTATE_NEVER_OVERWRITES", False)
except audit.ProbeError:
    check("PRESTATE_NEVER_OVERWRITES", True)

# JWT auth in the disposable lab config: enable_jwt_auth blocks the R3 gate (R1 unchanged); then restore.
def psql(sql):
    return subprocess.run(["docker", "exec", pg_id, "psql", "-At", "-U", "postgres", "-d", "litellm", "-c", sql],
                          check=True, capture_output=True, text=True, timeout=60).stdout.strip()


prior = psql("SELECT count(*) FROM \"LiteLLM_Config\" WHERE \"param_name\" = 'general_settings'")
if prior == "0":
    psql("INSERT INTO \"LiteLLM_Config\" (\"param_name\", \"param_value\") VALUES ('general_settings', '{\"enable_jwt_auth\": true}')")
else:
    saved = psql("SELECT \"param_value\"::text FROM \"LiteLLM_Config\" WHERE \"param_name\" = 'general_settings'")
    psql("UPDATE \"LiteLLM_Config\" SET \"param_value\" = \"param_value\" || '{\"enable_jwt_auth\": true}' WHERE \"param_name\" = 'general_settings'")
f, _ = probe(keys["clean"])
check("JWT_ENABLED_BLOCKS_R3", (f.get("JWT_AUTH"), f.get("KEY_POLICY_GATE"), f.get("KEY_POLICY_GATE_R3")) == ("ENABLED", "PASS", "NOT_VERIFIED")
      and "JWT_AUTH_NOT_DISABLED" in f.get("KEY_POLICY_GATE_R3_REASONS", ""), f.get("KEY_POLICY_GATE_R3_REASONS"))
if prior == "0":
    psql("DELETE FROM \"LiteLLM_Config\" WHERE \"param_name\" = 'general_settings'")
else:
    psql("UPDATE \"LiteLLM_Config\" SET \"param_value\" = '" + saved.replace("'", "''") + "'::jsonb WHERE \"param_name\" = 'general_settings'")
f, _ = probe(keys["clean"])
check("JWT_RESTORED_R3_AS_BEFORE", (f.get("JWT_AUTH"), f.get("KEY_POLICY_GATE_R3")) == ("DISABLED", "PASS" if rehearsed else "NOT_VERIFIED"))

# Schema drift in the disposable lab DB: an unknown key column blocks the R3 gate (R1 unchanged).
subprocess.run(["docker", "exec", pg_id, "psql", "-q", "-U", "postgres", "-d", "litellm", "-c",
                'ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN "s5r3_unknown_mechanism" text'], check=True, capture_output=True)
f, _ = probe(keys["clean"])
check("SCHEMA_DRIFT_BLOCKS_R3", (f.get("KEY_SCHEMA_COMPAT"), f.get("KEY_SCHEMA_UNKNOWN_COLUMNS"), f.get("KEY_POLICY_GATE"), f.get("KEY_POLICY_GATE_R3")) ==
      ("UNKNOWN_COLUMNS", "1", "PASS", "NOT_VERIFIED") and "SCHEMA_NOT_LAB_EXACT" in f.get("KEY_POLICY_GATE_R3_REASONS", ""))

# Every probe output is render-safe and contains no key, hash, fingerprint, alias, URL or DSN.
secrets = [master, ALIAS, "s5.invalid", "postgresql://", "synthetic-"] + [k for k in keys.values()]
secrets += [hashlib.sha256(k.encode()).hexdigest() for k in keys.values()]
secrets += [audit.fingerprint_token_hash(hashlib.sha256(k.encode()).hexdigest()) for k in keys.values()]
joined = "\n".join(OUTPUTS)
check("OUTPUT_HAS_NO_SECRET", all(s and s not in joined for s in secrets))
safe = True
for line in OUTPUTS:
    try:
        audit.render(json.loads(line), container_identity="UNCHANGED")
    except audit.ProbeError:
        safe = False
check("OUTPUT_RENDER_SAFE", safe)

failed = 0
for name, ok, detail in RESULTS:
    failed += 0 if ok else 1
    print(f"S5R3 {name}={'PASS' if ok else 'FAIL'}" + (f" ({detail})" if detail else ""))
print(f"S5R3_CHECKS={len(RESULTS)} S5R3_FAILED={failed}")
sys.exit(1 if failed or not RESULTS else 0)
PY
version="$(docker exec "$litellm_id" python3 -B -c 'import importlib.metadata as m; print(m.version("litellm"))')"
if [[ "$version" != "$LITELLM_VERSION" ]]; then echo "S5R3 LAB_LITELLM_VERSION=FAIL"; exit 1; fi
echo "S5R3 LAB_LITELLM_VERSION=PASS ($version)"
python3 -B -I "$work/driver.py" "$here" "$litellm_id" "$pg_id" "$MASTER" "$version" "$work" || rc=1
