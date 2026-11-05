import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import process from "node:process"

/**
 * Serves the production build the way the repository Caddyfile does: SPA fallback for navigation
 * paths, a real 404 for missing build assets, and no CORS headers. `vite preview` is not used: it
 * answers with `Vary: Origin`, and with it the offline reload scenario (F13-1) failed because the
 * service worker's cached assets were not served. The repository Caddyfile sends no such header, so
 * the PWA scenarios would otherwise test the preview server instead of the application.
 */

const root = path.resolve(process.env.E2E_BUILD_DIR ?? "build")
const port = Number(process.env.E2E_APP_PORT ?? 4173)

const MIME_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
}

const resolveFile = (pathname) => {
  const candidate = path.join(root, decodeURIComponent(pathname))
  if (!candidate.startsWith(root)) {
    return null
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate
  }
  // Missing files with an extension are real misses (hashed build assets); other paths are routes.
  return path.extname(pathname) ? null : path.join(root, "index.html")
}

createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://app")
  const file = resolveFile(pathname)

  if (!file) {
    response.writeHead(404)
    response.end()
    return
  }

  const headers = {
    "Content-Type": MIME_TYPES[path.extname(file)] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  }
  response.writeHead(200, headers)
  createReadStream(file).pipe(response)
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}`)
})
