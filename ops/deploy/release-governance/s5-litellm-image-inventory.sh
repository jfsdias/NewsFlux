#!/usr/bin/env bash
# S5-R3: production LiteLLM image identity, METADATA ONLY (operator command for the OMV host).
#
# Reads exactly one container, identified by its exact name AND the expected immutable ID prefix AND
# its Compose project/service labels, then the image it runs, by immutable image ID:
#   container: ID, name, state, Compose labels, .Image (immutable image ID), .Config.Image (reference),
#              StartedAt and RestartCount (to prove nothing changed while reading);
#   image:     ID, RepoDigests (registry manifest digests), Created, OS/architecture, OCI version label.
# Never: pull, run, restart, recreate, rm, stop, environment, mounts, ports, networks, logs or files.
#
# Optional, only with an explicit approval reference (e.g. the PM comment authorizing it):
#   --with-version-read <ref>   one `docker exec` into that container ID running
#                               python3 -B -I importlib.metadata.version("litellm") (no import of
#                               litellm, no bytecode, no network). Without it the version is NOT read.
#
#   sudo bash ops/deploy/release-governance/s5-litellm-image-inventory.sh \
#     --container litellm --expect-id-prefix 09650c457315 --project litellm --service litellm
#
# Output: S5R3_INV_* lines only. Identifiers printed (container/image IDs, image reference, registry
# digests) are public metadata, not credentials. Exit 0 complete, 2 hold, 3 container changed.
set -Euo pipefail
umask 077
container="" prefix="" project="" service="" approval=""
version_read=0

out() { echo "S5R3_INV_$1=$2"; }
hold() { out RESULT "$1"; exit "${2:-2}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) container="${2:-}"; shift 2 || hold HOLD_USAGE ;;
    --expect-id-prefix) prefix="${2:-}"; shift 2 || hold HOLD_USAGE ;;
    --project) project="${2:-}"; shift 2 || hold HOLD_USAGE ;;
    --service) service="${2:-}"; shift 2 || hold HOLD_USAGE ;;
    --with-version-read) version_read=1; approval="${2:-}"; if [[ $# -ge 2 ]]; then shift 2; else shift; fi ;;
    *) hold HOLD_USAGE ;;
  esac
done
[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || hold HOLD_USAGE
[[ "$prefix" =~ ^[0-9a-f]{12,64}$ ]] || hold HOLD_USAGE
[[ -z "$project" || "$project" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || hold HOLD_USAGE
[[ -z "$service" || "$service" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || hold HOLD_USAGE
if [[ "$version_read" == 1 && ! "$approval" =~ ^[A-Za-z0-9._-]{3,64}$ ]]; then hold HOLD_USAGE; fi

# 1) Identity by exact name, then everything else by the immutable full ID only.
identity="$(docker inspect --format '{{.Id}} {{.Name}} {{.State.Status}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}' "$container" 2>/dev/null)" \
  || hold HOLD_TARGET_NOT_FOUND
read -r cid name status label_project label_service <<<"$identity"
[[ "$cid" =~ ^[0-9a-f]{64}$ && "$name" == "/$container" ]] || hold HOLD_TARGET_NOT_FOUND
[[ "$cid" == "$prefix"* ]] || hold HOLD_TARGET_ID_PREFIX
if [[ -n "$project" && "${label_project:-}" != "$project" ]] || [[ -n "$service" && "${label_service:-}" != "$service" ]]; then
  hold HOLD_COMPOSE_LABELS
fi
[[ "$status" == running ]] || hold HOLD_NOT_RUNNING
snapshot='{{.Id}} {{.Image}} {{.State.StartedAt}} {{.RestartCount}} {{.State.Status}}'
before="$(docker inspect --format "$snapshot" "$cid" 2>/dev/null)" || hold HOLD_TARGET_NOT_FOUND
image_id="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null)" || hold HOLD_TARGET_NOT_FOUND
config_image="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null)" || hold HOLD_TARGET_NOT_FOUND
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || hold HOLD_IMAGE_ID_UNRECOGNIZED
[[ "$config_image" =~ ^[A-Za-z0-9][A-Za-z0-9./_:@-]{0,254}$ ]] || config_image="UNRECOGNIZED"

# 2) The image, by immutable ID (never by the moving tag).
resolved="$(docker image inspect --format '{{.Id}}' "$image_id" 2>/dev/null)" || hold HOLD_IMAGE_UNREADABLE
digests_json="$(docker image inspect --format '{{json .RepoDigests}}' "$image_id" 2>/dev/null)" || hold HOLD_IMAGE_UNREADABLE
created="$(docker image inspect --format '{{.Created}}' "$image_id" 2>/dev/null)" || hold HOLD_IMAGE_UNREADABLE
platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image_id" 2>/dev/null)" || hold HOLD_IMAGE_UNREADABLE
label_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_id" 2>/dev/null)" || label_version=""
digests="$(python3 -I -c '
import json, re, sys
try:
    items = json.loads(sys.argv[1]) or []
except ValueError:
    items = []
ok = sorted({i for i in items if isinstance(i, str) and re.fullmatch(r"[a-z0-9][a-z0-9./_-]{0,254}@sha256:[0-9a-f]{64}", i)})
print(" ".join(ok) or "NONE")' "$digests_json")" || hold HOLD_IMAGE_UNREADABLE
[[ "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?$ ]] || created="UNRECOGNIZED"
[[ "$platform" =~ ^[a-z0-9]+/[a-z0-9_]+$ ]] || platform="UNRECOGNIZED"
if [[ -z "$label_version" ]]; then label_version="ABSENT"
elif [[ ! "$label_version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9]+)?$ ]]; then label_version="UNRECOGNIZED"; fi

# 3) Optional package version, only with an approval reference.
package_version="NOT_COLLECTED_METADATA_ONLY"
if [[ "$version_read" == 1 ]]; then
  package_version="$(docker exec "$cid" python3 -B -I -c 'import importlib.metadata as m; print(m.version("litellm"))' 2>/dev/null)" \
    || package_version="UNAVAILABLE"
  [[ "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || "$package_version" == UNAVAILABLE ]] || package_version="UNRECOGNIZED"
fi

after="$(docker inspect --format "$snapshot" "$cid" 2>/dev/null)" || hold HOLD_TARGET_NOT_FOUND

out CONTAINER_ID "$cid"
out CONTAINER_NAME "$container"
out CONFIG_IMAGE "$config_image"
out IMAGE_ID "$image_id"
if [[ "$resolved" == "$image_id" ]]; then out IMAGE_ID_RESOLVES YES; else out IMAGE_ID_RESOLVES NO; fi
out REPO_DIGESTS "$digests"
out IMAGE_CREATED "$created"
out ARCH "$platform"
out LABEL_VERSION "$label_version"
out PACKAGE_VERSION "$package_version"
if [[ "$version_read" == 1 ]]; then out VERSION_READ_APPROVAL "$approval"; fi
out IDENTIFIER_NOTE "IMAGE_ID_IS_LOCAL_CONTENT_ID_REPO_DIGESTS_ARE_REGISTRY_MANIFEST_DIGESTS"
if [[ "$before" != "$after" ]]; then
  out CONTAINER_IDENTITY CHANGED
  hold HOLD_CONTAINER_STATE_CHANGED 3
fi
out CONTAINER_IDENTITY UNCHANGED
[[ "$resolved" == "$image_id" ]] || hold HOLD_IMAGE_ID_MISMATCH
out RESULT COMPLETE_METADATA_ONLY
