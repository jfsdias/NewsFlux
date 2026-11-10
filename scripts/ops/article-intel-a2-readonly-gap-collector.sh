#!/usr/bin/env bash
set -uo pipefail

# Targeted, read-only collector for the remaining Article Intelligence A2 design gaps.
# Run directly on the OMV host after reviewing the script. It does not contact providers,
# inspect container environment variables, read application config/secrets, or mutate Docker/firewall state.

readonly EXPECTED_DOCKER_ROOT='/dockerdata/docker'
readonly EXPECTED_DOCKER_VERSION='29.9.3'
readonly EXPECTED_NEWSFLUX_IMAGE='newsflux-local:70f0d0c3c90b'
readonly EXPECTED_NEWSFLUX_IMAGE_ID='sha256:9f2cd31257d1857b7bb6341f6e9c8a9b619c970cb2ffd12a80aac4561dd7dd95'

out() { printf '%s\n' "$*"; }
section() { printf '\n[%s]\n' "$*"; }
has() { command -v "$1" >/dev/null 2>&1; }
collector_completeness='NOT_STARTED'
section_status() { out "SECTION_STATUS=$1:AVAILABLE"; }
section_unavailable() {
  collector_completeness='PARTIAL'
  out "SECTION_UNAVAILABLE=$1"
}

if [[ ${DOCKER_HOST+x} || ${DOCKER_CONTEXT+x} || ${DOCKER_CONFIG+x} ]]; then
  out 'TARGET_GUARD=BLOCKED_DOCKER_ENV_OVERRIDE_SET (values suppressed)'
  out 'COLLECTOR_COMPLETENESS=NOT_STARTED_TARGET_GUARD_BLOCKED'
  exit 2
fi
if ! has docker; then
  out 'TARGET_GUARD=BLOCKED_DOCKER_UNAVAILABLE'
  out 'COLLECTOR_COMPLETENESS=NOT_STARTED_TARGET_GUARD_BLOCKED'
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
  out 'COLLECTOR_COMPLETENESS=NOT_STARTED_TARGET_GUARD_BLOCKED'
  out 'Target identity values are suppressed.'
  out 'No further inventory was collected.'
  exit 2
fi

out 'TARGET_GUARD=PASS_OPERATOR_SUPPLIED_OMV_IDENTITY'
collector_completeness='COMPLETE'
section 'HOST_AND_CAPACITY'
if docker info --format 'DockerRootDir={{.DockerRootDir}} OperatingSystem={{.OperatingSystem}} ServerVersion={{.ServerVersion}} Architecture={{.Architecture}} CPUs={{.NCPU}} MemoryBytes={{.MemTotal}} CgroupVersion={{.CgroupVersion}} CgroupDriver={{.CgroupDriver}} SecurityOptions={{json .SecurityOptions}}' 2>/dev/null; then
  section_status 'HOST_DOCKER_INFO'
else
  out 'docker_info=UNAVAILABLE'
  section_unavailable 'HOST_DOCKER_INFO'
fi
if [[ -r /proc/meminfo ]] && awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {print $1 $2 $3}' /proc/meminfo; then
  section_status 'HOST_MEMINFO'
else
  section_unavailable 'HOST_MEMINFO'
fi
if [[ -r /proc/pressure/memory ]] && awk '{print "memory_pressure_" $1 "=" $2 " " $3 " " $4 " " $5}' /proc/pressure/memory; then
  section_status 'HOST_MEMORY_PRESSURE'
else
  out 'memory_pressure=UNAVAILABLE'
  section_unavailable 'HOST_MEMORY_PRESSURE'
fi
if has vmstat; then
  if vmstat 1 4 2>/dev/null | tail -n 4 | sed 's/^/vmstat_sample=/'; then
    section_status 'HOST_VMSTAT'
  else
    out 'vmstat_sample=UNAVAILABLE'
    section_unavailable 'HOST_VMSTAT'
  fi
else
  out 'vmstat_sample=UNAVAILABLE'
  section_unavailable 'HOST_VMSTAT'
fi
if has swapon; then
  if swapon --show=TYPE,SIZE,USED,PRIO --noheadings 2>/dev/null | sed 's/^/swap_device=/'; then
    section_status 'HOST_SWAP'
  else
    out 'swap_devices=UNAVAILABLE'
    section_unavailable 'HOST_SWAP'
  fi
else
  out 'swap_devices=UNAVAILABLE'
  section_unavailable 'HOST_SWAP'
fi
if has findmnt; then
  if findmnt -T /dockerdata --noheadings --output TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | sed 's/^/dockerdata_mount=/'; then
    section_status 'DOCKERDATA_MOUNT'
  else
    out 'dockerdata_mount=UNAVAILABLE'
    section_unavailable 'DOCKERDATA_MOUNT'
  fi
else
  out 'dockerdata_mount=UNAVAILABLE'
  section_unavailable 'DOCKERDATA_MOUNT'
fi
if df -PT /dockerdata 2>/dev/null | sed 's/^/dockerdata_disk=/'; then
  section_status 'DOCKERDATA_DISK'
else
  out 'dockerdata_disk=UNAVAILABLE'
  section_unavailable 'DOCKERDATA_DISK'
fi

container_format='container={{.Name}} image={{.Config.Image}} image_id={{.Image}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}} restart={{.HostConfig.RestartPolicy.Name}} mem_limit_bytes={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}} pids_limit={{.HostConfig.PidsLimit}} readonly_root={{.HostConfig.ReadonlyRootfs}} exposed_ports={{json .Config.ExposedPorts}} published_ports={{json .NetworkSettings.Ports}} compose_project={{index .Config.Labels "com.docker.compose.project"}} compose_service={{index .Config.Labels "com.docker.compose.service"}} compose_workdir={{index .Config.Labels "com.docker.compose.project.working_dir"}} compose_files={{index .Config.Labels "com.docker.compose.project.config_files"}} networks={{range $name,$net := .NetworkSettings.Networks}}{{$name}}:ip={{$net.IPAddress}}/{{$net.IPPrefixLen}},gateway={{$net.Gateway}},aliases={{json $net.Aliases}};{{end}} mounts={{range .Mounts}}{{.Type}}:{{.Source}}->{{.Destination}}:rw={{.RW}};{{end}}'
classify_inspect_error() {
  local error_text="${1,,}"
  case "$error_text" in
    *'map has no entry for key "nanocpus"'*|*'<.hostconfig.nanocpus>'*)
      out 'TEMPLATE_MISSING_FIELD_NANO_CPUS' ;;
    *'map has no entry for key '*|*'nil pointer evaluating'*)
      out 'TEMPLATE_MISSING_FIELD' ;;
    *'template parsing error'*)
      out 'TEMPLATE_PARSE_ERROR' ;;
    *'template:'*|*"can't evaluate field"*)
      out 'TEMPLATE_EXECUTION_ERROR' ;;
    *'cannot connect to the docker daemon'*|*'error during connect'*)
      out 'DOCKER_CONNECTION_ERROR' ;;
    *'error response from daemon:'*)
      out 'DOCKER_API_ERROR' ;;
    *)
      out 'OTHER_DOCKER_INSPECT_ERROR' ;;
  esac
}
inspect_container() {
  local container="$1"
  local inspect_output
  if ! docker inspect "$container" >/dev/null 2>&1; then
    out "container=$container state=NOT_FOUND_OR_UNAVAILABLE"
    return 1
  fi
  if inspect_output=$(docker inspect --format "$container_format" "$container" 2>&1); then
    out "$inspect_output"
    return 0
  fi
  out "container=$container inspect=UNAVAILABLE inspect_error_class=$(classify_inspect_error "$inspect_output")"
  return 1
}

section 'SELECTED_CONTAINER_METADATA (no environment/config/logs)'
for container in newsflux miniflux litellm litellm-db newsflux-pr188-content-fallback; do
  if inspect_container "$container"; then
    section_status "container:$container"
  else
    section_unavailable "container:$container"
  fi
done
proxy_container_found=0
for container in npm nginx-proxy-manager; do
  if docker inspect "$container" >/dev/null 2>&1; then
    proxy_container_found=1
    if inspect_container "$container"; then
      section_status "container:$container"
    else
      section_unavailable "container:$container"
    fi
  else
    out "container=$container state=NOT_FOUND_OR_UNAVAILABLE (alternate proxy name)"
  fi
done
if [[ "$proxy_container_found" -eq 0 ]]; then
  section_unavailable 'container:reverse_proxy (npm/nginx-proxy-manager)'
fi

section 'NETWORKS (current topology only)'
for network in npm-proxyyml_default ai_internal; do
  if ! docker network inspect "$network" >/dev/null 2>&1; then
    out "network=$network state=NOT_FOUND_OR_UNAVAILABLE"
    section_unavailable "network:$network"
    continue
  fi
  if docker network inspect --format 'network={{.Name}} id={{.Id}} driver={{.Driver}} scope={{.Scope}} internal={{.Internal}} attachable={{.Attachable}} enable_ipv6={{.EnableIPv6}} ipam={{json .IPAM.Config}} options={{json .Options}} endpoints={{range $id,$endpoint := .Containers}}{{$endpoint.Name}}:ip={{$endpoint.IPv4Address}}/ipv6={{$endpoint.IPv6Address}};{{end}}' "$network" 2>/dev/null; then
    section_status "network:$network"
  else
    out "network=$network inspect=UNAVAILABLE"
    section_unavailable "network:$network"
  fi
done

section 'FIREWALL_BACKEND_AND_EFFECTIVE_DOCKER_PATHS (read-only)'
for family_tool in iptables ip6tables; do
  if ! has "$family_tool"; then
    out "$family_tool=UNAVAILABLE"
    section_unavailable "firewall:$family_tool"
    continue
  fi
  if version_output=$("$family_tool" --version 2>&1); then
    if printf '%s\n' "$version_output" | sed "s/^/${family_tool}_version=/"; then
      section_status "firewall:$family_tool:version"
    else
      out "$family_tool=VERSION_UNAVAILABLE"
      section_unavailable "firewall:$family_tool:version"
    fi
  else
    out "$family_tool=VERSION_UNAVAILABLE"
    section_unavailable "firewall:$family_tool:version"
  fi
  save_tool="${family_tool}-save"
  if has "$save_tool"; then
    for table in filter nat; do
      if firewall_snapshot=$("$save_tool" -t "$table" 2>/dev/null) && [[ -n "$firewall_snapshot" ]]; then
        if sanitized_snapshot=$(printf '%s\n' "$firewall_snapshot" | sed -E \
          -e 's/ -m comment --comment ("[^"\\]*(\\.[^"\\]*)*"|[^ ]+)//g' \
          -e 's/--log-prefix ("[^"\\]*(\\.[^"\\]*)*"|[^ ]+)//g' \
          | sed "s/^/$family_tool:$table:/"); then
          printf '%s\n' "$sanitized_snapshot"
          section_status "firewall:$family_tool:$table"
        else
          out "$family_tool:$table=UNAVAILABLE_OR_UNREADABLE"
          section_unavailable "firewall:$family_tool:$table"
        fi
      else
        out "$family_tool:$table=UNAVAILABLE_OR_UNREADABLE"
        section_unavailable "firewall:$family_tool:$table"
      fi
    done
  else
    out "$family_tool-save=UNAVAILABLE"
    section_unavailable "firewall:$save_tool"
  fi
done

if has nft; then
  if nft_version_output=$(nft --version 2>&1); then
    if printf '%s\n' "$nft_version_output" | sed 's/^/nft_version=/'; then
      section_status 'firewall:nft:version'
    else
      out 'nft_version=UNAVAILABLE'
      section_unavailable 'firewall:nft:version'
    fi
  else
    out 'nft_version=UNAVAILABLE'
    section_unavailable 'firewall:nft:version'
  fi
  if has python3; then
    if nft_snapshot=$(nft -j list ruleset 2>/dev/null); then
      if python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except json.JSONDecodeError:
    print("nft_ruleset=UNAVAILABLE_OR_UNREADABLE")
    raise SystemExit(2)
objects = doc.get("nftables", [])
selected_tables = set()

def clean(value, parent=""):
    if isinstance(value, dict):
        cleaned = {}
        for key, nested in value.items():
            if key.casefold() == "comment" or (parent == "log" and key.casefold() == "prefix"):
                continue
            cleaned[key] = clean(nested, key.casefold())
        return cleaned
    if isinstance(value, list):
        return [clean(v, parent) for v in value]
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
' <<< "$nft_snapshot"; then
        section_status 'firewall:nft:ruleset'
      else
        out 'nft_ruleset=UNAVAILABLE_OR_UNREADABLE'
        section_unavailable 'firewall:nft:ruleset'
      fi
    else
      out 'nft_ruleset=UNAVAILABLE_OR_UNREADABLE'
      section_unavailable 'firewall:nft:ruleset'
    fi
  else
    out 'nft_ruleset=PYTHON3_UNAVAILABLE'
    section_unavailable 'firewall:nft:python3'
  fi
else
  out 'nft=UNAVAILABLE'
  section_unavailable 'firewall:nft'
fi

section 'OPERATOR_SUPPLIED_ROUTE_AND_BACKUP_DECISIONS'
out 'output_review=before sharing, redact sensitive internal addresses, interface names, and mount paths; retain firewall rule structure and ordering'
out 'miniflux_https_base_url=NOT_COLLECTED (supply the exact configured HTTPS origin separately; do not include API keys)'
section_unavailable 'operator_input:miniflux_https_base_url'
out 'api_https_route=NOT_COLLECTED (state whether an existing approved route exists; this script does not inspect NPM credentials/config)'
section_unavailable 'operator_input:api_https_route'
if [[ -n "${A2_BACKUP_TARGET:-}" ]]; then
  if [[ "$A2_BACKUP_TARGET" == /* && -d "$A2_BACKUP_TARGET" ]]; then
    if has findmnt && findmnt -T "$A2_BACKUP_TARGET" --noheadings --output TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | sed 's/^/backup_target_mount=/'; then
      section_status 'BACKUP_TARGET_MOUNT'
    else
      out 'backup_target_mount=UNAVAILABLE'
      section_unavailable 'BACKUP_TARGET_MOUNT'
    fi
    if df -PT "$A2_BACKUP_TARGET" 2>/dev/null | sed 's/^/backup_target_disk=/'; then
      section_status 'BACKUP_TARGET_DISK'
    else
      out 'backup_target_disk=UNAVAILABLE'
      section_unavailable 'BACKUP_TARGET_DISK'
    fi
    if stat -c 'backup_target_mode=%a owner_uid=%u owner_gid=%g type=%F' "$A2_BACKUP_TARGET" 2>/dev/null; then
      section_status 'BACKUP_TARGET_PERMISSIONS'
    else
      out 'backup_target_permissions=UNAVAILABLE'
      section_unavailable 'BACKUP_TARGET_PERMISSIONS'
    fi
  else
    out 'backup_target=INVALID_OR_UNAVAILABLE (path value suppressed)'
    section_unavailable 'operator_input:backup_target'
  fi
else
  out 'backup_target=NOT_PROVIDED'
  section_unavailable 'operator_input:backup_target'
fi

section 'COLLECTOR_COMPLETENESS'
out "COLLECTOR_COMPLETENESS=$collector_completeness"
section 'READ_ONLY_COMMAND_AUDIT'
out 'READ_ONLY_COMMAND_AUDIT=STATIC_SOURCE_AND_SYNTHETIC_INVOCATION_TESTED'
out 'READ_ONLY_COMMAND_AUDIT_SCOPE=runtime_syscalls_not_traced_by_collector'
section 'MUTATION_GUARD'
out 'MUTATION_GUARD=DECLARATIVE_ONLY_NOT_A_RUNTIME_COUNTER'

if [[ "$collector_completeness" == 'PARTIAL' ]]; then
  exit 3
fi
exit 0
