import { createServer } from "node:http"

const server = createServer((request, response) => {
  if (request.url?.startsWith("/provider-wide.svg")) {
    response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" })
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="24" viewBox="0 0 64 24"><rect width="64" height="24" fill="#f5e44a"/></svg>',
    )
    return
  }

  if (request.url?.startsWith("/provider-tiny.svg")) {
    response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" })
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#111"/></svg>',
    )
    return
  }

  response.writeHead(404)
  response.end()
})

server.listen(4174, "127.0.0.1", () => {
  process.stdout.write("NNW01-A mock provider icon server listening on http://127.0.0.1:4174\n")
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
