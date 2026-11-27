import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

const scriptUrl = new URL("limesurvey-stage-a-host-preflight-01.sh", import.meta.url)
const script = readFileSync(scriptUrl, "utf8")

function makeHostFixture({
  macos = "27.2",
  app = "valid",
  appVersion = "5.0.8",
  appBuild = "128",
  cpu = "8",
  ipv4Forward = "0",
  ipv6Forward = "0",
  swVersReadable = "yes",
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "newsflux-host-preflight-"))
  const bin = path.join(root, "bin")
  const home = path.join(root, "home")
  const applications = path.join(root, "applications")
  mkdirSync(bin)
  mkdirSync(home)
  mkdirSync(applications)

  const commands = {
    uname: String.raw`case "$1" in -s) printf '%s\n' Darwin ;; -m) printf '%s\n' arm64 ;; *) exit 1 ;; esac`,
    sw_vers: String.raw`test "$TEST_SW_VERS_READABLE" = yes || exit 1
printf '%s\n' "$TEST_MACOS_VERSION"`,
    sysctl: String.raw`case "$2" in hw.ncpu) printf '%s\n' "$TEST_CPU" ;; net.inet.ip.forwarding) test "$TEST_IPV4_FORWARD" != unreadable || exit 1; printf '%s\n' "$TEST_IPV4_FORWARD" ;; net.inet6.ip6.forwarding) test "$TEST_IPV6_FORWARD" != unreadable || exit 1; printf '%s\n' "$TEST_IPV6_FORWARD" ;; *) exit 1 ;; esac`,
    system_profiler: String.raw`printf '%s\n' 'Memory: 16 GB'`,
    df: String.raw`printf '%s\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on' '/dev/disk1 200000000 100 190000000 1% /tmp'`,
    netstat: String.raw`printf '%s\n' a b c d 'default 192.0.2.1 UGSc en0'`,
    plutil: String.raw`key=
file=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -extract ]; then key=$2; shift 2; elif [ "$1" = -lint ]; then shift; else file=$1; shift; fi
done
test -r "$file" || exit 1
if [ "$key" = "" ]; then grep -q '<plist' "$file" && grep -q '</plist>' "$file"; exit $?; fi
awk -v wanted="$key" '
  index($0, "<key>" wanted "</key>") { if (getline <= 0) exit 1; value=$0; sub(/^.*<string>/, "", value); sub(/<\/string>.*$/, "", value); if (value == $0 || value == "") exit 1; print value; found=1; exit }
  END { if (!found) exit 1 }
' "$file"`,
  }

  for (const [name, body] of Object.entries(commands)) {
    const commandPath = path.join(bin, name)
    writeFileSync(commandPath, `#!/bin/sh\n${body}\n`)
    chmodSync(commandPath, 0o755)
  }

  if (app !== "absent") {
    const appPath = path.join(applications, "UTM.app")
    mkdirSync(appPath, { recursive: true })
    if (app !== "empty") {
      const contents = path.join(appPath, "Contents")
      mkdirSync(contents)
      const plistPath = path.join(contents, "Info.plist")
      const plist =
        app === "unreadable"
          ? "not a plist\n"
          : `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n<key>CFBundleShortVersionString</key>\n<string>${appVersion}</string>\n${app === "missing-build" ? "" : `<key>CFBundleVersion</key>\n<string>${appBuild}</string>\n`}</dict></plist>\n`
      writeFileSync(plistPath, plist)
    }
  }

  const run = () =>
    spawnSync("sh", [scriptUrl.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: home,
        UTM_APPLICATIONS_DIR: applications,
        TEST_MACOS_VERSION: macos,
        TEST_SW_VERS_READABLE: swVersReadable,
        TEST_CPU: cpu,
        TEST_IPV4_FORWARD: ipv4Forward,
        TEST_IPV6_FORWARD: ipv6Forward,
      },
    })

  return { root, run }
}

function withHostFixture(options, callback) {
  const fixture = makeHostFixture(options)
  try {
    callback(fixture.run())
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

test("Stage A host preflight executes read-only and emits non-identifying gates", () => {
  const result = spawnSync("sh", [scriptUrl.pathname], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /LIMESURVEY_STAGE_A_HOST_PREFLIGHT_01/)
  assert.match(result.stdout, /HOST_PLATFORM_GATE=(PASS|BLOCKED)/)
  assert.match(result.stdout, /HOST_MACOS_VERSION_GATE=(PASS|BLOCKED)/)
  assert.match(result.stdout, /UTM_METADATA_GATE=(PASS|BLOCKED)/)
  assert.match(result.stdout, /UTM_VERSION_GATE=(PASS|BLOCKED)/)
  assert.match(result.stdout, /HOST_RESOURCE_GATE=(PASS|BLOCKED)/)
  assert.match(result.stdout, /IPV4_GUEST_ISOLATION_GATE=BLOCKED_NOT_TESTED/)
  assert.match(result.stdout, /IPV6_GUEST_ISOLATION_GATE=BLOCKED_NOT_TESTED/)
  assert.match(result.stdout, /GUEST_ROUTE_GATE=BLOCKED_NO_VM/)
  assert.match(result.stdout, /UTM_PEER_VM_ISOLATION_GATE=BLOCKED_NO_VM/)
  assert.match(result.stdout, /HOST_SERVICE_REACHABILITY_GATE=BLOCKED_NO_VM/)
  assert.match(result.stdout, /MUTATIONS_PERFORMED=NO/)
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  assert.doesNotMatch(result.stdout, /(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/i)
})

test("UTM presence is separate from validated metadata and approved version", () => {
  for (const options of [
    { app: "absent" },
    { app: "empty" },
    { app: "wrong", appVersion: "5.0.7" },
    { app: "unreadable" },
    { app: "missing-build" },
  ]) {
    withHostFixture(options, (result) => {
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /UTM_VERSION_GATE=BLOCKED/)
      assert.match(result.stdout, /HOST_PREFLIGHT=BLOCKED/)
      if (options.app === "absent") {
        assert.match(result.stdout, /UTM_PRESENT=NO/)
        assert.match(result.stdout, /UTM_METADATA_GATE=BLOCKED/)
      } else {
        assert.match(result.stdout, /UTM_PRESENT=YES/)
      }
      if (options.app === "wrong") {
        assert.match(result.stdout, /UTM_VERSION=5\.0\.7/)
        assert.match(result.stdout, /UTM_METADATA_GATE=PASS/)
      } else if (options.app !== "absent") {
        assert.match(result.stdout, /UTM_METADATA_GATE=BLOCKED/)
      }
    })
  }
})

test("macOS version admission accepts only readable 27.x", () => {
  for (const options of [
    { macos: "26.7" },
    { macos: "unknown", swVersReadable: "no" },
    { macos: "28.0" },
  ]) {
    withHostFixture({ ...options, app: "valid" }, (result) => {
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /HOST_MACOS_VERSION_GATE=BLOCKED/)
      assert.match(result.stdout, /HOST_PREFLIGHT=BLOCKED/)
      assert.match(result.stdout, /UTM_VERSION_GATE=PASS/)
    })
  }

  withHostFixture({ app: "valid", macos: "27.2" }, (result) => {
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /HOST_PLATFORM_GATE=PASS/)
    assert.match(result.stdout, /HOST_MACOS_VERSION_GATE=PASS/)
    assert.match(result.stdout, /HOST_RESOURCE_GATE=PASS/)
    assert.match(result.stdout, /UTM_METADATA_GATE=PASS/)
    assert.match(result.stdout, /UTM_VERSION_GATE=PASS/)
    assert.match(result.stdout, /HOST_IPV4_FORWARDING=0/)
    assert.match(result.stdout, /HOST_IPV6_FORWARDING=0/)
    assert.match(result.stdout, /HOST_PREFLIGHT=PASS/)
    assert.match(result.stdout, /IPV4_GUEST_ISOLATION_GATE=BLOCKED_NOT_TESTED/)
    assert.match(result.stdout, /IPV6_GUEST_ISOLATION_GATE=BLOCKED_NOT_TESTED/)
  })
})

test("unreadable CPU or forwarding state keeps host admission blocked", () => {
  for (const options of [
    { cpu: "unknown" },
    { ipv4Forward: "unreadable" },
    { ipv6Forward: "unreadable" },
  ]) {
    withHostFixture({ app: "valid", ...options }, (result) => {
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /HOST_PREFLIGHT=BLOCKED/)
      if (options.ipv4Forward) {
        assert.match(result.stdout, /HOST_IPV4_FORWARDING=BLOCKED/)
      }
      if (options.ipv6Forward) {
        assert.match(result.stdout, /HOST_IPV6_FORWARDING=BLOCKED/)
      }
    })
  }
})

test("Stage A host preflight does not contain installation or network mutation commands", () => {
  for (const forbidden of [
    "sudo ",
    "curl ",
    "wget ",
    "networksetup ",
    "route add",
    "pfctl -f",
    "launchctl load",
    "apt-get",
    "limactl start",
    "multipass launch",
    "hdiutil create",
    "open -a",
    "osascript ",
    "UTM.app/Contents/MacOS",
  ]) {
    assert.equal(
      script.includes(forbidden),
      false,
      `Unexpected mutation-capable command: ${forbidden}`,
    )
  }
})
