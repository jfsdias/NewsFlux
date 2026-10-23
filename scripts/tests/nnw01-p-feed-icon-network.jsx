/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import FeedIcon from "@/components/ui/FeedIcon"
import { authState } from "@/store/authState"
import { feedIconsState } from "@/store/feedIconsState"

// NNW01-P: renders the real FeedIcon (and the real useFeedIcons hook) for the icon states that
// used to reach a third-party favicon service, so a browser run can count outgoing requests.
// Everything here is synthetic: reserved .test hosts, generated PNG data URIs, no real Miniflux.
const MINIFLUX_ORIGIN = "https://miniflux.test"
authState.set({
  server: MINIFLUX_ORIGIN,
  token: "synthetic-harness-token",
  username: "",
  password: "",
})

const createPngDataUrl = (width, height, color) => {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  return canvas.toDataURL("image/png")
}

const SQUARE_ICON_ID = 11
const NON_SQUARE_ICON_ID = 12
const BROKEN_ICON_ID = 13
// Provider-backed icon data is what useFeedIcons stores after GET /v1/icons/{id}; seeding the same
// store keeps the harness free of API calls while exercising the same render path.
feedIconsState.setKey(SQUARE_ICON_ID, {
  url: createPngDataUrl(32, 32, "#2878c8"),
  width: null,
  height: null,
})
feedIconsState.setKey(NON_SQUARE_ICON_ID, {
  url: createPngDataUrl(64, 24, "#c8502a"),
  width: null,
  height: null,
})

const createFeed = (id, title, iconId, siteUrl, feedUrl = "", externalIconId) => ({
  id,
  title,
  site_url: siteUrl,
  feed_url: feedUrl,
  icon: {
    feed_id: id,
    icon_id: iconId,
    ...(externalIconId ? { external_icon_id: externalIconId } : {}),
  },
})

const CASES = [
  {
    name: "NO_ICON",
    feed: createFeed(
      1,
      "No Icon Feed",
      0,
      "https://news.example.test/",
      "https://news.example.test/rss",
    ),
  },
  {
    name: "SQUARE_PROVIDER_ICON",
    feed: createFeed(2, "Square Icon Feed", SQUARE_ICON_ID, "https://square.example.test/"),
  },
  {
    name: "NON_SQUARE_PROVIDER_ICON",
    feed: createFeed(3, "Wide Icon Feed", NON_SQUARE_ICON_ID, "https://wide.example.test/"),
  },
  {
    name: "BROKEN_PROVIDER_ICON",
    feed: createFeed(
      4,
      "Broken Icon Feed",
      BROKEN_ICON_ID,
      "https://broken.example.test/",
      "",
      "broken-icon",
    ),
  },
  {
    name: "USERINFO_AND_PORT",
    feed: createFeed(
      5,
      "Userinfo Feed",
      0,
      "https://reader:SYNTHETIC-NOT-A-SECRET@auth.example.test:8443/",
    ),
  },
  {
    name: "MULTIPART_CO_UK",
    feed: createFeed(6, "BBC Like", 0, "https://www.bbc.example.co.uk/news"),
  },
  {
    name: "MULTIPART_JUS_BR",
    feed: createFeed(7, "Tribunal", 0, "https://www.stj.example.jus.br/"),
  },
  {
    name: "LOCALHOST",
    feed: createFeed(8, "Localhost Feed", 0, "http://localhost:8080/", "http://localhost:8080/rss"),
  },
  {
    name: "IP_LITERAL",
    feed: createFeed(9, "IP Feed", 0, "http://192.168.1.10/", "http://192.168.1.10/rss"),
  },
  {
    name: "MALFORMED_URLS",
    feed: createFeed(10, "Malformed Feed", 0, "not a url", "also not a url"),
  },
]

const VARIANTS = [
  { name: "sidebar", props: {} },
  { name: "list", props: { monogramFallback: true } },
]

const describeIcon = (element) => {
  if (element.querySelector(".feed-icon-monogram")) {
    return "LOCAL_MONOGRAM"
  }
  const sources = [...element.querySelectorAll("img")].map((image) => image.getAttribute("src"))
  if (sources.length === 0) {
    return "NONE"
  }
  if (sources.every((source) => source.endsWith("/default-feed-icon.png"))) {
    return "LOCAL_DEFAULT"
  }
  if (sources.every((source) => source.startsWith("data:"))) {
    return "PROVIDER_DATA_ICON"
  }
  if (sources.every((source) => source.startsWith(`${MINIFLUX_ORIGIN}/`))) {
    return "PROVIDER_URL_ICON"
  }
  return "REMOTE_OR_OTHER"
}

const collectReport = () => {
  const rows = [...document.querySelectorAll("[data-case]")].map((element) => {
    const images = [...element.querySelectorAll("img")]
    return {
      case: element.dataset.case,
      variant: element.dataset.variant,
      state: describeIcon(element),
      sources: images.map((image) => image.getAttribute("src").slice(0, 80)),
      naturalSizes: images.map((image) => `${image.naturalWidth}x${image.naturalHeight}`),
    }
  })
  return { generatedAt: new Date().toISOString(), rows }
}

const Harness = () => {
  const [report, setReport] = useState(null)

  useEffect(() => {
    // Give image load and error events a moment to settle before reporting.
    const timer = setTimeout(() => {
      const nextReport = collectReport()
      globalThis.__NNW01P_REPORT__ = nextReport
      setReport(nextReport)
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <main style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1>NNW01-P feed icon network harness</h1>
      <table>
        <tbody>
          {CASES.map(({ name, feed }) => (
            <tr key={name}>
              <th scope="row" style={{ textAlign: "left", paddingRight: 16 }}>
                {name}
              </th>
              {VARIANTS.map(({ name: variantName, props }) => (
                <td
                  key={variantName}
                  data-case={name}
                  data-variant={variantName}
                  style={{ width: 48, height: 24 }}
                >
                  <FeedIcon feed={feed} {...props} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <output data-testid="nnw01-p-report" style={{ whiteSpace: "pre-wrap" }}>
        {report ? JSON.stringify(report.rows, null, 1) : "running"}
      </output>
    </main>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
