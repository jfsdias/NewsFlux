#!/usr/bin/env bash
# Read-only inventory. Run on OMV as an operator with existing Docker access.
set -euo pipefail
: "${SUMMARY_CONTAINER:?Set SUMMARY_CONTAINER to the exact Summary container name}"
: "${READER_CONTAINER:?Set READER_CONTAINER to the exact Reader container name}"
: "${NPM_CONTAINER:?Set NPM_CONTAINER to the exact NPM container name}"
: "${LEDGER_DIR:?Set LEDGER_DIR to the exact host ledger directory}"

echo 'FILESYSTEM (operator must confirm local filesystem and mount options):'
findmnt -T "$LEDGER_DIR" -o TARGET,SOURCE,FSTYPE,OPTIONS
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
docker exec "$READER_CONTAINER" cat /etc/caddy/Caddyfile | awk '/pilotSummary/,/^}/'
echo 'SUMMARY LIVENESS FROM READER NETWORK (requires wget in Reader):'
docker exec "$READER_CONTAINER" wget -qO- http://summary-api:8788/healthz
echo
echo 'MANUAL_GATES: verify vhost inheritance, exact mount and network, single owner, and end-to-end route before promotion.'
echo 'This inventory does not prove cross-container lock semantics; use the isolated CI harness and an approved OMV gate.'
