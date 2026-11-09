import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const scriptUrl = new URL("limesurvey-stage-a-host-preflight-01.sh", import.meta.url)
const script = readFileSync(scriptUrl, "utf8")

test("Stage A host preflight executes read-only and emits non-identifying gates", () => {
  const result = spawnSync("sh", [scriptUrl.pathname], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /LIMESURVEY_STAGE_A_HOST_PREFLIGHT_01/)
  assert.match(result.stdout, /HOST_PLATFORM_GATE=(PASS|BLOCKED)/)
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
  ]) {
    assert.equal(
      script.includes(forbidden),
      false,
      `Unexpected mutation-capable command: ${forbidden}`,
    )
  }
})
