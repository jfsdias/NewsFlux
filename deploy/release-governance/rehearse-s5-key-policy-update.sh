#!/usr/bin/env bash
# S5-R2B: assertion-based rehearsal of an in-place key policy update and its exact rollback, on a
# REAL, disposable LiteLLM + Postgres (pinned images, synthetic master key and keys, unreachable
# synthetic providers, NO inference, nothing about the production gateway).
#
# Every expectation is an automatic check printed as "S5R2B <NAME>=PASS|FAIL"; the script exits
# non-zero if any check fails, if any state cannot be read or validated, or if cleanup fails.
#
#   bash rehearse-s5-key-policy-update.sh               # full rehearsal (exit 0 only if all PASS)
#   bash rehearse-s5-key-policy-update.sh --self-test   # comparator/check unit tests, no Docker
#   S5R2B_FAULT=<mode> bash rehearse-s5-key-policy-update.sh   # fault injection, MUST exit non-zero:
#       wrong_target     the update sends rpm 6 while the target asserts 5
#       skip_rollback    the final rollback is not performed
#       cleanup          cleanup also tries to remove a resource that does not exist
#
# Checks (R2B-01/02/03/04): /key/update status; exact one-alias scope; rpm/tpm/max_budget/
# budget_duration equal to the target; untouched fields unchanged; same key row and still
# authenticating; object_permission_id and its grants unchanged; catalog equal to exactly the alias;
# S5-R1 auditor (R2A, pinned sha256) keeps KEY_POLICY_GATE=NOT_VERIFIED while OBJECT_PERMISSION is
# linked and gives PASS for an identical key without it; negative cases (refused update, unexpected
# payload, partial rollback); rollback compared field by field with the structured prestate,
# including budget_reset_at; 30d reset observed on a calendar boundary; LiteLLM health before/after.
# No key, token hash, fingerprint, DSN or production object is printed.
set -Euo pipefail
umask 022
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
LITELLM_IMAGE="${LITELLM_IMAGE:-litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9}"
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
# S5-R1 auditor as reviewed in PR #271 (R2A); read from git, verified by SHA-256, never modified.
AUDITOR_REV="${S5R1_AUDITOR_REV:-3822e09850b3984dd8143b0782e2451aac2530b9}"
AUDITOR_SHA256="f200fbc743f79994171770ecf282ccc1708da2b07030d907aafd3caea52d8c80"
FAULT="${S5R2B_FAULT:-}"
run="s5r2b-$$"
net="$run-net"
work="$(mktemp -d)"
rc=0

write_probe() {
  cat >"$1" <<'PY'
"""S5-R2B probe: runs inside the disposable LiteLLM container (or locally with --self-test)."""
import contextlib, hashlib, io, json, os, sys, urllib.error, urllib.request

ALIAS = "newsflux-s5-free"
TARGET = {"models": [ALIAS], "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 1.0, "budget_duration": "30d"}
ROLLBACK_FIELDS = ("models", "rpm_limit", "tpm_limit", "max_budget", "budget_duration")
# Every policy-relevant column compared between prestate and post-rollback.
COMPARED = ("models", "rpm_limit", "tpm_limit", "max_budget", "budget_duration", "budget_reset_at",
            "allowed_routes", "blocked", "expires", "spend", "object_permission_id", "key_alias",
            "team_id", "aliases", "router_settings", "max_parallel_requests", "metadata")
UNTOUCHED = tuple(f for f in COMPARED if f not in ROLLBACK_FIELDS + ("budget_reset_at",))
OBJPERM_FIELDS = ("mcp_servers", "mcp_access_groups", "mcp_tool_permissions", "vector_stores", "agents",
                  "agent_access_groups", "models", "blocked_tools", "search_tools", "skills")
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    return bool(ok)


def diff(before, after, fields):
    """Field names whose values differ; a field missing on either side is a difference."""
    out = []
    for field in fields:
        if (field in before) != (field in after) or before.get(field) != after.get(field):
            out.append(field)
    return out


def report():
    failed = 0
    for name, ok, detail in RESULTS:
        failed += 0 if ok else 1
        print(f"S5R2B {name}={'PASS' if ok else 'FAIL'}" + (f" ({detail})" if detail else ""))
    print(f"S5R2B_CHECKS={len(RESULTS)} S5R2B_FAILED={failed}")
    return 1 if failed or not RESULTS else 0


def self_test():
    a = {"models": ["all-proxy-models"], "rpm_limit": None, "object_permission_id": "op-1", "x": 1}
    assert diff(a, dict(a), ("models", "rpm_limit", "object_permission_id")) == []
    assert diff(a, dict(a, rpm_limit=5), ("rpm_limit",)) == ["rpm_limit"]
    assert diff(a, dict(a, rpm_limit=0), ("rpm_limit",)) == ["rpm_limit"]           # None vs 0
    assert diff(a, {k: v for k, v in a.items() if k != "rpm_limit"}, ("rpm_limit",)) == ["rpm_limit"]
    assert diff(a, dict(a, models=["all-proxy-models", "x"]), ("models",)) == ["models"]
    assert diff(a, dict(a, object_permission_id="op-2"), ("object_permission_id",)) == ["object_permission_id"]
    assert diff({"vector_stores": ["vs"]}, {"vector_stores": []}, ("vector_stores",)) == ["vector_stores"]
    RESULTS.clear(); check("A", True); check("B", False, "why")
    with contextlib.redirect_stdout(io.StringIO()) as out:
        code = report()
    assert code == 1 and "S5R2B B=FAIL (why)" in out.getvalue() and "S5R2B_FAILED=1" in out.getvalue()
    RESULTS.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        assert report() == 1  # no check at all is a failure, never a silent pass
    RESULTS.clear(); check("A", True)
    with contextlib.redirect_stdout(io.StringIO()):
        assert report() == 0
    print("S5R2B_SELF_TEST=PASS")
    return 0


def main(master, fault):
    import psycopg
    from psycopg.rows import dict_row

    def call(method, path, body=None, key=master):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request("http://127.0.0.1:4000" + path, method=method, data=data,
                                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as error:
            return error.code, None
        except Exception:  # noqa: BLE001
            return None, None

    def snapshot(key):
        """Structured, read-only state of one synthetic key: policy columns + linked grants."""
        token = hashlib.sha256(key.encode()).hexdigest()
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            conn.read_only = True
            rows = conn.execute('SELECT ' + ", ".join(f'"{c}"' for c in COMPARED) +
                                ' FROM "LiteLLM_VerificationToken" WHERE "token" = %s', (token,)).fetchall()
            if len(rows) != 1:
                return None
            state = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in rows[0].items()}
            state["object_permission"] = None
            if state["object_permission_id"]:
                perm = conn.execute('SELECT * FROM "LiteLLM_ObjectPermissionTable" WHERE "object_permission_id" = %s',
                                    (state["object_permission_id"],)).fetchone()
                state["object_permission"] = None if perm is None else {f: perm.get(f) for f in OBJPERM_FIELDS}
            conn.rollback()
            return state

    def catalog(key):
        status, body = call("GET", "/v1/models", key=key)
        if status != 200 or not isinstance(body, dict):
            return status, None
        return status, sorted(item.get("id") for item in body.get("data", []))

    def audit(key):
        """S5-R1 auditor (R2A) on the real DB; returns its classification dict."""
        ns = {"__name__": "s5_audit"}
        with open("/tmp/s5_audit.py", encoding="utf-8") as handle:
            exec(compile(handle.read(), "s5_db_readonly_audit.py", "exec"), ns)  # noqa: S102 - pinned, hash-checked
        token = hashlib.sha256(key.encode()).hexdigest()
        payload = {"fingerprint": ns["fingerprint_token_hash"](token), "alias": ALIAS,
                   "caps": {"rpm": 5, "tpm": 20000, "budget": 1.0}, "allowed_callbacks": []}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            ns["probe_main"](payload)
        try:
            return json.loads(out.getvalue().strip().splitlines()[-1])
        except (ValueError, IndexError):
            return {}

    def health():
        status, _ = call("GET", "/health/liveliness")
        return status == 200

    check("LITELLM_HEALTH_BEFORE", health())
    # Prestate shape of the production key (receipt): wildcard scope, no limits, linked object permission.
    prestate_policy = {"models": ["all-proxy-models"], "allowed_routes": ["llm_api_routes"], "key_alias": "newsflux-synthetic",
                       "object_permission": {"vector_stores": ["vs-synthetic"], "mcp_servers": ["mcp-synthetic"]}}
    st, gen = call("POST", "/key/generate", prestate_policy)
    check("GENERATE_PRESTATE_KEY_HTTP_200", st == 200 and isinstance(gen, dict) and gen.get("key"), f"status {st}")
    st2, gen2 = call("POST", "/key/generate", {k: v for k, v in prestate_policy.items() if k != "object_permission"}
                     | {"key_alias": "newsflux-synthetic-control"})
    check("GENERATE_CONTROL_KEY_HTTP_200", st2 == 200 and isinstance(gen2, dict) and gen2.get("key"), f"status {st2}")
    if not (isinstance(gen, dict) and gen.get("key") and isinstance(gen2, dict) and gen2.get("key")):
        return report()
    key, control = gen["key"], gen2["key"]

    pre = snapshot(key)
    check("PRESTATE_READ", pre is not None)
    if pre is None:
        return report()
    pre_catalog_status, pre_catalog = catalog(key)
    check("PRESTATE_SHAPE", pre["models"] == ["all-proxy-models"] and pre["rpm_limit"] is None and pre["tpm_limit"] is None
          and pre["max_budget"] is None and pre["budget_duration"] is None and pre["budget_reset_at"] is None
          and pre["object_permission_id"] and pre["object_permission"] is not None)
    check("PRESTATE_CATALOG_READ", pre_catalog_status == 200 and pre_catalog and len(pre_catalog) >= 2,
          f"status {pre_catalog_status}")
    audit_pre = audit(key)
    check("R2B02_PRESTATE_KEY_POLICY_GATE_FAIL", audit_pre.get("KEY_POLICY_GATE") == "FAIL"
          and audit_pre.get("KEY_SCOPE_DETAIL") == "WILDCARD", json.dumps({k: audit_pre.get(k) for k in ("KEY_POLICY_GATE", "KEY_SCOPE_DETAIL")}))

    # ---- R2B-01: target update, every invariant asserted -------------------------------------------
    sent = dict(TARGET, rpm_limit=6) if fault == "wrong_target" else dict(TARGET)
    st, _ = call("POST", "/key/update", dict(sent, key=key))
    check("UPDATE_TARGET_HTTP_200", st == 200, f"status {st}")
    post = snapshot(key)
    check("POST_UPDATE_READ", post is not None)
    if post is None:
        return report()
    check("SCOPE_EXACT_ALIAS", post["models"] == [ALIAS])
    for field in ("rpm_limit", "tpm_limit", "max_budget", "budget_duration"):
        check(f"TARGET_{field.upper()}", post[field] == TARGET[field])
    check("UNTOUCHED_FIELDS_UNCHANGED", diff(pre, post, UNTOUCHED) == [], ",".join(diff(pre, post, UNTOUCHED)))
    check("OBJECT_PERMISSION_ID_UNCHANGED", post["object_permission_id"] == pre["object_permission_id"])
    check("OBJECT_PERMISSION_GRANTS_UNCHANGED", post["object_permission"] == pre["object_permission"])
    check("SAME_KEY_ROW_STILL_AUTHENTICATES", catalog(key)[0] == 200)
    check("CATALOG_EXACTLY_ALIAS", catalog(key)[1] == [ALIAS])
    reset = post.get("budget_reset_at") or ""
    check("R2B04_30D_RESET_ON_CALENDAR_FIRST", reset[8:10] == "01" and reset[11:19] == "00:00:00", "observed day 01, 00:00 UTC")

    # ---- R2B-02: auditor keeps NOT_VERIFIED while OBJECT_PERMISSION is linked --------------------------
    audit_post = audit(key)
    detail = json.dumps({k: audit_post.get(k) for k in ("KEY_SCOPE", "KEY_RATE_LIMITS", "KEY_BUDGET", "KEY_INDIRECTION", "KEY_POLICY_GATE")})
    check("R2B02_OTHER_KEY_GATES_PASS_AFTER_FIX", all(audit_post.get(g) == "PASS" for g in ("KEY_SCOPE", "KEY_RATE_LIMITS", "KEY_BUDGET", "KEY_VALIDITY", "KEY_ROUTES")), detail)
    check("R2B02_INDIRECTION_OBJECT_PERMISSION", audit_post.get("KEY_INDIRECTION") == "OBJECT_PERMISSION", detail)
    check("R2B02_KEY_POLICY_GATE_STAYS_NOT_VERIFIED", audit_post.get("KEY_POLICY_GATE") == "NOT_VERIFIED", detail)
    st, _ = call("POST", "/key/update", dict(TARGET, key=control))
    audit_control = audit(control)
    check("R2B02_CONTROL_WITHOUT_OBJECT_PERMISSION_PASSES", st == 200 and audit_control.get("KEY_POLICY_GATE") == "PASS"
          and audit_control.get("KEY_INDIRECTION") == "NONE",
          json.dumps({k: audit_control.get(k) for k in ("KEY_INDIRECTION", "KEY_POLICY_GATE")}))

    # ---- R2B-03: negative cases ------------------------------------------------------------------------
    st, _ = call("POST", "/key/update", dict(TARGET, key="sk-synthetic-key-that-does-not-exist-0000"))
    check("NEG_REFUSED_UPDATE_NOT_200", st is not None and st != 200, f"status {st}")
    check("NEG_REFUSED_UPDATE_LEFT_STATE", diff(post, snapshot(key) or {}, COMPARED + ("object_permission",)) == [])
    st, _ = call("POST", "/key/update", {"key": key, "rpm_limit": "not-a-number"})
    check("NEG_UNEXPECTED_PAYLOAD_NOT_200", st is not None and st != 200, f"status {st}")
    check("NEG_UNEXPECTED_PAYLOAD_LEFT_STATE", diff(post, snapshot(key) or {}, COMPARED + ("object_permission",)) == [])
    partial = {"key": key, "models": pre["models"], "tpm_limit": None, "max_budget": None, "budget_duration": None}  # rpm omitted
    st, _ = call("POST", "/key/update", partial)
    after_partial = snapshot(key) or {}
    missed = diff(pre, after_partial, COMPARED)
    check("NEG_PARTIAL_ROLLBACK_DETECTED", st == 200 and "rpm_limit" in missed, ",".join(missed))

    # ---- R2B-03: full rollback, compared field by field with the structured prestate -------------------
    if fault != "skip_rollback":
        st, _ = call("POST", "/key/update", {"key": key, **{f: pre[f] for f in ROLLBACK_FIELDS}})
        check("ROLLBACK_HTTP_200", st == 200, f"status {st}")
    after = snapshot(key)
    check("POST_ROLLBACK_READ", after is not None)
    after = after or {}
    mismatched = diff(pre, after, COMPARED + ("object_permission",))
    check("ROLLBACK_EQUALS_PRESTATE", mismatched == [], ",".join(mismatched) or f"{len(COMPARED) + 1} fields equal")
    check("ROLLBACK_BUDGET_RESET_AT_NULL", after.get("budget_reset_at") is None)
    check("ROLLBACK_CATALOG_EQUALS_PRESTATE", catalog(key) == (200, pre_catalog))
    check("ROLLBACK_SAME_KEY_STILL_AUTHENTICATES", catalog(key)[0] == 200)
    check("LITELLM_HEALTH_AFTER", health())
    return report()


if __name__ == "__main__":
    if sys.argv[1:2] == ["--self-test"]:
        sys.exit(self_test())
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""))
PY
}

cleanup() {
  local status=0 resource
  local networks=("$net")
  # `docker rm -f` exits 0 for a missing container, so removal is verified by absence afterwards;
  # `docker network rm` of a missing network fails, which is what the cleanup fault exercises.
  [[ "$FAULT" == cleanup ]] && networks+=("$run-does-not-exist")
  for resource in "$run-litellm" "$run-pg"; do
    docker rm -f "$resource" >/dev/null 2>&1 || status=1
    docker container inspect "$resource" >/dev/null 2>&1 && status=1
  done
  for resource in "${networks[@]}"; do
    docker network rm "$resource" >/dev/null 2>&1 || status=1
  done
  rm -rf "$work" || status=1
  [[ -e "$work" ]] && status=1
  # Only this run's resources, by exact name; any failure is reported, never swallowed.
  if [[ "$status" == 0 ]]; then echo "S5R2B CLEANUP=PASS"; else echo "S5R2B CLEANUP=FAIL"; fi
  return "$status"
}

if [[ "${1:-}" == "--self-test" ]]; then
  write_probe "$work/probe.py"
  python3 -B "$work/probe.py" --self-test
  rc=$?
  rm -rf "$work"
  exit "$rc"
fi

finish() {
  cleanup || rc=1
  echo "S5R2B_EXIT=$rc"
  exit "$rc"
}
trap finish EXIT

# Lab image provenance (R2B-04). This is the pinned registry digest of the rehearsal image; it is not
# an identifier of any production image and cannot be compared with a local Docker image ID.
echo "S5R2B LAB_IMAGE=$LITELLM_IMAGE"

auditor="$work/s5_audit.py"
if ! git -C "$repo" show "$AUDITOR_REV:deploy/release-governance/s5_db_readonly_audit.py" >"$auditor" 2>/dev/null \
   || [[ "$(sha256sum "$auditor" | cut -d' ' -f1)" != "$AUDITOR_SHA256" ]]; then
  echo "S5R2B AUDITOR_PINNED_SOURCE=FAIL (git object $AUDITOR_REV not available or hash mismatch; git fetch origin $AUDITOR_REV)"
  rc=1
  exit 1
fi
echo "S5R2B AUDITOR_PINNED_SOURCE=PASS"

cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: hosted_vllm/synthetic-s5, api_base: "https://s5.invalid/v1", api_key: synthetic}
  - model_name: other-model
    litellm_params: {model: openai/synthetic-other, api_base: "https://other.invalid/v1", api_key: synthetic}
YAML
chmod 0644 "$work/config.yaml"
write_probe "$work/probe.py"
MASTER="sk-synthetic-master-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

docker network create "$net" >/dev/null || { rc=1; exit 1; }
docker run -d --name "$run-pg" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE" >/dev/null || { rc=1; exit 1; }
for _ in $(seq 1 30); do docker exec "$run-pg" pg_isready -q -U postgres 2>/dev/null && break; sleep 1; done
docker run -d --name "$run-litellm" --network "$net" -e LITELLM_MASTER_KEY="$MASTER" -e LITELLM_LOCAL_MODEL_COST_MAP=True \
  -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" -v "$work/config.yaml:/app/config.yaml:ro" \
  "$LITELLM_IMAGE" --config /app/config.yaml --port 4000 >/dev/null || { rc=1; exit 1; }
for _ in $(seq 1 120); do
  docker exec "$run-litellm" python3 -B -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1 && break
  sleep 2
done
version="$(docker exec "$run-litellm" python3 -B -c 'import importlib.metadata as m; print(m.version("litellm"))' 2>/dev/null || echo UNKNOWN)"
echo "S5R2B LAB_LITELLM_VERSION=$version"
docker cp "$work/probe.py" "$run-litellm:/tmp/probe.py" >/dev/null && docker cp "$auditor" "$run-litellm:/tmp/s5_audit.py" >/dev/null || { rc=1; exit 1; }
docker exec -i "$run-litellm" python3 -B /tmp/probe.py "$MASTER" "$FAULT" || rc=1
