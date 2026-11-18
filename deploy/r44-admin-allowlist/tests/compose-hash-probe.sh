#!/usr/bin/env bash
# Diagnostic (test topology only): compare the running config-hash label with `config --hash` rendered
# several ways, to find Compose-version differences. Prints hashes and booleans only.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; H="$(mktemp -d)"; T="$H/topo"
bash "$here/setup.sh" "$T"
cid="$(docker ps -aq --filter label=com.docker.compose.service=summary-api)"
lab() { docker inspect -f "{{index .Config.Labels \"$1\"}}" "$cid"; }
echo "LABEL_HASH=$(lab com.docker.compose.config-hash)"
echo "LABEL_FILES=$(lab com.docker.compose.project.config_files | tr ',' '\n' | xargs -n1 basename | paste -sd,)"
echo "LABEL_ENVFILE_SET=$([ -n "$(lab com.docker.compose.project.environment_file)" ] && echo YES || echo NO)"
wd="$(lab com.docker.compose.project.working_dir)"
echo "A_TOOL_ARGS=$(docker compose -p newsflux --project-directory "$wd" -f "$T/compose.yaml" -f "$T/override.yaml" config --hash summary-api | awk '{print $2}')"
echo "B_CWD_ARGS=$(cd "$T" && docker compose -p newsflux -f compose.yaml -f override.yaml config --hash summary-api | awk '{print $2}')"
echo "C_TOOL_ARGS_ENVFILE=$(docker compose -p newsflux --project-directory "$wd" --env-file "$T/.env" -f "$T/compose.yaml" -f "$T/override.yaml" config --hash summary-api | awk '{print $2}')"
(cd "$T" && docker compose -p newsflux -f compose.yaml -f override.yaml up -d --no-deps --no-build --pull never summary-api >/dev/null 2>&1)
cid2="$(docker ps -aq --filter label=com.docker.compose.service=summary-api)"
echo "UP_AGAIN_RECREATED=$([ "$cid" = "$cid2" ] && echo NO || echo YES)"
echo "LABEL_HASH_AFTER_UP=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$cid2")"
bash "$here/teardown.sh" "$T"
