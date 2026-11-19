#!/usr/bin/env bash
# NEWSFLUX-AI-SETTINGS-01 R4.4 — Summary admin allowlist via the EXISTING governed release tool.
#
# No production file is edited. The allowlist is a release-owned, configuration-only Compose override
# (one key) applied with deploy/release-governance/release.py from main (lock, manifest, drift and
# protected-container checks, Summary-only recreate with the pinned image ID, automatic rollback).
# Rollback = release.py rollback: an idempotent recreate from the untouched base Compose files.
#
#   R44_MODE=readonly  (default) runtime trust, current state, owner identity (/v1/me), optional admin list
#   R44_MODE=apply     R44_ADMIN_ID=<id>   readonly checks + owner phrase + plan + promote + verify + Gate D
#   R44_MODE=rollback  R44_RELEASE_ID=<id> restore the pre-change Summary (idempotent)
#
# Required: R44_EXPECT_IMAGE (running Summary image ID), R44_EXPECT_REVISION (its approved commit).
# Owner input (key, consent, phrase) is read from fd 3 if open, else from /dev/tty; never echoed or stored.
# Output: KEY=VALUE lines only, no paths, URLs, usernames, keys or env values.
# Exit: 0 PASS/APPLIED; 3 HOLD (nothing changed); 4 owner decision required; 5 failed and rolled back
# (release.py); 6 state needs supervised recovery (run R44_MODE=rollback).
set -u
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
git() { command git -c safe.directory="$REPO" "$@"; }   # the operator's clone is not owned by root
MODE="${R44_MODE:-readonly}"
PROJECT=newsflux; SERVICE=summary-api
PROTECTED=(miniflux miniflux-db npm newsflux)
RELEASE_ROOT="${R44_RELEASE_ROOT:-/root/newsflux-releases}"
LOCK="${R44_LOCK:-/run/lock/newsflux-release.lock}"
MAIN_SHA=d54eda2bdb8bc5c3d1bd58d40236f48da762e852
PIN_RELEASE_PY=8398393447d1cca817058df0aad0e09952612ffcff29817fe29cd4257133c859
PIN_POLICY=c448295e73c2c997745da2ccb1bd067dff2e516c3129d5773be9ef379327693b
PREFLIGHT_SHA=4c3e07529d706ffc37115aa8de808f36cccdc244
PIN_PREFLIGHT=86670b2c9810e851d4d976a38b5a91c6060d351d0cd355edf3e44f093391f196
PIN_BASELINE=7e7ff3a4399a96efdc67652f48d9f664e759b97e340eb59db564207916dc259d
PIN_CADDY=56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
WALLHOP_EXPECTED=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
KEY=NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS

out() { printf '%s=%s\n' "$1" "$2"; }
finish() { out R44_RESULT "$1"; out SECRET_PRINTED NO; exit "$2"; }
hold() { out "$1" "$2"; finish "${3:-HOLD_NO_CHANGE}" 3; }
{ true <&3; } 2>/dev/null || exec 3</dev/tty
ask() { local v; printf '%s' "$1" >&2; if [ "${2:-}" = secret ]; then IFS= read -rs v <&3; else IFS= read -r v <&3; fi; echo >&2; printf '%s' "$v"; }
sha() { sha256sum "$1" 2>/dev/null | cut -c1-64; }

out R44_MODE "$(printf %s "$MODE" | tr a-z A-Z)"
case "$MODE" in readonly|apply|rollback) ;; *) hold R44_MODE UNKNOWN ;; esac
[ "$(id -u)" = 0 ] || hold RUN_AS_ROOT NO
[[ "${R44_EXPECT_IMAGE:-}" =~ ^sha256:[0-9a-f]{64}$ && "${R44_EXPECT_REVISION:-}" =~ ^[0-9a-f]{40}$ ]] || hold RUNTIME_EXPECTATIONS MISSING
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null || hold HOST_PYTHON UNSUPPORTED

# ---------------------------------------------------------------- pinned tools (existing code, verified)
D="$(mktemp -d)"; trap 'rm -rf -- "$D"' EXIT
git -C "$REPO" show "$MAIN_SHA:deploy/release-governance/release.py" >"$D/release.py" 2>/dev/null
git -C "$REPO" show "$MAIN_SHA:deploy/release-governance/policy.json" >"$D/policy.json" 2>/dev/null
mkdir -p "$D/pf" && git -C "$REPO" archive "$PREFLIGHT_SHA" deploy 2>/dev/null | tar -x -C "$D/pf" 2>/dev/null
PF="$D/pf/deploy/release-governance"
[ "$(sha "$D/release.py")" = "$PIN_RELEASE_PY" ] && [ "$(sha "$D/policy.json")" = "$PIN_POLICY" ] \
  && [ "$(sha "$PF/ai-settings-readonly-preflight.sh")" = "$PIN_PREFLIGHT" ] \
  && [ "$(sha "$PF/ai-settings-flag-baseline.json")" = "$PIN_BASELINE" ] \
  && [ "$(sha "$D/pf/deploy/article-intel-pilot/Caddyfile")" = "$PIN_CADDY" ] || hold TOOL_PINS MISMATCH
out TOOL_PINS PASS
release() { # release.py in its own session: a terminal Ctrl+C or ssh hangup never reaches it or its docker children
  setsid -w python3 -I "$D/release.py" --policy "$D/policy.json" --lock "$LOCK" "$@" </dev/null 2>"$D/release.err"
}

# ---------------------------------------------------------------- runtime trust before any secret
summary_id() { docker ps -q --no-trunc --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$SERVICE"; }
CID="$(summary_id)"; [ "$(wc -w <<<"$CID")" = 1 ] || hold SUMMARY_CONTAINER NOT_UNIQUE_OR_NOT_RUNNING
IMG="$(docker inspect -f '{{.Image}}' "$CID")"
REV="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMG" 2>/dev/null)"
HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CID")"
CODE_DRIFT="$(docker diff "$CID" 2>/dev/null | grep -cE '^[ACD] /(app|usr|etc/ssl)(/|$)')"
[ "$IMG" = "$R44_EXPECT_IMAGE" ] || hold RUNTIME_IMAGE MISMATCH
[ "$REV" = "$R44_EXPECT_REVISION" ] || hold RUNTIME_REVISION MISMATCH
[ "$HEALTH" = healthy ] || hold SUMMARY_HEALTH "$(printf %s "${HEALTH:-none}" | tr a-z A-Z)"
[ "$CODE_DRIFT" = 0 ] || hold RUNTIME_CODE_DRIFT DETECTED
out RUNTIME_TRUST PASS
allowlist_state() { # effective allowlist as the Summary's own settings parse it (state:count:ids)
  docker exec "$1" python -I -c 'import sys; sys.path.insert(0, "/app")
from services.article_intel_auth.config import AuthSettings
s = AuthSettings.from_env(); print("%s:%d:%s" % (s.admin_allowlist_state, len(s.admin_user_ids), ",".join(map(str, sorted(s.admin_user_ids)))))' 2>/dev/null
}

# ---------------------------------------------------------------- rollback (idempotent, existing tool)
if [ "$MODE" = rollback ]; then
  [[ "${R44_RELEASE_ID:-}" =~ ^r44-allowlist-[0-9]{8}T[0-9]{6}Z$ ]] || hold R44_RELEASE_ID INVALID
  M="$RELEASE_ROOT/$R44_RELEASE_ID/manifest.json"; [ -f "$M" ] || hold RELEASE_MANIFEST ABSENT
  [ "$(ask "Type ROLLBACK-R44 to restore the pre-change Summary: ")" = ROLLBACK-R44 ] || hold ROLLBACK_AUTHORIZED NO
  trap '' INT TERM HUP
  r="$(release rollback --manifest "$M" --timeout 180)"; rc=$?
  if [ "$rc" = 0 ]; then out ROLLBACK "$(sed -n 's/^ROLLBACK=\([A-Z_]*\).*/\1/p' <<<"$r")"
  else out ROLLBACK "BLOCKED_$(sed -n 's/.*CODE=\([A-Z0-9_:]*\).*/\1/p' <<<"$r")"; fi
  st="$(allowlist_state "$(summary_id)")"; out ADMIN_ALLOWLIST_AFTER "$(cut -d: -f1 <<<"$st" | tr a-z A-Z)"
  [ "$rc" = 0 ] && finish ROLLED_BACK_VERIFIED 0
  finish ROLLBACK_INCOMPLETE 6
fi

# ---------------------------------------------------------------- read-only state and owner identity
ST="$(allowlist_state "$CID")"; out ADMIN_ALLOWLIST_STATE "$(cut -d: -f1 <<<"$ST" | tr a-z A-Z)"
KEYV="$(ask "Miniflux API key of the NewsFlux owner (hidden, never stored): " secret)"
[[ "$KEYV" =~ ^[!-~]{1,4096}$ ]] || hold API_KEY_INPUT INVALID_FORMAT
CONSENT=0; [ "$(ask "List Miniflux admin IDs to detect other admins? Type LIST-ADMIN-IDS or press Enter: ")" = LIST-ADMIN-IDS ] && CONSENT=1
PROBE='import json, sys; sys.path.insert(0, "/app")
from services.article_intel_auth.auth import MinifluxAuthService, MAX_IDENTITY_RESPONSE_BYTES
from services.article_intel_auth.config import AuthSettings
from services.article_intel_auth.errors import AuthError
key = sys.stdin.readline().strip(); consent = sys.stdin.readline().strip() == "1"; r = {}
svc = MinifluxAuthService(AuthSettings.from_env())
try:
    me = svc._get_json("/v1/me", key, max_bytes=MAX_IDENTITY_RESPONSE_BYTES)
    ok = isinstance(me, dict) and type(me.get("id")) is int and me["id"] > 0 and type(me.get("is_admin")) is bool
    r["me"] = [me["id"], me["is_admin"]] if ok else None
    if ok and consent and me["is_admin"]:
        users = svc._get_json("/v1/users", key, max_bytes=4 << 20)
        r["admins"] = sorted(u["id"] for u in users if isinstance(u, dict) and u.get("is_admin") is True and type(u.get("id")) is int)
except AuthError as exc:
    r["error"] = exc.code
print(json.dumps(r))'
J="$(printf '%s\n%s\n' "$KEYV" "$CONSENT" | docker exec -i "$CID" python -I -c "$PROBE" 2>/dev/null | tail -n1)"; unset KEYV
read -r ME_ID ME_ADMIN ADMINS ERRC < <(python3 -I -c 'import json, sys
try: r = json.loads(sys.argv[1])
except ValueError: r = {"error": "probe_failed"}
me = r.get("me") or [0, False]; a = r.get("admins")
print(me[0], "YES" if me[1] else "NO", ",".join(map(str, a)) if a is not None else "-", str(r.get("error", "-")).upper())' "$J")
[ "$ERRC" = - ] || hold ME_LOOKUP "$ERRC"
[ "$ME_ID" != 0 ] || hold ME_LOOKUP INVALID_RESPONSE
out ADMIN_ID_CANDIDATE "$ME_ID"; out MINIFLUX_IS_ADMIN "$ME_ADMIN"
[ "$ME_ADMIN" = YES ] || hold OWNER_SELECTION CALLER_NOT_MINIFLUX_ADMIN
if [ "$CONSENT" = 1 ]; then out ADMIN_IDS "${ADMINS:-NONE}"; fi
if [ "$CONSENT" = 1 ] && [ "$ADMINS" = "$ME_ID" ]; then SEL=SINGLE_ADMIN_IS_CALLER
elif [ "$CONSENT" = 1 ]; then SEL=OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS
else SEL=OWNER_DECISION_REQUIRED_ENUMERATION_DECLINED; fi
out OWNER_SELECTION "$SEL"
if [ "$MODE" = readonly ]; then
  out WRITES_PERFORMED NO
  [ "$SEL" = SINGLE_ADMIN_IS_CALLER ] && finish READ_ONLY_PASS 0
  finish OWNER_DECISION_REQUIRED 4
fi

# ---------------------------------------------------------------- apply (specific production GO)
[[ "${R44_ADMIN_ID:-}" =~ ^[1-9][0-9]{0,18}$ ]] || hold R44_ADMIN_ID INVALID
[ "$R44_ADMIN_ID" = "$ME_ID" ] || hold ADMIN_ID_VERIFIED MISMATCH_WITH_LIVE_IDENTITY
case "$(cut -d: -f1 <<<"$ST")" in missing|empty) ;; *) hold ADMIN_ALLOWLIST_STATE NOT_EMPTY ;; esac
[ "$(ask "Set the Summary admin allowlist to $ME_ID (Summary-only recreate). Type APPLY-R44-ADMIN-$ME_ID: ")" = "APPLY-R44-ADMIN-$ME_ID" ] \
  || hold CONFIG_CHANGE_AUTHORIZED NO
REL="r44-allowlist-$(date -u +%Y%m%dT%H%M%SZ)"; RD="$RELEASE_ROOT/$REL"
mkdir -p -m 700 "$RELEASE_ROOT" && mkdir -m 700 "$RD" || hold RELEASE_DIR UNAVAILABLE
printf '{"services":{"%s":{"environment":{"%s":"%s"}}}}\n' "$SERVICE" "$KEY" "$ME_ID" >"$RD/allowlist.override.json"
PROT=(); for p in "${PROTECTED[@]}"; do PROT+=(--protected "$p"); done
r="$(release plan --project "$PROJECT" --service "$SERVICE" --candidate-image "$IMG" --approved-sha "$REV" \
  "${PROT[@]}" --release-dir "$RD" --extra-override "$RD/allowlist.override.json")"
grep -q '^PLAN=PASS' <<<"$r" || hold PLAN "BLOCKED_$(sed -n 's/.*CODE=\([A-Z0-9_:]*\).*/\1/p' <<<"$r")"
out PLAN PASS; out RELEASE_ID "$REL"; out MANIFEST_SHA256 "$(sed -n 's/.*MANIFEST_SHA256=\([0-9a-f]*\).*/\1/p' <<<"$r")"
label() { docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}} {{.Image}}' "$1" 2>/dev/null; }
L0="$(label "$CID")"
trap '' INT TERM HUP   # critical section: bounded by release.py timeouts; SIGKILL/power loss -> R44_MODE=rollback
r="$(release promote --manifest "$RD/manifest.json" --timeout 180)"; rc=$?
code="$(sed -n 's/.*CODE=\([A-Z0-9_:]*\).*/\1/p' <<<"$r")"
if [ "$rc" != 0 ]; then
  out PROMOTE "BLOCKED_${code:-UNKNOWN}"
  case "$code" in PROMOTION_FAILED_ROLLED_BACK*) finish ROLLED_BACK_VERIFIED 5 ;; esac
  # Anything else: "nothing changed" only if the live Summary is provably the original one.
  NOW="$(summary_id)"
  if [ "$NOW" = "$CID" ] && [ "$(label "$NOW")" = "$L0" ]; then finish HOLD_NO_CHANGE 3; fi
  out ROLLBACK_RELEASE_ID "$REL"
  finish SUPERVISED_RECOVERY_REQUIRED 6
fi
out PROMOTE APPLIED
NEW="$(summary_id)"; ST="$(allowlist_state "$NEW")"
if [ "$ST" = "configured:1:$ME_ID" ]; then out EFFECTIVE_ADMIN_ALLOWLIST CONFIGURED_COUNT_1; else
  out EFFECTIVE_ADMIN_ALLOWLIST MISMATCH
  r="$(release rollback --manifest "$RD/manifest.json" --timeout 180)" && finish ROLLED_BACK_VERIFIED 5
  finish SUPERVISED_RECOVERY_REQUIRED 6
fi
trap - INT TERM HUP
# Gate D: the pinned #265 read-only preflight, reported (not auto-acted on) for the PM decision.
pf="$(NEWSFLUX_PROTECTED_CONTAINERS="miniflux miniflux-db npm" NEWSFLUX_WALLHOP_EXPECTED_SHA256="$WALLHOP_EXPECTED" \
  bash "$PF/ai-settings-readonly-preflight.sh" 2>/dev/null)"; prc=$?
grep -E '^(ADMIN_ALLOWLIST|HOLD_COUNT|PREFLIGHT|WRITES_PERFORMED|WALLHOP_INTEGRITY)=' <<<"$pf" | sed 's/^/GATE_D_/'
sed -nE 's/^PROTECTED_([A-Za-z0-9_.-]+)=(RUNNING|ABSENT|NOT_RUNNING)( .*)?$/\1 \2/p' <<<"$pf" | while read -r n s; do
  out "GATE_D_PROTECTED_$(printf %s "$n" | tr 'a-z.-' 'A-Z__')_STATUS" "$s"; done
out GATE_D_PREFLIGHT_EXIT "$prc"
out ROLLBACK_RELEASE_ID "$REL"
[ "$prc" = 0 ] && finish APPLIED_VERIFIED_GATE_D_PASS 0
finish APPLIED_VERIFIED_GATE_D_HOLD 0   # applied and verified; Gate D needs PM review (rollback ready)
