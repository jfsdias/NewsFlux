#!/bin/sh

# Read-only, privacy-preserving host inventory for the future LimeSurvey Stage A VM.
# It deliberately does not install, download, create, start, configure, scan, or remove anything.

set -u

emit() {
  printf '%s=%s\n' "$1" "$2"
}

is_present() {
  command -v "$1" >/dev/null 2>&1
}

printf '%s\n' 'LIMESURVEY_STAGE_A_HOST_PREFLIGHT_01'

OS_NAME=$(uname -s 2>/dev/null || printf unknown)
HOST_ARCH=$(uname -m 2>/dev/null || printf unknown)
OS_VERSION=unknown
CPU_CORES=unknown
MEMORY_GIB=unknown
FREE_GIB=unknown

if [ "$OS_NAME" = Darwin ] && command -v sw_vers >/dev/null 2>&1; then
  OS_VERSION=$(sw_vers -productVersion 2>/dev/null || printf unknown)
fi
if command -v sysctl >/dev/null 2>&1; then
  CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || printf unknown)
fi
if command -v system_profiler >/dev/null 2>&1; then
  MEMORY_GIB=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F ': ' '/Memory:/ {gsub(/[^0-9.]/, "", $2); print $2; exit}')
  [ -n "$MEMORY_GIB" ] || MEMORY_GIB=unknown
fi
if command -v df >/dev/null 2>&1; then
  FREE_GIB=$(df -Pk "$HOME" 2>/dev/null | awk 'NR == 2 {printf "%.1f", $4 / 1024 / 1024}')
  [ -n "$FREE_GIB" ] || FREE_GIB=unknown
fi

emit HOST_OS "$OS_NAME"
emit HOST_OS_VERSION "$OS_VERSION"
emit HOST_ARCH "$HOST_ARCH"
emit HOST_CPU_CORES "$CPU_CORES"
emit HOST_MEMORY_GIB "$MEMORY_GIB"
emit HOST_FREE_GIB "$FREE_GIB"

if [ "$OS_NAME" = Darwin ] && [ "$HOST_ARCH" = arm64 ]; then
  emit HOST_PLATFORM_GATE PASS
else
  emit HOST_PLATFORM_GATE BLOCKED
fi

if [ "$CPU_CORES" -ge 4 ] 2>/dev/null && [ "$MEMORY_GIB" -ge 12 ] 2>/dev/null && awk -v free="$FREE_GIB" 'BEGIN {exit !(free >= 40)}'; then
  emit HOST_RESOURCE_GATE PASS
else
  emit HOST_RESOURCE_GATE BLOCKED
fi

if [ -d /Applications/UTM.app ] || [ -d "$HOME/Applications/UTM.app" ]; then
  emit UTM_PRESENT YES
else
  emit UTM_PRESENT NO
fi
if is_present limactl || is_present lima; then emit LIMA_PRESENT YES; else emit LIMA_PRESENT NO; fi
if is_present multipass; then emit MULTIPASS_PRESENT YES; else emit MULTIPASS_PRESENT NO; fi
if is_present qemu-system-aarch64 || is_present qemu-system-x86_64; then emit QEMU_PRESENT YES; else emit QEMU_PRESENT NO; fi
if is_present VBoxManage; then emit VIRTUALBOX_PRESENT YES; else emit VIRTUALBOX_PRESENT NO; fi
if is_present vmrun || [ -d "/Applications/VMware Fusion.app" ] || [ -d "$HOME/Applications/VMware Fusion.app" ]; then
  emit VMWARE_FUSION_PRESENT YES
else
  emit VMWARE_FUSION_PRESENT NO
fi
if is_present prlctl || [ -d "/Applications/Parallels Desktop.app" ] || [ -d "$HOME/Applications/Parallels Desktop.app" ]; then
  emit PARALLELS_PRESENT YES
else
  emit PARALLELS_PRESENT NO
fi

if command -v netstat >/dev/null 2>&1; then
  IPV4_DEFAULT=$(netstat -rn -f inet 2>/dev/null | awk 'NR > 4 && $1 == "default" {found=1} END {print found ? "PRESENT" : "ABSENT_OR_UNREADABLE"}')
  IPV6_DEFAULT=$(netstat -rn -f inet6 2>/dev/null | awk 'NR > 4 && $1 == "default" {found=1} END {print found ? "PRESENT" : "ABSENT_OR_UNREADABLE"}')
else
  IPV4_DEFAULT=BLOCKED
  IPV6_DEFAULT=BLOCKED
fi
emit HOST_IPV4_DEFAULT_ROUTE "$IPV4_DEFAULT"
emit HOST_IPV6_DEFAULT_ROUTE "$IPV6_DEFAULT"
emit HOST_DEFAULT_ROUTES_NOTE INFO_ONLY_NOT_GUEST_ROUTE_EVIDENCE

if command -v sysctl >/dev/null 2>&1; then
  IPV4_FORWARD=$(sysctl -n net.inet.ip.forwarding 2>/dev/null || true)
  IPV6_FORWARD=$(sysctl -n net.inet6.ip6.forwarding 2>/dev/null || true)
else
  IPV4_FORWARD=
  IPV6_FORWARD=
fi
case "$IPV4_FORWARD" in 0) emit HOST_IPV4_FORWARDING 0 ;; 1) emit HOST_IPV4_FORWARDING 1 ;; *) emit HOST_IPV4_FORWARDING BLOCKED ;; esac
case "$IPV6_FORWARD" in 0) emit HOST_IPV6_FORWARDING 0 ;; 1) emit HOST_IPV6_FORWARDING 1 ;; *) emit HOST_IPV6_FORWARDING BLOCKED ;; esac

if [ -d /Applications/Safari.app ]; then emit HOST_SAFARI_PRESENT YES; else emit HOST_SAFARI_PRESENT UNKNOWN; fi
emit GUEST_ROUTE_GATE BLOCKED_NO_VM
emit IPV4_GUEST_ISOLATION_GATE BLOCKED_NOT_TESTED
emit IPV6_GUEST_ISOLATION_GATE BLOCKED_NOT_TESTED
emit UTM_PEER_VM_ISOLATION_GATE BLOCKED_NO_VM
emit HOST_SERVICE_REACHABILITY_GATE BLOCKED_NO_VM
emit NO_PUBLIC_INGRESS_GATE BLOCKED_NO_VM
emit PRODUCTION_ROUTE_GATE BLOCKED_NO_VM

if [ "$OS_NAME" = Darwin ] && [ "$HOST_ARCH" = arm64 ] && [ -d /Applications/UTM.app -o -d "$HOME/Applications/UTM.app" ] && [ "$IPV4_FORWARD" = 0 ] && [ "$IPV6_FORWARD" = 0 ] && [ "$CPU_CORES" -ge 4 ] 2>/dev/null && [ "$MEMORY_GIB" -ge 12 ] 2>/dev/null && awk -v free="$FREE_GIB" 'BEGIN {exit !(free >= 40)}'; then
  emit HOST_PREFLIGHT PASS
else
  emit HOST_PREFLIGHT BLOCKED
fi

emit MUTATIONS_PERFORMED NO
