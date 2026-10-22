import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const [buildRoot, basePath = "/", port = "4178"] = process.argv.slice(2)

if (!buildRoot) {
  throw new Error(
    "Usage: node pwa-runtime-asset-cache-integrity-server.js <build-dir> [base-path] [port]",
  )
}

const resolvedBuildRoot = path.resolve(buildRoot)
const resolvedHarnessPath = fileURLToPath(
  new URL("pwa-runtime-asset-cache-integrity.html", import.meta.url),
)
const normalizedBasePath = `/${basePath.split("/").filter(Boolean).join("/")}${basePath === "/" ? "" : "/"}`
const availableAssets = new Set()
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
}

const send = (response, status, contentType, body) => {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" })
  response.end(body)
}

const sendFile = async (response, filePath) => {
  try {
    const body = await readFile(filePath)
    send(response, 200, mimeTypes[path.extname(filePath)] || "application/octet-stream", body)
    return true
  } catch {
    return false
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1")
  const requestPath = decodeURIComponent(url.pathname)
  const pathWithinBase =
    normalizedBasePath === "/"
      ? requestPath
      : requestPath.startsWith(normalizedBasePath)
        ? `/${requestPath.slice(normalizedBasePath.length)}`
        : null

  if (pathWithinBase === null) {
    send(response, 404, "text/plain; charset=utf-8", "outside test base path")
    return
  }

  if (pathWithinBase === "/__pwa03a__/asset") {
    const name = url.searchParams.get("name") || ""
    if (!/^pwa03a-[a-z0-9-]+\.(?:js|css)$/.test(name)) {
      send(response, 400, "text/plain; charset=utf-8", "invalid fixture asset name")
      return
    }
    if (url.searchParams.get("available") === "true") {
      availableAssets.add(name)
    } else {
      availableAssets.delete(name)
    }
    send(response, 200, "text/plain; charset=utf-8", "ok")
    return
  }

  if (pathWithinBase === "/pwa-runtime-asset-cache-integrity.html") {
    await sendFile(response, resolvedHarnessPath)
    return
  }

  if (pathWithinBase.startsWith("/assets/pwa03a-invalid-status.js")) {
    send(response, 503, "text/javascript; charset=utf-8", "unavailable")
    return
  }

  const fixtureMatch = pathWithinBase.match(/^\/assets\/(pwa03a-[a-z0-9-]+\.(?:js|css))$/)
  if (fixtureMatch) {
    const [, name] = fixtureMatch
    if (availableAssets.has(name)) {
      const isCss = name.endsWith(".css")
      const body = isCss
        ? "/* pwa03a-real-css */ .pwa03a { color: green; }"
        : "globalThis.__pwa03aAsset = 'pwa03a-real-javascript'"
      send(
        response,
        200,
        isCss ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
        body,
      )
      return
    }

    send(
      response,
      200,
      "text/html; charset=utf-8",
      "<!doctype html><title>SPA fallback fixture</title>",
    )
    return
  }

  const normalizedPath = path.normalize(pathWithinBase).replace(/^([.][.][/\\])+/, "")
  const filePath = path.resolve(resolvedBuildRoot, `.${path.sep}${normalizedPath}`)
  if (
    filePath.startsWith(`${resolvedBuildRoot}${path.sep}`) &&
    (await sendFile(response, filePath))
  ) {
    return
  }

  if (pathWithinBase.startsWith("/assets/")) {
    send(
      response,
      200,
      "text/html; charset=utf-8",
      "<!doctype html><title>SPA fallback fixture</title>",
    )
    return
  }

  const indexPath = path.join(resolvedBuildRoot, "index.html")
  if (await sendFile(response, indexPath)) {
    return
  }
  send(response, 404, "text/plain; charset=utf-8", "test build has no index.html")
})

server.listen(Number(port), "127.0.0.1", () => {
  process.stdout.write(`PWA03A2A_HARNESS_SERVER=http://127.0.0.1:${port}${normalizedBasePath}\n`)
})
