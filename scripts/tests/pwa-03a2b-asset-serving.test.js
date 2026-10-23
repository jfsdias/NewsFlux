import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const caddyBinary = process.env.CADDY_BIN
const rootBuild = process.env.PWA_ASSET_TEST_BUILD_ROOT
const nonRootBuild = process.env.PWA_ASSET_TEST_BUILD_NON_ROOT
const skipReason =
  "set CADDY_BIN and production build directories to run the Caddy integration gate"

const getFreePort = async () => {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

const findFile = async (directory, predicate) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, predicate)
      if (nested) {
        return nested
      }
    } else if (predicate(entry.name, entryPath)) {
      return entryPath
    }
  }
  return null
}

const startCaddy = async ({ basePath, buildDirectory }) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "newsflux-caddy-asset-test-"))
  const port = await getFreePort()
  let rootDirectory = buildDirectory
  let servedIndex = path.join(rootDirectory, "index.html")

  if (basePath !== "/") {
    rootDirectory = path.join(tempDirectory, "published")
    const baseDirectory = path.join(rootDirectory, basePath.replaceAll(/^\/+|\/+$/g, ""))
    await mkdir(baseDirectory, { recursive: true })
    await cp(buildDirectory, baseDirectory, { recursive: true })
    servedIndex = path.join(baseDirectory, "index.html")
  }

  const caddySource = await readFile(path.join(repositoryRoot, "Caddyfile"), "utf8")
  const config = caddySource
    .replaceAll(/^:2000$/gm, `http://127.0.0.1:${port}\n\tbind 127.0.0.1`)
    .replaceAll("root * /srv", `root * "${rootDirectory}"`)
  const configPath = path.join(tempDirectory, "Caddyfile")
  await writeFile(configPath, `{\n\tadmin off\n}\n\n${config}`)

  const child = spawn(caddyBinary, ["run", "--config", configPath, "--adapter", "caddyfile"], {
    env: {
      ...process.env,
      REACTFLUX_BASE_PATH: basePath,
      XDG_CONFIG_HOME: path.join(tempDirectory, "config"),
      XDG_DATA_HOME: path.join(tempDirectory, "data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let output = ""
  child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk))
  child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk))

  const origin = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 10_000
  let ready = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Caddy exited before becoming ready:\n${output}`)
    }
    try {
      const response = await fetch(`${origin}${basePath}`)
      if (response.status === 200) {
        ready = true
        break
      }
    } catch {
      // Caddy can refuse connections while its listener is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) {
    child.kill("SIGTERM")
    throw new Error(`Caddy did not become ready:\n${output}`)
  }

  return {
    origin,
    child,
    output: () => output,
    servedIndex,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = once(child, "exit")
        child.kill("SIGTERM")
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))])
      }
      await rm(tempDirectory, { recursive: true, force: true })
    },
  }
}

const assertContract = async (t, { basePath, buildDirectory }) => {
  const server = await startCaddy({ basePath, buildDirectory })
  t.after(() => server.stop())

  const indexHtml = await readFile(server.servedIndex, "utf8")
  const jsPath = indexHtml.match(/\bsrc="([^"]+\.js)"/)?.[1]
  const cssPath = indexHtml.match(/\bhref="([^"]+\.css)"/)?.[1]
  assert.ok(jsPath, "production index must reference a JavaScript bundle")
  assert.ok(cssPath, "production index must reference a stylesheet")

  const validJs = await fetch(new URL(jsPath, server.origin))
  assert.equal(validJs.status, 200)
  assert.match(validJs.headers.get("content-type") ?? "", /javascript/i)

  const validCss = await fetch(new URL(cssPath, server.origin))
  assert.equal(validCss.status, 200)
  assert.match(validCss.headers.get("content-type") ?? "", /text\/css/i)

  const fontPath = await findFile(buildDirectory, (name) => /\.(?:woff2?|ttf|otf|eot)$/i.test(name))
  assert.ok(fontPath, "production build must include a font fixture")
  const relativeFont = path.relative(buildDirectory, fontPath).split(path.sep).join("/")
  const validFont = await fetch(`${server.origin}${basePath}${relativeFont}`)
  assert.equal(validFont.status, 200)
  assert.match(validFont.headers.get("content-type") ?? "", /font|octet-stream/i)

  for (const assetPath of [
    `${basePath}assets/__missing-pwa-03a2b__.js`,
    `${basePath}assets/__missing-pwa-03a2b__.css`,
    `${basePath}fonts/__missing-pwa-03a2b__.woff2`,
  ]) {
    const missing = await fetch(`${server.origin}${assetPath}`, { cache: "no-store" })
    const body = await missing.text()
    assert.equal(missing.status, 404, `${assetPath} must be a real asset miss`)
    assert.doesNotMatch(missing.headers.get("content-type") ?? "", /text\/html/i)
    assert.notEqual(body, indexHtml, `${assetPath} must not return the SPA document`)
  }

  const routePath = `${basePath}feed/75`
  const route = await fetch(`${server.origin}${routePath}`)
  assert.equal(route.status, 200)
  assert.match(route.headers.get("content-type") ?? "", /text\/html/i)
  assert.equal(await route.text(), indexHtml)
}

test(
  "PWA-03A2B Caddy asset contract at root base path",
  { skip: !caddyBinary || !rootBuild ? skipReason : false },
  async (t) => assertContract(t, { basePath: "/", buildDirectory: rootBuild }),
)

test(
  "PWA-03A2B Caddy asset contract at non-root base path",
  { skip: !caddyBinary || !nonRootBuild ? skipReason : false },
  async (t) => assertContract(t, { basePath: "/newsflux/", buildDirectory: nonRootBuild }),
)
