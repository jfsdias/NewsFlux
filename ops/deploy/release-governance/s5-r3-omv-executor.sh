#!/usr/bin/env bash
# S5-R3B: single self-contained, supervised executor for the FIRST read-only S5 diagnostic on the OMV host.
# PREPARED ONLY. Running it requires an explicit PM GO for that run; nothing here authorizes it.
#
#   bash s5-r3-omv-executor.sh --workdir <absolute, must not exist> --expect-head <40-hex> \
#        --expect-wrapper-sha256 <64-hex> -- <s5-r3-omv-readonly-run.sh arguments, without --source/--expect-head>
#
# Steps (each failure prints S5R3_EXEC_RESULT=HOLD_<reason> and exits non-zero; nothing later runs):
#   PREPARE  create --workdir 0700 (it must not exist: no reuse of an earlier checkout)
#   CLONE    public HTTPS clone of jfsdias/NewsFlux into <workdir>/src
#   CHECKOUT detached exact --expect-head, verified with rev-parse
#   HASH     the wrapper's SHA-256 equals --expect-wrapper-sha256 (the wrapper then pins the auditor itself)
#   RUN      the wrapper with --source <workdir>/src --expect-head <head>; its output is shown and saved to
#            <workdir>/receipt.txt (0600)
# Exit status: the wrapper's own status (0 COMPLETE, 2 HOLD, 3 changed state); 4 if the wrapper passed but the
# receipt could not be saved; 2 for any executor HOLD; 130/143 if interrupted. The final status line is printed
# by this script and the exit status is never replaced by the status of a print, tee or cleanup.
set -Euo pipefail
umask 077
REPO_URL="https://github.com/jfsdias/NewsFlux.git"
WRAPPER_PATH="ops/deploy/release-governance/s5-r3-omv-readonly-run.sh"

say() { echo "S5R3_EXEC_$1=$2"; }
hold() { say RESULT "HOLD_$1"; exit 2; }
trap 'say RESULT HOLD_INTERRUPTED; exit 130' INT
trap 'say RESULT HOLD_INTERRUPTED; exit 143' TERM

workdir="" head="" wrapper_sha=""
while [[ $# -gt 0 && "$1" != "--" ]]; do
  [[ $# -ge 2 ]] || hold USAGE
  case "$1" in
    --workdir) workdir="$2" ;;
    --expect-head) head="$2" ;;
    --expect-wrapper-sha256) wrapper_sha="$2" ;;
    *) hold USAGE ;;
  esac
  shift 2
done
[[ "${1:-}" == "--" ]] || hold USAGE
shift
[[ "$workdir" == /* && "$workdir" != *..* && "$head" =~ ^[0-9a-f]{40}$ && "$wrapper_sha" =~ ^[0-9a-f]{64}$ ]] || hold USAGE
for arg in "$@"; do
  case "$arg" in --source|--expect-head) hold USAGE ;; esac   # the executor alone binds the source
  [[ "${arg,,}" == *prestate* ]] && hold PRIVATE_PRESTATE_FORBIDDEN
done
say PRIVATE_PRESTATE OFF

[[ ! -e "$workdir" ]] || hold PREPARE_WORKDIR_EXISTS
install -d -m 0700 -- "$workdir" 2>/dev/null || hold PREPARE
git clone -q -- "$REPO_URL" "$workdir/src" >/dev/null 2>&1 || hold CLONE
git -C "$workdir/src" -c advice.detachedHead=false checkout -q --detach "$head" >/dev/null 2>&1 || hold CHECKOUT
[[ "$(git -C "$workdir/src" rev-parse HEAD 2>/dev/null)" == "$head" ]] || hold CHECKOUT
say SOURCE "$head"
observed="$(sha256sum -- "$workdir/src/$WRAPPER_PATH" 2>/dev/null)" || hold WRAPPER_SHA256
[[ "${observed%% *}" == "$wrapper_sha" ]] || hold WRAPPER_SHA256
say WRAPPER_SHA256 PASS

: >"$workdir/receipt.txt" 2>/dev/null && chmod 0600 "$workdir/receipt.txt" 2>/dev/null || hold PREPARE_RECEIPT
bash "$workdir/src/$WRAPPER_PATH" --source "$workdir/src" --expect-head "$head" "$@" | tee -a "$workdir/receipt.txt"
statuses=("${PIPESTATUS[@]}")
rc="${statuses[0]}"
if [[ "$rc" == 0 && "${statuses[1]}" != 0 ]]; then
  rc=4
  say RESULT HOLD_RECEIPT_NOT_SAVED
fi
say WRAPPER_EXIT "${statuses[0]}"
say EXIT "$rc"
exit "$rc"
