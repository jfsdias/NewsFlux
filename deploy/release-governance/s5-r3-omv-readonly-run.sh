#!/usr/bin/env bash
# S5-R3: gated wrapper for the FIRST read-only run of the S5-R1/R3 auditor on the OMV host.
# Prepared only; running it requires an explicit PM GO. PRIVATE_PRESTATE is OFF and cannot be enabled.
#
# Every gate must pass, in order, or the wrapper stops with S5R3_RUN_RESULT=HOLD_<reason> (exit 2) and
# issues no further call; the auditor runs only after every pre-gate:
#   G1 SOURCE   exact clean checkout at --expect-head; the auditor file tracked, unmodified, SHA-256 pinned
#   G2 CI       GitHub check runs on that exact commit: "synthetic-release" completed/success, none failed
#   G3 LITELLM  container by full ID, running, running the expected immutable image ID; that image's
#               RepoDigests contain the expected registry digest
#   G4 BINDING  the image ID is in this wrapper's table of lab-proven images, for exactly the expected
#               LiteLLM version (a version string alone is never provenance)
#   G5 SUMMARY  exactly one Summary container for project/service; its image revision label is the
#               expected production revision
#   RUN         python3 -B -I <auditor> --litellm-container <full ID>  (the auditor itself refuses unless
#               the Summary's inference and external-transfer flags are OFF, uses a READ ONLY transaction,
#               and checks both containers are unchanged)
#   POST        every output line must be a sanitized enum line; the receipt must report the expected
#               version as LAB_REHEARSED, DB_READ_ONLY=VERIFIED, CONTAINER_IDENTITY=UNCHANGED and
#               COMPLETE_DIAGNOSTIC_ONLY; G3 is re-checked after the run
#
# Output: S5R3_RUN_* lines and the sanitized S5R1_*/S5R3_* receipt. Nothing else is ever printed.
set -Euo pipefail
umask 077
REPO_SLUG="jfsdias/NewsFlux"
AUDITOR_PATH="deploy/release-governance/s5_db_readonly_audit.py"
# Lab-proven production images: immutable image ID (config digest) -> LiteLLM package version.
declare -A PROVEN_IMAGES=(
  ["sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab"]="1.110.0"
)
SAFE_LINE='^(S5R1|S5R3)_[A-Z0-9_]+=([A-Z0-9_]+(,[A-Z0-9_]+)*|[0-9]+)$'
AUDITOR_NEXT_LINE='NEXT=evidence for PM review only; S5_PREFLIGHT is unchanged (no official attestation produced)'

say() { echo "S5R3_RUN_$1=$2"; }
hold() { say RESULT "HOLD_$1"; exit 2; }

src="" head="" auditor_sha="" litellm_id="" image_id="" repo_digest="" version="" project="" service="" summary_rev=""
for arg in "$@"; do
  if [[ "${arg,,}" == *prestate* ]]; then say PRIVATE_PRESTATE FORBIDDEN; hold PRIVATE_PRESTATE_FORBIDDEN; fi
done
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || hold USAGE
  case "$1" in
    --source) src="$2" ;;
    --expect-head) head="$2" ;;
    --expect-auditor-sha256) auditor_sha="$2" ;;
    --litellm-container-id) litellm_id="$2" ;;
    --expect-image-id) image_id="$2" ;;
    --expect-repo-digest) repo_digest="$2" ;;
    --expect-litellm-version) version="$2" ;;
    --summary-project) project="$2" ;;
    --summary-service) service="$2" ;;
    --expect-summary-revision) summary_rev="$2" ;;
    *) hold USAGE ;;
  esac
  shift 2
done
[[ -n "$src" && "$src" == /* && -d "$src" && "$head" =~ ^[0-9a-f]{40}$ && "$auditor_sha" =~ ^[0-9a-f]{64}$ \
   && "$litellm_id" =~ ^[0-9a-f]{64}$ && "$image_id" =~ ^sha256:[0-9a-f]{64}$ \
   && "$repo_digest" =~ ^[a-z0-9][a-z0-9./_-]{0,254}@sha256:[0-9a-f]{64}$ && "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ \
   && "$project" =~ ^[A-Za-z0-9_.-]{1,64}$ && "$service" =~ ^[A-Za-z0-9_.-]{1,64}$ && "$summary_rev" =~ ^[0-9a-f]{40}$ ]] || hold USAGE
say PRIVATE_PRESTATE OFF
[[ "$(id -u)" == 0 ]] || hold NOT_ROOT

# G1 SOURCE -----------------------------------------------------------------------------------------
[[ "$(git -C "$src" rev-parse HEAD 2>/dev/null)" == "$head" ]] || hold SOURCE_HEAD_MISMATCH
[[ -z "$(git -C "$src" status --porcelain --untracked-files=no 2>/dev/null)" ]] || hold SOURCE_NOT_CLEAN
git -C "$src" ls-files --error-unmatch -- "$AUDITOR_PATH" >/dev/null 2>&1 || hold SOURCE_AUDITOR_UNTRACKED
git -C "$src" diff --quiet HEAD -- "$AUDITOR_PATH" 2>/dev/null || hold SOURCE_AUDITOR_MODIFIED
[[ "$(sha256sum "$src/$AUDITOR_PATH" | cut -d' ' -f1)" == "$auditor_sha" ]] || hold SOURCE_AUDITOR_SHA256
say SOURCE_GATE PASS_EXACT_HEAD

# G2 CI -----------------------------------------------------------------------------------------------
ci_json="$(curl -fsS --max-time 30 -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$head/check-runs?per_page=100" 2>/dev/null)" || hold CI_UNVERIFIED
ci="$(python3 -I -c '
import json, sys
try:
    runs = json.loads(sys.argv[1]).get("check_runs") or []
except (ValueError, AttributeError):
    print("UNVERIFIED"); sys.exit()
bad = [r for r in runs if r.get("status") != "completed" or r.get("conclusion") not in ("success", "skipped", "neutral")]
ok = [r for r in runs if r.get("name") == "synthetic-release" and r.get("status") == "completed" and r.get("conclusion") == "success"]
print("PASS" if ok and not bad else ("FAILED_OR_PENDING" if bad else "MISSING_SYNTHETIC_RELEASE"))' "$ci_json")" || hold CI_UNVERIFIED
[[ "$ci" == PASS ]] || hold "CI_$ci"
say CI_GATE PASS_EXACT_HEAD

# G3 LITELLM identity (re-usable for the post-run check) -------------------------------------------
litellm_gate() {
  local info running image digests
  info="$(docker inspect --format '{{.Id}} {{.State.Status}} {{.Image}}' "$litellm_id" 2>/dev/null)" || return 1
  read -r running_id running image <<<"$info"
  [[ "$running_id" == "$litellm_id" && "$running" == running && "$image" == "$image_id" ]] || return 1
  [[ "$(docker image inspect --format '{{.Id}}' "$image_id" 2>/dev/null)" == "$image_id" ]] || return 1
  digests="$(docker image inspect --format '{{json .RepoDigests}}' "$image_id" 2>/dev/null)" || return 1
  python3 -I -c 'import json, sys; sys.exit(0 if sys.argv[2] in (json.loads(sys.argv[1]) or []) else 1)' "$digests" "$repo_digest" || return 1
}
litellm_gate || hold LITELLM_IDENTITY_OR_IMAGE
say LITELLM_IDENTITY_GATE PASS
say LITELLM_IMAGE_GATE PASS

# G4 image -> version binding -------------------------------------------------------------------------
[[ "${PROVEN_IMAGES[$image_id]:-}" == "$version" ]] || hold IMAGE_NOT_LAB_PROVEN_FOR_VERSION
say IMAGE_VERSION_BINDING "PASS_${version//./_}"

# G5 SUMMARY revision ---------------------------------------------------------------------------------
summary="$(docker ps -q --no-trunc --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=$service" 2>/dev/null)" || hold SUMMARY_UNREADABLE
[[ "$(wc -w <<<"$summary")" == 1 ]] || hold SUMMARY_NOT_UNIQUE
summary_image="$(docker inspect --format '{{.Image}}' "$summary" 2>/dev/null)" || hold SUMMARY_UNREADABLE
rev="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$summary_image" 2>/dev/null)" \
  || hold SUMMARY_UNREADABLE
[[ "$rev" == "$summary_rev" ]] || hold SUMMARY_REVISION_MISMATCH
say SUMMARY_REVISION_GATE PASS

# RUN -------------------------------------------------------------------------------------------------
receipt="$(python3 -B -I "$src/$AUDITOR_PATH" --litellm-container "$litellm_id" 2>/dev/null)"
audit_code=$?
unsafe=0
declare -A seen=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == "$AUDITOR_NEXT_LINE" ]] && continue
  if [[ "$line" =~ $SAFE_LINE && "$line" != S5R3_PRIVATE_PRESTATE* ]]; then
    echo "$line"
    seen["${line%%=*}"]="${line#*=}"
  else
    unsafe=$((unsafe + 1))   # never printed
  fi
done <<<"$receipt"
[[ "$unsafe" == 0 ]] || hold OUTPUT_UNSAFE
[[ "$audit_code" == 0 ]] || hold "AUDITOR_EXIT_$audit_code"

# POST ------------------------------------------------------------------------------------------------
[[ "${seen[S5R1_AUDIT]:-}" == COMPLETE_DIAGNOSTIC_ONLY ]] || hold RECEIPT_NOT_COMPLETE
[[ "${seen[S5R1_DB_READ_ONLY]:-}" == VERIFIED ]] || hold RECEIPT_READ_ONLY_UNVERIFIED
[[ "${seen[S5R1_CONTAINER_IDENTITY]:-}" == UNCHANGED ]] || hold RECEIPT_CONTAINER_CHANGED
[[ "${seen[S5R1_LITELLM_VERSION]:-}" == "${version//./_}" ]] || hold RECEIPT_VERSION_MISMATCH
[[ "${seen[S5R1_LITELLM_VERSION_CLASS]:-}" == LAB_REHEARSED ]] || hold RECEIPT_VERSION_NOT_REHEARSED
litellm_gate || hold LITELLM_CHANGED_AFTER_RUN
say POST_GATES PASS
say RESULT COMPLETE_DIAGNOSTIC_ONLY_READONLY
