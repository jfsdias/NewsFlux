#!/usr/bin/env bash
# S5-R3A: gated wrapper for the FIRST read-only run of the S5-R1/R3 auditor on the OMV host.
# Prepared only; running it requires an explicit PM GO. PRIVATE_PRESTATE is OFF and cannot be enabled.
#
# Gates, in order; the first failure prints S5R3_RUN_RESULT=HOLD_<reason> (exit 2) and stops:
#   G1 SOURCE   exact clean checkout at --expect-head; the auditor file tracked, unmodified, SHA-256 pinned
#   G2 EVIDENCE exactly one source:
#     REMOTE_CI          --expect-ci-run-id + --expect-ci-run-attempt: run of workflow summary-release-rehearsal.yaml
#                        in jfsdias/NewsFlux (repository and head repository), head SHA == --expect-head, that exact
#                        attempt, completed/success; the attempt's job listing read page by page until complete
#                        (stable total_count, unique job IDs), every job on the same run/attempt/SHA, exactly one
#                        "synthetic-release", none failed, pending or skipped in its place
#     LOCAL_INDEPENDENT  --local-evidence + --local-replay + --local-approval: g2_local_evidence.py (tracked at this
#                        HEAD) verifies two complete offline runs of every manifest step at this commit and tree by
#                        two distinct producers and a detached approval by a third signer; signers must be in
#                        LOCAL_ADMITTED_SIGNERS, which is EMPTY (the mode HOLDs until the PM admits signers)
#   G3 LITELLM  container by full ID: running, the expected immutable image ID, whose RepoDigests contain the
#               expected registry digest; lifecycle snapshot recorded (ID|image|StartedAt|RestartCount|state|labels)
#   G4 BINDING  that image ID is in this wrapper's table of lab-proven images for the expected LiteLLM version
#   G5 SUMMARY  the expected revision is an AUTHORIZED deploy in this wrapper's table (with its recorded image
#               ID and receipt); exactly one container for project/service, running that image, whose revision
#               label is that revision; lifecycle snapshot recorded. The observed SHA is never adopted.
#   --gates-only stops here (metadata only, no exec) after re-checking both snapshots.
#   PRE-RUN     both snapshots re-read and unchanged since the gates
#   RUN         env -i ... python3 -B -I <auditor> with the exact Summary and LiteLLM IDs, images, project/service
#               and both snapshots (strict mode: no discovery; the auditor re-checks identity right before its
#               first exec, again after the Summary parser and right before the LiteLLM exec, and after its last;
#               it refuses unless the inference/external-transfer flags are effectively OFF, and confirms them
#               with the Summary's own runtime parser)
#   CONTRACT    the whole receipt is held in memory and validated against an explicit field/value contract
#               (known fields, enums, bounded counts, no duplicates, required fields, no prestate, exit-code
#               coherence); nothing from it is printed unless every check passes
#   POST        both snapshots re-read and unchanged; only then is the validated receipt printed
# Atomicity is not absolute (bounded): a change between the auditor's last identity check and an exec targets a full ID
# (a replacement fails the exec) and a restart is caught by the post-run comparison.
set -Euo pipefail
umask 077
REPO_SLUG="jfsdias/NewsFlux"
AUDITOR_PATH="deploy/release-governance/s5_db_readonly_audit.py"
CI_WORKFLOW_PATH=".github/workflows/summary-release-rehearsal.yaml"
CI_JOB_NAME="synthetic-release"
G2L_VERIFIER_PATH="deploy/release-governance/g2_local_evidence.py"
# G2_LOCAL_INDEPENDENT signers admitted by the PM (OpenSSH allowed_signers lines: "<principal> <keytype> <key>").
# EMPTY ON PURPOSE: the local mode stays ineligible for a privileged run until the PM admits named reviewers
# in a reviewed change to this file (which also changes this file's pinned SHA-256).
LOCAL_ADMITTED_SIGNERS=""
IDENTITY_FORMAT='{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Status}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}'
# Lab-proven LiteLLM images: immutable image ID (config digest) -> LiteLLM package version.
declare -A PROVEN_IMAGES=(
  ["sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab"]="1.110.0"
)
# Authorized Summary deploys (revision -> image ID recorded in the release receipt). The flag parser of every
# revision listed here was reviewed (default OFF proven); a revision not listed is never accepted.
#   12929fb: exact-main release, receipt https://github.com/jfsdias/NewsFlux/pull/270#issuecomment-7025312981
declare -A AUTHORIZED_SUMMARY=(
  ["12929fbabe603ec24dcc700c8393f1f6bc7bbf60"]="sha256:6cee8366be056e84893b32dd6708248d983f1d3a939261af6cfe27db8572adc3"
)

say() { echo "S5R3_RUN_$1=$2"; }
hold() { say RESULT "HOLD_$1"; exit 2; }

src="" head="" auditor_sha="" litellm_id="" image_id="" repo_digest="" version="" project="" service="" summary_rev="" ci_run=""
ci_attempt="" local_evidence="" local_replay="" local_approval=""
gates_only=0
for arg in "$@"; do
  if [[ "${arg,,}" == *prestate* ]]; then say PRIVATE_PRESTATE FORBIDDEN; hold PRIVATE_PRESTATE_FORBIDDEN; fi
done
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --gates-only ]]; then gates_only=1; shift; continue; fi
  [[ $# -ge 2 ]] || hold USAGE
  case "$1" in
    --source) src="$2" ;;
    --expect-head) head="$2" ;;
    --expect-auditor-sha256) auditor_sha="$2" ;;
    --expect-ci-run-id) ci_run="$2" ;;
    --expect-ci-run-attempt) ci_attempt="$2" ;;
    --local-evidence) local_evidence="$2" ;;
    --local-replay) local_replay="$2" ;;
    --local-approval) local_approval="$2" ;;
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
# G2 evidence source: exactly one of remote CI (run id + attempt) or local independent (three paths).
g2_mode=""
if [[ -n "$ci_run$ci_attempt" && -z "$local_evidence$local_replay$local_approval" ]]; then
  [[ "$ci_run" =~ ^[0-9]{1,20}$ && "$ci_attempt" =~ ^[1-9][0-9]{0,3}$ ]] && g2_mode=remote
elif [[ -z "$ci_run$ci_attempt" ]]; then
  [[ "$local_evidence" == /* && "$local_replay" == /* && "$local_approval" == /* ]] && g2_mode=local
fi
[[ -n "$g2_mode" ]] || hold USAGE
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

# G2 CI: exact repository / workflow / run / attempt / job / SHA, complete job listing -------------------
api() { curl -fsS --max-time 30 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO_SLUG/$1" 2>/dev/null; }
CI_PY=$(cat <<'PY'
import json, sys
repo, run_id, attempt, head, path, job_name, run_text = sys.argv[1:8]
page_texts = sys.argv[8:]
def out(word):
    print(word); sys.exit()
try:
    run = json.loads(run_text)
    pages = [json.loads(t) for t in page_texts]
except ValueError:
    out("UNVERIFIED")
if not isinstance(run, dict) or str(run.get("id")) != run_id or type(run.get("run_attempt")) is not int:
    out("UNVERIFIED")
if str(run["run_attempt"]) != attempt:
    out("ATTEMPT_MISMATCH")   # a re-run is a different attempt: it is never adopted silently
for side in ("repository", "head_repository"):
    owner = run.get(side)
    if not isinstance(owner, dict) or owner.get("full_name") != repo:
        out("OTHER_REPOSITORY")
if run.get("head_sha") != head:
    out("OTHER_SHA")
if run.get("path") != path:
    out("OTHER_WORKFLOW")
if run.get("status") != "completed" or run.get("conclusion") != "success":
    out("RUN_NOT_SUCCESS")
jobs, totals = [], set()
for page in pages:
    if not isinstance(page, dict) or not isinstance(page.get("jobs"), list) or type(page.get("total_count")) is not int:
        out("UNVERIFIED")
    totals.add(page["total_count"])
    jobs.extend(page["jobs"])
if len(totals) != 1:
    out("JOBS_INCOMPLETE")   # the listing changed while it was being read
total = totals.pop()
if len(jobs) < total and pages[-1]["jobs"] and len(pages[-1]["jobs"]) == 100:
    out("NEED_MORE")
if len(jobs) != total or total < 1:
    out("JOBS_INCOMPLETE")
ids = [j.get("id") if isinstance(j, dict) else None for j in jobs]
if None in ids or len(set(ids)) != len(ids):
    out("JOBS_INCOMPLETE")
for job in jobs:
    if str(job.get("run_id")) != run_id or str(job.get("run_attempt")) != attempt or job.get("head_sha") != head:
        out("JOB_OTHER_RUN")
named = [j for j in jobs if j.get("name") == job_name]
if len(named) != 1:
    out("JOB_MISSING_OR_AMBIGUOUS")
if any(j.get("status") != "completed" or j.get("conclusion") not in ("success", "skipped") for j in jobs):
    out("JOB_NOT_SUCCESS")
if named[0].get("conclusion") != "success":
    out("JOB_NOT_SUCCESS")
out("PASS")
PY
)
g2_remote() {
  local run_json page_json ci="" page
  local -a pages=()
  run_json="$(api "actions/runs/$ci_run")" || hold CI_UNVERIFIED
  for page in 1 2 3 4 5 6 7 8 9 10; do
    page_json="$(api "actions/runs/$ci_run/attempts/$ci_attempt/jobs?per_page=100&page=$page")" || hold CI_UNVERIFIED
    pages+=("$page_json")
    ci="$(python3 -I -B -c "$CI_PY" "$REPO_SLUG" "$ci_run" "$ci_attempt" "$head" "$CI_WORKFLOW_PATH" "$CI_JOB_NAME" \
          "$run_json" "${pages[@]}")" || hold CI_UNVERIFIED
    [[ "$ci" == NEED_MORE ]] || break
  done
  [[ "$ci" == NEED_MORE ]] && ci="JOBS_INCOMPLETE"
  [[ "$ci" == PASS ]] || hold "CI_$ci"
  say G2_MODE REMOTE_CI
  say CI_WORKFLOW SUMMARY_RELEASE_REHEARSAL
  say CI_RUN_ID "$ci_run"
  say CI_RUN_ATTEMPT "$ci_attempt"
  say CI_HEAD_SHA "$head"
  say CI_JOB SYNTHETIC_RELEASE
  say CI_JOBS_LISTING COMPLETE
  say CI_RUN_CONCLUSION SUCCESS
  say CI_JOB_CONCLUSION SUCCESS
  say CI_GATE PASS_EXACT_RUN_ATTEMPT_JOB_SHA
}
g2_local() {
  # G2_LOCAL_INDEPENDENT: offline evidence produced at this exact HEAD/tree, replayed by a second, distinct
  # producer and approved by a detached SSH-signed review naming both bundles. The verifier is tracked at
  # this HEAD (G1 proved the tree clean). Signers are admitted only through LOCAL_ADMITTED_SIGNERS below;
  # while it is empty this mode verifies everything and then HOLDs (not admitted by the PM).
  local verdict
  verdict="$(env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin python3 -B -I "$src/$G2L_VERIFIER_PATH" \
      --source "$src" --expect-head "$head" --evidence "$local_evidence" --replay "$local_replay" \
      --approval "$local_approval" --allowed-signers-text "$LOCAL_ADMITTED_SIGNERS" 2>/dev/null | tail -n 1)" || true
  [[ "$verdict" =~ ^G2L_RESULT=(PASS|HOLD_G2L_[A-Z0-9_]{1,72})$ ]] || hold G2L_VERIFIER_UNAVAILABLE
  [[ "${BASH_REMATCH[1]}" == PASS ]] || hold "${BASH_REMATCH[1]#HOLD_}"
  say G2_MODE LOCAL_INDEPENDENT
  say CI_HEAD_SHA "$head"
  say CI_GATE PASS_LOCAL_INDEPENDENT_REPLAYED_APPROVED
}
if [[ "$g2_mode" == remote ]]; then g2_remote; else g2_local; fi

# G3 LITELLM identity -----------------------------------------------------------------------------------
snapshot() { docker inspect --format "$IDENTITY_FORMAT" "$1" 2>/dev/null; }
litellm_snapshot="$(snapshot "$litellm_id")" || hold LITELLM_IDENTITY_OR_IMAGE
IFS='|' read -r l_id l_image _ _ l_state _ _ <<<"$litellm_snapshot"
[[ "$l_id" == "$litellm_id" && "$l_state" == running && "$l_image" == "$image_id" ]] || hold LITELLM_IDENTITY_OR_IMAGE
[[ "$(docker image inspect --format '{{.Id}}' "$image_id" 2>/dev/null)" == "$image_id" ]] || hold LITELLM_IDENTITY_OR_IMAGE
digests="$(docker image inspect --format '{{json .RepoDigests}}' "$image_id" 2>/dev/null)" || hold LITELLM_IDENTITY_OR_IMAGE
python3 -I -B -c 'import json, sys; sys.exit(0 if sys.argv[2] in (json.loads(sys.argv[1]) or []) else 1)' "$digests" "$repo_digest" \
  || hold LITELLM_IDENTITY_OR_IMAGE
say LITELLM_IDENTITY_GATE PASS
say LITELLM_IMAGE_GATE PASS

# G4 image -> version binding -------------------------------------------------------------------------
[[ "${PROVEN_IMAGES[$image_id]:-}" == "$version" ]] || hold IMAGE_NOT_LAB_PROVEN_FOR_VERSION
say IMAGE_VERSION_BINDING "PASS_${version//./_}"

# G5 SUMMARY: authorized deploy + live metadata ---------------------------------------------------------
summary_image_expected="${AUTHORIZED_SUMMARY[$summary_rev]:-}"
[[ -n "$summary_image_expected" ]] || hold SUMMARY_REVISION_NOT_AUTHORIZED
summary_ids="$(docker ps -q --no-trunc --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=$service" 2>/dev/null)" || hold SUMMARY_UNREADABLE
[[ "$(wc -w <<<"$summary_ids")" == 1 && "$summary_ids" =~ ^[0-9a-f]{64}$ ]] || hold SUMMARY_NOT_UNIQUE
summary_id="$summary_ids"
summary_snapshot="$(snapshot "$summary_id")" || hold SUMMARY_UNREADABLE
IFS='|' read -r s_id s_image _ _ s_state s_project s_service <<<"$summary_snapshot"
[[ "$s_id" == "$summary_id" && "$s_state" == running && "$s_project" == "$project" && "$s_service" == "$service" ]] \
  || hold SUMMARY_IDENTITY
[[ "$s_image" == "$summary_image_expected" ]] || hold SUMMARY_IMAGE_NOT_AUTHORIZED
rev="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$s_image" 2>/dev/null)" \
  || hold SUMMARY_UNREADABLE
[[ "$rev" == "$summary_rev" ]] || hold SUMMARY_REVISION_MISMATCH
say SUMMARY_DEPLOY_AUTHORIZED PASS_TABLE
say SUMMARY_REVISION_GATE PASS
say LIVE_SUMMARY_REVISION "$rev"
say SUMMARY_CONTAINER_ID "$summary_id"
say SUMMARY_IMAGE_ID "$s_image"

unchanged() {
  [[ "$(snapshot "$summary_id")" == "$summary_snapshot" && "$(snapshot "$litellm_id")" == "$litellm_snapshot" ]]
}
if [[ "$gates_only" == 1 ]]; then
  unchanged || hold IDENTITY_CHANGED_BETWEEN_GATES
  say RESULT GATES_PASS_METADATA_ONLY_NO_AUDIT
  exit 0
fi

# PRE-RUN, RUN ------------------------------------------------------------------------------------------
unchanged || hold IDENTITY_CHANGED_BETWEEN_GATES
receipt="$(env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  python3 -B -I "$src/$AUDITOR_PATH" --litellm-container "$litellm_id" --summary-container "$summary_id" \
  --project "$project" --summary-service "$service" --expect-summary-image "$s_image" --expect-litellm-image "$image_id" \
  --expect-summary-snapshot "$summary_snapshot" --expect-litellm-snapshot "$litellm_snapshot" 2>/dev/null)"
audit_code=$?

# CONTRACT (receipt held in memory; nothing from it is printed before every check passes) ---------------
# ---BEGIN RECEIPT CONTRACT---
CONTRACT_PY=$(cat <<'PY'
import re, sys

NEXT_LINE = "NEXT=evidence for PM review only; S5_PREFLIGHT is unchanged (no official attestation produced)"
GATES = {"PASS", "FAIL", "NOT_VERIFIED"}
FAMILIES = {"OPENROUTER", "GROQ", "GEMINI", "VERTEX_AI", "MISTRAL", "OPENAI", "AZURE", "ANTHROPIC", "TOGETHER_AI", "CEREBRAS",
            "OLLAMA", "HUGGINGFACE", "NVIDIA_NIM", "COHERE", "DEEPSEEK", "BEDROCK", "XAI", "FIREWORKS_AI", "SAMBANOVA",
            "GITHUB_MODELS", "CLOUDFLARE", "OTHER", "MIXED", "NONE"}
CALLBACKS = {"LANGFUSE", "LANGSMITH", "DATADOG", "PROMETHEUS", "SENTRY", "S3", "GCS_BUCKET", "OTEL", "OPENTELEMETRY",
             "LUNARY", "HELICONE", "POSTHOG", "ARIZE", "BRAINTRUST", "MLFLOW", "SLACK", "EMAIL", "DYNAMODB", "ATHINA",
             "LOGFIRE", "WANDB", "LANGTRACE", "OPENMETER", "LAGO", "ARGILLA", "GALILEO", "SUPABASE", "GREENSCALE",
             "HUMANLOOP", "OPIK", "GENERIC_API", "OTHER", "UNRECOGNIZED"}
EXTRA_IND = {"USER", "ORGANIZATION", "PROJECT", "AGENT", "PERMISSIONS", "CONFIG", "BUDGET_FALLBACKS"}
EXTRA_LIM = {"MODEL_MAX_BUDGET", "BUDGET_LIMITS", "TPD_LIMIT", "MAX_PARALLEL_REQUESTS"}
OBJPERM_COUNTED = ("MCP_SERVERS", "VECTOR_STORES", "MCP_ACCESS_GROUPS", "AGENTS", "AGENT_ACCESS_GROUPS", "MODELS",
                   "MCP_TOOLSETS", "SEARCH_TOOLS", "SKILLS", "BLOCKED_TOOLS", "MCP_TOOL_PERMISSIONS")
AUDITOR_HOLDS = {"NOT_ROOT", "STRICT_BINDING_INCOMPLETE", "ENV_DIVERGENT", "UNVERIFIED", "CONTAINER_STATE_CHANGED",
                 "IDENTITY_MISMATCH_SUMMARY", "IDENTITY_MISMATCH_LITELLM", "IDENTITY_CHANGED_BEFORE_EXEC",
                 "IDENTITY_CHANGED_BETWEEN_EXECS",
                 "AI_FLAGS_NOT_OFF", "AI_FLAGS_AMBIGUOUS", "AI_FLAGS_DUPLICATE", "AI_FLAGS_UNREADABLE",
                 "FLAGS_RUNTIME_NOT_OFF", "FLAGS_RUNTIME_UNAVAILABLE", "SUMMARY_KEY_UNAVAILABLE", "PROBE_OUTPUT_UNSAFE",
                 "SUMMARY_CONTAINER_NOT_UNIQUE", "LITELLM_CONTAINER_NOT_UNIQUE", "DOCKER_INSPECT_FAILED",
                 "DOCKER_EXEC_FAILED", "DOCKER_PS_FAILED", "PROBE_INPUT_INVALID", "PROBE_DB_UNAVAILABLE",
                 "PROBE_DB_READ_FAILED", "PROBE_DB_NOT_READ_ONLY", "PROBE_DB_SCHEMA_UNSUPPORTED",
                 "PROBE_PROBE_OUTPUT_UNSAFE", "PROBE_UNSAFE"}


def enum(*values):
    allowed = set(values)
    return lambda v: v in allowed


def subset(options, extra=("NONE",)):
    def check(v):
        if v in extra:
            return True
        parts = v.split(",")
        return len(parts) == len(set(parts)) and all(p in options for p in parts)
    return check


def count(low, high, words=()):
    def check(v):
        if v in words:
            return True
        return bool(re.fullmatch(r"0|[1-9][0-9]{0,5}", v)) and low <= int(v) <= high
    return check


CONTRACT = {
    "DB_READ_ONLY": enum("VERIFIED"),
    "YAML_CONFIG": enum("LOADED", "NOT_FOUND", "UNREADABLE", "INVALID_ROOT", "INVALID_STRUCTURE"),
    "KEY_SCHEMA": enum("FULL", "PARTIAL_OPTIONAL"),
    "KEY_LOOKUP": enum("EXACT_FINGERPRINT"),
    "KEY_MATCH": enum("ONE", "NONE", "MULTIPLE"),
    "KEY_POLICY_GATE": enum(*GATES),
    "KEY_INDIRECTION": subset({"ALIASES", "ALIASES_UNRECOGNIZED", "ROUTER_SETTINGS", "ROUTER_SETTINGS_UNRECOGNIZED", "TEAM",
                               "ACCESS_GROUPS", "POLICIES", "OBJECT_PERMISSION"}, ("NONE", "NOT_EVALUATED")),
    "KEY_MODELS_COUNT": count(0, 10000),
    "KEY_SCOPE_DETAIL": enum("UNRESTRICTED_ALL_MODELS", "INVALID_TYPE", "INVALID_ENTRY", "WILDCARD", "EXACT_ALIAS",
                             "DUPLICATE_ENTRIES", "EXTRA_MODELS", "OTHER_MODEL"),
    "KEY_SCOPE": enum("PASS", "FAIL"),
    "KEY_VALIDITY": enum("PASS", "FAIL"),
    "KEY_ROUTES": enum(*GATES),
    "KEY_LIMIT_SOURCE": enum("KEY", "BUDGET_TABLE"),
    "KEY_RPM_WITHIN_APP": enum("APP_CAP_MISSING", "NOT_APPLICABLE", "YES", "NO"),
    "KEY_TPM_WITHIN_APP": enum("APP_CAP_MISSING", "NOT_APPLICABLE", "YES", "NO"),
    "KEY_RATE_LIMITS": enum("PASS", "FAIL"),
    "KEY_SPEND": enum("KNOWN", "UNKNOWN"),
    "KEY_BUDGET": enum(*GATES),
    "KEY_SCHEMA_COLUMNS": count(0, 500),
    "KEY_SCHEMA_UNKNOWN_COLUMNS": count(0, 500),
    "KEY_SCHEMA_MISSING_KNOWN": count(0, 500),
    "KEY_SCHEMA_COMPAT": enum("LAB_EXACT", "UNKNOWN_COLUMNS", "MISSING_COLUMNS", "UNKNOWN_AND_MISSING_COLUMNS"),
    "LITELLM_VERSION": lambda v: v in ("UNKNOWN", "UNRECOGNIZED") or bool(re.fullmatch(r"[0-9]{1,4}_[0-9]{1,4}_[0-9]{1,6}", v)),
    "LITELLM_VERSION_CLASS": enum("LAB_REHEARSED", "NOT_REHEARSED", "UNKNOWN"),
    "KEY_POLICY_GATE_R3": enum(*GATES),
    "KEY_POLICY_GATE_R3_REASONS": subset({"SCHEMA_NOT_LAB_EXACT", "VERSION_NOT_REHEARSED", "EXTRA_INDIRECTION",
                                          "DURATION_UNRECOGNIZED", "JWT_AUTH_NOT_DISABLED", "OBJECT_PERMISSION_LINKED",
                                          "KEY_NOT_MATCHED"}),
    "KEY_MAX_BUDGET": enum("MISSING", "INVALID", "NONPOSITIVE", "APP_CAP_MISSING", "ABOVE_APP_CAP", "OK"),
    "KEY_BUDGET_DURATION": enum("MISSING", "BLANK", "UNRECOGNIZED", "CALENDAR_MONTH", "DAILY", "WEEKLY", "OTHER_WINDOW"),
    "KEY_SPEND_VS_MAX": enum("BELOW", "AT_OR_ABOVE", "NOT_APPLICABLE"),
    "APP_BUDGET_CAP": enum("PRESENT", "MISSING", "INVALID"),
    "KEY_BUDGET_CAUSE": subset({"APP_BUDGET_CAP_MISSING", "APP_BUDGET_CAP_INVALID", "MAX_BUDGET_MISSING", "MAX_BUDGET_INVALID",
                                "MAX_BUDGET_NONPOSITIVE", "MAX_BUDGET_ABOVE_APP_CAP", "BUDGET_DURATION_MISSING",
                                "BUDGET_DURATION_INVALID_TYPE", "BUDGET_DURATION_BLANK", "BUDGET_DURATION_UNRECOGNIZED",
                                "SPEND_UNKNOWN", "SPEND_AT_OR_ABOVE_MAX"}),
    "KEY_RPM": enum("MISSING", "NON_INTEGER", "NONPOSITIVE", "APP_CAP_MISSING", "ABOVE_APP_CAP", "OK"),
    "KEY_TPM": enum("MISSING", "NON_INTEGER", "NONPOSITIVE", "APP_CAP_MISSING", "ABOVE_APP_CAP", "OK"),
    "KEY_SCOPE_TOKEN": subset({"ALL_PROXY_MODELS", "ALL_TEAM_MODELS", "STAR", "CONTAINS_STAR"}),
    "KEY_EXTRA_INDIRECTION": subset(EXTRA_IND | {x + "_UNRECOGNIZED" for x in EXTRA_IND}),
    "KEY_EXTRA_LIMITS": subset(EXTRA_LIM | {x + "_UNRECOGNIZED" for x in EXTRA_LIM}),
    "KEY_AGENT_ID": enum("NONE", "PRESENT", "COLUMN_ABSENT"),
    "KEY_TYPE": enum("NONE", "DEFAULT", "LLM_API", "MANAGEMENT", "READ_ONLY", "OTHER"),
    "OBJPERM_ROW": enum("NONE", "PRESENT", "MISSING", "MULTIPLE"),
    "OBJPERM_EFFECTIVE": enum("NONE", "EMPTY", "GRANTS_PRESENT", "UNKNOWN"),
    "OBJPERM_UNKNOWN_COLUMNS": count(0, 100),
    "OBJPERM_MISSING_COLUMNS": count(0, 100),
    "OBJPERM_UNRECOGNIZED_VALUES": count(0, 100),
    "OBJPERM_MCP_TOOL_SEARCH_ENABLED": enum("TRUE", "FALSE", "UNSET", "UNRECOGNIZED"),
    "JWT_AUTH": enum("ENABLED", "DISABLED", "UNRECOGNIZED", "UNKNOWN"),
    "DEPLOYMENTS_DB": count(0, 200, ("NOT_VERIFIED_TRUNCATED",)),
    "DEPLOYMENTS_YAML": count(0, 1000),
    "DEPLOYMENT_SOURCE": enum("DB_AND_YAML", "DB", "YAML", "NONE"),
    "PROVIDER_FAMILY": enum(*FAMILIES),
    "ENDPOINT_CLASS": enum("PROVIDER_DEFAULT", "LOCAL_OLLAMA", "CUSTOM_ENDPOINT", "MIXED", "NONE"),
    "DEPLOYMENT_BLOCKED": enum("NONE", "ALL", "SOME"),
    "MODEL_ROUTE_GATE": enum(*GATES),
    "CONFIGURED_PRICE": enum("NONZERO", "ZERO", "NOT_PUBLISHED"),
    "PUBLISHED_PRICE_MAP": enum("NONZERO", "ZERO", "NOT_LISTED", "MIXED"),
    "PRICING_GATE": enum("FAIL", "NOT_VERIFIED_PROVIDER_TERMS", "NOT_VERIFIED"),
    "FALLBACK_ALIAS_RULE": enum("NONE", "PRESENT"),
    "FALLBACK_CONTEXT_WINDOW": enum("NONE", "PRESENT"),
    "FALLBACK_CONTENT_POLICY": enum("NONE", "PRESENT"),
    "FALLBACK_DEFAULT_RULE": enum("NONE", "PRESENT"),
    "FALLBACK_GATE": enum(*GATES),
    "FALLBACK_GENERAL_SETTINGS": enum("NONE", "UNRECOGNIZED", "PRESENT_UNVERIFIED_SEMANTICS"),
    "CALLBACKS_CONFIGURED": subset(CALLBACKS),
    "CALLBACK_GATE": enum(*GATES),
    "PROVIDER_PRIVACY_GATE": enum("NOT_VERIFIED_OPERATOR_TERMS_REQUIRED"),
    "OFFICIAL_ATTESTATION": enum("HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE"),
    "EVIDENCE_KIND": enum("DIAGNOSTIC_DB_CONFIG_READONLY"),
    "S5_PREFLIGHT_EFFECT": enum("NONE"),
    "INFERENCE_EFFECTIVE": enum("OFF_EXPLICIT", "OFF_DEFAULT_RUNTIME"),
    "EXTERNAL_TRANSFER_EFFECTIVE": enum("OFF_EXPLICIT", "OFF_DEFAULT_RUNTIME"),
    "FLAGS_RUNTIME_PARSER": enum("CONFIRMED_OFF"),
    "SUMMARY_BINDING": enum("EXACT_ID_IMAGE_LABELS_LIFECYCLE"),
    "LITELLM_BINDING": enum("EXACT_ID_IMAGE_LIFECYCLE"),
    "DELIBERATE_DB_CONFIG_WRITES": enum("NONE"),
    "CONTAINER_IDENTITY": enum("UNCHANGED", "CHANGED"),
    "FILESYSTEM_INTEGRITY": enum("NOT_PROVEN"),
    "AUDIT": lambda v: v == "COMPLETE_DIAGNOSTIC_ONLY" or (v.startswith("HOLD_") and v[5:] in AUDITOR_HOLDS),
}
for _name in OBJPERM_COUNTED:
    CONTRACT[f"OBJPERM_{_name}_COUNT"] = count(0, 100000, ("COLUMN_ABSENT", "UNRECOGNIZED"))
REQUIRED = ("DB_READ_ONLY", "KEY_LOOKUP", "KEY_MATCH", "KEY_POLICY_GATE", "KEY_POLICY_GATE_R3", "KEY_POLICY_GATE_R3_REASONS",
            "KEY_SCHEMA_COMPAT", "LITELLM_VERSION", "LITELLM_VERSION_CLASS", "JWT_AUTH", "MODEL_ROUTE_GATE", "PRICING_GATE",
            "FALLBACK_GATE", "CALLBACK_GATE", "PROVIDER_PRIVACY_GATE", "OFFICIAL_ATTESTATION", "EVIDENCE_KIND",
            "S5_PREFLIGHT_EFFECT", "INFERENCE_EFFECTIVE", "EXTERNAL_TRANSFER_EFFECTIVE", "FLAGS_RUNTIME_PARSER",
            "SUMMARY_BINDING", "LITELLM_BINDING", "DELIBERATE_DB_CONFIG_WRITES", "CONTAINER_IDENTITY",
            "FILESYSTEM_INTEGRITY", "AUDIT")
LINE = re.compile(r"S5R1_([A-Z0-9_]{1,64})=([A-Z0-9_,]{1,512})")


def validate(text, code, version_token):
    """("OK", lines) or (hold_code, None). Never echoes rejected content."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if len(lines) > 400:
        return "RECEIPT_TOO_LONG", None
    if code not in (0, 2, 3):
        return "AUDITOR_EXIT_UNEXPECTED", None
    fields, kept, next_seen = {}, [], 0
    for index, line in enumerate(lines):
        if "PRESTATE" in line.upper():
            return "RECEIPT_PRIVATE_PRESTATE", None
        if line == NEXT_LINE:
            if index != len(lines) - 1 or next_seen:
                return "RECEIPT_UNEXPECTED_LINE", None
            next_seen += 1
            continue
        match = LINE.fullmatch(line)
        if not match:
            return "RECEIPT_UNEXPECTED_LINE", None
        name, value = match.groups()
        if name in fields:
            return "RECEIPT_DUPLICATE_FIELD", None
        check = CONTRACT.get(name)
        if check is None:
            return "RECEIPT_UNKNOWN_FIELD", None
        if not check(value):
            return ("RECEIPT_COUNT_OUT_OF_RANGE" if re.fullmatch(r"[0-9]+", value) else "RECEIPT_VALUE_NOT_ALLOWED"), None
        fields[name] = value
        kept.append(line)
    audit = fields.get("AUDIT")
    if code != 0:
        if audit is None or audit == "COMPLETE_DIAGNOSTIC_ONLY" or next_seen:
            return "RECEIPT_EXIT_INCOHERENT", None
        if code == 3 and (audit != "HOLD_CONTAINER_STATE_CHANGED" or fields.get("CONTAINER_IDENTITY") != "CHANGED"):
            return "RECEIPT_EXIT_INCOHERENT", None
        if code == 2 and len(fields) != 1:
            return "RECEIPT_EXIT_INCOHERENT", None
        return "AUDITOR_" + audit[5:], None
    if audit != "COMPLETE_DIAGNOSTIC_ONLY" or next_seen != 1:
        return "RECEIPT_EXIT_INCOHERENT", None
    if lines[-2] != "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY":
        return "RECEIPT_EXIT_INCOHERENT", None
    if any(name not in fields for name in REQUIRED):
        return "RECEIPT_MISSING_REQUIRED", None
    if fields["CONTAINER_IDENTITY"] != "UNCHANGED":
        return "RECEIPT_CONTAINER_CHANGED", None
    if fields["LITELLM_VERSION"] != version_token or fields["LITELLM_VERSION_CLASS"] != "LAB_REHEARSED":
        return "RECEIPT_VERSION_MISMATCH", None
    return "OK", kept


if __name__ == "__main__":
    verdict, kept = validate(sys.stdin.read(), int(sys.argv[1]), sys.argv[2])
    print(verdict)
    if kept is not None:
        print("\n".join(kept))
PY
)
# ---END RECEIPT CONTRACT---
validated="$(printf '%s' "$receipt" | python3 -I -B -c "$CONTRACT_PY" "$audit_code" "${version//./_}")" || hold CONTRACT_UNAVAILABLE
verdict="${validated%%$'\n'*}"
receipt=""   # drop the raw receipt; only the validated copy may be printed
if [[ "$verdict" != OK ]]; then
  [[ "$verdict" =~ ^[A-Z0-9_]{1,80}$ ]] || verdict="CONTRACT_UNRECOGNIZED"
  hold "$verdict"
fi

# POST --------------------------------------------------------------------------------------------------
unchanged || hold IDENTITY_CHANGED_AFTER_RUN
printf '%s\n' "${validated#*$'\n'}"
say POST_GATES PASS
say RESULT COMPLETE_DIAGNOSTIC_ONLY_READONLY
