#!/usr/bin/env bash
# S5-R2C: assertion-based rehearsal of an in-place key policy update and its exact rollback, on a
# REAL, disposable LiteLLM + Postgres (pinned images, synthetic master key and keys, unreachable
# synthetic providers, NO inference, nothing about the production gateway).
#
# Every expectation is an automatic check printed as "S5R2C <NAME>=PASS|FAIL"; the script exits
# non-zero if any check fails, if any setup step fails, if any state cannot be read or validated,
# or if cleanup cannot prove that every resource it created is gone.
#
#   bash rehearse-s5-key-policy-update.sh               # full rehearsal (exit 0 only if all PASS)
#   bash rehearse-s5-key-policy-update.sh --self-test   # unit tests + setup-failure tests, no LiteLLM
#   S5R2C_FAULT=<mode> bash rehearse-s5-key-policy-update.sh   # fault injection, MUST exit non-zero:
#       setup_mktemp     the disposable work directory cannot be created
#       setup_write      the probe cannot be written
#       setup_chmod      the config file mode cannot be set
#       unknown_column   the lab key and permission tables get a column the harness does not know
#       wrong_target     the update sends rpm 6 while the target asserts 5
#       neg_401          the negative calls use a wrong master key (auth error, not the refusal)
#       skip_rollback    the final rollback is not performed
#       cleanup          cleanup also tries to remove a network that does not exist
#
# Coverage (R2C-01): every column of LiteLLM_VerificationToken is classified (secret identity, target,
# derived, bookkeeping, invariant); an unknown or missing column fails. Every column of the linked
# object-permission row and of the linked budget row is compared; an unknown grant column fails.
# The S5-R1 auditor's KEY_COLUMNS + OPTIONAL_INDIRECTION_COLUMNS (+ agent_id) must all be compared.
# No key, token hash, fingerprint, DSN or production object is printed.
set -Eeuo pipefail
umask 022
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
self="$here/$(basename "$0")"
DEFAULT_LITELLM_IMAGE="litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9"
DEFAULT_LITELLM_VERSION="1.109.1"
LITELLM_IMAGE="${LITELLM_IMAGE:-$DEFAULT_LITELLM_IMAGE}"
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
# S5-R1 auditor as reviewed in PR #271 (R2A); read from git, verified by SHA-256, never modified.
AUDITOR_REV="${S5R1_AUDITOR_REV:-3822e09850b3984dd8143b0782e2451aac2530b9}"
AUDITOR_SHA256="f200fbc743f79994171770ecf282ccc1708da2b07030d907aafd3caea52d8c80"
FAULT="${S5R2C_FAULT:-}"
run="${S5R2C_RUN_ID:-s5r2c-$$}"
net="$run-net"
work=""
work_ok=0
docker_used=0
rc=0

if [[ ! "$run" =~ ^s5r2c-[a-z0-9-]+$ ]]; then
  echo "S5R2C RUN_ID=FAIL (unexpected run id)"
  exit 1
fi

write_probe() {
  cat >"$1" <<'PY'
"""S5-R2C probe: runs inside the disposable LiteLLM container (or on the host with --self-test)."""
import contextlib, datetime as dt, hashlib, http.server, io, json, os, re, sys, threading, urllib.error, urllib.request

ALIAS = "newsflux-s5-free"
TARGET = {"models": [ALIAS], "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 1.0, "budget_duration": "30d"}
UTC = dt.timezone.utc

# ---- R2C-01: explicit classification of every column of the pinned schema -------------------------
KEY_SECRET_IDENTITY = ("token",)                    # sha256 of the key: row identity, never printed
KEY_TARGET = tuple(TARGET)                          # the only fields the update may set
KEY_DERIVED = ("budget_reset_at",)                  # set by LiteLLM from budget_duration; asserted exactly
KEY_BOOKKEEPING = ("updated_at", "settings_updated_at")  # write stamps; observed to move on /key/update
KEY_INVARIANT = (
    "key_name", "key_alias", "soft_budget_cooldown", "spend", "expires", "aliases", "config", "user_id",
    "team_id", "permissions", "max_parallel_requests", "metadata", "blocked", "allowed_cache_controls",
    "model_spend", "model_max_budget", "budget_id", "organization_id", "created_at", "created_by",
    "updated_by", "allowed_routes", "object_permission_id", "auto_rotate", "key_rotation_at",
    "last_rotation_at", "rotation_count", "rotation_interval", "project_id", "router_settings", "policies",
    "access_group_ids", "last_active", "agent_id", "budget_limits", "budget_fallbacks", "key_type",
    "tpd_limit", "total_spend",
)
KEY_KNOWN = KEY_SECRET_IDENTITY + KEY_TARGET + KEY_DERIVED + KEY_BOOKKEEPING + KEY_INVARIANT
KEY_COMPARED = KEY_TARGET + KEY_DERIVED + KEY_INVARIANT        # equality-checked against the prestate
OBJPERM_KNOWN = ("object_permission_id", "mcp_servers", "vector_stores", "mcp_access_groups",
                 "mcp_tool_permissions", "agents", "agent_access_groups", "blocked_tools", "models",
                 "mcp_toolsets", "search_tools", "mcp_tool_search_enabled", "skills")
# The S5-R2B comparator, kept only to prove what it missed (R2C-01 RED).
LEGACY_COMPARED = ("models", "rpm_limit", "tpm_limit", "max_budget", "budget_duration", "budget_reset_at",
                   "allowed_routes", "blocked", "expires", "spend", "object_permission_id", "key_alias",
                   "team_id", "aliases", "router_settings", "max_parallel_requests", "metadata")
LEGACY_OBJPERM = ("mcp_servers", "mcp_access_groups", "mcp_tool_permissions", "vector_stores", "agents",
                  "agent_access_groups", "models", "blocked_tools", "search_tools", "skills")
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    return bool(ok)


def diff(before, after, fields):
    """Field names whose values differ; a field missing on either side is a difference."""
    return [f for f in fields if (f in before) != (f in after) or before.get(f) != after.get(f)]


def classify_columns(found, known):
    """(unknown, missing): a column the harness does not know, or a known one that does not exist."""
    return sorted(set(found) - set(known)), sorted(set(known) - set(found))


def unexpected_changes(before, after, allowed=()):
    """Every compared key column, the whole linked permission row and the whole linked budget row."""
    out = diff(before["key"], after["key"], [f for f in KEY_COMPARED if f not in allowed])
    out += ["object_permission." + f for f in sorted(set(before["object_permission"] or {}) | set(after["object_permission"] or {}))
            if (before["object_permission"] or {}).get(f, "<absent>") != (after["object_permission"] or {}).get(f, "<absent>")]
    if (before["object_permission"] is None) != (after["object_permission"] is None):
        out.append("object_permission")
    if before["budget"] != after["budget"]:
        out.append("budget_row")
    return out


def legacy_changes(before, after):
    out = diff(before["key"], after["key"], LEGACY_COMPARED)
    out += ["object_permission." + f for f in diff(before["object_permission"] or {}, after["object_permission"] or {}, LEGACY_OBJPERM)]
    return out


# ---- R2C-03: a negative test passes only on the intended refusal -----------------------------------
def refusal_ok(kind, status, body):
    if kind == "missing_key":
        error = body.get("error") if isinstance(body, dict) else None
        return status == 404 and isinstance(error, dict) and error.get("type") == "not_found_error" \
            and str(error.get("code")) == "404"
    if kind == "invalid_payload":
        detail = body.get("detail") if isinstance(body, dict) else None
        return status == 422 and isinstance(detail, list) and any(
            isinstance(d, dict) and d.get("type") == "int_parsing" and d.get("loc") == ["body", "rpm_limit"] for d in detail)
    return False


def legacy_refusal_ok(status):
    return status is not None and status != 200  # S5-R2B predicate, kept only for the RED proof


# ---- R2C-04: exact next calendar boundary -----------------------------------------------------------
def next_month_start(moment):
    """LiteLLM _handle_month_reset with reset_time_of_day 00:00 UTC: the 1st of the current month at
    00:00 is always <= now, so the reset is 00:00 UTC on the 1st of the following month."""
    moment = moment.astimezone(UTC)
    year, month = (moment.year + 1, 1) if moment.month == 12 else (moment.year, moment.month + 1)
    return dt.datetime(year, month, 1, tzinfo=UTC)


def reset_ok(value, before, after):
    """value: budget_reset_at as stored (naive UTC); before/after: aware UTC clock bracket of the update."""
    try:
        reset = dt.datetime.fromisoformat(str(value).replace(" ", "T"))
    except ValueError:
        return False
    if reset.tzinfo is None:
        reset = reset.replace(tzinfo=UTC)
    return reset > after and reset in {next_month_start(before), next_month_start(after)}


def legacy_reset_ok(value):
    value = str(value or "")
    return value[8:10] == "01" and value[11:19] == "00:00:00"


def version_ok(found, expected):
    return bool(re.fullmatch(r"\d+\.\d+\.\d+", found or "")) and found == expected


def call(base, method, path, body=None, key=""):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, method=method, data=data,
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b"null")
        except ValueError:
            return error.code, None
    except Exception:  # noqa: BLE001
        return None, None


def report(prefix="S5R2C"):
    failed = 0
    for name, ok, detail in RESULTS:
        failed += 0 if ok else 1
        print(f"{prefix} {name}={'PASS' if ok else 'FAIL'}" + (f" ({detail})" if detail else ""))
    print(f"S5R2C_CHECKS={len(RESULTS)} S5R2C_FAILED={failed}")
    return 1 if failed or not RESULTS else 0


def self_test(auditor_path):
    # comparator basics
    a = {"models": ["all-proxy-models"], "rpm_limit": None, "object_permission_id": "op-1"}
    assert diff(a, dict(a), ("models", "rpm_limit")) == []
    assert diff(a, dict(a, rpm_limit=0), ("rpm_limit",)) == ["rpm_limit"]               # None vs 0
    assert diff(a, {k: v for k, v in a.items() if k != "rpm_limit"}, ("rpm_limit",)) == ["rpm_limit"]
    # R2C-01: schema classification is exact and fail-closed
    assert classify_columns(KEY_KNOWN, KEY_KNOWN) == ([], [])
    assert classify_columns(KEY_KNOWN + ("brand_new_grant",), KEY_KNOWN) == (["brand_new_grant"], [])
    assert classify_columns([c for c in KEY_KNOWN if c != "agent_id"], KEY_KNOWN) == ([], ["agent_id"])
    assert len(set(KEY_KNOWN)) == len(KEY_KNOWN)                                       # no double class
    ns = {"__name__": "s5_audit"}
    with open(auditor_path, encoding="utf-8") as handle:
        exec(compile(handle.read(), "s5_db_readonly_audit.py", "exec"), ns)  # noqa: S102 - pinned, hash-checked
    critical = set(ns["KEY_COLUMNS"]) | set(ns["OPTIONAL_INDIRECTION_COLUMNS"]) | {"agent_id"}
    assert critical - {"token"} <= set(KEY_COMPARED), critical - set(KEY_COMPARED)
    assert {"budget_id", "access_group_ids", "policies", "agent_id"} & set(LEGACY_COMPARED) == set()  # the R2B gap
    # R2C-01: incidental mutations; the R2B comparator missed them, the R2C comparator detects them
    base = {"key": {c: None for c in KEY_KNOWN}, "object_permission": {c: None for c in OBJPERM_KNOWN}, "budget": {"max_budget": 5.0}}
    base["key"].update(budget_id="bud", access_group_ids=["ag"], policies=["pol"], agent_id="agent")
    mutations = {"budget_id": ("key", "budget_id", None), "access_group_ids": ("key", "access_group_ids", []),
                 "policies": ("key", "policies", []), "agent_id": ("key", "agent_id", None),
                 "mcp_toolsets": ("object_permission", "mcp_toolsets", ["ts"]),
                 "mcp_tool_search_enabled": ("object_permission", "mcp_tool_search_enabled", True),
                 "budget_row": ("budget", "max_budget", 50.0)}
    for name, (part, field, value) in mutations.items():
        mutated = {k: dict(v) for k, v in base.items()}
        mutated[part][field] = value
        assert legacy_changes(base, mutated) == [], name
        assert unexpected_changes(base, mutated) != [], name
    assert unexpected_changes(base, {k: dict(v) for k, v in base.items()}) == []
    # R2C-03: real HTTP round trips against a local stub; only the intended refusal is accepted
    responses = {
        "/ok404": (404, {"error": {"message": "Key not found.", "type": "not_found_error", "param": "key", "code": "404"}}),
        "/ok422": (422, {"detail": [{"type": "int_parsing", "loc": ["body", "rpm_limit"], "msg": "x"}]}),
        "/401": (401, {"error": {"message": "Authentication Error", "type": "token_not_found_in_db", "code": "401"}}),
        "/403": (403, {"error": {"message": "Enterprise only", "type": "auth_error", "code": "403"}}),
        "/500": (500, {"error": {"message": "internal", "type": "internal_server_error", "code": "500"}}),
        "/404other": (404, {"detail": "Not Found"}),
        "/422other": (422, {"detail": [{"type": "missing", "loc": ["body", "key"]}]}),
        "/500text": (500, None),
    }

    class Stub(http.server.BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            status, body = responses[self.path]
            payload = b"<html>oops</html>" if body is None else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    got = {path: call(base_url, "POST", path, {"key": "synthetic"}) for path in responses}
    server.shutdown()
    assert refusal_ok("missing_key", *got["/ok404"]) and refusal_ok("invalid_payload", *got["/ok422"])
    for path in ("/401", "/403", "/500", "/500text", "/404other", "/422other"):
        for kind in ("missing_key", "invalid_payload"):
            assert not refusal_ok(kind, *got[path]), (path, kind)
    for path in ("/401", "/403", "/500"):
        assert legacy_refusal_ok(got[path][0]), path          # the R2B predicate accepted these (RED)
    assert not refusal_ok("missing_key", *got["/ok422"]) and not refusal_ok("invalid_payload", *got["/ok404"])
    # R2C-04: exact next boundary, full UTC timestamp
    nov = dt.datetime(2026, 11, 20, 3, 0, tzinfo=UTC)
    assert next_month_start(nov) == dt.datetime(2026, 12, 1, tzinfo=UTC)
    assert next_month_start(dt.datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC)) == dt.datetime(2027, 1, 1, tzinfo=UTC)
    assert next_month_start(dt.datetime(2026, 2, 1, 0, 0, tzinfo=UTC)) == dt.datetime(2026, 3, 1, tzinfo=UTC)
    assert reset_ok("2026-12-01T00:00:00", nov, nov) and reset_ok("2026-12-01 00:00:00", nov, nov)
    for stale in ("2020-01-01T00:00:00", "2026-11-01T00:00:00", "2027-01-01T00:00:00"):
        assert legacy_reset_ok(stale) and not reset_ok(stale, nov, nov), stale   # R2B accepted (RED)
    for wrong in ("2026-12-01T00:00:01", "2026-12-15T00:00:00", None, "garbage"):
        assert not reset_ok(wrong, nov, nov), wrong
    jan = dt.datetime(2027, 1, 1, tzinfo=UTC)
    assert reset_ok("2027-01-01T00:00:00", dt.datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC), dt.datetime(2027, 1, 1, 0, 0, 1, tzinfo=UTC)) is False
    assert reset_ok("2027-02-01T00:00:00", dt.datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC), dt.datetime(2027, 1, 1, 0, 0, 1, tzinfo=UTC))
    assert jan.tzinfo is UTC
    # R2C-04: version gate
    assert version_ok("1.109.1", "1.109.1")
    for found in ("UNKNOWN", "", None, "1.109.2", "1.109.1rc1", "1.109"):
        assert not version_ok(found, "1.109.1"), found
    # reporting is fail-closed
    RESULTS.clear(); check("A", True); check("B", False, "why")
    with contextlib.redirect_stdout(io.StringIO()) as out:
        assert report() == 1
    assert "S5R2C B=FAIL (why)" in out.getvalue()
    RESULTS.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        assert report() == 1  # no check at all is a failure, never a silent pass
    RESULTS.clear()
    print("S5R2C_PY_SELF_TEST=PASS")
    return 0


def main(master, fault):
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.environ["DATABASE_URL"]
    base_url = "http://127.0.0.1:4000"

    def api(method, path, body=None, key=master):
        return call(base_url, method, path, body, key)

    def lab_write(sql, params=()):
        """Direct write to the DISPOSABLE lab DB only (fault injection and policies mutation)."""
        with psycopg.connect(dsn) as conn:
            conn.execute(sql, params)

    def columns(conn, table):
        return [r["column_name"] for r in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = %s",
            (table,)).fetchall()]

    def snapshot(key):
        """Structured, read-only state of one synthetic key: whole key row, linked permission and budget rows."""
        token = hashlib.sha256(key.encode()).hexdigest()
        norm = lambda r: {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()}  # noqa: E731
        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            conn.read_only = True
            rows = conn.execute('SELECT * FROM "LiteLLM_VerificationToken" WHERE "token" = %s', (token,)).fetchall()
            if len(rows) != 1:
                return None
            state = {"key": norm(rows[0]), "object_permission": None, "budget": None}
            if state["key"].get("object_permission_id"):
                perm = conn.execute('SELECT * FROM "LiteLLM_ObjectPermissionTable" WHERE "object_permission_id" = %s',
                                    (state["key"]["object_permission_id"],)).fetchone()
                state["object_permission"] = None if perm is None else norm(perm)
            if state["key"].get("budget_id"):
                budget = conn.execute('SELECT * FROM "LiteLLM_BudgetTable" WHERE "budget_id" = %s',
                                      (state["key"]["budget_id"],)).fetchone()
                state["budget"] = None if budget is None else norm(budget)
            conn.rollback()
            return state

    def catalog(key):
        status, body = api("GET", "/v1/models", key=key)
        if status != 200 or not isinstance(body, dict):
            return status, None
        return status, sorted(item.get("id") for item in body.get("data", []))

    ns = {"__name__": "s5_audit"}
    with open("/tmp/s5_audit.py", encoding="utf-8") as handle:
        exec(compile(handle.read(), "s5_db_readonly_audit.py", "exec"), ns)  # noqa: S102 - pinned, hash-checked

    def audit(key):
        """S5-R1 auditor (R2A) on the real lab DB; returns its classification dict."""
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
        return api("GET", "/health/liveliness")[0] == 200

    def pick(d, *keys):
        return json.dumps({k: d.get(k) for k in keys})

    check("LITELLM_HEALTH_BEFORE", health())

    # ---- R2C-01: schema discovery and classification -----------------------------------------------
    if fault == "unknown_column":
        lab_write('ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN "s5r2c_unknown_grant" text')
        lab_write('ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN "s5r2c_unknown_grant" text[]')
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.read_only = True
        key_cols, perm_cols = columns(conn, "LiteLLM_VerificationToken"), columns(conn, "LiteLLM_ObjectPermissionTable")
        conn.rollback()
    unknown, missing = classify_columns(key_cols, KEY_KNOWN)
    check("SCHEMA_KEY_COLUMNS_ALL_CLASSIFIED", key_cols and not unknown and not missing,
          f"{len(key_cols)} columns; unknown={','.join(unknown) or 'none'}; missing={','.join(missing) or 'none'}")
    unknown, missing = classify_columns(perm_cols, OBJPERM_KNOWN)
    check("SCHEMA_OBJPERM_COLUMNS_ALL_CLASSIFIED", perm_cols and not unknown and not missing,
          f"{len(perm_cols)} columns; unknown={','.join(unknown) or 'none'}; missing={','.join(missing) or 'none'}")
    critical = set(ns["KEY_COLUMNS"]) | set(ns["OPTIONAL_INDIRECTION_COLUMNS"]) | {"agent_id"}
    uncovered = sorted(critical - {"token"} - set(KEY_COMPARED))
    check("AUDITOR_POLICY_COLUMNS_COMPARED", not uncovered, f"{len(critical)} auditor/indirection columns; uncovered={','.join(uncovered) or 'none'}")
    print("S5R2C INFO R2B_COMPARATOR_GAP=" + ",".join(sorted(critical - {"token"} - set(LEGACY_COMPARED))))
    if not RESULTS[-1][1] or not RESULTS[-2][1] or not RESULTS[-3][1]:
        return report()  # unknown mechanism: never continue as if the schema were understood

    # ---- keys: A carries every settable indirection; B only an object permission; C none -------------
    st, _ = api("POST", "/budget/new", {"budget_id": "bud-s5r2c-synthetic", "max_budget": 5.0})
    check("GENERATE_SYNTHETIC_BUDGET_HTTP_200", st == 200, f"status {st}")
    base = {"models": ["all-proxy-models"], "allowed_routes": ["llm_api_routes"]}
    rich = dict(base, key_alias="newsflux-synthetic-rich", budget_id="bud-s5r2c-synthetic",
                access_group_ids=["ag-synthetic"], agent_id="agent-synthetic", metadata={"synthetic": 1},
                permissions={"synthetic": 1}, object_permission={"vector_stores": ["vs-synthetic"], "mcp_servers": ["mcp-synthetic"]})
    st, body = api("POST", "/key/generate", dict(rich, policies=["pol-synthetic"]))
    message = json.dumps(body) if body is not None else ""
    policies_lab = "SETTABLE" if st == 200 else ("ENTERPRISE_GATED" if st == 403 and "Enterprise" in message else f"REFUSED_{st}")
    print(f"S5R2C INFO POLICIES_IN_LAB={policies_lab} (compared as a column in every case)")
    if st != 200:
        st, body = api("POST", "/key/generate", rich)
    check("GENERATE_RICH_KEY_HTTP_200", st == 200 and isinstance(body, dict) and body.get("key"), f"status {st}")
    st2, body2 = api("POST", "/key/generate", dict(base, key_alias="newsflux-synthetic-objperm",
                                                   object_permission={"vector_stores": ["vs-synthetic"], "mcp_servers": ["mcp-synthetic"]}))
    st3, body3 = api("POST", "/key/generate", dict(base, key_alias="newsflux-synthetic-control"))
    check("GENERATE_OBJPERM_AND_CONTROL_KEYS_HTTP_200", st2 == 200 and st3 == 200, f"status {st2},{st3}")
    if not all(isinstance(b, dict) and b.get("key") for b in (body, body2, body3)):
        return report()
    key, objperm_key, control = body["key"], body2["key"], body3["key"]

    pre = snapshot(key)
    check("PRESTATE_READ", pre is not None)
    if pre is None:
        return report()
    k = pre["key"]
    check("PRESTATE_SHAPE", k["models"] == ["all-proxy-models"] and k["rpm_limit"] is None and k["tpm_limit"] is None
          and k["max_budget"] is None and k["budget_duration"] is None and k["budget_reset_at"] is None)
    check("PRESTATE_INDIRECTIONS_NONNULL", k["budget_id"] and k["access_group_ids"] and k["agent_id"]
          and k["object_permission_id"] and pre["object_permission"] and pre["budget"],
          "budget_id, access_group_ids, agent_id, object_permission_id, linked rows")
    check("AGENT_ID_SUPPORTED_IN_LAB", "agent_id" in key_cols and k["agent_id"] == "agent-synthetic")
    pre_catalog_status, pre_catalog = catalog(key)
    check("PRESTATE_CATALOG_READ", pre_catalog_status == 200 and pre_catalog and len(pre_catalog) >= 2, f"status {pre_catalog_status}")
    audit_pre = audit(objperm_key)
    check("R2B02_PRESTATE_KEY_POLICY_GATE_FAIL", audit_pre.get("KEY_POLICY_GATE") == "FAIL"
          and audit_pre.get("KEY_SCOPE_DETAIL") == "WILDCARD", pick(audit_pre, "KEY_POLICY_GATE", "KEY_SCOPE_DETAIL"))

    # ---- target update: every column asserted ------------------------------------------------------
    sent = dict(TARGET, rpm_limit=6) if fault == "wrong_target" else dict(TARGET)
    before = dt.datetime.now(UTC)
    st, _ = api("POST", "/key/update", dict(sent, key=key))
    after = dt.datetime.now(UTC)
    check("UPDATE_TARGET_HTTP_200", st == 200, f"status {st}")
    post = snapshot(key)
    check("POST_UPDATE_READ", post is not None)
    if post is None:
        return report()
    check("SCOPE_EXACT_ALIAS", post["key"]["models"] == [ALIAS])
    for field in ("rpm_limit", "tpm_limit", "max_budget", "budget_duration"):
        check(f"TARGET_{field.upper()}", post["key"][field] == TARGET[field])
    extra = unexpected_changes(pre, post, allowed=KEY_TARGET + KEY_DERIVED)
    check("NO_INCIDENTAL_CHANGE_AFTER_UPDATE", extra == [], ",".join(extra) or f"{len(KEY_INVARIANT)} invariant columns + linked rows equal")
    check("SAME_KEY_ROW_STILL_AUTHENTICATES", catalog(key)[0] == 200)
    check("CATALOG_EXACTLY_ALIAS", catalog(key)[1] == [ALIAS])
    check("R2C04_RESET_EXACT_NEXT_MONTH_UTC", reset_ok(post["key"]["budget_reset_at"], before, after),
          f"expected {next_month_start(after).isoformat()}")

    # ---- R2B-02 contract: auditor keeps NOT_VERIFIED while OBJECT_PERMISSION is linked ---------------
    st, _ = api("POST", "/key/update", dict(TARGET, key=objperm_key))
    audit_post = audit(objperm_key)
    detail = pick(audit_post, "KEY_SCOPE", "KEY_RATE_LIMITS", "KEY_BUDGET", "KEY_INDIRECTION", "KEY_POLICY_GATE")
    check("R2B02_OTHER_KEY_GATES_PASS_AFTER_FIX", st == 200 and all(audit_post.get(g) == "PASS" for g in (
        "KEY_SCOPE", "KEY_RATE_LIMITS", "KEY_BUDGET", "KEY_VALIDITY", "KEY_ROUTES")), detail)
    check("R2B02_INDIRECTION_OBJECT_PERMISSION", audit_post.get("KEY_INDIRECTION") == "OBJECT_PERMISSION", detail)
    check("R2B02_KEY_POLICY_GATE_STAYS_NOT_VERIFIED", audit_post.get("KEY_POLICY_GATE") == "NOT_VERIFIED", detail)
    st, _ = api("POST", "/key/update", dict(TARGET, key=control))
    audit_control = audit(control)
    check("R2B02_CONTROL_WITHOUT_OBJECT_PERMISSION_PASSES", st == 200 and audit_control.get("KEY_POLICY_GATE") == "PASS"
          and audit_control.get("KEY_INDIRECTION") == "NONE", pick(audit_control, "KEY_INDIRECTION", "KEY_POLICY_GATE"))

    # ---- R2C-03: negative cases accept only the intended refusal -------------------------------------
    neg_key = "sk-synthetic-wrong-master-0000" if fault == "neg_401" else master
    st, body = api("POST", "/key/update", dict(TARGET, key="sk-synthetic-key-that-does-not-exist-0000"), key=neg_key)
    check("NEG_MISSING_KEY_REFUSED_404_NOT_FOUND", refusal_ok("missing_key", st, body), f"status {st}")
    now = snapshot(key)
    check("NEG_MISSING_KEY_LEFT_STATE", now is not None and unexpected_changes(post, now) == [])
    st, body = api("POST", "/key/update", {"key": key, "rpm_limit": "not-a-number"}, key=neg_key)
    check("NEG_INVALID_PAYLOAD_REFUSED_422_INT_PARSING", refusal_ok("invalid_payload", st, body), f"status {st}")
    now = snapshot(key)
    check("NEG_INVALID_PAYLOAD_LEFT_STATE", now is not None and unexpected_changes(post, now) == [])
    partial = {"key": key, "models": pre["key"]["models"], "tpm_limit": None, "max_budget": None, "budget_duration": None}
    st, _ = api("POST", "/key/update", partial)  # rpm omitted on purpose
    now = snapshot(key) or {"key": {}, "object_permission": None, "budget": None}
    missed = unexpected_changes(pre, now)
    check("NEG_PARTIAL_ROLLBACK_DETECTED", st == 200 and "rpm_limit" in missed, ",".join(missed))

    # ---- full rollback, compared with the structured prestate ----------------------------------------
    if fault != "skip_rollback":
        st, _ = api("POST", "/key/update", {"key": key, **{f: pre["key"][f] for f in KEY_TARGET}})
        check("ROLLBACK_HTTP_200", st == 200, f"status {st}")
    restored = snapshot(key)
    check("POST_ROLLBACK_READ", restored is not None)
    restored = restored or {"key": {}, "object_permission": None, "budget": None}
    mismatched = unexpected_changes(pre, restored)
    check("ROLLBACK_EQUALS_PRESTATE", mismatched == [],
          ",".join(mismatched) or f"{len(KEY_COMPARED)} key columns + {len(OBJPERM_KNOWN)} permission columns + budget row equal")
    check("ROLLBACK_BUDGET_RESET_AT_NULL", restored["key"].get("budget_reset_at") is None)
    check("ROLLBACK_CATALOG_EQUALS_PRESTATE", catalog(key) == (200, pre_catalog))

    # ---- R2C-01: incidental mutations; R2B comparator misses them, R2C comparator detects them --------
    perm_id = pre["key"]["object_permission_id"]
    mutations = (
        ("BUDGET_ID", ("api", {"key": key, "budget_id": None}), ("api", {"key": key, "budget_id": pre["key"]["budget_id"]})),
        ("ACCESS_GROUP_IDS", ("api", {"key": key, "access_group_ids": []}), ("api", {"key": key, "access_group_ids": pre["key"]["access_group_ids"]})),
        ("AGENT_ID", ("db", 'UPDATE "LiteLLM_VerificationToken" SET "agent_id" = NULL WHERE "token" = %s', (hashlib.sha256(key.encode()).hexdigest(),)),
         ("db", 'UPDATE "LiteLLM_VerificationToken" SET "agent_id" = %s WHERE "token" = %s', (pre["key"]["agent_id"], hashlib.sha256(key.encode()).hexdigest()))),
        ("POLICIES", ("db", 'UPDATE "LiteLLM_VerificationToken" SET "policies" = %s WHERE "token" = %s', (["pol-synthetic"], hashlib.sha256(key.encode()).hexdigest())),
         ("db", 'UPDATE "LiteLLM_VerificationToken" SET "policies" = %s WHERE "token" = %s', (pre["key"]["policies"], hashlib.sha256(key.encode()).hexdigest()))),
        ("OBJPERM_MCP_TOOLSETS", ("db", 'UPDATE "LiteLLM_ObjectPermissionTable" SET "mcp_toolsets" = %s WHERE "object_permission_id" = %s', (["ts-synthetic"], perm_id)),
         ("db", 'UPDATE "LiteLLM_ObjectPermissionTable" SET "mcp_toolsets" = %s WHERE "object_permission_id" = %s', (pre["object_permission"]["mcp_toolsets"], perm_id))),
        ("BUDGET_ROW", ("api_budget", {"budget_id": pre["key"]["budget_id"], "max_budget": 50.0}),
         ("api_budget", {"budget_id": pre["key"]["budget_id"], "max_budget": pre["budget"]["max_budget"]})),
    )

    def apply(step):
        if step[0] == "api":
            return api("POST", "/key/update", step[1])[0] == 200
        if step[0] == "api_budget":
            return api("POST", "/budget/update", step[1])[0] == 200
        lab_write(step[1], step[2])
        return True

    for name, mutate, restore in mutations:
        s0 = snapshot(key)
        applied = apply(mutate)
        s1 = snapshot(key)
        detected = unexpected_changes(s0, s1) if s0 and s1 else []
        legacy = legacy_changes(s0, s1) if s0 and s1 else ["unreadable"]
        print(f"S5R2C INFO MUTATION_{name} R2B_COMPARATOR={'DETECTED' if legacy else 'MISSED'} R2C_COMPARATOR={'DETECTED' if detected else 'MISSED'}")
        check(f"R2C01_MUTATION_{name}_DETECTED", applied and detected != [], ",".join(detected))
        restored_ok = apply(restore)
        s2 = snapshot(key)
        left = unexpected_changes(s0, s2) if s0 and s2 else ["unreadable"]
        if name == "BUDGET_ROW":
            left = [f for f in left if f != "budget_row"] + (["budget_row"] if s0 and s2 and {
                k: v for k, v in (s0["budget"] or {}).items() if k not in ("updated_at", "updated_by")} != {
                k: v for k, v in (s2["budget"] or {}).items() if k not in ("updated_at", "updated_by")} else [])
        check(f"R2C01_MUTATION_{name}_RESTORED", restored_ok and left == [], ",".join(left))
    final = snapshot(key) or {"key": {}, "object_permission": None, "budget": None}
    left = [f for f in unexpected_changes(pre, final) if f != "budget_row"]
    budget_left = {k: v for k, v in (pre["budget"] or {}).items() if k not in ("updated_at", "updated_by")} != {
        k: v for k, v in (final["budget"] or {}).items() if k not in ("updated_at", "updated_by")}
    check("FINAL_STATE_EQUALS_PRESTATE", left == [] and not budget_left, ",".join(left + (["budget_row"] if budget_left else [])))
    check("LITELLM_HEALTH_AFTER", health())
    return report()


if __name__ == "__main__":
    if sys.argv[1:2] == ["--self-test"]:
        sys.exit(self_test(sys.argv[2]))
    if sys.argv[1:2] == ["--version-gate"]:
        sys.exit(0 if version_ok(sys.argv[2], sys.argv[3]) else 1)
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""))
PY
}

absent() {
  # $1 = container|network, $2 = exact name. 0 = proven absent, 1 = present, 2 = cannot verify.
  local out
  if [[ "$1" == container ]]; then
    out="$(docker ps -a --filter "name=^/?$2\$" --format '{{.Names}}' 2>/dev/null)" || return 2
  else
    out="$(docker network ls --filter "name=^$2\$" --format '{{.Name}}' 2>/dev/null)" || return 2
  fi
  [[ -z "$out" ]] && return 0
  return 1
}

cleanup() {
  local status=0 resource state
  if [[ "$docker_used" == 1 ]] || docker info >/dev/null 2>&1; then
    for resource in "$run-litellm" "$run-pg"; do
      docker rm -f "$resource" >/dev/null 2>&1 || true   # exit 0 even when missing: absence is verified below
      absent container "$resource"; state=$?
      if [[ "$state" == 0 ]]; then echo "S5R2C CLEANUP_CONTAINER_ABSENT=PASS ($resource)"; else echo "S5R2C CLEANUP_CONTAINER_ABSENT=FAIL ($resource, state $state)"; status=1; fi
    done
    if absent network "$net"; then :; else docker network rm "$net" >/dev/null 2>&1 || status=1; fi
    if [[ "$FAULT" == cleanup ]]; then docker network rm "$run-does-not-exist" >/dev/null 2>&1 || status=1; fi
    absent network "$net"; state=$?
    if [[ "$state" == 0 ]]; then echo "S5R2C CLEANUP_NETWORK_ABSENT=PASS ($net)"; else echo "S5R2C CLEANUP_NETWORK_ABSENT=FAIL ($net, state $state)"; status=1; fi
  elif [[ "$docker_used" == 1 ]]; then
    echo "S5R2C CLEANUP_DOCKER_VERIFY=FAIL (docker unavailable after resources were created)"; status=1
  fi
  if [[ "$work_ok" == 1 ]]; then
    rm -rf -- "$work" || status=1
    if [[ -e "$work" ]]; then status=1; fi
  fi
  if [[ "$status" == 0 ]]; then echo "S5R2C CLEANUP=PASS"; else echo "S5R2C CLEANUP=FAIL"; fi
  return "$status"
}

finish() {
  local code=$?
  trap - EXIT ERR
  set +e
  if [[ "$code" != 0 ]]; then rc=1; fi
  cleanup || rc=1
  echo "S5R2C_EXIT=$rc"
  exit "$rc"
}

on_err() {
  echo "S5R2C SETUP_STEP=FAIL (line $1, exit $2)"
}

self_test() {
  local sandbox cwdbox fault out code before after failed=0
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/s5r2c-selftest.XXXXXXXX")"
  [[ -n "$sandbox" && -d "$sandbox" && ! -L "$sandbox" ]] || { echo "S5R2C SELF_TEST_SANDBOX=FAIL"; return 1; }
  # 1) Python unit tests (comparators, schema classification, HTTP refusal contract, reset, version).
  git -C "$repo" show "$AUDITOR_REV:deploy/release-governance/s5_db_readonly_audit.py" >"$sandbox/s5_audit.py"
  write_probe "$sandbox/probe.py"
  if python3 -B "$sandbox/probe.py" --self-test "$sandbox/s5_audit.py"; then :; else echo "S5R2C PY_SELF_TEST=FAIL"; failed=1; fi
  rm -f -- "$sandbox/s5_audit.py" "$sandbox/probe.py"
  # 2) R2C-02: setup failures must exit non-zero before any container and write nothing outside the workspace.
  before="$(git -C "$repo" status --porcelain=v1 --untracked-files=all | sha256sum)"
  for fault in setup_mktemp setup_write setup_chmod; do
    mkdir "$sandbox/tmp-$fault" "$sandbox/cwd-$fault"
    cwdbox="$sandbox/cwd-$fault"
    out="$(cd "$cwdbox" && TMPDIR="$sandbox/tmp-$fault" S5R2C_FAULT="$fault" S5R2C_RUN_ID="s5r2c-selftest-${fault//_/-}" \
      bash "$self" 2>&1)" && code=0 || code=$?
    after="$(git -C "$repo" status --porcelain=v1 --untracked-files=all | sha256sum)"
    local stray=0 path
    for path in /config.yaml /probe.py /s5_audit.py "$repo/config.yaml" "$repo/probe.py" "$repo/s5_audit.py"; do
      if [[ -e "$path" ]]; then stray=1; fi
    done
    local leftovers containers=0 networks=0
    leftovers="$(find "$sandbox/tmp-$fault" "$cwdbox" -mindepth 1 | wc -l)"
    if docker info >/dev/null 2>&1; then
      containers="$(docker ps -a --filter "name=s5r2c-selftest-${fault//_/-}" -q | wc -l)"
      networks="$(docker network ls --filter "name=s5r2c-selftest-${fault//_/-}" -q | wc -l)"
    fi
    if [[ "$code" != 0 ]] && grep -q 'SETUP_STEP=FAIL' <<<"$out" && grep -q 'S5R2C CLEANUP=PASS' <<<"$out" \
       && ! grep -q 'LAB_' <<<"$out" && [[ "$leftovers" == 0 && "$stray" == 0 && "$before" == "$after" \
       && "$containers" == 0 && "$networks" == 0 ]]; then
      echo "S5R2C R2C02_${fault^^}=PASS (exit $code, no container/network, workspace removed, no stray writes)"
    else
      echo "S5R2C R2C02_${fault^^}=FAIL (exit $code, leftovers $leftovers, stray $stray, containers $containers, networks $networks)"
      printf '%s\n' "$out" | sed 's/^/    /'
      failed=1
    fi
  done
  rm -rf -- "$sandbox"
  if [[ "$failed" == 0 ]]; then echo "S5R2C_SELF_TEST=PASS"; else echo "S5R2C_SELF_TEST=FAIL"; fi
  return "$failed"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit $?
fi

trap 'on_err "$LINENO" "$?"' ERR
trap finish EXIT

# ---- R2C-02: disposable workspace, validated before anything is written ------------------------------
tmp_base="${TMPDIR:-/tmp}"
if [[ "$FAULT" == setup_mktemp ]]; then tmp_base="$tmp_base/does-not-exist"; fi
work="$(mktemp -d "$tmp_base/s5r2c.XXXXXXXX")"
if [[ -z "$work" || ! -d "$work" || -L "$work" || "$work" != "$tmp_base"/s5r2c.* ]]; then
  echo "S5R2C SETUP_STEP=FAIL (workspace not validated)"
  exit 1
fi
work_ok=1

auditor="$work/s5_audit.py"
git -C "$repo" show "$AUDITOR_REV:deploy/release-governance/s5_db_readonly_audit.py" >"$auditor"
if [[ "$(sha256sum "$auditor" | cut -d' ' -f1)" != "$AUDITOR_SHA256" ]]; then
  echo "S5R2C AUDITOR_PINNED_SOURCE=FAIL (hash mismatch)"
  exit 1
fi
echo "S5R2C AUDITOR_PINNED_SOURCE=PASS"

cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: hosted_vllm/synthetic-s5, api_base: "https://s5.invalid/v1", api_key: synthetic}
  - model_name: other-model
    litellm_params: {model: openai/synthetic-other, api_base: "https://other.invalid/v1", api_key: synthetic}
YAML
if [[ "$FAULT" == setup_chmod ]]; then mv -- "$work/config.yaml" "$work/config.moved"; ln -s "$work/missing" "$work/config.yaml"; fi
chmod 0644 "$work/config.yaml"
if [[ "$FAULT" == setup_write ]]; then mkdir -- "$work/probe.py"; fi
write_probe "$work/probe.py"
if [[ "$(stat -c '%a' "$work/config.yaml")" != 644 || "$(stat -c '%a' "$work/probe.py")" != 644 ]]; then
  echo "S5R2C SETUP_STEP=FAIL (file modes)"
  exit 1
fi
MASTER="sk-synthetic-master-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# ---- R2C-04: provenance is mandatory; distinguish manifest digest, local image ID, package version ----
manifest_digest="${LITELLM_IMAGE##*@}"
if [[ "$LITELLM_IMAGE" == "$DEFAULT_LITELLM_IMAGE" ]]; then
  expected_version="$DEFAULT_LITELLM_VERSION"
else
  expected_version="${S5R2C_EXPECTED_LITELLM_VERSION:-}"
fi
if [[ "$LITELLM_IMAGE" != *@sha256:* || ! "$manifest_digest" =~ ^sha256:[0-9a-f]{64}$ || -z "$expected_version" ]]; then
  echo "S5R2C LAB_IMAGE_PINNED=FAIL (reference must be pinned by digest; a non-default image needs S5R2C_EXPECTED_LITELLM_VERSION)"
  exit 1
fi
echo "S5R2C LAB_IMAGE_PINNED=PASS"

docker_used=1
docker network create "$net" >/dev/null
docker run -d --name "$run-pg" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE" >/dev/null
ready=0
for _ in $(seq 1 30); do
  if docker exec "$run-pg" pg_isready -q -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then echo "S5R2C SETUP_STEP=FAIL (postgres not ready)"; exit 1; fi
docker run -d --name "$run-litellm" --network "$net" -e LITELLM_MASTER_KEY="$MASTER" -e LITELLM_LOCAL_MODEL_COST_MAP=True \
  -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" -v "$work/config.yaml:/app/config.yaml:ro" \
  "$LITELLM_IMAGE" --config /app/config.yaml --port 4000 >/dev/null
ready=0
for _ in $(seq 1 120); do
  if docker exec "$run-litellm" python3 -B -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then echo "S5R2C SETUP_STEP=FAIL (litellm not ready)"; exit 1; fi

local_image_id="$(docker image inspect --format '{{.Id}}' "$LITELLM_IMAGE")"
repo_digests="$(docker image inspect --format '{{join .RepoDigests " "}}' "$LITELLM_IMAGE")"
container_image_id="$(docker inspect --format '{{.Image}}' "$run-litellm")"
version="$(docker exec "$run-litellm" python3 -B -c 'import importlib.metadata as m; print(m.version("litellm"))' 2>/dev/null)" || version=""
echo "S5R2C INFO LAB_MANIFEST_DIGEST=$manifest_digest (registry manifest digest from the pinned reference)"
echo "S5R2C INFO LAB_LOCAL_IMAGE_ID=$local_image_id (local Docker image ID; a different identifier type)"
echo "S5R2C INFO LAB_LITELLM_PACKAGE_VERSION=${version:-UNAVAILABLE} (expected $expected_version)"
echo "S5R2C INFO PRODUCTION_PARITY=UNVERIFIED (no production identifier is compared by this lab)"
prov_ok=1
if [[ " $repo_digests " == *"@$manifest_digest "* ]]; then echo "S5R2C LAB_REPO_DIGEST_MATCHES_PIN=PASS"; else echo "S5R2C LAB_REPO_DIGEST_MATCHES_PIN=FAIL"; prov_ok=0; fi
if [[ -n "$local_image_id" && "$container_image_id" == "$local_image_id" ]]; then echo "S5R2C LAB_CONTAINER_RUNS_PINNED_IMAGE=PASS"; else echo "S5R2C LAB_CONTAINER_RUNS_PINNED_IMAGE=FAIL"; prov_ok=0; fi
if python3 -B "$work/probe.py" --version-gate "$version" "$expected_version"; then echo "S5R2C LAB_LITELLM_VERSION_APPROVED=PASS"; else echo "S5R2C LAB_LITELLM_VERSION_APPROVED=FAIL"; prov_ok=0; fi
if [[ "$prov_ok" != 1 ]]; then exit 1; fi

docker cp "$work/probe.py" "$run-litellm:/tmp/probe.py" >/dev/null
docker cp "$auditor" "$run-litellm:/tmp/s5_audit.py" >/dev/null
docker exec -i "$run-litellm" python3 -B /tmp/probe.py "$MASTER" "$FAULT" || rc=1
