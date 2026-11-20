#!/usr/bin/env bash
# S5-R2 planning evidence: in-place key policy update and exact rollback on a REAL, disposable LiteLLM.
#
# Synthetic only: disposable LiteLLM + Postgres (same pinned images as rehearse-s5-db-audit.sh),
# synthetic master key and keys, unreachable synthetic providers, no inference. Nothing here touches
# or describes the production gateway; it only establishes how the pinned LiteLLM version behaves:
#   - /key/update changes models, rpm/tpm, max_budget and budget_duration in place (key value unchanged);
#   - the key's catalog then lists only the exact alias;
#   - an existing object_permission row is left untouched by the update and by the rollback;
#   - an update with explicit nulls restores the prestate exactly (budget_reset_at back to null).
# Not wired to CI: run manually when re-validating the S5-R2 plan against a new LiteLLM image.
set -Eeuo pipefail
LITELLM_IMAGE=litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9
PG_IMAGE=postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663
run="s5r2x-$$"; net="$run-net"; work="$(mktemp -d)"
MASTER="sk-synthetic-master-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cleanup() { docker rm -f "$run-litellm" "$run-pg" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: hosted_vllm/synthetic-s5, api_base: "https://s5.invalid/v1", api_key: synthetic}
  - model_name: other-model
    litellm_params: {model: openai/synthetic-other, api_base: "https://other.invalid/v1", api_key: synthetic}
YAML
chmod 0644 "$work/config.yaml"
docker network create "$net" >/dev/null
docker run -d --name "$run-pg" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do docker exec "$run-pg" pg_isready -q -U postgres 2>/dev/null && break; sleep 1; done
docker run -d --name "$run-litellm" --network "$net" -e LITELLM_MASTER_KEY="$MASTER" -e LITELLM_LOCAL_MODEL_COST_MAP=True \
  -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" -v "$work/config.yaml:/app/config.yaml:ro" \
  "$LITELLM_IMAGE" --config /app/config.yaml --port 4000 >/dev/null
for _ in $(seq 1 120); do docker exec "$run-litellm" python3 -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1 && break; sleep 2; done
docker exec -i "$run-litellm" python3 -B - "$MASTER" <<'PY'
import json, os, sys, urllib.request, urllib.error
import psycopg
from psycopg.rows import dict_row
M = sys.argv[1]
def call(method, path, body=None, key=M):
    req = urllib.request.Request("http://127.0.0.1:4000" + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e: return e.code, (e.read()[:300].decode("utf-8","replace"))
FIELDS = ("models","rpm_limit","tpm_limit","max_budget","budget_duration","budget_reset_at","allowed_routes","object_permission_id","blocked","expires","spend")
def row(key):
    import hashlib
    h = hashlib.sha256(key.encode()).hexdigest()
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as c:
        c.read_only = True
        r = c.execute('SELECT ' + ",".join(f'"{f}"' for f in FIELDS) + ' FROM "LiteLLM_VerificationToken" WHERE token=%s', (h,)).fetchone()
        op = None
        if r and r["object_permission_id"]:
            op = c.execute('SELECT * FROM "LiteLLM_ObjectPermissionTable" WHERE object_permission_id=%s', (r["object_permission_id"],)).fetchone()
        return r, op
def show(tag, key):
    r, op = row(key)
    out = {k: (str(v) if k in ("budget_reset_at","expires") and v else v) for k, v in r.items() if k != "object_permission_id"}
    out["object_permission"] = None if not op else {k: v for k, v in op.items() if k != "object_permission_id" and v not in ([], None, {})}
    print(tag, json.dumps(out, default=str, sort_keys=True))

# Prestate shape seen in production (owner screenshot + receipt): all-proxy-models, no rpm/tpm/budget,
# plus an object permission row (the production key has object_permission_id set).
st, gen = call("POST", "/key/generate", {"models": ["all-proxy-models"], "allowed_routes": ["llm_api_routes"], "key_alias": "newsflux-synthetic",
                                         "object_permission": {"vector_stores": ["vs-synthetic"], "mcp_servers": []}})
print("GENERATE_WITH_OBJECT_PERMISSION", st, "" if st == 200 else gen)
K = gen["key"]; print("GENERATE", st)
show("PRESTATE", K)
# Target policy, in place.
target = {"key": K, "models": ["newsflux-s5-free"], "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 1.0, "budget_duration": "30d"}
st, body = call("POST", "/key/update", target); print("UPDATE_TARGET", st)
show("AFTER_TARGET", K)
st, _ = call("GET", "/v1/models", key=K); print("CATALOG_AFTER_TARGET", st, sorted(m["id"] for m in _["data"]) if isinstance(_, dict) else _)
# Rollback attempt to the exact prestate: wildcard model + null limits + null budget.
st, body = call("POST", "/key/update", {"key": K, "models": ["all-proxy-models"], "rpm_limit": None, "tpm_limit": None, "max_budget": None, "budget_duration": None})
print("UPDATE_ROLLBACK", st, body if st != 200 else "")
show("AFTER_ROLLBACK", K)
# Key value unchanged throughout: the same key still authenticates.
st, _ = call("GET", "/v1/models", key=K); print("SAME_KEY_STILL_VALID", st, "CATALOG_AFTER_ROLLBACK", sorted(m["id"] for m in _["data"]) if isinstance(_, dict) else _)
PY
