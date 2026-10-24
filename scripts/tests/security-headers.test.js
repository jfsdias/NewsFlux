import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createServer as createNetServer } from "node:net"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const caddyBinary = process.env.CADDY_BIN
const buildDirectory = process.env.SECURITY_HEADERS_BUILD_ROOT
const caddySource = await readFile(path.join(repositoryRoot, "Caddyfile"), "utf8")
const expectedHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
}

const getFreePort = async () => {
  const server = createNetServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

const assertSecurityHeaders = (response, context) => {
  for (const [name, value] of Object.entries(expectedHeaders)) {
    assert.equal(response.headers.get(name), value, `${context}: ${name}`)
  }
}

test("Caddyfile declares only the approved baseline response headers", () => {
  const headerBlocks = [...caddySource.matchAll(/(?<![\w-])header\s*\{([^}]*)\}/gs)]
  assert.equal(headerBlocks.length, 1)
  assert.deepEqual(
    headerBlocks[0][1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    ["X-Content-Type-Options nosniff", "Referrer-Policy strict-origin-when-cross-origin"],
  )
})

test(
  "Caddy applies the approved headers to root, SPA, assets, 404, and Story proxy responses",
  { skip: !caddyBinary && "set CADDY_BIN to run the isolated Caddy response integration gate" },
  async (t) => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "newsflux-security-headers-test-"))
    const rootDirectory = buildDirectory || path.join(tempDirectory, "site")
    if (!buildDirectory) {
      await mkdir(path.join(rootDirectory, "assets"), { recursive: true })
      await writeFile(
        path.join(rootDirectory, "index.html"),
        "<!doctype html><title>fixture</title>",
      )
      await writeFile(path.join(rootDirectory, "assets", "app.js"), "window.fixtureLoaded = true;")
    }

    let storyPath = null
    const storyServer = createServer((request, response) => {
      storyPath = request.url
      response.writeHead(202, { "content-type": "application/json" })
      response.end('{"ok":true}')
    })
    storyServer.listen(0, "127.0.0.1")
    await once(storyServer, "listening")
    const storyPort = storyServer.address().port

    const port = await getFreePort()
    const config = caddySource
      .replaceAll(/^:2000$/gm, `http://127.0.0.1:${port}\n\tbind 127.0.0.1`)
      .replaceAll("root * /srv", `root * "${rootDirectory}"`)
    const configPath = path.join(tempDirectory, "Caddyfile")
    await writeFile(configPath, `{\n\tadmin off\n}\n\n${config}`)

    const child = spawn(caddyBinary, ["run", "--config", configPath, "--adapter", "caddyfile"], {
      env: {
        ...process.env,
        STORY_RANKER_UPSTREAM: `http://127.0.0.1:${storyPort}`,
        XDG_CONFIG_HOME: path.join(tempDirectory, "config"),
        XDG_DATA_HOME: path.join(tempDirectory, "data"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk))
    child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk))
    const origin = `http://127.0.0.1:${port}`

    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, "exit")
        child.kill("SIGTERM")
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))])
      }
      await new Promise((resolve) => storyServer.close(resolve))
      await rm(tempDirectory, { recursive: true, force: true })
    })

    let ready = false
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Caddy exited before becoming ready:\n${output}`)
      }
      try {
        const response = await fetch(origin)
        if (response.status === 200) {
          ready = true
          break
        }
      } catch {
        // Caddy can refuse connections while its listener is starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(ready, true, `Caddy did not become ready:\n${output}`)

    const root = await fetch(origin)
    assert.equal(root.status, 200)
    assertSecurityHeaders(root, "root")
    const indexHtml = await readFile(path.join(rootDirectory, "index.html"), "utf8")

    const spa = await fetch(`${origin}/all`)
    assert.equal(spa.status, 200)
    assert.equal(await spa.text(), indexHtml)
    assertSecurityHeaders(spa, "SPA route")

    const jsPath = indexHtml.match(/\bsrc="([^"]+\.js)"/)?.[1]
    const cssPath = indexHtml.match(/\bhref="([^"]+\.css)"/)?.[1]
    const assets = buildDirectory
      ? [
          ["static JavaScript asset", jsPath, /javascript/i],
          ["static CSS asset", cssPath, /text\/css/i],
        ]
      : [["static JavaScript asset", "/assets/app.js", /javascript/i]]
    for (const [label, assetPath, contentType] of assets) {
      assert.ok(assetPath, `production index must reference ${label}`)
      const asset = await fetch(new URL(assetPath, origin))
      assert.equal(asset.status, 200)
      assert.match(asset.headers.get("content-type") ?? "", contentType)
      assertSecurityHeaders(asset, label)
    }

    const missing = await fetch(`${origin}/assets/__security_headers_missing__.js`)
    assert.equal(missing.status, 404)
    assert.doesNotMatch(missing.headers.get("content-type") ?? "", /text\/html/i)
    assertSecurityHeaders(missing, "true static 404")

    const story = await fetch(`${origin}/api/story-candidates/probe?source=home`)
    assert.equal(story.status, 202)
    assert.deepEqual(await story.json(), { ok: true })
    assert.equal(
      storyPath,
      "/probe?source=home",
      "Story proxy keeps its existing stripped-prefix semantics",
    )
    assertSecurityHeaders(story, "Story API proxy")
  },
)
