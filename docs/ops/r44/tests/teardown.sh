#!/usr/bin/env bash
T="$1"
[ -d "$T" ] && (cd "$T" && docker compose -p newsflux -f compose.yaml -f override.yaml down -v >/dev/null 2>&1)
docker rm -f miniflux miniflux-db npm >/dev/null 2>&1
docker network rm r44-mf >/dev/null 2>&1
rm -rf "$T"
true
