#!/usr/bin/env bash
# D1-R7-02: end-to-end rehearsal of the legacy -> D1 release transition in a DISPOSABLE lab.
#
#   DARK BASELINE -> CAPTURE -> D1 PREFLIGHT (target config) -> SYNTHETIC ACTIVATION -> MODEL CATALOG
#   -> SYNTHETIC CANARY -> ROLLBACK -> DARK BASELINE
#
# Real pieces: the Summary image built from this commit, the production LiteLLM image pin
# (litellm-database 1.110.0, config 95017a67…) with Postgres, the authorized auditor (57c536f, sha256 pinned)
# driven by d1_capture.py, release.py and ai-functional-release.sh with the production project/service naming.
# Synthetic pieces: master key, virtual key, Miniflux stand-ins, and the only "provider": a local mock that
# answers OpenAI-format completions on an --internal network (no egress, no real inference, no article).
#
#   sudo bash deploy/release-governance/rehearse-d1-transition.sh      # never on a real host (refuses)
#   NEWSFLUX_TEST_PIP_CA=/path/ca.pem: TLS-inspecting sandboxes only (dependency install line adapted)
set -Eeuo pipefail
umask 022
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
SHA="$(git -C "$repo" rev-parse HEAD)"
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=no -- deploy/release-governance services)" ]] \
  || { echo "D1E2E REFUSED=COMMIT_RELEASE_AND_SERVICE_FILES_FIRST"; exit 1; }
[[ "$(id -u)" == 0 ]] || { echo "D1E2E REFUSED=ROOT_REQUIRED (the capture is a root operation)"; exit 1; }
for name in newsflux miniflux miniflux-db; do
  if docker inspect "$name" >/dev/null 2>&1 || [[ -n "$(docker ps -aq --filter label=com.docker.compose.project=newsflux)" ]]; then
    echo "D1E2E REFUSED=PRODUCTION_NAMES_PRESENT (never run on a real host)"; exit 1
  fi
done
LITELLM_IMAGE="ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a"
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
CADDY_IMAGE="caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d"
BUSYBOX_IMAGE="busybox:1.36.1"
AUDITOR_HEAD=57c536fb583a52bb42a88d9a1b051869abc64b1f
AUDITOR_SHA256=6e5bef4ed383e43b16264ce4a94bd82ad5f4b0523b1bbf2b57e7576490f14d11
run="nfd1-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
gw="$run-gw"
work="$(mktemp -d /var/tmp/nfd1-e2e.XXXXXX)"
chmod 0755 "$work"
capture_dir=""
pass=0; fail=0
ok() { echo "D1E2E $1=PASS${2:+ ($2)}"; pass=$((pass + 1)); }
ko() { echo "D1E2E $1=FAIL${2:+ ($2)}"; fail=$((fail + 1)); }
stack() { docker compose -p newsflux --project-directory "$work/stack" -f "$work/stack/compose.json" -f "$work/stack/layer2.json" "$@"; }
cleanup() {
  stack down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$run-pg" "$run-litellm" "$run-tls" "$run-mock" >/dev/null 2>&1 || true
  docker network rm "$gw" >/dev/null 2>&1 || true
  docker image rm -f "newsflux-summary:$SHA" >/dev/null 2>&1 || true
  [[ -n "$capture_dir" && "$capture_dir" == /root/newsflux-d1.* ]] && rm -rf -- "$capture_dir"
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'echo "D1E2E SETUP_STEP=FAIL (line $LINENO)"' ERR

# ---- source the operator script clones, and the authorized auditor --------------------------------------
git init -q --bare "$work/origin.git"
git -C "$work/origin.git" fetch -q --depth=1 "file://$repo" "HEAD:refs/heads/main"
git -C "$repo" cat-file -e "$AUDITOR_HEAD^{commit}" 2>/dev/null || git -C "$repo" fetch -q --depth=1 origin "$AUDITOR_HEAD"
git -C "$repo" show "$AUDITOR_HEAD:deploy/release-governance/s5_db_readonly_audit.py" >"$work/auditor.py"
[[ "$(sha256sum "$work/auditor.py" | cut -d' ' -f1)" == "$AUDITOR_SHA256" ]] && ok AUDITOR_PINNED || { ko AUDITOR_PINNED; exit 1; }

# ---- Summary image from this commit (exact revision label) ---------------------------------------------
build_args=(-f "$repo/services/article_intel_summary/Dockerfile" --build-arg "SOURCE_COMMIT=$SHA")
context="$repo"
if [[ -n "${NEWSFLUX_TEST_PIP_CA:-}" ]]; then
  context="$work/ctx"; mkdir -p "$context"
  cp -R "$repo/services" "$context/services"; cp "$NEWSFLUX_TEST_PIP_CA" "$context/.pip-ca.pem"
  python3 - "$repo/services/article_intel_summary/Dockerfile" "$context/Dockerfile.sandbox" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r"^FROM (\S+)@sha256:\S+", r"FROM \1", s, count=1, flags=re.M)
s = s.replace("RUN pip install", "COPY .pip-ca.pem /tmp/ca.pem\nARG HTTPS_PROXY\nRUN PIP_CERT=/tmp/ca.pem pip install", 1)
open(sys.argv[2], "w").write(s)
PY
  build_args=(-f "$context/Dockerfile.sandbox" --network host --build-arg "SOURCE_COMMIT=$SHA" --build-arg "HTTPS_PROXY=${HTTPS_PROXY:-}")
fi
docker build -q "${build_args[@]}" -t "newsflux-summary:$SHA" "$context" >/dev/null
[[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "newsflux-summary:$SHA")" == "$SHA" ]] \
  && ok SUMMARY_IMAGE_EXACT_REVISION || ko SUMMARY_IMAGE_EXACT_REVISION

# ---- gateway lab: Postgres, LiteLLM (production pin), TLS front, mock provider; --internal network --------
docker image inspect "$LITELLM_IMAGE" >/dev/null 2>&1 || docker pull -q "$LITELLM_IMAGE" >/dev/null
docker network create --internal "$gw" >/dev/null
MASTER="sk-synthetic-master-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: openai/newsflux-s5-free, api_base: "http://mock-provider:8080/v1", api_key: synthetic}
    model_info: {mode: chat}   # the catalog's capability gate needs an explicit chat mode
  - model_name: newsflux-other
    litellm_params: {model: openai/newsflux-other, api_base: "http://mock-provider:8080/v1", api_key: synthetic}
    model_info: {mode: chat}
YAML
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/tls.key" -out "$work/tls.crt" -days 1 \
  -subj "/CN=litellm-tls" -addext "subjectAltName=DNS:litellm-tls" >/dev/null 2>&1
printf 'https://:8443 {\n  tls /etc/lab/tls.crt /etc/lab/tls.key\n  reverse_proxy %s:4000\n}\n' "$run-litellm" >"$work/Caddyfile"
chmod 0644 "$work/config.yaml" "$work/tls.crt" "$work/tls.key" "$work/Caddyfile"
docker run -d --name "$run-pg" --network "$gw" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do docker exec "$run-pg" pg_isready -q -U postgres 2>/dev/null && break; sleep 1; done
docker run -d --name "$run-mock" --network "$gw" --network-alias mock-provider --entrypoint python3 "$LITELLM_IMAGE" -B -I -c '
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
OUT = {"summary": "Resumo sintético do laboratório.", "summary_paragraph_ids": ["p1"],
       "key_points": [{"text": "Ponto sintético.", "paragraph_ids": ["p1"]}], "action_points": []}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        print("MOCK_REQUEST", body.get("model"), flush=True)
        data = json.dumps({"id": "mock-1", "object": "chat.completion", "created": 0, "model": body.get("model"),
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(OUT)}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
HTTPServer(("0.0.0.0", 8080), H).serve_forever()' >/dev/null
docker run -d --name "$run-litellm" --network "$gw" -e LITELLM_MASTER_KEY="$MASTER" -e LITELLM_LOCAL_MODEL_COST_MAP=True \
  -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" -v "$work/config.yaml:/app/config.yaml:ro" \
  "$LITELLM_IMAGE" --config /app/config.yaml --port 4000 >/dev/null
docker run -d --name "$run-tls" --network "$gw" --network-alias litellm-tls -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$work/tls.crt:/etc/lab/tls.crt:ro" -v "$work/tls.key:/etc/lab/tls.key:ro" "$CADDY_IMAGE" >/dev/null
ll() { docker exec -i "$run-litellm" python3 -B -I - "$@"; }
for _ in $(seq 1 150); do
  ll <<<'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1 && break; sleep 2
done
KEY="$(ll "$MASTER" <<'PY'
import json, sys, urllib.request
req = urllib.request.Request("http://127.0.0.1:4000/key/generate", method="POST", data=json.dumps({
    "models": ["newsflux-s5-free", "newsflux-other"], "allowed_routes": ["llm_api_routes"], "max_budget": 0.5,
    "budget_duration": "30d", "tpm_limit": 20000, "rpm_limit": 5, "key_alias": "newsflux-d1-lab"}).encode(),
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + sys.argv[1]})
print(json.loads(urllib.request.urlopen(req, timeout=30).read())["key"])
PY
)"
[[ "$KEY" == sk-* ]] && ok LAB_KEY_SCOPED_BUDGETED || { ko LAB_KEY_SCOPED_BUDGETED; exit 1; }
mkdir -p "$work/secrets"; printf '%s\n' "$KEY" >"$work/secrets/key"; chmod 0400 "$work/secrets/key"; chown -R 10001:10001 "$work/secrets"
unset KEY MASTER_UNUSED

# ---- dark production-shaped stack: project newsflux, service summary-api, protected miniflux pair -------
mkdir -p "$work/stack" "$work/ledger"; chown 10001:10001 "$work/ledger"; chmod 0700 "$work/ledger"
docker image inspect "$BUSYBOX_IMAGE" >/dev/null 2>&1 || docker pull -q "$BUSYBOX_IMAGE" >/dev/null
python3 - "$work" "$SHA" "$gw" "$BUSYBOX_IMAGE" <<'PY'
import json, sys
work, sha, gw, busybox = sys.argv[1:]
summary_env = {
    "NEWSFLUX_AI_MINIFLUX_BASE_URL": "https://miniflux.invalid", "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS": "https://newsflux.invalid",
    "NEWSFLUX_AI_LITELLM_BASE_URL": "https://litellm-tls:8443", "SSL_CERT_FILE": "/run/lab-ca.crt",
    "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": "/run/secrets/litellm/key", "NEWSFLUX_AI_USAGE_DATABASE_PATH": "/data/usage.sqlite3",
    "NEWSFLUX_AI_INFERENCE_ENABLED": "false", "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "false",
    "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "newsflux-s5-free", "NEWSFLUX_AI_MAX_INPUT_TOKENS": "4096",
    "NEWSFLUX_AI_MAX_OUTPUT_TOKENS": "512", "NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE": "5",
    "NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE": "20000", "NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS": "20",
    # Legacy money controls as configured today: the D1 override must blank them (no duplicated cost control).
    "NEWSFLUX_AI_MONTHLY_BUDGET_USD": "1.00", "NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION": "0",
    "NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION": "0",
}
compose = {
    "services": {
        "summary-api": {"image": f"newsflux-summary:{sha}", "environment": summary_env, "networks": ["gateway"],
                        "volumes": [f"{work}/secrets:/run/secrets/litellm:ro", f"{work}/tls.crt:/run/lab-ca.crt:ro",
                                    f"{work}/ledger:/data"]},
        "miniflux": {"image": busybox, "container_name": "miniflux", "command": ["sleep", "3600"], "network_mode": "none"},
        "miniflux-db": {"image": busybox, "container_name": "miniflux-db", "command": ["sleep", "3600"], "network_mode": "none"},
    },
    "networks": {"gateway": {"external": True, "name": gw}},
}
json.dump(compose, open(f"{work}/stack/compose.json", "w"), indent=1)
json.dump({"services": {"summary-api": {"environment": {"NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS": "newsflux-mistral-small"}}}},
          open(f"{work}/stack/layer2.json", "w"))
PY
stack up -d --wait >/dev/null
summary() { docker ps -q --no-trunc --filter label=com.docker.compose.project=newsflux --filter label=com.docker.compose.service=summary-api; }
envof() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(summary)"; }
confhash() { docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$(summary)"; }
BASELINE_HASH="$(confhash)"
out="$(docker exec "$(summary)" python -B -m services.article_intel_summary.cost_authority preflight || true)"
grep -qx 'D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT' <<<"$out" && grep -qx 'NEWSFLUX_AI_INFERENCE_ENABLED=false' <<<"$(envof)" \
  && ok DARK_BASELINE "inference off, D1 not applicable" || ko DARK_BASELINE

# ---- operator script (production naming, disposable release root) -------------------------------------
export APPROVED_SHA="$SHA" NEWSFLUX_RELEASE_ROOT="$work/releases" NEWSFLUX_REPO_URL="file://$work/origin.git" \
  NEWSFLUX_RELEASE_LOCK="$work/release.lock"
op() { bash "$here/ai-functional-release.sh" "$@" 2>&1; }
op prepare >/dev/null && ok OPERATOR_PREPARE || ko OPERATOR_PREPARE

# Legacy mode is unchanged: the legacy S5 preflight (zero price, NewsFlux budget, attestation) still decides.
before="$(summary)"
out="$(op enable-s5 || true)"
if grep -q 'CODE=S5_PREFLIGHT_NOT_PASS' <<<"$out" && [[ "$(summary)" == "$before" && "$(confhash)" == "$BASELINE_HASH" ]]; then
  ok LEGACY_COMPATIBILITY "legacy enable-s5 still runs the legacy preflight and blocks here; nothing changed"
else
  ko LEGACY_COMPATIBILITY
fi

# ---- CAPTURE: one root invocation, the authorized auditor with --private-prestate ----------------------
capture_dir="$(mktemp -d /root/newsflux-d1.XXXXXXXX)"
litellm_id="$(docker inspect -f '{{.Id}}' "$run-litellm")"
litellm_image="$(docker inspect -f '{{.Image}}' "$run-litellm")"
# Rehearsal only: the auditor discovers LiteLLM by container; the lab LiteLLM is not part of project newsflux.
out="$(python3 -I -B "$here/d1_capture.py" --auditor "$work/auditor.py" --expect-auditor-sha256 "$AUDITOR_SHA256" \
  --evidence-lib "$repo/services/article_intel_summary" --summary-container "$(summary)" --litellm-container "$litellm_id" \
  --expect-litellm-image "$litellm_image" --expect-repo-digest "$LITELLM_IMAGE" --expect-litellm-version 1.110.0 \
  --project newsflux --summary-service summary-api --declaration gateway_budget_enforced --out-dir "$capture_dir" || true)"
printf '%s\n' "$out" | grep -E '^D1CAPTURE_(AUDITOR_EXIT|CLASSIFICATION|RESULT)=' | sed 's/^/D1E2E   /'
EVIDENCE_SHA="$(sed -n 's/^D1CAPTURE_EVIDENCE_SHA256=//p' <<<"$out")"
if grep -qx 'D1CAPTURE_RESULT=EVIDENCE_WRITTEN' <<<"$out" && grep -qx 'D1CAPTURE_CLASSIFICATION=GATEWAY_ENFORCEMENT_EVIDENCE' <<<"$out"; then
  ok CAPTURE_ONE_INVOCATION "real auditor, prestate-bound key, exit 0"
else
  ko CAPTURE_ONE_INVOCATION; echo "D1E2E SUMMARY pass=$pass fail=$fail"; exit 1
fi
[[ "$(stat -c '%U %a' "$capture_dir/prestate.json")" == "root 600" && "$(stat -c '%U %a' "$capture_dir/evidence.json")" == "root 644" ]] \
  && ok CAPTURE_FILE_MODES || ko CAPTURE_FILE_MODES
grep -q "$(cat "$work/secrets/key")" "$capture_dir/evidence.json" && ko NO_KEY_IN_EVIDENCE || ok NO_KEY_IN_EVIDENCE

export RELEASE_MODE=d1 D1_COST_AUTHORITY=gateway_budget_enforced D1_EVIDENCE_FILE="$capture_dir/evidence.json"
# ---- negative gates before anything is planned ------------------------------------------------------------
out="$(D1_EVIDENCE_SHA256="${EVIDENCE_SHA//?/0}" D1_EXTERNAL_TRANSFER_CONSENT=GRANTED op d1-preflight || true)"
grep -q 'CODE=EVIDENCE_DIGEST_MISMATCH' <<<"$out" && ok D1_WRONG_DIGEST_REFUSED || ko D1_WRONG_DIGEST_REFUSED
out="$(D1_EVIDENCE_SHA256="$EVIDENCE_SHA" op d1-preflight || true)"
grep -q 'CODE=EXTERNAL_TRANSFER_CONSENT_MISSING' <<<"$out" && ok D1_CONSENT_REQUIRED || ko D1_CONSENT_REQUIRED
export D1_EVIDENCE_SHA256="$EVIDENCE_SHA" D1_EXTERNAL_TRANSFER_CONSENT=GRANTED

# ---- D1 PREFLIGHT in the TARGET configuration (one-off container), service untouched -------------------
before="$(summary)"
out="$(op d1-preflight || true)"
printf '%s\n' "$out" | grep -E '^D1_' | sed 's/^/D1E2E   /'
if grep -qx 'D1_PREFLIGHT=PASS' <<<"$out" && grep -qx 'D1_TARGET_PREFLIGHT=PASS' <<<"$out" \
   && [[ "$(summary)" == "$before" && "$(confhash)" == "$BASELINE_HASH" ]]; then
  ok D1_TARGET_PREFLIGHT "evidence mount, pin, key, non-financial gates, live catalog and callbacks; service untouched"
else
  ko D1_TARGET_PREFLIGHT
fi
grep -qx 'D1_NO_DUPLICATE_COST_CONTROL=PASS' <<<"$out" && ok D1_NO_DUPLICATE_COST_CONTROL || ko D1_NO_DUPLICATE_COST_CONTROL

# ---- SYNTHETIC ACTIVATION ----------------------------------------------------------------------------------
out="$(op enable-s5 || true)"
grep -qx 'D1_ENABLED=PASS' <<<"$out" && grep -qx 'LIVE_D1_PREFLIGHT=PASS' <<<"$out" && ok SYNTHETIC_ACTIVATION || { ko SYNTHETIC_ACTIVATION; printf '%s\n' "$out" | grep -E '=(BLOCKED|HOLD|FAIL)' | head -5; }
env_now="$(envof)"
grep -qx 'NEWSFLUX_AI_MODEL_AUTHORITY=litellm_key' <<<"$env_now" && grep -qx 'NEWSFLUX_AI_MONTHLY_BUDGET_USD=' <<<"$env_now" \
  && grep -qx 'NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION=' <<<"$env_now" && ok D1_TARGET_CONFIG "key authority on, NewsFlux money controls blanked" || ko D1_TARGET_CONFIG
mount="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/run/newsflux-d1/evidence.json"}}{{.Type}} {{.RW}}{{end}}{{end}}' "$(summary)")"
in_container="$(docker exec "$(summary)" sh -c 'stat -c "%u %a" /run/newsflux-d1/evidence.json /run/newsflux-d1; grep " /run/newsflux-d1/evidence.json " /proc/self/mountinfo | cut -d" " -f6')"
[[ "$mount" == "bind false" && "$in_container" == $'0 644\n0 755\nro'* ]] && ok D1_EVIDENCE_MOUNT "root 0644, read-only bind" || ko D1_EVIDENCE_MOUNT "$mount / $in_container"

# ---- MODEL CATALOG and SYNTHETIC CANARY (real catalog, real adapter, real LiteLLM, mock provider) --------
canary="$(docker exec -i "$(summary)" python -B - <<'PY'
import os, tempfile
from services.article_intel_summary.catalog import create_model_router, discovered_model_id
from services.article_intel_summary.tests.test_litellm_adapter import input_fixture
with tempfile.TemporaryDirectory() as scratch:   # throwaway ledger: the service owns /data
    values = dict(os.environ, NEWSFLUX_AI_USAGE_DATABASE_PATH=os.path.join(scratch, "u.sqlite3"))
    router, _ = create_model_router(values, default_adapter=object())
    models = router.catalog_document()["models"]
    available = sorted(m["label"] for m in models if m["available"])
    priced = [m for m in models if (m.get("pricing") or {}).get("input_usd_per_million") is not None]
    print("CATALOG_AVAILABLE=" + ",".join(available))
    print("CATALOG_PRICES=" + ("NONE" if not priced else "PRESENT"))
    result = router.adapter_for(discovered_model_id("newsflux-s5-free")).summarize(input_fixture(), timeout_seconds=20)
    print("CANARY_MODEL=" + result.effective_model_id)
    if router.ledger_owner is not None:
        router.ledger_owner.__exit__(None, None, None)
PY
)" || true
printf '%s\n' "$canary" | sed 's/^/D1E2E   /'
grep -qx 'CATALOG_AVAILABLE=newsflux-other,newsflux-s5-free' <<<"$canary" && grep -qx 'CATALOG_PRICES=NONE' <<<"$canary" \
  && ok MODEL_CATALOG "the key's models, no price" || ko MODEL_CATALOG
mock_hits="$(docker logs "$run-mock" 2>/dev/null | grep -c '^MOCK_REQUEST newsflux-s5-free$' || true)"
grep -qx 'CANARY_MODEL=newsflux-s5-free' <<<"$canary" && [[ "$mock_hits" == 1 ]] \
  && ok SYNTHETIC_CANARY "one summary via LiteLLM to the local mock" || ko SYNTHETIC_CANARY "mock_hits=$mock_hits"

# ---- ROLLBACK to the dark baseline ---------------------------------------------------------------------
out="$(op disable-s5 || true)"
env_now="$(envof)"
if grep -q 'ROLLBACK=APPLIED' <<<"$out" && [[ "$(confhash)" == "$BASELINE_HASH" ]] \
   && ! grep -q 'NEWSFLUX_AI_MODEL_AUTHORITY' <<<"$env_now" && grep -qx 'NEWSFLUX_AI_INFERENCE_ENABLED=false' <<<"$env_now" \
   && [[ -z "$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/run/newsflux-d1/evidence.json"}}x{{end}}{{end}}' "$(summary)")" ]]; then
  ok ROLLBACK "exact baseline config hash, mount and D1 env removed"
else
  ko ROLLBACK
fi
out="$(docker exec "$(summary)" python -B -m services.article_intel_summary.cost_authority preflight || true)"
[[ "$(docker inspect -f '{{.State.Health.Status}}' "$(summary)")" == healthy ]] && grep -qx 'D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT' <<<"$out" \
  && ok DARK_BASELINE_RESTORED || ko DARK_BASELINE_RESTORED
for name in miniflux miniflux-db; do docker inspect -f '{{.State.Running}}' "$name" | grep -qx true || ko "PROTECTED_${name}"; done
egress="$(docker exec -i "$run-litellm" python3 -B -I - <<<'import socket
try:
    socket.create_connection(("1.1.1.1", 443), timeout=3); print("OPEN")
except OSError:
    print("BLOCKED")' || true)"
[[ "$egress" == BLOCKED ]] && ok NO_EGRESS || ko NO_EGRESS
echo "D1E2E SUMMARY pass=$pass fail=$fail"
trap - ERR
if [[ "$fail" == 0 ]]; then exit 0; else exit 1; fi
