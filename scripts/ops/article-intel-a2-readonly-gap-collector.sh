#!/usr/bin/env bash
set -uo pipefail

# Targeted, read-only collector for the remaining Article Intelligence A2 design gaps.
# Run directly on the OMV host after reviewing the script. It does not contact providers,
# inspect container environment variables, read application config/secrets, or mutate Docker/firewall state.

readonly EXPECTED_DOCKER_ROOT='/dockerdata/docker'
readonly EXPECTED_DOCKER_VERSION='29.9.3'
readonly EXPECTED_NEWSFLUX_IMAGE='newsflux-local:1fdfd08dd201'
readonly EXPECTED_NEWSFLUX_IMAGE_ID='sha256:4ec48a15cd547aaa63bbbe40d910d93d3efc1d0c78f3fcbeb77ee1ae950fc641'

out() { printf '%s\n' "$*"; }
section() { out "\n[$*]"; }
has() { command -v "$1" >/dev/null 2>&1; }

if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" ]]; then
  out 'TARGET_GUARD=BLOCKED_DOCKER_OVERRIDE_SET (value suppressed)'
  exit 2
fi
if ! has docker; then
  out 'TARGET_GUARD=BLOCKED_DOCKER_UNAVAILABLE'
  exit 2
fi

docker_context=$(docker context show 2>/dev/null || true)
docker_endpoint=$(docker context inspect default --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null || true)
docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
docker_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)
newsflux_image=$(docker inspect newsflux --format '{{.Config.Image}}' 2>/dev/null || true)
newsflux_image_id=$(docker inspect newsflux --format '{{.Image}}' 2>/dev/null || true)

if [[ "$docker_context" != 'default' || "$docker_endpoint" != unix://* || "$docker_root" != "$EXPECTED_DOCKER_ROOT" || \
      "$docker_version" != "$EXPECTED_DOCKER_VERSION" || \
      "$newsflux_image" != "$EXPECTED_NEWSFLUX_IMAGE" || \
      "$newsflux_image_id" != "$EXPECTED_NEWSFLUX_IMAGE_ID" ]]; then
  out 'TARGET_GUARD=BLOCKED_TARGET_MISMATCH'
  out "observed_context=${docker_context:-unavailable}"
  out "observed_endpoint=${docker_endpoint:-unavailable}"
  out "observed_docker_root=${docker_root:-unavailable}"
  out "observed_docker_version=${docker_version:-unavailable}"
  out "observed_newsflux_image=${newsflux_image:-unavailable}"
  out "observed_newsflux_image_id=${newsflux_image_id:-unavailable}"
  out 'No further inventory was collected.'
  exit 2
fi

out 'TARGET_GUARD=PASS_OPERATOR_SUPPLIED_OMV_IDENTITY'
section 'HOST_AND_CAPACITY'
docker info --format 'DockerRootDir={{.DockerRootDir}} OperatingSystem={{.OperatingSystem}} ServerVersion={{.ServerVersion}} Architecture={{.Architecture}} CPUs={{.NCPU}} MemoryBytes={{.MemTotal}} CgroupVersion={{.CgroupVersion}} CgroupDriver={{.CgroupDriver}} SecurityOptions={{json .SecurityOptions}}' 2>/dev/null || out 'docker_info=UNAVAILABLE'
if [[ -r /proc/meminfo ]]; then
  awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {print $1 $2 $3}' /proc/meminfo
fi
if [[ -r /proc/pressure/memory ]]; then
  awk '{print "memory_pressure_" $1 "=" $2 " " $3 " " $4 " " $5}' /proc/pressure/memory
fi
if has vmstat; then
  vmstat 1 4 2>/dev/null | tail -n 4 | sed 's/^/vmstat_sample=/'
else
  out 'vmstat_sample=UNAVAILABLE'
fi
if has swapon; then
  swapon --show=TYPE,SIZE,USED,PRIO --noheadings 2>/dev/null | sed 's/^/swap_device=/' || out 'swap_devices=UNAVAILABLE'
fi
if has findmnt; then
  findmnt -T /dockerdata --noheadings --output TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | sed 's/^/dockerdata_mount=/' || out 'dockerdata_mount=UNAVAILABLE'
fi
df -PT /dockerdata 2>/dev/null | sed 's/^/dockerdata_disk=/' || out 'dockerdata_disk=UNAVAILABLE'

section 'SELECTED_CONTAINER_METADATA (no environment/config/logs)'
for container in newsflux miniflux litellm litellm-db newsflux-pr188-content-fallback npm nginx-proxy-manager; do
  if ! docker inspect "$container" >/dev/null 2>&1; then
    continue
  fi
  docker inspect --format 'container={{.Name}} image={{.Config.Image}} image_id={{.Image}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}} restart={{.HostConfig.RestartPolicy.Name}} mem_limit_bytes={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}} pids_limit={{.HostConfig.PidsLimit}} readonly_root={{.HostConfig.ReadonlyRootfs}} exposed_ports={{json .Config.ExposedPorts}} published_ports={{json .NetworkSettings.Ports}} compose_project={{index .Config.Labels "com.docker.compose.project"}} compose_service={{index .Config.Labels "com.docker.compose.service"}} compose_workdir={{index .Config.Labels "com.docker.compose.project.working_dir"}} compose_files={{index .Config.Labels "com.docker.compose.project.config_files"}} networks={{range $name,$net := .NetworkSettings.Networks}}{{$name}}:ip={{$net.IPAddress}}/{{$net.IPPrefixLen}},gateway={{$net.Gateway}},aliases={{json $net.Aliases}};{{end}} mounts={{range .Mounts}}{{.Type}}:{{.Source}}->{{.Destination}}:rw={{.RW}};{{end}}' "$container" 2>/dev/null || out "container=$container inspect=UNAVAILABLE"
done

section 'NETWORKS (current topology only)'
for network in npm-proxyyml_default ai_internal; do
  if ! docker network inspect "$network" >/dev/null 2>&1; then
    out "network=$network state=NOT_FOUND"
    continue
  fi
  docker network inspect --format 'network={{.Name}} id={{.Id}} driver={{.Driver}} scope={{.Scope}} internal={{.Internal}} attachable={{.Attachable}} enable_ipv6={{.EnableIPv6}} ipam={{json .IPAM.Config}} options={{json .Options}} endpoints={{range $id,$endpoint := .Containers}}{{$endpoint.Name}}:ip={{$endpoint.IPv4Address}}/ipv6={{$endpoint.IPv6Address}};{{end}}' "$network" 2>/dev/null || out "network=$network inspect=UNAVAILABLE"
done

section 'FIREWALL_BACKEND_AND_EFFECTIVE_DOCKER_PATHS (read-only)'
for family_tool in iptables ip6tables; do
  if ! has "$family_tool"; then
    out "$family_tool=UNAVAILABLE"
    continue
  fi
  "$family_tool" --version 2>&1 | sed "s/^/${family_tool}_version=/"
  save_tool="${family_tool}-save"
  if has "$save_tool"; then
    for table in filter nat; do
      "$save_tool" -t "$table" 2>/dev/null | sed -E \
        -e 's/ -m comment --comment ("[^"\\]*(\\.[^"\\]*)*"|[^ ]+)//g' \
        -e 's/--log-prefix ("[^"\\]*(\\.[^"\\]*)*"|[^ ]+)//g' \
        | sed "s/^/$family_tool:$table:/" || out "$family_tool:$table=UNAVAILABLE_OR_UNREADABLE"
    done
  else
    out "$family_tool-save=UNAVAILABLE"
  fi
done

if has nft; then
  nft --version 2>&1 | sed 's/^/nft_version=/'
  if has python3; then
    nft -j list ruleset 2>/dev/null | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    print("nft_ruleset=UNAVAILABLE_OR_UNREADABLE")
    raise SystemExit(0)
objects = doc.get("nftables", [])
selected_tables = set()

def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if k.casefold() not in {"comment", "prefix", "log"}}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value

for item in objects:
    chain = item.get("chain")
    if not chain:
        continue
    name = str(chain.get("name", ""))
    hook = str(chain.get("hook", ""))
    table = str(chain.get("table", ""))
    if hook in {"input", "forward", "output"} or "docker" in name.casefold() or "docker" in table.casefold() or "bridge" in table.casefold():
        selected_tables.add((str(chain.get("family", "")), table))
for item in objects:
    for kind, value in item.items():
        if not isinstance(value, dict):
            continue
        table = value.get("table")
        family = value.get("family")
        if table is not None and (str(family), str(table)) in selected_tables:
            print("nft_object=" + json.dumps({kind: clean(value)}, sort_keys=True))
' 2>/dev/null || out 'nft_ruleset=UNAVAILABLE_OR_UNREADABLE'
  else
    out 'nft_ruleset=PYTHON3_UNAVAILABLE'
  fi
else
  out 'nft=UNAVAILABLE'
fi

section 'OPERATOR_SUPPLIED_ROUTE_AND_BACKUP_DECISIONS'
out 'output_review=before sharing, redact sensitive internal addresses, interface names, and mount paths; retain firewall rule structure and ordering'
out 'miniflux_https_base_url=NOT_COLLECTED (supply the exact configured HTTPS origin separately; do not include API keys)'
out 'api_https_route=NOT_COLLECTED (state whether an existing approved route exists; this script does not inspect NPM credentials/config)'
if [[ -n "${A2_BACKUP_TARGET:-}" ]]; then
  if [[ "$A2_BACKUP_TARGET" == /* && -d "$A2_BACKUP_TARGET" ]]; then
    findmnt -T "$A2_BACKUP_TARGET" --noheadings --output TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | sed 's/^/backup_target_mount=/' || true
    df -PT "$A2_BACKUP_TARGET" 2>/dev/null | sed 's/^/backup_target_disk=/' || true
    stat -c 'backup_target_mode=%a owner_uid=%u owner_gid=%g type=%F' "$A2_BACKUP_TARGET" 2>/dev/null || true
  else
    out 'backup_target=INVALID_OR_UNAVAILABLE (path value suppressed)'
  fi
else
  out 'backup_target=NOT_PROVIDED'
fi

section 'MUTATION_GUARD'
out 'docker_mutations=0'
out 'firewall_mutations=0'
out 'provider_requests=0'
out 'secrets_read=0'
out 'compose_changes=0'
