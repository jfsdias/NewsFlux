import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"
import test from "node:test"

/* eslint-disable import/extensions -- Node ESM needs explicit extensions. */
import {
  PRODUCT_GITHUB_REPO_PATH,
  PRODUCT_NAME,
  UPSTREAM_GITHUB_REPO_PATH,
  UPSTREAM_NAME,
} from "./constants.js"
import { applyRuntimeProductIdentity } from "./product-identity.js"
import { shouldNotifyProductUpdate } from "./update-check.js"
/* eslint-enable import/extensions */

test("exposes separate NewsFlux product and ReactFlux upstream identities", () => {
  assert.equal(PRODUCT_NAME, "NewsFlux")
  assert.equal(PRODUCT_GITHUB_REPO_PATH, "jfsdias/NewsFlux")
  assert.equal(UPSTREAM_NAME, "ReactFlux")
  assert.equal(UPSTREAM_GITHUB_REPO_PATH, "electh/ReactFlux")
})

test("brands nested runtime phrases without mutating the locale source", () => {
  const source = {
    compatibility: {
      description: "ReactFlux requires Miniflux %{minimumVersion} or newer.",
    },
    article: {
      tooltip: "Open in ReactFlux",
    },
    untouched: "Miniflux",
  }

  const branded = applyRuntimeProductIdentity(source)

  assert.deepEqual(branded, {
    compatibility: {
      description: "NewsFlux requires Miniflux %{minimumVersion} or newer.",
    },
    article: {
      tooltip: "Open in NewsFlux",
    },
    untouched: "Miniflux",
  })
  assert.equal(source.article.tooltip, "Open in ReactFlux")
})

test("suppresses a main advance that only changes docs", () => {
  assert.equal(
    shouldNotifyProductUpdate({
      status: "ahead",
      ahead_by: 1,
      files: [{ filename: "docs/NEWSFLUX_PROJECT_STATE.md" }],
    }),
    false,
  )
})

test("reports a main advance that includes runtime code", () => {
  assert.equal(
    shouldNotifyProductUpdate({
      status: "ahead",
      ahead_by: 2,
      files: [{ filename: "docs/NEWSFLUX_PROJECT_STATE.md" }, { filename: "src/App.jsx" }],
    }),
    true,
  )
})

test("fails open to update notification at the GitHub compare file cap", () => {
  assert.equal(
    shouldNotifyProductUpdate({
      status: "ahead",
      ahead_by: 1,
      files: Array.from({ length: 300 }, (_, index) => ({ filename: `docs/${index}.md` })),
    }),
    true,
  )
})

test("does not notify when main is not ahead of the build", () => {
  for (const status of ["identical", "behind", "diverged"]) {
    assert.equal(
      shouldNotifyProductUpdate({ status, ahead_by: 0, files: [{ filename: "src/App.jsx" }] }),
      false,
    )
  }
})

test("sidebar brand uses shared product identity", () => {
  const sidebarSource = readFileSync(
    new URL("../components/Sidebar/Sidebar.jsx", import.meta.url),
    "utf8",
  )

  assert.ok(sidebarSource.includes('import { PRODUCT_NAME } from "@/utils/constants"'))

  assert.ok(sidebarSource.includes('<span className="home-brand-title">{PRODUCT_NAME}</span>'))

  assert.ok(!sidebarSource.includes('<span className="home-brand-title">ReactFlux</span>'))
})

const TEST_BUILD_REVISION = "0123456789abcdef0123456789abcdef01234567"

const runVersionInfoInSandbox = (environment = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "newsflux-version-info-"))
  const scriptsDirectory = path.join(root, "src", "scripts")
  const binDirectory = path.join(root, "bin")
  const scriptPath = path.join(scriptsDirectory, "version-info.js")
  const outputPath = path.join(root, "src", "version-info.json")

  mkdirSync(scriptsDirectory, { recursive: true })
  mkdirSync(binDirectory)
  copyFileSync(new URL("../scripts/version-info.js", import.meta.url), scriptPath)

  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: { PATH: binDirectory, ...environment },
    })
    const versionInfo = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : null

    return { ...result, versionInfo }
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

test("production builds cannot silently keep an unknown revision", () => {
  const unguardedResult = runVersionInfoInSandbox()

  assert.equal(unguardedResult.status, 0, unguardedResult.stderr)
  assert.equal(unguardedResult.versionInfo.gitFullHash, "unknown")

  const result = runVersionInfoInSandbox({ NEWSFLUX_REQUIRE_BUILD_REVISION: "1" })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SOURCE_COMMIT/)
  assert.equal(result.versionInfo, null)
})

test("About build metadata uses the exact supplied full revision", () => {
  const result = runVersionInfoInSandbox({
    NEWSFLUX_REQUIRE_BUILD_REVISION: "1",
    SOURCE_COMMIT: TEST_BUILD_REVISION,
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.versionInfo.gitFullHash, TEST_BUILD_REVISION)
  assert.equal(result.versionInfo.gitHash, TEST_BUILD_REVISION.slice(0, 8))
})

test("development metadata has a bounded fallback when Git and build SHA are absent", () => {
  const result = runVersionInfoInSandbox()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.versionInfo, {
    gitHash: "unknown",
    gitFullHash: "unknown",
    gitDate: null,
  })
})

test("Docker frontend and OCI identity use the explicit NewsFlux build input", () => {
  const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")

  assert.match(dockerfile, /^ARG SOURCE_COMMIT$/m)
  assert.match(dockerfile, /NEWSFLUX_REQUIRE_BUILD_REVISION/)
  assert.match(dockerfile, /LABEL org\.opencontainers\.image\.revision=\$SOURCE_COMMIT/)
  assert.match(
    dockerfile,
    /org\.opencontainers\.image\.source="https:\/\/github\.com\/jfsdias\/NewsFlux"/,
  )
})

test("About exposes the full build SHA alongside its short display", () => {
  const aboutSource = readFileSync(
    new URL("../components/About/AboutModal.jsx", import.meta.url),
    "utf8",
  )

  assert.match(aboutSource, /title=\{buildInfo\.gitFullHash\}/)
  assert.match(
    aboutSource,
    /aria-label=\{`\$\{polyglot\.t\("about\.commit"\)\}: \$\{buildInfo\.gitFullHash\}`\}/,
  )
})
