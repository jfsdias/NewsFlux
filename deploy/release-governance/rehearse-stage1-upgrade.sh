#!/usr/bin/env bash
# Disposable rehearsal of the UPGRADE from the deployed Stage 1 (A = 57f1c6a…) to this commit (B),
# with production naming and the operator scripts themselves:
#
#   1. pre-Stage1 stack (old pilot Caddyfile 6970ee…), then Stage 1 is installed with the operator
#      script AS IT EXISTS AT A (its own source checkout, its own release dir);
#   2. a release whose Caddyfile equals Stage 1 is a verified no-op (ALREADY_APPLIED, rollback no-op);
#   3. upgrade to T with this commit's operator script, where T = B if B changes the pilot Caddyfile
#      (e.g. the LiteLLM admin routes), otherwise a synthetic child of B with a comment-only Caddyfile
#      change so the Stage 1 -> new Caddyfile transition is ALWAYS exercised:
#      preflight (read-only; drift blocks) → promote-summary → failure injection before write, during
#      write and on reload (each restores Stage 1 bytes+inode) → update-caddy (backup, validate,
#      in-place write, reload, readback; Reader container not recreated) → admin route/method checks
#      → promote-reader → smoke (both revisions T);
#   4. rollback of T (reader, caddy, summary) restores Stage 1 exactly: image IDs, Compose config
#      hashes and config_files sequences, Caddyfile hash AND inode; repeated rollback is idempotent;
#      an external edit after the update makes rollback-caddy refuse (DRIFT_SINCE_RELEASE) without
#      touching the file; Stage 1 smoke (script A) passes again;
#   5. Miniflux, miniflux-db, the NPM, LiteLLM and content-fallback (PR188) stand-ins keep their
#      container identity; no WallHop network or container appears; inference stays disabled.
#
# Images are local stand-ins (Caddy) labelled with the revision, as in rehearse-operator-script.sh;
# real Summary image start-up is covered by rehearse-r12f09.sh. Synthetic only; never a real host.
#
#   sudo bash deploy/release-governance/rehearse-stage1-upgrade.sh
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
A="${STAGE1_SHA:-57f1c6aaa22b44a087cdf7c7bc0dfbb83f521c37}"
B="$(git -C "$repo" rev-parse HEAD)"
PILOT_OLD=6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108
STAGE1_CADDY=56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=no -- deploy/release-governance deploy/article-intel-pilot)" ]] || { echo "commit release files first"; exit 1; }
git -C "$repo" merge-base --is-ancestor "$A" "$B" || { echo "UPGRADE_REHEARSAL=REFUSED CODE=STAGE1_NOT_ANCESTOR"; exit 1; }
for name in newsflux miniflux miniflux-db litellm content-fallback; do
  if docker inspect "$name" >/dev/null 2>&1; then echo "UPGRADE_REHEARSAL=REFUSED CODE=CONTAINER_${name}_EXISTS (never run on a real host)"; exit 1; fi
done
work="$(mktemp -d /tmp/nf-upgrade.XXXXXX)"
CADDY_IMAGE=caddy:2.10.2-alpine
pass=0
fail=0
ok() { echo "UPGRADE_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "UPGRADE_GATE $1=FAIL"; fail=$((fail + 1)); }
cleanup() {
  docker compose -p newsflux --project-directory "$work/stack" -f "$work/stack/compose.yaml" -f "$work/stack/compose.layer2.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f miniflux miniflux-db npm-front litellm content-fallback >/dev/null 2>&1 || true
  docker network rm nfup-npm >/dev/null 2>&1 || true
  docker image rm -f "newsflux-summary:$A" "newsflux-reader:$A" "newsflux-summary:$B" "newsflux-reader:$B" \
    "newsflux-summary:${T:-none}" "newsflux-reader:${T:-none}" \
    nfup-summary:previous nfup-reader:previous >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/stack" "$work/releases"

# Origin whose main is B (A is an ancestor), so both releases prepare from the same remote.
git init -q --bare "$work/origin.git"
git -C "$work/origin.git" fetch -q --depth=50 "file://$repo" "$B:refs/heads/main"
git -C "$work/origin.git" cat-file -e "$A" || { echo "UPGRADE_REHEARSAL=REFUSED CODE=STAGE1_NOT_IN_HISTORY"; exit 1; }
git -C "$repo" show "$A:deploy/release-governance/ai-functional-release.sh" >"$work/op-stage1.sh"
[[ "$(git -C "$repo" show "$A:deploy/article-intel-pilot/Caddyfile" | sha256sum | cut -d' ' -f1)" == "$STAGE1_CADDY" ]] \
  || { echo "UPGRADE_REHEARSAL=REFUSED CODE=STAGE1_CADDY_UNEXPECTED"; exit 1; }

# Target release T: B itself when B changes the pilot Caddyfile, else a synthetic child of B whose only
# change is a comment in the Caddyfile (exercises the transition without inventing routes).
if [[ "$(git -C "$repo" show "$B:deploy/article-intel-pilot/Caddyfile" | sha256sum | cut -d' ' -f1)" != "$STAGE1_CADDY" ]]; then
  T="$B"; T_KIND=b-changes-caddy
else
  git clone -q -b main "$work/origin.git" "$work/tclone"
  printf '\n# rehearsal-only: Stage 1 -> new Caddyfile transition (no route change)\n' >>"$work/tclone/deploy/article-intel-pilot/Caddyfile"
  git -C "$work/tclone" -c user.email=rehearsal@invalid -c user.name=rehearsal commit -qam "rehearsal: synthetic Caddyfile transition"
  git -C "$work/tclone" push -q origin HEAD:main
  T="$(git -C "$work/tclone" rev-parse HEAD)"; T_KIND=synthetic-comment-only
fi
echo "UPGRADE_TARGET=$T KIND=$T_KIND"
T_CADDY="$(git -C "$work/origin.git" show "$T:deploy/article-intel-pilot/Caddyfile" | sha256sum | cut -d' ' -f1)"
T_HAS_ADMIN_ROUTES=0
git -C "$work/origin.git" show "$T:deploy/article-intel-pilot/Caddyfile" | grep -q '@pilotAiAdminWrite' && T_HAS_ADMIN_ROUTES=1

# ---- stand-in images ---------------------------------------------------------------------------
cat >"$work/summary.Caddyfile" <<'EOF'
:8788 {
	@me path /api/ai/v1/models
	handle /healthz {
		header Content-Type application/json
		respond `{"status":"ok"}` 200
	}
	@auth {
		path /api/ai/v1/models
		header X-NewsFlux-Miniflux-Server *
	}
	handle @auth {
		header Content-Type application/json
		respond `{"schema_version":"1","request_id":null,"error":{"code":"UNAUTHENTICATED","retryable":false}}` 401
	}
	handle @me {
		header Content-Type application/json
		respond `{"schema_version":"1","request_id":null,"error":{"code":"NOT_AUTHORIZED","retryable":false}}` 403
	}
	respond 404
}
EOF
mk_image() { # tag revision kind
  local dir="$work/img-${1//[:\/]/_}"
  mkdir -p "$dir"
  if [[ "$3" == summary ]]; then
    cp "$work/summary.Caddyfile" "$dir/Caddyfile"
    printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nCOPY Caddyfile /etc/caddy/Caddyfile\nHEALTHCHECK --interval=1s --timeout=2s --retries=3 CMD wget -qO- http://127.0.0.1:8788/healthz | grep -q ok\n' "$CADDY_IMAGE" "$2" >"$dir/Dockerfile"
  else
    printf '<!doctype html><div id="root"></div><!-- %s %s -->\n' "$3" "$2" >"$dir/index.html"
    printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nCOPY index.html /srv/index.html\n' "$CADDY_IMAGE" "$2" >"$dir/Dockerfile"
  fi
  docker build -q -t "$1" "$dir" >/dev/null
}
PREV="$(printf 'f%.0s' {1..40})"
mk_image nfup-summary:previous "$PREV" summary
mk_image nfup-reader:previous "$PREV" reader
for sha in "$A" "$B" "$T"; do
  mk_image "newsflux-summary:$sha" "$sha" summary
  mk_image "newsflux-reader:$sha" "$sha" reader
done

# ---- pre-Stage1 "production" ---------------------------------------------------------------------
git -C "$repo" show a398387905bf399ca767c6c25fa32b7fc00f3620:deploy/article-intel-pilot/Caddyfile >"$work/stack/Caddyfile"
[[ "$(sha256sum "$work/stack/Caddyfile" | cut -d' ' -f1)" == "$PILOT_OLD" ]]
npm_ip=172.29.1.10
docker network create --subnet 172.29.1.0/24 nfup-npm >/dev/null
docker run -d --name miniflux --network nfup-npm busybox:1.36.1 sleep 3600 >/dev/null
docker run -d --name miniflux-db --network nfup-npm busybox:1.36.1 sleep 3600 >/dev/null
docker run -d --name litellm --network nfup-npm busybox:1.36.1 sleep 3600 >/dev/null
docker run -d --name content-fallback --network nfup-npm busybox:1.36.1 sleep 3600 >/dev/null
cat >"$work/stack/compose.yaml" <<EOF
services:
  newsflux:
    container_name: newsflux
    image: nfup-reader:previous
    environment:
      NEWSFLUX_PILOT_TRUSTED_PROXY_IP: $npm_ip
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
    networks: [npm, summary_private]
  summary-api:
    image: nfup-summary:previous
    environment:
      NEWSFLUX_AI_ALLOWED_WEB_ORIGINS: https://news.rehearsal.test
      NEWSFLUX_AI_MINIFLUX_BASE_URL: https://miniflux.rehearsal.test
      NEWSFLUX_AI_INFERENCE_ENABLED: "false"
    networks: [summary_private]
networks:
  npm: { external: true, name: nfup-npm }
  summary_private: { internal: true }
EOF
printf 'services:\n  summary-api:\n    environment:\n      LAYER: "2"\n' >"$work/stack/compose.layer2.yaml"
docker compose -p newsflux --project-directory "$work/stack" -f "$work/stack/compose.yaml" -f "$work/stack/compose.layer2.yaml" up -d --wait >/dev/null
cat >"$work/npm.Caddyfile" <<'EOF'
{
	local_certs
}
news.rehearsal.test {
	tls internal
	reverse_proxy newsflux:2000 {
		header_up X-Forwarded-Proto https
	}
}
EOF
docker run -d --name npm-front --network nfup-npm --ip "$npm_ip" -v "$work/npm.Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
for _ in $(seq 1 30); do docker exec npm-front test -f /data/caddy/pki/authorities/local/root.crt && break; sleep 1; done
docker cp npm-front:/data/caddy/pki/authorities/local/root.crt "$work/ca.crt" >/dev/null

export NEWSFLUX_REPO_URL="file://$work/origin.git" NEWSFLUX_RELEASE_ROOT="$work/releases" \
  NEWSFLUX_RELEASE_LOCK="$work/release.lock" NEWSFLUX_PUBLIC_CURL_RESOLVE="news.rehearsal.test:443:$npm_ip" \
  NEWSFLUX_PUBLIC_CURL_CACERT="$work/ca.crt"
opA() { APPROVED_SHA="$A" bash "$work/op-stage1.sh" "$@"; }
opB() { APPROVED_SHA="$B" bash "$here/ai-functional-release.sh" "$@"; }
opT() { APPROVED_SHA="$T" bash "$here/ai-functional-release.sh" "$@"; }
opN() { APPROVED_SHA="$A" bash "$here/ai-functional-release.sh" "$@"; }  # this script on a Caddy-unchanged release
identity() { # container -> image id, compose config hash, compose file sequence
  docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}} {{index .Config.Labels "com.docker.compose.project.config_files"}}' "$1"
}
summary_ctr() { docker ps -q --filter label=com.docker.compose.project=newsflux --filter label=com.docker.compose.service=summary-api; }
outside() { docker inspect -f '{{.Name}} {{.Id}} {{.Image}} {{.State.StartedAt}}' miniflux miniflux-db npm-front litellm content-fallback; }
caddy_id() { stat -c '%i' "$work/stack/Caddyfile"; sha256sum "$work/stack/Caddyfile" | cut -d' ' -f1; }
in_ctr_caddy() { docker exec newsflux sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1; }
reader_ctr_id() { docker inspect -f '{{.Id}} {{.State.StartedAt}}' newsflux; }
state() { docker ps -a --no-trunc --format '{{.ID}} {{.Image}} {{.Status}}' | sed 's/Up [^)]*/Up/' | sort; find "$work/releases" -printf '%p %s %T@\n' | sort; caddy_id; }
inference_flag() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(summary_ctr)" | sed -n 's/^NEWSFLUX_AI_INFERENCE_ENABLED=//p'; }
public() { # method path -> HTTP status through NPM -> Reader Caddy (trusted proxy, TLS)
  curl -sS --noproxy '*' --max-time 10 --resolve "news.rehearsal.test:443:$npm_ip" --cacert "$work/ca.crt" \
    -o /dev/null -w '%{http_code}' -X "$1" "https://news.rehearsal.test$2"
}
outside_before="$(outside)"

# ---- 1. Stage 1 with the operator script at A ----------------------------------------------------
{ opA prepare && opA preflight && opA promote-summary && opA update-caddy && opA promote-reader && opA smoke; } >"$work/stage1.out" 2>&1 \
  && ok STAGE1_INSTALLED_WITH_SCRIPT_A || { tail -5 "$work/stage1.out"; ko STAGE1_INSTALLED_WITH_SCRIPT_A; }
stage1_summary="$(identity "$(summary_ctr)")"
stage1_reader="$(identity newsflux)"
stage1_caddy="$(caddy_id)"
[[ "$(tail -1 <<<"$stage1_caddy")" != "$PILOT_OLD" ]] && ok STAGE1_PILOT_ROUTE_ACTIVE || ko STAGE1_PILOT_ROUTE_ACTIVE

# ---- 2. A release that does not change the Caddyfile is a verified no-op ------------------------
noop_before="$(caddy_id)"
opN update-caddy >"$work/noop.out" 2>&1 && grep -qx 'CADDY_UPDATE=ALREADY_APPLIED' "$work/noop.out" \
  && [[ "$(caddy_id)" == "$noop_before" ]] && ok UNCHANGED_CADDY_RELEASE_IS_NOOP || { cat "$work/noop.out"; ko UNCHANGED_CADDY_RELEASE_IS_NOOP; }
opN rollback-caddy >"$work/noop-rb.out" 2>&1 && grep -qx 'CADDY_ROLLBACK=NOT_APPLICABLE_UNCHANGED_BY_THIS_RELEASE' "$work/noop-rb.out" \
  && ok UNCHANGED_CADDY_ROLLBACK_NOOP_VERIFIED || { cat "$work/noop-rb.out"; ko UNCHANGED_CADDY_ROLLBACK_NOOP_VERIFIED; }

# ---- 3. Upgrade to T (Stage 1 Caddyfile -> T Caddyfile) --------------------------------------------
[[ "$T_CADDY" != "$STAGE1_CADDY" ]] && ok TARGET_CHANGES_CADDYFILE || ko TARGET_CHANGES_CADDYFILE
opT prepare >/dev/null && ok UPGRADE_PREPARE || ko UPGRADE_PREPARE
before="$(state)"
opT preflight >"$work/preflight.out" 2>&1 && grep -qx "ACTIVE_CADDY_SHA256=$STAGE1_CADDY" "$work/preflight.out" \
  && ok CADDY_PREFLIGHT_ACCEPTS_STAGE1 || { tail -3 "$work/preflight.out"; ko CADDY_PREFLIGHT_ACCEPTS_STAGE1; }
[[ "$(state)" == "$before" ]] && ok UPGRADE_PREFLIGHT_READ_ONLY || ko UPGRADE_PREFLIGHT_READ_ONLY
# Stage 1 -> preflight failure: an unknown live Caddyfile blocks, read-only.
cp -p "$work/stack/Caddyfile" "$work/Caddyfile.stage1"
printf '\n# unreviewed edit\n' >>"$work/stack/Caddyfile"
drift_state="$(state)"
if opT preflight >"$work/preflight-drift.out" 2>&1; then ko CADDY_PREFLIGHT_BLOCKS_DRIFT; else
  grep -qx 'CODE=ACTIVE_CADDY_DRIFT' "$work/preflight-drift.out" && [[ "$(state)" == "$drift_state" ]] \
    && ok CADDY_PREFLIGHT_BLOCKS_DRIFT || { tail -3 "$work/preflight-drift.out"; ko CADDY_PREFLIGHT_BLOCKS_DRIFT; }
fi
cat "$work/Caddyfile.stage1" >"$work/stack/Caddyfile"
[[ "$(caddy_id)" == "$stage1_caddy" ]] && ok STAGE1_CADDY_REESTABLISHED || ko STAGE1_CADDY_REESTABLISHED
[[ "$(opT s5-attestation-path)" == "$work/releases/ai-functional-${T:0:12}/s5-key-attestation.json" ]] \
  && ok ATTESTATION_PATH_IS_RELEASE_DIR || ko ATTESTATION_PATH_IS_RELEASE_DIR

opT promote-summary >/dev/null 2>&1 && ok UPGRADE_PROMOTE_SUMMARY || ko UPGRADE_PROMOTE_SUMMARY
# Summary-only is not a supported strategy: smoke demands both services on T.
if opT smoke >"$work/smoke-partial.out" 2>&1; then ko SUMMARY_ONLY_UPGRADE_FAILS_SMOKE; else
  grep -qx 'CODE=READER_REVISION' "$work/smoke-partial.out" && ok SUMMARY_ONLY_UPGRADE_FAILS_SMOKE || { tail -3 "$work/smoke-partial.out"; ko SUMMARY_ONLY_UPGRADE_FAILS_SMOKE; }
fi

# Failure injection (disposable release root only). Each must leave Stage 1 bytes, inode and the
# in-container view intact, and must not recreate the Reader container.
reader_before="$(reader_ctr_id)"
for fault in caddy-before-write caddy-during-write caddy-reload; do
  case "$fault" in
    caddy-before-write) want=REHEARSAL_FAULT_BEFORE_WRITE gate_name=CADDY_FAULT_BEFORE_WRITE_SAFE ;;
    caddy-during-write) want=WRITE_FAILED_RESTORED gate_name=CADDY_FAULT_DURING_WRITE_RESTORED ;;
    caddy-reload) want=RELOAD_FAILED_RESTORED gate_name=CADDY_FAULT_RELOAD_RESTORED ;;
  esac
  if NEWSFLUX_REHEARSAL_FAULT="$fault" opT update-caddy >"$work/fault-$fault.out" 2>&1; then ko "$gate_name"; else
    grep -qx "CODE=$want" "$work/fault-$fault.out" && [[ "$(caddy_id)" == "$stage1_caddy" ]] \
      && [[ "$(in_ctr_caddy)" == "$STAGE1_CADDY" ]] && ok "$gate_name" || { cat "$work/fault-$fault.out"; ko "$gate_name"; }
  fi
done

opT update-caddy >"$work/caddy.out" 2>&1 && grep -qx 'CADDY_UPDATE=PASS' "$work/caddy.out" \
  && grep -qx "CADDY_FROM_SHA256=$STAGE1_CADDY" "$work/caddy.out" && ok CADDY_UPDATE_FROM_STAGE1 || { cat "$work/caddy.out"; ko CADDY_UPDATE_FROM_STAGE1; }
[[ "$(caddy_id)" == "$(head -1 <<<"$stage1_caddy")"$'\n'"$T_CADDY" ]] && ok CADDY_TARGET_HASH_SAME_INODE || { caddy_id; ko CADDY_TARGET_HASH_SAME_INODE; }
[[ "$(in_ctr_caddy)" == "$T_CADDY" ]] && ok CADDY_READBACK_IN_CONTAINER || ko CADDY_READBACK_IN_CONTAINER
[[ "$(reader_ctr_id)" == "$reader_before" ]] && ok READER_NOT_RECREATED_BY_CADDY_UPDATE || ko READER_NOT_RECREATED_BY_CADDY_UPDATE
cdir="$work/releases/ai-functional-${T:0:12}/caddy"
cmp -s "$cdir/before.Caddyfile" "$work/Caddyfile.stage1" && [[ "$(stat -c %a "$cdir")" == 700 ]] \
  && [[ "$(stat -c %a "$cdir/before.Caddyfile")" == 600 ]] && [[ "$(cat "$cdir/before.sha256")" == "$STAGE1_CADDY" ]] \
  && ok CADDY_BACKUP_EXACT_AND_PRIVATE || ko CADDY_BACKUP_EXACT_AND_PRIVATE
opT update-caddy >"$work/caddy-again.out" 2>&1 && grep -qx 'CADDY_UPDATE=ALREADY_APPLIED_BY_THIS_RELEASE' "$work/caddy-again.out" \
  && [[ "$(in_ctr_caddy)" == "$T_CADDY" ]] && ok CADDY_UPDATE_IDEMPOTENT || { cat "$work/caddy-again.out"; ko CADDY_UPDATE_IDEMPOTENT; }

# Routes through NPM -> Reader Caddy. The Summary stand-in answers 404 to admin paths it receives;
# the Reader's catchall answers 403 to anything it does not forward.
routes_ok=1
if [[ "$T_HAS_ADMIN_ROUTES" == 1 ]]; then
  for probe in "GET /api/ai/v1/admin/litellm/status 404" "GET /api/ai/v1/admin/litellm/models 404" \
    "GET /api/ai/v1/admin/litellm/policy 404" "POST /api/ai/v1/admin/litellm/test-key 404" \
    "POST /api/ai/v1/admin/litellm/save-key 404" "POST /api/ai/v1/admin/litellm/save-policy 404" \
    "POST /api/ai/v1/admin/litellm/approve-model 404" "POST /api/ai/v1/admin/litellm/remove-model 404" \
    "OPTIONS /api/ai/v1/admin/litellm/save-key 404" \
    "POST /api/ai/v1/admin/litellm/status 403" "GET /api/ai/v1/admin/litellm/save-key 403" \
    "DELETE /api/ai/v1/admin/litellm/policy 403" "GET /api/ai/v1/admin/litellm/delete-key 403" \
    "POST /api/ai/v1/admin/litellm/save-key/extra 403" "GET /api/ai/v1/admin/litellm 403" \
    "OPTIONS /api/ai/v1/admin/litellm/delete-key 403" "GET /api/ai/v1/keys 403"; do
    read -r m p want <<<"$probe"
    got="$(public "$m" "$p")"
    [[ "$got" == "$want" ]] || { echo "route $m $p want=$want got=$got"; routes_ok=0; }
  done
  [[ "$routes_ok" == 1 ]] && ok ADMIN_ROUTES_METHODS_AND_CATCHALL_403 || ko ADMIN_ROUTES_METHODS_AND_CATCHALL_403
else
  for p in /api/ai/v1/admin/litellm/status /api/ai/v1/keys; do
    [[ "$(public GET "$p")" == 403 ]] || routes_ok=0
  done
  [[ "$routes_ok" == 1 ]] && ok ADMIN_ROUTES_NOT_EXPOSED_WITHOUT_ROUTE_CHANGE || ko ADMIN_ROUTES_NOT_EXPOSED_WITHOUT_ROUTE_CHANGE
fi

opT promote-reader >/dev/null 2>&1 && ok UPGRADE_PROMOTE_READER || ko UPGRADE_PROMOTE_READER
[[ "$(in_ctr_caddy)" == "$T_CADDY" ]] && ok CADDY_SURVIVES_READER_PROMOTION || ko CADDY_SURVIVES_READER_PROMOTION
opT smoke >"$work/smoke.out" 2>&1 && grep -qx 'CATALOG_SMOKE=PASS' "$work/smoke.out" && ok UPGRADE_SMOKE_BOTH_ON_TARGET || { tail -3 "$work/smoke.out"; ko UPGRADE_SMOKE_BOTH_ON_TARGET; }
grep -qx 'INFERENCE_ENABLED=false' "$work/smoke.out" && ok INFERENCE_STILL_DISABLED || ko INFERENCE_STILL_DISABLED
grep -qx "ACTIVE_CADDY_SHA256=$T_CADDY" "$work/smoke.out" && ok RECEIPT_RECORDS_TARGET_CADDY || ko RECEIPT_RECORDS_TARGET_CADDY
[[ "$(outside)" == "$outside_before" ]] && ok OUTSIDE_SERVICES_UNCHANGED_AFTER_UPGRADE || ko OUTSIDE_SERVICES_UNCHANGED_AFTER_UPGRADE

# ---- 4. Rollback of T restores Stage 1 exactly ---------------------------------------------------
opT rollback-reader >/dev/null 2>&1 && ok ROLLBACK_READER || ko ROLLBACK_READER
opT rollback-caddy >"$work/rbcaddy.out" 2>&1 && grep -qx 'CADDY_ROLLBACK=PASS' "$work/rbcaddy.out" \
  && ok CADDY_ROLLBACK_TO_STAGE1 || { cat "$work/rbcaddy.out"; ko CADDY_ROLLBACK_TO_STAGE1; }
[[ "$(in_ctr_caddy)" == "$STAGE1_CADDY" ]] && ok CADDY_ROLLBACK_READBACK_IN_CONTAINER || ko CADDY_ROLLBACK_READBACK_IN_CONTAINER
opT rollback-summary >/dev/null 2>&1 && ok ROLLBACK_SUMMARY || ko ROLLBACK_SUMMARY
[[ "$(identity "$(summary_ctr)")" == "$stage1_summary" ]] && ok SUMMARY_EXACTLY_STAGE1 || { echo "want $stage1_summary"; echo "got  $(identity "$(summary_ctr)")"; ko SUMMARY_EXACTLY_STAGE1; }
[[ "$(identity newsflux)" == "$stage1_reader" ]] && ok READER_EXACTLY_STAGE1 || { echo "want $stage1_reader"; echo "got  $(identity newsflux)"; ko READER_EXACTLY_STAGE1; }
[[ "$(caddy_id)" == "$stage1_caddy" ]] && ok CADDY_EXACTLY_STAGE1 || ko CADDY_EXACTLY_STAGE1
{ opT rollback-reader && opT rollback-caddy && opT rollback-summary; } >"$work/rb-again.out" 2>&1 \
  && grep -qx 'CADDY_ROLLBACK=ALREADY_RESTORED' "$work/rb-again.out" \
  && [[ "$(identity "$(summary_ctr)")" == "$stage1_summary" && "$(identity newsflux)" == "$stage1_reader" && "$(caddy_id)" == "$stage1_caddy" ]] \
  && ok ROLLBACK_IDEMPOTENT || { cat "$work/rb-again.out"; ko ROLLBACK_IDEMPOTENT; }
[[ "$(inference_flag)" == false ]] && ok INFERENCE_FLAG_PRESERVED_AFTER_ROLLBACK || ko INFERENCE_FLAG_PRESERVED_AFTER_ROLLBACK

# An external edit after the update is reported, never silently "restored", and the file is untouched.
opT update-caddy >"$work/caddy-redo.out" 2>&1 && grep -qx 'CADDY_UPDATE=PASS' "$work/caddy-redo.out" \
  && ok CADDY_REAPPLY_FROM_STAGE1 || { cat "$work/caddy-redo.out"; ko CADDY_REAPPLY_FROM_STAGE1; }
cp -p "$work/stack/Caddyfile" "$work/Caddyfile.keep"
printf '\n# drift\n' >>"$work/stack/Caddyfile"
drifted="$(caddy_id)"
if opT rollback-caddy >"$work/drift.out" 2>&1; then ko CADDY_DRIFT_DETECTED; else
  grep -qx 'CODE=DRIFT_SINCE_RELEASE' "$work/drift.out" && [[ "$(caddy_id)" == "$drifted" ]] \
    && ok CADDY_DRIFT_DETECTED || { cat "$work/drift.out"; ko CADDY_DRIFT_DETECTED; }
fi
cat "$work/Caddyfile.keep" >"$work/stack/Caddyfile"
opT rollback-caddy >/dev/null 2>&1 && [[ "$(caddy_id)" == "$stage1_caddy" && "$(in_ctr_caddy)" == "$STAGE1_CADDY" ]] \
  && ok CADDY_ROLLBACK_AFTER_DRIFT_RESOLVED || ko CADDY_ROLLBACK_AFTER_DRIFT_RESOLVED
opA smoke >"$work/smoke-stage1.out" 2>&1 && ok STAGE1_SMOKE_PASSES_AFTER_ROLLBACK || { tail -3 "$work/smoke-stage1.out"; ko STAGE1_SMOKE_PASSES_AFTER_ROLLBACK; }

# ---- 5. Nothing outside the release changed --------------------------------------------------------
[[ "$(outside)" == "$outside_before" ]] && ok MINIFLUX_NPM_LITELLM_FALLBACK_UNCHANGED || ko MINIFLUX_NPM_LITELLM_FALLBACK_UNCHANGED
[[ -z "$(docker network ls -q --filter name=wallhop)$(docker ps -aq --filter name=wallhop)" ]] && ok NO_WALLHOP_RESOURCES || ko NO_WALLHOP_RESOURCES

echo "UPGRADE_PASSED=$pass UPGRADE_FAILED=$fail"
[[ "$fail" -eq 0 ]]
