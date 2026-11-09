# LimeSurvey Stage A Environment Readiness 01

- **Repository:** `jfsdias/NewsFlux`
- **Prepared from live main:** `43bcb26989ee8f2f8b28aba23ecdf8017fc54d57`
- **Track:** Personalization research infrastructure
- **Mode:** Read-only host audit and synthetic-only operational planning
- **PR #200:** merged at the prepared base; this document does not revise its instrument or mock adapter
- **Installation, VM creation, network changes, survey activation, human collection:** not authorized or performed
- **Personalization V2:** HOLD

## Decision summary

Recommend a **new UTM 5.0.8 Apple Virtualization VM on macOS 27, Debian 13.7.0 arm64 DVD-1, UTM Host Only networking, and no guest Internet route**. Keep the survey reachable only from a clean host browser through the UTM host-only link. Transfer approved files using a read-only ISO, not a shared host folder. Apply a guest default-deny firewall as defense in depth. UTM documents that Host Only allows host/guest communication but no Internet access on macOS 26+; it also allows VMs using that mode in the same UTM app to communicate with each other. Therefore the plan requires no other VM on the segment and a separate host-service exposure review. These remain runtime gates, not proven by this plan.

This is **PLAN_PASS only**. UTM is not installed on the audited Mac, host forwarding sysctls were not readable without elevated access, and no VM exists. Runtime isolation, browser reachability, package availability from DVD-1, LimeSurvey install health, and Stage A import/preview remain untested. Do not create or install the VM until the owner authorizes a specific target and resolves these preflight blockers.

The fallback is an owner-provided, dedicated **physically disconnected Linux ARM64 machine** using the same pinned Debian media and offline package process. Its availability was not established. Lima and Multipass are not isolation-equivalent fallbacks: their normal macOS networking gives the guest outbound access through the host.

## Live prestate and scope

GitHub was checked before edits. `main` is `43bcb26989ee8f2f8b28aba23ecdf8017fc54d57`; PR #200 is merged at that SHA. PRs #197, #198, and #199 are merged. The open PR inventory is PR #195 plus Story research PRs #134–#140; none is a LimeSurvey environment/readiness PR. PR #195 and all Story PRs are out of scope and untouched. The checked-in PR #199 adapter remains pinned to `MOCK_CSV_CONTRACT`; real LimeSurvey CSV is not tested and this runbook does not alter that contract.

This branch changes only this readiness document, the read-only host preflight script, and its offline test. It does not alter the blueprint, response fixtures, adapter, survey settings, NewsFlux application, or infrastructure.

## Read-only Mac audit

Observed on 2026-11-09:

| Property                                                 | Observation                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Host                                                     | MacBook Pro, Apple M1 Pro, arm64                                                                        |
| macOS                                                    | 27.2                                                                                                    |
| CPU                                                      | Prior detailed audit: 8 total cores (6 performance, 2 efficiency); current script cannot read the count |
| Memory                                                   | 16 GiB, read from `system_profiler`                                                                     |
| Home-volume free space                                   | 79.7 GiB in the latest preflight run                                                                    |
| VM software                                              | UTM, Lima, Multipass, QEMU, VirtualBox, VMware Fusion, and Parallels not found by the preflight         |
| Safari                                                   | Present; use a separate clean browser profile for the future local preview                              |
| Host routes                                              | IPv4 and IPv6 default routes are present on the host. This says nothing about a future guest route.     |
| Host IPv4/IPv6 forwarding sysctls                        | Read blocked in the current environment; actual values remain unknown                                   |
| VM runtime / guest route / browser-to-guest reachability | Not tested; no VM was created                                                                           |

The previous detailed audit measured 8 CPU cores, 16 GiB of memory, and 82.8 GiB free. In the latest run the read-only script could not read the CPU count through `sysctl`, so it reports `HOST_CPU_CORES=unknown` and `HOST_RESOURCE_GATE=BLOCKED`; memory is 16 GiB and current free space is 79.7 GiB. Installation preflight is **BLOCKED** because UTM is absent, forwarding state is unreadable, and the current resource gate cannot verify CPU count. No route addresses, MAC addresses, VPN details, secrets, or service endpoints are recorded. No OMV host was inspected because no authorization or access path was established.

Run the proposed host-only check with:

```sh
sh scripts/limesurvey-stage-a-host-preflight-01.sh
```

It reports summarized, non-identifying properties only. It does not install, download, create, start, or configure anything. `HOST_PREFLIGHT=BLOCKED` is expected until UTM is installed through a separate authorization and the relevant host forwarding state can be inspected.

## Virtualization options

Versions below were checked against vendor release pages on 2026-11-09. No tool was installed.

| Option                               | Compatibility and current network behavior                                                                                                                                                                                                                                                                                              | Assessment for this rehearsal                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UTM 5.0.8 + Apple Virtualization** | Latest listed UTM release. macOS 27 is supported by the current AVF features. On macOS 26+, Host Only allows host↔guest communication and explicitly has no Internet access; VMs on that mode in the same UTM app can also communicate. Snapshots for AVF VMs are supported on macOS 27.                                                | **Recommended.** Native ARM64, GUI and clear isolation mode, no cloud cost. Still requires runtime proof; Host Only exposes the host and same-segment VMs. No other VM may share the segment; host listeners need review. No shares, NAT, shared network, bridged NIC, or forwarding. |
| **Lima 2.3.0**                       | Native ARM-on-ARM and VZ supported. Default user-mode networking has outbound connectivity. `hostLoopback=false` blocks loopback services only; outbound DNS/network access continues and host services bound to all interfaces can remain reachable by the host's LAN address. Automatic mounts and port forwarding add host exposure. | Not selected. The feature set is useful for development, but its normal network model does not meet the no-egress target without additional network controls. A future “no NIC” profile would need a separate documented and tested design.                                           |
| **Multipass 1.17.0**                 | Native macOS VM manager. On macOS, it uses Apple's Internet Sharing to provide instances a private network; its default interface can reach outside networks. Adding a host-only/bridged interface does not remove the default NAT interface.                                                                                           | Not selected. Its convenient default is incompatible with this isolated target; no extra bridge or network configuration will be introduced on this Mac.                                                                                                                              |

**Fallback target:** a dedicated existing Linux ARM64 device, physically disconnected from Ethernet/Wi-Fi and with no other network interface enabled, if the owner confirms it exists and authorizes its use. The same default-deny guest/host policy, pinned media, offline package bundle, local browser-only use, and backup/teardown gates apply. It will be `NOT_AVAILABLE` until verified. Do not substitute a cloud VM, OMV, Docker/Compose, Lima, Multipass, or production host without a new decision.

### Resource and operating model

- Guest: **2 vCPU, 4 GiB RAM, 24 GiB virtual disk**; Debian server-only, no desktop environment.
- Host admission threshold: arm64, at least 4 CPU cores, 12 GiB RAM, and **40 GiB free disk** before creation. The previous detailed audit measured 8 cores and 16 GiB; the latest preflight could not verify the CPU count, so require a fresh `HOST_RESOURCE_GATE=PASS` before creation. Latest free space is 79.7 GiB.
- Disk headroom reserves room for a pinned ~3.72 GiB Debian DVD-1 image, LimeSurvey archive, VM growth, database backup, and a pre-import VM snapshot. VM disk may be sparse; reserve as if it grows to its configured cap.
- Apache, PHP, PostgreSQL, and LimeSurvey run entirely inside the disposable VM. PostgreSQL listens on loopback only. Apache listens on the guest host-only IPv4 address and one unprivileged HTTP port; the guest firewall permits only the host-only Mac peer. Before creating the VM, require that no other VM is attached to that UTM Host Only segment. Review host listeners reachable over the host-only interface; guest egress is dropped by default, and no host firewall change is allowed without separate authorization. No NewsFlux/Miniflux, Compose, reverse proxy, SMTP, DNS, external analytics, or public service is involved.
- The local Safari profile is isolated from production cookies and credentials. The host browser loads only the guest's host-only address and locally packaged assets.
- UTM direct distribution is free/open source; no cloud, subscription, or paid external service is required. Updates are manual and pinned in the receipt. No UTM or OS update occurs during a rehearsal.

## Current software compatibility snapshot

| Component                               | Current verified plan                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LimeSurvey CE                           | 7.9.1, listed by the official release page as released 2026-11-02                                                                                                     |
| Application architecture                | CE is delivered as a PHP ZIP rather than a CPU-specific binary; the official manual has no separate ARM64 support matrix. Validate the guest PHP/DB stack at runtime. |
| Official LimeSurvey package             | `https://download.limesurvey.org/latest-master/limesurvey7.9.1%2B261102.zip`                                                                                          |
| Official published SHA-256              | `c90a1dae4b0b3e265d20de08185a74f5d68f1af3e78fa5e33772f82f550d6891`                                                                                                    |
| Package bytes locally downloaded/hashed | **No**; published checksum only, not `PACKAGE_BYTES_VERIFIED`                                                                                                         |
| Linux media                             | Debian GNU/Linux 13.7.0 “trixie”, arm64, `debian-13.7.0-arm64-DVD-1.iso`, 3,993,284,608 bytes                                                                         |
| Database                                | PostgreSQL 14+; Debian 13 DVD snapshot provides the OS package set, exact package version to be recorded from media                                                   |
| PHP                                     | LimeSurvey 7.x requires PHP >=8.1.29 and is tested through 8.5.x; Debian 13.7 package version must be read from the verified DVD and checked before install           |
| PHP extensions                          | `mbstring`, `pdo_pgsql`, `gd`, `zip`, `zlib`, `curl`, `fileinfo`, `json`, and standard PHP libraries (including `SimpleXML`); PHP `memory_limit >=128M`               |
| PHP request limits                      | Set `max_input_vars >=5000`, `post_max_size >=32M`, `upload_max_filesize >=32M`                                                                                       |
| LimeSurvey minimum disk                 | 500 MB for unpacked package plus survey files/data; VM sizing is deliberately larger                                                                                  |

The official LimeSurvey downloads page currently lists 7.9.1 and links to the archive and checksum. Debian's official stable release and installer pages list 13.7.0 and arm64 media; Debian publishes signed checksum files beside the ISO. Before any installation authorization is exercised, recheck the latest CE release and exact Linux media in their official sources. Download the LimeSurvey archive only after a separate Stage A authorization, calculate its local SHA-256, and compare it byte-for-byte to the then-current official checksum before extraction. This plan does not fetch the package or ISO.

### Offline media acceptance

The Debian **DVD-1**, rather than `netinst`, is selected because Debian documents that `netinst` requires an Internet connection during installation. A verified DVD-1 allows the OS install to proceed with no guest network egress. The readiness gate remains blocked until a later authorized install demonstrates that every required Debian package (including PHP extensions and PostgreSQL) is available from verified local media. Install commands must use APT's `--no-download`; the guest must have no HTTP/HTTPS APT source. If any package is missing, stop. Do not attach NAT or briefly enable Internet. Prepare a separately verified, signed supplemental APT-media ISO with the exact dependency closure before asking the owner to authorize continuation.

## Authorized Stage A runbook (commands are plans; none were executed)

### 0. Authorization and preflight

Obtain an explicit owner authorization naming the UTM target, Debian and LimeSurvey versions, VM creation, Stage A install, and LSS import/preview. This does **not** authorize Stage B activation/submissions or Stage C destruction. Re-run the read-only preflight script immediately before creation and require:

```text
HOST_ARCH=arm64
HOST_RESOURCE_GATE=PASS
UTM_PRESENT=YES
HOST_IPV4_FORWARDING=0
HOST_IPV6_FORWARDING=0
HOST_PREFLIGHT=PASS
```

If forwarding remains unreadable, UTM Host Only cannot be selected, disk headroom is below 40 GiB, CPU count cannot be verified, another VM could share the Host Only segment, host-service exposure is not reviewed, or any condition differs, stop for a new decision. Do not use `sudo`, change routes/firewall/DNS, or enable sharing to make the check pass.

### 1. Pin and verify installation media on the host

Use the versioned Debian 13.7.0 arm64 DVD-1 image, not the mutable `current` alias. Download it and its `SHA256SUMS` plus signature only after authorization. Verify the signature with Debian's official CD signing keyring after checking the fingerprint against Debian's verification instructions; then verify the exact ISO entry:

```sh
gpgv --keyring "$DEBIAN_CD_KEYRING" SHA256SUMS.sign SHA256SUMS
grep -F 'debian-13.7.0-arm64-DVD-1.iso' SHA256SUMS | shasum -a 256 -c -
```

`DEBIAN_CD_KEYRING` must name a locally verified Debian role keyring; do not import a key merely because a download includes it. Save the ISO digest and signer fingerprint in a redacted receipt.

Download the official LimeSurvey 7.9.1 ZIP and checksum from the official CE download page. Do not use a third-party mirror or container image. Recompute locally and require the exact current official published digest before preparing the transfer bundle:

```sh
shasum -a 256 limesurvey7.9.1+261102.zip
cat limesurvey7.9.1+261102-sha256-checksum.txt
```

Stop on missing checksum, mismatch, version drift, or changed official support requirements. Put only the verified Linux installer media, LimeSurvey archive/checksum, and the existing synthetic blueprint/stimulus files into a task-specific payload folder. Create a read-only ISO payload with macOS `hdiutil`; verify the ISO digest. Do not share the host Downloads, home, repository, or secrets directory with the guest.

### 2. Create the VM in UTM

In the UTM GUI after authorization:

1. Create a new Linux **Apple Virtualization** VM, ARM64, Debian 13.7.0 DVD-1, 2 CPU / 4 GiB / 24 GiB disk.
2. Add exactly one network device and choose **Host Only**. Do not use Shared Network, NAT Network, Bridged, or host Wi-Fi. Create no port-forward rules.
3. Do not configure any host shared folder, clipboard sharing, guest agent file share, or additional NIC. Attach the read-only payload ISO as removable media.
4. Confirm that no other VM using the same UTM app is attached to this Host Only segment. Stop before boot if peer VMs cannot be accounted for.
5. Review, without recording raw service output, which host services listen on the Host Only interface or wildcard addresses. Require the existing host firewall to prevent guest-initiated access except what is explicitly allowed; if proving or enforcing this would require a host firewall/network change, stop for a separate authorization.
6. Install a minimal server system from DVD-1. Decline network mirror setup and install packages only from verified optical media. Do not enable SSH. If the installer cannot finish without Internet, stop before proceeding.
7. Record UTM version, backend, network mode, peer-VM check, host-listener review result, media digests, VM resources, and media/ISO IDs. Do not capture host addresses, serials, listener details, serial numbers, or MACs in the receipt.

### 3. Prove guest network and package boundary before starting services

Inside the guest, identify the sole non-loopback interface and record addresses/routes without copying them into public logs:

```sh
ip -br link
ip -br -4 address
ip -br -6 address
ip -4 route
ip -6 route
```

Require one non-loopback NIC, a host-only IPv4 address, **no IPv4 or IPv6 default route**, no global IPv6 address, and no other route except loopback and the host-only subnet. Confirm UTM still shows Host Only and no second NIC or forwarding rule. If the host-only mode or topology differs, shut down the VM and stop.

Use a static host-only IPv4 address so the guest needs no DHCP or DNS exception. Install `nftables` from verified local media and, before Apache, prepare a default-drop policy with these exact rules (replace the two address placeholders only after confirming the UTM host-only mapping):

```nft
table inet stage_a {
  chain input {
    type filter hook input priority 0; policy drop;
    iifname "lo" accept
    ct state established,related accept
    ip saddr <HOST_ONLY_MAC_IPV4> ip daddr <GUEST_HOST_ONLY_IPV4> tcp dport 8080 ct state new accept
  }
  chain output {
    type filter hook output priority 0; policy drop;
    oifname "lo" accept
    ct state established,related accept
  }
  chain forward {
    type filter hook forward priority 0; policy drop;
  }
}
```

Substitute literal IPv4 values in a reviewed local file, run `nft -c -f` against it, review the diff, then apply only inside the authorized guest. This allows the host browser to initiate the one HTTP connection and allows established replies; it does not permit guest-initiated IPv4/IPv6 egress, DNS, or forwarding. Do not add DHCP, DNS, ICMP, or other allow rules to make a failed gate pass. If UTM requires another protocol for host-only browser access, stop and seek a reviewed rule change. PostgreSQL remains loopback-only. Verify effective IPv4 and IPv6 rules and counters before starting Apache.

Inspect listener and APT state before application install:

```sh
ss -lntup
grep -R -E '^[[:space:]]*(deb|URIs:)[[:space:]]+https?://' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null
```

Before LimeSurvey, only loopback admin/DB listeners are allowed; no SSH. APT network-source search must return no active HTTP/HTTPS source. Mount the DVD and add it as the only source, then require package availability with no downloads:

```sh
sudo apt-cdrom -m -d=/media/cdrom add
sudo apt-get update
sudo apt-get --no-download install apache2 postgresql nftables php libapache2-mod-php php-pgsql php-gd php-zip php-mbstring php-curl php-xml
```

The `apt-get` command is intentionally network-disabled. If unavailable packages are reported, stop before installing a partial stack. Recheck `php -v`, `php -m`, `php -i | grep -E 'memory_limit|max_input_vars|post_max_size|upload_max_filesize'`, and `psql --version` against the official requirements. Record exact versions and extension presence, not configuration secrets.

Runtime network acceptance must separately test IPv4 and IPv6 route tables, the guest firewall's effective rules/counters, the absence of a guest default route, and that Apache/PostgreSQL bind only to their intended interfaces. Do not probe NewsFlux, Miniflux, LAN services, VPN networks, or production IPs. A reserved documentation-only test address may be used only with `ip route get`; do not send packets to private service addresses. From the host, open the guest host-only address in a clean Safari profile and verify only that local origin is requested. This proves local preview reachability, not Internet isolation by itself.

The host-service check is separate from the guest route check: confirm from UTM configuration that there is no other VM on the segment, review host listeners and firewall policy for the host-only link, and verify from guest firewall counters that unsolicited guest egress to the host peer is dropped. Do not enumerate or connect to host/LAN/production services. If the host OS firewall cannot provide the required boundary without changes, leave the VM stopped and request a separate decision.

### 4. Install LimeSurvey locally and protect credentials

Recompute the LimeSurvey archive SHA-256 inside the guest from the read-only payload ISO and require the same official digest before extraction. Extract into a dedicated `/var/www/limesurvey` directory. Configure Apache path URL format and bind it only to the guest host-only IPv4 address. Enforce the guest firewall allowlist. PostgreSQL `listen_addresses` stays `localhost`; create a dedicated database role and database with interactive password prompting (`createuser --pwprompt`), never a password in command arguments.

Create the LimeSurvey configuration interactively. Use a fresh admin password and database password stored only in the owner-approved password manager. Restrict configuration ownership/permissions to root and the web-server group; do not put secrets in the repository, URL, logs, command history, browser screenshots, or evidence. Disable SMTP, participant tokens, external authentication, analytics, IP/referrer/timing collection, and every external integration. Keep source and re-imported surveys inactive.

Configure PHP `memory_limit=256M`, `max_input_vars=5000`, `post_max_size=32M`, and `upload_max_filesize=32M` in the Apache PHP config. Check the official LimeSurvey admin requirements page after installation and require every warning to be resolved before survey construction.

### 5. Local health checks and no-exposure evidence

After Apache/PostgreSQL are configured, and before building the survey:

```sh
sudo systemctl is-active apache2 postgresql
php -v
php -m
sudo -u postgres psql -Atc 'SHOW listen_addresses;'
ss -lntup
ip -4 route
ip -6 route
sudo nft list ruleset
```

Require database listen address `localhost`; Apache bound only to the guest host-only IPv4 address and approved HTTP port; no SSH, public/global guest IP, default route, or extra NIC; firewall ingress/egress default drop except the documented host-only browser path and link maintenance. Confirm UTM has no shared folders, NAT/bridged network, port forwarding, or internet-capable second adapter. Save a redacted command receipt and a clean UTM snapshot before importing the survey. Do not state `NO_PUBLIC_EXPOSURE=RUNTIME_PASS` until these checks are observed in the created VM.

### 6. Backup before LSS import

Create the VM snapshot using UTM's snapshot support. Also create a database backup with restrictive permissions:

```sh
umask 077
install -d -m 700 /root/stage-a-backup
sudo -u postgres pg_dump -Fc limesurvey_stage_a > /root/stage-a-backup/pre-lss-import.dump
chmod 600 /root/stage-a-backup/pre-lss-import.dump
sha256sum /root/stage-a-backup/pre-lss-import.dump
```

Keep both snapshot and backup on the encrypted host volume, not a cloud share or production filesystem. Verify the backup format and record only the digest, timestamp, LimeSurvey/DB versions, and survey counts. A backup includes local admin configuration; treat it as restricted even though survey content is synthetic.

## Reuse PR #200 blueprint: Stage A LSS and Preview procedure

The checked-in blueprint at `scripts/tests/fixtures/limesurvey-ce-dummy-instrument-blueprint-01.json` is labeled `SYNTHETIC_SURVEY_BLUEPRINT_NOT_LSS`. It is not a LimeSurvey import file. Reuse it to manually construct the source survey with its exact question codes and groups; use `scripts/tests/fixtures/limesurvey-ce-export-field-map-01.json` and the synthetic allocation, session, receipt, and stimulus fixtures as the source of truth. Do not use real articles, Miniflux, account data, or participant information.

1. Build the source survey from the blueprint's Session control, Profile seed choices, `synthetic_transit`, `synthetic_library`, and Session closeout groups. Verify each field/question code is unique and equals the field map. Do not show allocation/arm mapping in respondent-visible content. Do not configure any human collection channel.
2. Confirm the source survey status is **Inactive**. Record a structural manifest: exact version, group order, question-code list, question types, response options, relevant anonymous/privacy settings, and source survey ID (the receipt is restricted and contains no public link).
3. Use LimeSurvey's native **Export survey structure** action to create the `.lss`. Record the export timestamp and SHA-256. This is a LimeSurvey-generated artifact; never rename the JSON blueprint to `.lss`.
4. Import that `.lss` into a new second survey slot on the same instance/version. Keep the second survey **Inactive**. Compare the imported group order, question codes, types, answer codes, and settings with the source structural manifest. Any difference is a gate failure; do not repair/rename fields silently.
5. Run Preview separately on source and re-imported surveys in the clean host Safari profile. Check presentation/order, labels, required/optional states, rendering of local static stimuli, navigation, and X/Y blinding. The PR #200 contract states Preview does not persist answers; do not test submit, save, activate, or export response data in Stage A.
6. Save a redacted receipt with both inactive states, LSS SHA-256, structural comparison result, Preview result, zero external requests, zero Miniflux/NewsFlux access, and zero persisted responses. No screenshots containing credentials or actual response data.

**CSV status:** Stage A does not establish CSV headers, completion semantics, row persistence, or adapter compatibility. `scripts/limesurvey-ce-export-adapter-01.js` remains mock-only. A real CSV export requires the separate Stage B authorization and test.

## Rollback, recovery, and teardown boundary

- If a Stage A package, configuration, health, LSS import, or Preview gate fails, stop Apache/PostgreSQL and preserve the diagnostic receipt. Restore the pre-import UTM snapshot or `pg_restore` the pre-import backup inside the same isolated VM if a clean retry is separately approved.
- Before any stop action, verify that each survey that exists is inactive; after import, verify both source and copy remain inactive and no response rows exist. Preserve the clean pre-import snapshot until PM reviews the receipt.
- Do not delete a survey, VM, virtual disk, ISO, backup, UTM app, or host file as an automatic rollback. Removing the VM/data/backups, or revoking credentials, is a separate explicit Stage C teardown authorization.
- Stage B activation, synthetic operational submissions, and real CSV export are separately authorized future work. Human collection remains unauthorized. No operation here starts any service or alters an existing service.

## Gate ledger

| Gate                                       | Status           | Evidence / remaining condition                                                                           |
| ------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------- |
| GitHub prestate and PR #200 merge          | `PASS`           | Live `main` is PR #200 merge SHA; no overlapping LimeSurvey PR                                           |
| Host inventory                             | `PASS`           | Read-only Mac audit; UTM absent, host forwarding state unreadable                                        |
| Resource sizing                            | `BLOCKED`        | Memory and disk meet thresholds; latest script could not read CPU count, so the combined gate is blocked |
| Host Only peer-VM isolation                | `BLOCKED_NO_VM`  | No UTM instance exists; same-app peer VM exclusion must be checked at runtime                            |
| Host-service reachability                  | `BLOCKED_NO_VM`  | No UTM host-only interface exists; listener/firewall review is a future runtime gate                     |
| UTM option and architecture review         | `PLAN_PASS`      | UTM AVF Host Only, Debian arm64; no application/runtime installed                                        |
| Lima/Multipass comparison                  | `PASS`           | Official network docs reviewed; both default models rejected for this isolation target                   |
| IPv4/IPv6 isolation                        | `PLAN_PASS`      | No NIC besides Host Only; no guest default routes; guest default-deny firewall; runtime still untested   |
| No production/private route                | `PLAN_PASS`      | Guest egress denied and no default route; no service probes; runtime still untested                      |
| No public ingress                          | `PLAN_PASS`      | No bridged/NAT NIC/forward; host-only-bound listener plus guest firewall; runtime still untested         |
| Current LimeSurvey version/source/checksum | `PASS`           | Official page/checksum endpoint observed; version snapshot recheck required before install               |
| LimeSurvey archive bytes                   | `NOT_EXECUTED`   | No archive download or local hashing                                                                     |
| Debian media signature/hash                | `NOT_EXECUTED`   | Exact media and signed-checksum verification commands prepared; no ISO downloaded                        |
| Offline package availability               | `BLOCKED`        | Must demonstrate required package closure on DVD-1; no online fallback permitted                         |
| Install/health checks                      | `PLAN_PASS`      | Commands prepared; runtime not created                                                                   |
| LSS export/re-import/Preview               | `PLAN_PASS`      | Blueprint and steps preserved; no `.lss` or survey runtime created                                       |
| Backup/rollback/teardown                   | `PLAN_PASS`      | Pre-import snapshot plus `pg_dump`; delete requires separate authorization                               |
| Stage B/CSV/human data                     | `NOT_AUTHORIZED` | No activation, submissions, real CSV, or collection                                                      |

### Owner decisions required before any operation

1. Approve or reject UTM 5.0.8 Apple Virtualization + Host Only as the named target; confirm the 2026-11-09 host audit remains current and resolve the read-blocked forwarding check.
2. Authorize the specific Debian/LimeSurvey media acquisition, VM creation, Stage A installation, payload ISO, and LSS export/re-import/Preview. This does not authorize Stage B, survey activation, response submissions, or Stage C teardown.
3. Approve the backup retention location/expiration and the clean browser profile used to preview the local instance.
4. If DVD-1 lacks a required package, decide whether to prepare a signed supplemental offline package ISO. No NAT or Internet exception is recommended.
5. Confirm the disconnected Linux host fallback is available or accept UTM-only with a stop condition.

## Sources

- [LimeSurvey official release list](https://community.limesurvey.org/releases/)
- [LimeSurvey official CE downloads and published SHA-256 link](https://community.limesurvey.org/downloads/)
- [LimeSurvey CE installation requirements](https://www.limesurvey.org/manual/Installation_-_LimeSurvey_CE)
- [Debian stable releases and 13.7.0 status](https://www.debian.org/releases/)
- [Debian 13.7.0 installation images](https://www.debian.org/releases/stable/debian-installer/)
- [Debian arm64 installation guide](https://www.debian.org/releases/stable/arm64/)
- [Debian signed image checksum verification](https://www.debian.org/CD/verify)
- [UTM v5.0.8 release](https://github.com/utmapp/UTM/releases/latest)
- [UTM network modes](https://docs.getutm.app/settings-apple/devices/network/)
- [UTM Apple Virtualization support on macOS 27](https://github.com/utmapp/UTM/releases/latest)
- [Lima v2.3.0 release](https://github.com/lima-vm/lima/releases/latest)
- [Lima default user-mode networking](https://lima-vm.io/docs/config/network/user/)
- [Multipass 1.17.0 release](https://github.com/canonical/multipass/releases/latest)
- [Multipass macOS network behavior](https://canonical.com/multipass/docs/latest/how-to-guides/troubleshoot/troubleshoot-networking/)

## Closeout state

```text
HOST_AUDIT=PASS_READ_ONLY
HOST_PREFLIGHT=BLOCKED_UTM_ABSENT_AND_FORWARDING_UNREADABLE
RECOMMENDED_TARGET=UTM_5.0.8_AVF_HOST_ONLY_DEBIAN_13.7.0_ARM64
FALLBACK_TARGET=DEDICATED_DISCONNECTED_LINUX_ARM64_HOST_NOT_VERIFIED_AVAILABLE
LIMESURVEY_VERSION=7.9.1
PUBLISHED_SHA256=c90a1dae4b0b3e265d20de08185a74f5d68f1af3e78fa5e33772f82f550d6891
PACKAGE_BYTES_VERIFIED=NO_NOT_DOWNLOADED
UTM_HOST_ONLY_ISOLATION=PLAN_PASS_RUNTIME_NOT_TESTED
PLAN_PASS=YES
RUNTIME_PASS=NO
VM_CREATED=NO
INSTALLATION_EXECUTED=NO
SURVEY_CREATED_OR_IMPORTED=NO
SURVEY_ACTIVATED=NO
REAL_CSV_EXPORT=NOT_TESTED
HUMAN_COLLECTION=NO
NEWSFLUX_OR_MINIFLUX_ACCESS=NO
PERSONALIZATION_V2=HOLD
```
