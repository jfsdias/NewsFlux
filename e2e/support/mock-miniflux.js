/* eslint-disable unicorn/prefer-switch -- request routing mixes equality and regular-expression tests */
import { createServer } from "node:http"

/**
 * Synthetic Miniflux used by the e2e suite. It implements only the endpoints NewsFlux calls and a
 * control API under /__e2e/ to reset state, inject failures and inspect requests. No real data.
 */

const BASE_ENTRY_COUNT = 150
const INJECTED_ID_BASE = 1000
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "X-Auth-Token,Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
}
const MINUTE = 60_000
const SLOW_RESPONSE_MS = 6000

const categories = [
  { id: 1, title: "Tecnologia" },
  { id: 2, title: "Mundo" },
  { id: 3, title: "Economia" },
  { id: 4, title: "Ciência" },
]
const feedNames = [
  "Alfa Tech",
  "Beta Mundo",
  "Gama Econ",
  "Delta Ciência",
  "Épsilon Dev",
  "Zeta Brasil",
  "Eta Global",
  "Theta Lab",
]
const imageShapes = [
  [1200, 675],
  [800, 800],
  [600, 900],
  [1600, 400],
  [320, 180],
]
const filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor "

const buildFeeds = (now) =>
  feedNames.map((title, index) => ({
    id: index + 1,
    user_id: 1,
    title,
    site_url: `https://feed${index + 1}.example.invalid`,
    feed_url: `https://feed${index + 1}.example.invalid/rss`,
    checked_at: new Date(now).toISOString(),
    parsing_error_count: 0,
    parsing_error_message: "",
    disabled: false,
    hide_globally: false,
    category: categories[index % categories.length],
    icon: { feed_id: index + 1, icon_id: index + 1 },
  }))

const buildEntryContent = (index, imageBase) => {
  const [width, height] = imageShapes[index % imageShapes.length]
  const hasImage = index % 7 !== 0
  const broken = index % 23 === 0
  const image = hasImage
    ? `<figure><img src="${imageBase}/img/${index}.svg?w=${width}&h=${height}${broken ? "&broken=1" : ""}" width="${width}" height="${height}" alt="Imagem ${index}"><figcaption>Legenda ${index}</figcaption></figure>`
    : ""
  return `${image}<p>${filler.repeat(3)}</p><h2>Subtítulo</h2><p>${filler.repeat(8)}</p><blockquote>${filler}</blockquote><pre><code>const x = ${index}\nconsole.log(x)</code></pre><p>${filler.repeat(6)}</p>`
}

const buildEntries = (now, feeds, imageBase) =>
  Array.from({ length: BASE_ENTRY_COUNT }, (_, offset) => {
    const index = offset + 1
    const feed = feeds[(index * 3) % feeds.length]
    const published = new Date(now - index * 37 * MINUTE).toISOString()
    const longTitle =
      index % 11 === 0
        ? "Um título extraordinariamente longo que precisa quebrar em várias linhas para testar truncamento "
        : "Título curto "
    return {
      id: index,
      user_id: 1,
      feed_id: feed.id,
      status: "unread",
      hash: `h${index}`,
      title: `Notícia ${index}: ${longTitle}${feed.title}`,
      url: `https://feed${feed.id}.example.invalid/a/${index}`,
      comments_url: "",
      published_at: published,
      created_at: published,
      changed_at: published,
      content: buildEntryContent(index, imageBase),
      author: `Autor ${index}`,
      share_code: "",
      starred: index % 13 === 0,
      reading_time: 1 + (index % 9),
      enclosures: [],
      tags: [],
      feed,
    }
  })

const sortEntries = (list, order, direction) =>
  list.toSorted((left, right) => {
    const leftValue = order === "id" ? left.id : Date.parse(left[order] ?? left.published_at)
    const rightValue = order === "id" ? right.id : Date.parse(right[order] ?? right.published_at)
    return direction === "asc" ? leftValue - rightValue : rightValue - leftValue
  })

const filterEntries = (query, source, all) => {
  let list = [...source]
  const status = query.get("status")
  if (status) {
    list = list.filter((entry) => entry.status === status)
  }
  if (query.get("starred") === "true") {
    list = list.filter((entry) => entry.starred)
  }
  const search = query.get("search")?.toLowerCase()
  if (search) {
    list = list.filter((entry) => `${entry.title}${entry.content}`.toLowerCase().includes(search))
  }
  const before = query.get("published_before")
  if (before) {
    list = list.filter((entry) => Date.parse(entry.published_at) / 1000 < Number(before))
  }
  const after = query.get("published_after")
  if (after) {
    list = list.filter((entry) => Date.parse(entry.published_at) / 1000 > Number(after))
  }
  const order = query.get("order") ?? "published_at"
  const beforeEntryId = query.get("before_entry_id")
  if (beforeEntryId) {
    const reference = all.find((entry) => String(entry.id) === beforeEntryId)
    if (reference) {
      const key = order === "created_at" ? "created_at" : "published_at"
      list = list.filter((entry) => Date.parse(entry[key]) < Date.parse(reference[key]))
    }
  }
  const sorted = sortEntries(list, order, query.get("direction") ?? "desc")
  const offset = Number(query.get("offset") ?? 0)
  const limit = Number(query.get("limit") ?? 100)
  return { total: sorted.length, entries: sorted.slice(offset, offset + limit) }
}

const readBody = (request) =>
  new Promise((resolve) => {
    let body = ""
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => resolve(body))
  })

const iconPayload = (id) => ({
  id: Number(id),
  mime_type: "image/svg+xml",
  data: `image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="hsl(${Number(id) * 60} 60% 50%)"/></svg>`,
  ).toString("base64")}`,
})

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json", ...headers })
  response.end(typeof body === "string" ? body : JSON.stringify(body))
}

const image = (url, response) => {
  if (url.searchParams.get("broken")) {
    response.writeHead(404, CORS_HEADERS)
    response.end()
    return
  }
  const id = Number(url.pathname.split("/", 3)[2].replace(".svg", ""))
  const width = url.searchParams.get("w")
  const height = url.searchParams.get("h")
  response.writeHead(200, {
    ...CORS_HEADERS,
    "Content-Type": "image/svg+xml",
    "Cache-Control": "max-age=3600",
  })
  response.end(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="hsl(${(id * 37) % 360} 40% 35%)"/></svg>`,
  )
}

const createMockMiniflux = ({ port }) => {
  const imageBase = `http://127.0.0.1:${port}`
  const now = Date.now()
  const feeds = buildFeeds(now)
  let entries = buildEntries(now, feeds, imageBase)
  const faults = {}
  const hits = []
  const mutations = []
  let mode = "ok"

  const reset = () => {
    for (const key of Object.keys(faults)) {
      delete faults[key]
    }
    mode = "ok"
    entries = entries
      .filter((entry) => entry.id < INJECTED_ID_BASE)
      .map((entry) => ({ ...entry, status: "unread", starred: entry.id % 13 === 0 }))
    hits.length = 0
    mutations.length = 0
  }

  const inject = (count) => {
    const feed = feeds[0]
    for (let index = 0; index < count; index += 1) {
      const id = INJECTED_ID_BASE + entries.length + index
      const stamp = new Date().toISOString()
      entries.unshift({
        id,
        user_id: 1,
        feed_id: feed.id,
        status: "unread",
        hash: `n${id}`,
        title: `NOVA ${id}`,
        url: `https://x.invalid/${id}`,
        published_at: stamp,
        created_at: stamp,
        changed_at: stamp,
        content: "<p>nova</p>",
        author: "a",
        share_code: "",
        starred: false,
        reading_time: 1,
        enclosures: [],
        tags: [],
        feed,
      })
    }
  }

  const state = () => ({
    read: entries.filter((entry) => entry.status === "read").map((entry) => entry.id),
    unread: entries.filter((entry) => entry.status === "unread").length,
    starred: entries.filter((entry) => entry.starred).map((entry) => entry.id),
    hits: hits.toSpliced(0, Math.max(0, hits.length - 60)),
    mutations: [...mutations],
  })

  const control = (url, response) => {
    const { pathname, searchParams } = url
    if (pathname === "/__e2e/reset") {
      reset()
    } else if (pathname === "/__e2e/fault") {
      faults[searchParams.get("target")] = searchParams.get("kind")
    } else if (pathname === "/__e2e/mode") {
      mode = searchParams.get("mode")
    } else if (pathname === "/__e2e/inject") {
      inject(Number(searchParams.get("count") ?? 3))
    }
    send(response, 200, { faults, mode, state: state() })
  }

  const faultFor = (request, url) => {
    const { pathname } = url
    let target
    if (pathname === "/v1/entries" && request.method === "PUT") {
      target = "status-mutation"
    } else if (pathname === "/v1/entries") {
      target = "entries"
    } else if (pathname === "/v1/feeds") {
      target = "feeds"
    } else if (pathname === "/v1/me") {
      target = "me"
    } else if (pathname.startsWith("/v1/entries/") && request.method === "GET") {
      target = "entry"
    }
    return target ? { target, kind: faults[target] } : {}
  }

  const applyFault = (response, url, { target, kind }) => {
    const query = url.searchParams
    switch (kind) {
      case "500": {
        if (target === "status-mutation") {
          return false
        }
        send(response, 500, { error_message: "boom" })
        return true
      }
      case "401": {
        send(response, 401, { error_message: "Access Unauthorized" })
        return true
      }
      case "badjson": {
        send(response, 200, "{not json")
        return true
      }
      case "html200": {
        send(response, 200, "<html>proxy login</html>", { "Content-Type": "text/html" })
        return true
      }
      case "empty": {
        send(response, 200, target === "entries" ? { total: 0, entries: [] } : [])
        return true
      }
      case "missing": {
        send(response, 200, { total: 2 })
        return true
      }
      case "emptyobject": {
        send(response, 200, {})
        return true
      }
      case "nullcontent": {
        const list = filterEntries(query, entries, entries).entries.map((entry) => ({
          ...entry,
          content: null,
          title: null,
        }))
        send(response, 200, { total: list.length, entries: list })
        return true
      }
      case "dup": {
        const result = filterEntries(query, entries, entries)
        send(response, 200, {
          total: result.total,
          entries: [...result.entries, ...result.entries.slice(0, 5)],
        })
        return true
      }
      case "slow": {
        setTimeout(() => {
          send(response, 200, target === "entries" ? filterEntries(query, entries, entries) : [])
        }, SLOW_RESPONSE_MS)
        return true
      }
      default: {
        return false
      }
    }
  }

  const counters = () => {
    const unreads = {}
    const reads = {}
    for (const feed of feeds) {
      unreads[feed.id] = entries.filter(
        (entry) => entry.feed_id === feed.id && entry.status === "unread",
      ).length
      reads[feed.id] = entries.filter(
        (entry) => entry.feed_id === feed.id && entry.status === "read",
      ).length
    }
    return { reads, unreads }
  }

  const route = async (request, response, url) => {
    const { pathname, searchParams } = url
    const entryMatch = pathname.match(/^\/v1\/entries\/(\d+)$/)
    const categoryMatch = pathname.match(/^\/v1\/categories\/(\d+)\/entries$/)
    const feedMatch = pathname.match(/^\/v1\/feeds\/(\d+)\/entries$/)

    if (pathname === "/v1/version") {
      send(response, 200, { version: "2.3.2", commit: "mock", build_date: "2026-01-01" })
    } else if (pathname === "/v1/me") {
      send(response, 200, { id: 1, username: "audit", is_admin: false, theme: "dark" })
    } else if (pathname === "/v1/categories") {
      send(
        response,
        200,
        categories.map((category) => ({ ...category, user_id: 1 })),
      )
    } else if (pathname === "/v1/feeds") {
      send(response, 200, feeds)
    } else if (pathname === "/v1/feeds/counters") {
      send(response, 200, counters())
    } else if (pathname.startsWith("/v1/icons/")) {
      send(response, 200, iconPayload(pathname.split("/", 4)[3]))
    } else if (pathname === "/v1/integrations/status") {
      send(response, 200, { has_integrations: false })
    } else if (pathname === "/v1/entries/ids") {
      const result = filterEntries(searchParams, entries, entries)
      send(response, 200, { total: result.total, entry_ids: result.entries.map(({ id }) => id) })
    } else if (request.method === "GET" && entryMatch) {
      const entry = entries.find(({ id }) => String(id) === entryMatch[1])
      if (entry) {
        send(response, 200, entry)
      } else {
        send(response, 404, { error_message: "Entry not found" })
      }
    } else if (request.method === "GET" && pathname === "/v1/entries") {
      send(response, 200, filterEntries(searchParams, entries, entries))
    } else if (request.method === "GET" && categoryMatch) {
      const source = entries.filter((entry) => String(entry.feed.category.id) === categoryMatch[1])
      send(response, 200, filterEntries(searchParams, source, entries))
    } else if (request.method === "GET" && feedMatch) {
      const source = entries.filter((entry) => String(entry.feed_id) === feedMatch[1])
      send(response, 200, filterEntries(searchParams, source, entries))
    } else if (request.method === "PUT" && pathname === "/v1/entries") {
      const payload = JSON.parse((await readBody(request)) || "{}")
      const mutation = {
        entryIds: [...payload.entry_ids],
        status: payload.status,
        outcome: faults["status-mutation"] === "500" ? "rejected" : "applied",
      }
      mutations.push(mutation)
      if (mutation.outcome === "rejected") {
        send(response, 500, { error_message: "mutation rejected by synthetic backend" })
        return
      }
      for (const entry of entries) {
        if (payload.entry_ids.includes(entry.id)) {
          entry.status = payload.status ?? entry.status
          entry.starred = typeof payload.starred === "boolean" ? payload.starred : entry.starred
        }
      }
      response.writeHead(204, CORS_HEADERS)
      response.end()
    } else if (request.method === "PUT") {
      response.writeHead(204, CORS_HEADERS)
      response.end()
    } else {
      send(response, 404, { error_message: `mock: unhandled ${pathname}` })
    }
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://mock")
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS)
      response.end()
      return
    }
    if (url.pathname.startsWith("/__e2e/")) {
      control(url, response)
      return
    }
    if (url.pathname.startsWith("/img/")) {
      image(url, response)
      return
    }
    if (mode === "down") {
      send(response, 503, { error_message: "mock down" })
      return
    }
    hits.push(`${request.method} ${url.pathname}${url.search}`)
    if (applyFault(response, url, faultFor(request, url))) {
      return
    }
    void route(request, response, url)
  })

  return {
    server,
    listen: () => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

export default createMockMiniflux
