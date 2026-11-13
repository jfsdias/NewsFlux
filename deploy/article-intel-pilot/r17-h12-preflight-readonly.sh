#!/usr/bin/env bash
# Read-only inventory. Run on OMV as an operator with existing Docker access.
set -euo pipefail
: "${SUMMARY_CONTAINER:?Set SUMMARY_CONTAINER to the exact Summary container name}"
: "${READER_CONTAINER:?Set READER_CONTAINER to the exact Reader container name}"
: "${NPM_CONTAINER:?Set NPM_CONTAINER to the exact NPM container name}"
: "${LEDGER_DIR:?Set LEDGER_DIR to the exact host ledger directory}"

echo 'FILESYSTEM (operator must confirm local filesystem and mount options):'
findmnt -T "$LEDGER_DIR" -o TARGET,SOURCE,FSTYPE,OPTIONS
echo 'LEDGER FILESYSTEM CAPACITY (operator must assess available space):'
df -Pk "$LEDGER_DIR"
echo 'SUMMARY MOUNTS (operator must confirm /data maps to LEDGER_DIR):'
docker inspect --format '{{range .Mounts}}{{println .Source "->" .Destination "rw=" .RW}}{{end}}' "$SUMMARY_CONTAINER"
echo 'READER NETWORKS:'
docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$READER_CONTAINER"
echo 'SUMMARY NETWORKS:'
docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$SUMMARY_CONTAINER"
echo 'OBSERVED HOST LOCKS (absence of a lock does not establish exclusivity):'
lslocks -o COMMAND,PID,TYPE,MODE,PATH | awk -v p="$LEDGER_DIR/usage.sqlite3.lock" 'NR==1 || index($0,p)'
echo 'NPM TIMEOUT DIRECTIVES (operator must evaluate inheritance for both NewsFlux vhosts):'
docker exec "$NPM_CONTAINER" nginx -T 2>&1 | awk '/^# configuration file/ || /proxy_(connect|send|read)_timeout/'
echo 'CADDY SUMMARY ROUTE CONFIGURATION:'
docker exec "$READER_CONTAINER" cat /etc/caddy/Caddyfile | awk '
  {
    line = $0
    sub(/^[[:space:]]+/, "", line)
    sub(/[[:space:]]+$/, "", line)
    gsub(/[[:space:]]+/, " ", line)
    if (line ~ /^#/ || line == "") next

    if (section == "") {
      if (line == "@pilotSummary {") {
        section = "matcher"; depth = 1; matcher_count++; matcher_line = NR; next
      }
      if (line == "handle @pilotSummary {") {
        section = "proxy"; depth = 1; proxy_count++; proxy_line = NR; next
      }
      if (line == "handle /api/ai/* {") {
        section = "fallback"; depth = 1; fallback_count++; fallback_line = NR; next
      }
      next
    }

    if (section == "matcher") {
      if (line == "path /api/ai/v1/entries/*/summary") matcher_path++
      else if (line == "remote_ip {$NEWSFLUX_PILOT_TRUSTED_PROXY_IP}") matcher_ip++
      else if (line == "header X-Forwarded-Proto https") matcher_https++
      else if (line != "}") matcher_extra++
    }
    if (section == "proxy") {
      if (depth == 1 && line == "reverse_proxy summary-api:8788 {") proxy_target++
      else if (depth == 2 && line == "header_up X-Forwarded-Proto https") proxy_https++
      else if (line != "}") proxy_extra++
    }
    if (section == "fallback") {
      if (depth == 1 && line == "respond 403") fallback_deny++
      else if (line != "}") fallback_extra++
    }

    if (line == "}") {
      depth--
      if (depth == 0) section = ""
      next
    }
    if (line ~ /\{[[:space:]]*$/) depth++
  }
  END {
    matcher_ok = matcher_count == 1 && matcher_path == 1 && matcher_ip == 1 && matcher_https == 1 && matcher_extra == 0
    proxy_ok = proxy_count == 1 && proxy_target == 1 && proxy_https == 1 && proxy_extra == 0
    fallback_ok = fallback_count == 1 && fallback_deny == 1 && fallback_extra == 0
    structure_ok = section == "" && depth == 0
    order_ok = matcher_ok && proxy_ok && fallback_ok && matcher_line < proxy_line && proxy_line < fallback_line
    all_ok = order_ok && structure_ok
    printf "CADDY_MATCHER_GATE=%s\n", matcher_ok ? "PASS" : "FAIL"
    printf "CADDY_PROXY_GATE=%s\n", proxy_ok ? "PASS" : "FAIL"
    printf "CADDY_AI_DENY_FALLBACK_GATE=%s\n", fallback_ok ? "PASS" : "FAIL"
    printf "CADDY_ROUTE_ORDER_GATE=%s\n", order_ok ? "PASS" : "FAIL"
    printf "CADDY_ROUTE_STATIC_GATE=%s\n", all_ok ? "PASS" : "FAIL"
    if (!all_ok) exit 1
  }
'
echo 'SUMMARY LIVENESS FROM READER NETWORK (requires wget in Reader):'
docker exec "$READER_CONTAINER" wget -qO- http://summary-api:8788/healthz
echo
echo 'MANUAL_GATES: verify vhost inheritance, exact mount and network, single owner, and end-to-end route before promotion.'
echo 'This inventory does not prove cross-container lock semantics; use the isolated CI harness and an approved OMV gate.'
