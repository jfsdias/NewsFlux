#!/usr/bin/env bash
# R12F-09 end-to-end rehearsal with the REAL release tool and REAL Summary images, in a disposable
# `newsflux` project whose summary-api spans SEVEN ordered Compose files (the last one pinning the
# running image, like the R12F-06 override), with protected `miniflux` and `miniflux-db`.
#   1. previous  = 2dab359 built from a umask-022 checkout (healthy, like production today)
#   2. broken    = 2dab359 built from a umask-077 checkout (what the operator script built)
#   3. fixed     = FIX commit built from a umask-077 checkout
# Expected: broken → PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED, forensic file with exit code 1 and
# PermissionError captured before rollback, exact config-hash restored; fixed → APPLIED, then exact
# rollback, then re-promotion.  Set NEWSFLUX_TEST_PIP_CA in TLS-inspecting sandboxes (see test-r12f09).
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(git -C "$here" rev-parse --show-toplevel)"
BROKEN_SHA=2dab359356a4a9c26627b1285fdebd46f2c7be7c
FIX_SHA="$(git -C "$repo" rev-parse HEAD)"
for name in newsflux-summary-api-1 miniflux miniflux-db; do
  docker inspect "$name" >/dev/null 2>&1 && { echo "R12F09_REHEARSAL=REFUSED (container $name exists)"; exit 1; }
done
work="$(mktemp -d /tmp/r12f09-rel.XXXXXX)"; chmod 755 "$work"
pass=0; fail=0
ok() { echo "R12F09_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "R12F09_GATE $1=FAIL"; fail=$((fail + 1)); }
compose=(docker compose -p newsflux --project-directory "$work/stack")
cleanup() {
  "${compose[@]}" $(for f in "$work"/stack/[0-9]*.yaml; do printf -- '-f %s ' "$f"; done) down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f miniflux miniflux-db >/dev/null 2>&1 || true
  docker image rm -f r12f09:previous r12f09:broken r12f09:fixed >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

build() { # tag sha umask
  local dir="$work/src-$1"
  (
    umask "$3"
    git init -q --bare "$dir.git"
    git -C "$dir.git" fetch -q --depth=1 "file://$repo" "$2:refs/heads/main"
    git clone -q --no-checkout "file://$dir.git" "$dir"
    git -C "$dir" -c advice.detachedHead=false checkout -q --force "$2"
  )
  local dockerfile="$dir/services/article_intel_summary/Dockerfile" args=()
  if [[ -n "${NEWSFLUX_TEST_PIP_CA:-}" ]]; then
    cp "$NEWSFLUX_TEST_PIP_CA" "$dir/.pip-ca.pem"
    python3 - "$dockerfile" "$dir/Dockerfile.sandbox" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r"^FROM (\S+)@sha256:\S+", r"FROM \1", s, count=1, flags=re.M)
s = s.replace("RUN pip install", "COPY .pip-ca.pem /tmp/ca.pem\nARG HTTPS_PROXY\nRUN PIP_CERT=/tmp/ca.pem pip install", 1)
open(sys.argv[2], "w").write(s)
PY
    dockerfile="$dir/Dockerfile.sandbox"; args=(--network host --build-arg "HTTPS_PROXY=${HTTPS_PROXY:-}")
  fi
  docker build -q "${args[@]}" -f "$dockerfile" --build-arg SOURCE_COMMIT="$2" -t "r12f09:$1" "$dir" >/dev/null
  docker image inspect -f '{{.Id}}' "r12f09:$1"
}
PREVIOUS="$(build previous "$BROKEN_SHA" 022)"
BROKEN="$(build broken "$BROKEN_SHA" 077)"
FIXED="$(build fixed "$FIX_SHA" 077)"

# ---- seven ordered Compose files, production-shaped -------------------------------------------
mkdir -p "$work/stack" "$work/ledger" "$work/releases"
chown 10001:10001 "$work/ledger" 2>/dev/null || chmod 777 "$work/ledger"
printf 'synthetic-virtual-key-000000000000\n' >"$work/key"; chown 10001:10001 "$work/key" 2>/dev/null || true; chmod 600 "$work/key"
cat >"$work/stack/1-base.yaml" <<Y
services:
  summary-api:
    image: r12f09:previous
    restart: unless-stopped
    networks: [summary_private]
networks:
  summary_private: { internal: true }
Y
printf 'services:\n  summary-api:\n    environment:\n      NEWSFLUX_AI_MINIFLUX_BASE_URL: https://miniflux.invalid\n      NEWSFLUX_AI_ALLOWED_WEB_ORIGINS: https://newsflux.invalid\n' >"$work/stack/2-auth.yaml"
printf 'services:\n  summary-api:\n    environment:\n      NEWSFLUX_AI_INFERENCE_ENABLED: "false"\n      NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER: "false"\n      NEWSFLUX_AI_ALLOW_PAID_INFERENCE: "false"\n      NEWSFLUX_AI_LITELLM_MODEL_CHOICE: s5-free\n' >"$work/stack/3-policy.yaml"
printf 'services:\n  summary-api:\n    volumes: ["%s:/data"]\n    environment:\n      NEWSFLUX_AI_USAGE_DATABASE_PATH: /data/usage.sqlite3\n' "$work/ledger" >"$work/stack/4-ledger.yaml"
printf 'services:\n  summary-api:\n    volumes: ["%s:/run/secrets/litellm-virtual-key:ro"]\n    environment:\n      NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE: /run/secrets/litellm-virtual-key\n' "$work/key" >"$work/stack/5-secret.yaml"
printf 'services:\n  summary-api:\n    environment:\n      NEWSFLUX_AI_LITELLM_PRIVATE_DOCKER_PEER: npm\n      NEWSFLUX_AI_LITELLM_BASE_URL: https://litellm.invalid\n' >"$work/stack/6-gateway.yaml"
printf 'services:\n  summary-api:\n    image: %s\n' "$PREVIOUS" >"$work/stack/7-candidate.override.yaml"
files=(); for f in "$work"/stack/[0-9]*.yaml; do files+=(-f "$f"); done
docker run -d --name miniflux busybox:1.36.1 sleep 3600 >/dev/null
docker run -d --name miniflux-db busybox:1.36.1 sleep 3600 >/dev/null
"${compose[@]}" "${files[@]}" up -d --wait >/dev/null
before_hash="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-summary-api-1)"
before_files="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' newsflux-summary-api-1)"
protected="$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)"
[[ "$(tr ',' '\n' <<<"$before_files" | grep -c .)" == 7 ]] && ok SEVEN_COMPOSE_FILES || ko SEVEN_COMPOSE_FILES

cat >"$work/policy.json" <<J
{"version":"newsflux-release-policy-v1","allowed":[{"project":"newsflux","service":"summary-api"}]}
J
rt() { python3 "$here/release.py" --policy "$work/policy.json" --lock "$work/release.lock" "$@"; }
plan() { rt plan --project newsflux --service summary-api --candidate-image "$1" --approved-sha "$2" --protected miniflux --protected miniflux-db --release-dir "$work/releases/$3" >/dev/null; }
restored() {
  [[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}} {{index .Config.Labels "com.docker.compose.project.config_files"}}' newsflux-summary-api-1)" == "$PREVIOUS $before_hash $before_files" ]]
}

# ---- 1. reproduce the incident ------------------------------------------------------------------
plan "$BROKEN" "$BROKEN_SHA" broken
out="$(rt promote --manifest "$work/releases/broken/manifest.json" --timeout 60 2>&1 || true)"
grep -q 'CODE=PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED' <<<"$out" && ok INCIDENT_REPRODUCED_READINESS_FAILED || { echo "$out"; ko INCIDENT_REPRODUCED_READINESS_FAILED; }
diag="$(ls "$work"/releases/broken/failure-*.json 2>/dev/null | head -1)"
if [[ -n "$diag" ]] && python3 - "$diag" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["exit_code"] == 1 and d["status"] in {"exited", "restarting"}, d
assert any("PermissionError" in line for line in d["log_tail"]), d["log_tail"]
assert oct(__import__("os").stat(sys.argv[1]).st_mode & 0o777) == "0o600"
PY
then ok FORENSICS_CAPTURED_BEFORE_ROLLBACK; else ko FORENSICS_CAPTURED_BEFORE_ROLLBACK; fi
restored && ok EXACT_RESTORE_AFTER_FAILED_PROMOTION || ko EXACT_RESTORE_AFTER_FAILED_PROMOTION
[[ "$(docker inspect -f '{{.State.Health.Status}}' newsflux-summary-api-1)" =~ ^(healthy|starting)$ ]] && ok PREVIOUS_RUNNING_AFTER_ROLLBACK || ko PREVIOUS_RUNNING_AFTER_ROLLBACK

# ---- 1b. same incident while forensics, docker logs and the journal all fail (ENOSPC) ------------
plan "$BROKEN" "$BROKEN_SHA" broken-io
io_out="$(python3 - "$here" "$work" <<'PY' 2>&1 || true
import errno, sys
from unittest import mock
sys.path.insert(0, sys.argv[1])
import release
work = sys.argv[2]
real_write, real_run, real_journal = release._atomic_write, release.subprocess.run, release._journal
def write(path, *a, **k):
    if str(path).rsplit("/", 1)[-1].startswith("failure-"):
        raise OSError(errno.ENOSPC, "No space left on device")
    return real_write(path, *a, **k)
def run(args, *a, **k):
    if list(args[:2]) == ["docker", "logs"]:
        raise OSError("docker logs unavailable")
    return real_run(args, *a, **k)
def journal(manifest, event, **details):
    if event != "promote_started":
        raise OSError(errno.ENOSPC, "No space left on device")
    return real_journal(manifest, event, **details)
with mock.patch.object(release, "_atomic_write", write), mock.patch.object(release.subprocess, "run", run), \
        mock.patch.object(release, "_journal", journal):
    release.main(["--policy", f"{work}/policy.json", "--lock", f"{work}/release.lock", "promote",
                  "--manifest", f"{work}/releases/broken-io/manifest.json", "--timeout", "60"])
PY
)"
grep -q 'CODE=PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED' <<<"$io_out" && ok IO_FAILURES_STILL_ROLL_BACK || { echo "$io_out"; ko IO_FAILURES_STILL_ROLL_BACK; }
grep -q 'FORENSIC_CAPTURE=UNAVAILABLE JOURNAL=UNAVAILABLE' <<<"$io_out" && ok SAFE_CODES_REPORTED || ko SAFE_CODES_REPORTED
grep -qiE 'PermissionError|Traceback|token=' <<<"$io_out" && ko NO_RAW_LOGS_ON_TERMINAL || ok NO_RAW_LOGS_ON_TERMINAL
[[ -z "$(ls "$work"/releases/broken-io/failure-*.json 2>/dev/null)" ]] && ok NO_FORENSIC_FILE_UNDER_ENOSPC || ko NO_FORENSIC_FILE_UNDER_ENOSPC
restored && ok EXACT_RESTORE_UNDER_IO_FAILURE || ko EXACT_RESTORE_UNDER_IO_FAILURE
[[ "$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)" == "$protected" ]] && ok PROTECTED_UNCHANGED_UNDER_IO_FAILURE || ko PROTECTED_UNCHANGED_UNDER_IO_FAILURE

# ---- 2. fixed candidate ---------------------------------------------------------------------------
plan "$FIXED" "$FIX_SHA" fixed
rt promote --manifest "$work/releases/fixed/manifest.json" --timeout 120 >/dev/null 2>&1 && ok FIXED_CANDIDATE_PROMOTED || ko FIXED_CANDIDATE_PROMOTED
[[ "$(docker inspect -f '{{.Image}} {{.State.Health.Status}}' newsflux-summary-api-1)" == "$FIXED healthy" ]] && ok FIXED_CANDIDATE_HEALTHY_BY_IMAGE_HEALTHCHECK || ko FIXED_CANDIDATE_HEALTHY_BY_IMAGE_HEALTHCHECK
[[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' newsflux-summary-api-1)" == "$before_files,$work/releases/fixed/candidate.override.json" ]] && ok SEVEN_FILES_PLUS_RELEASE_OVERRIDE || ko SEVEN_FILES_PLUS_RELEASE_OVERRIDE
rt rollback --manifest "$work/releases/fixed/manifest.json" --timeout 120 >/dev/null 2>&1 && restored && ok EXACT_ROLLBACK_CONFIG_HASH || ko EXACT_ROLLBACK_CONFIG_HASH
rt rollback --manifest "$work/releases/fixed/manifest.json" --timeout 120 2>&1 | grep -q ALREADY_APPLIED && ok ROLLBACK_IDEMPOTENT || ko ROLLBACK_IDEMPOTENT
rt promote --manifest "$work/releases/fixed/manifest.json" --timeout 120 >/dev/null 2>&1 && ok REPROMOTION || ko REPROMOTION
[[ "$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)" == "$protected" ]] && ok PROTECTED_SERVICES_UNCHANGED || ko PROTECTED_SERVICES_UNCHANGED
echo "R12F09_PASSED=$pass R12F09_FAILED=$fail"
[[ "$fail" -eq 0 ]]
