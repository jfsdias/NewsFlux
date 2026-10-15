# NewsFlux

NewsFlux is an editorial Miniflux frontend and a selectively maintained fork of ReactFlux. It gives unread stories a clearer Home and a focused reading experience while Miniflux remains the source of truth for feeds, categories, and article state.

## What is NewsFlux

NewsFlux is a third-party web frontend for [Miniflux](https://github.com/miniflux/v2). Its product and presentation direction diverge from the upstream ReactFlux project while preserving the fork’s history and attribution.

## Highlights

- An editorial Home with Highlights and Latest. Starred articles can inform source and category affinity for secondary Highlights and Latest, while the lead story remains freshness-driven.
- A focused article view, plus configurable Column, Card, and List browsing layouts.
- Responsive layouts with OLED-aware content surfaces and restrained Liquid Glass treatments for navigation and interactive controls.
- Search, feed and category views, with read/unread and starred state managed by Miniflux.
- All and Unread keep their chronological behavior; Home personalization affects only the Home story selection.

## Relationship to ReactFlux

NewsFlux is a fork of [electh/ReactFlux](https://github.com/electh/ReactFlux). Upstream fixes are reviewed for selective integration, while NewsFlux develops its own editorial and product direction. The upstream history and MIT license attribution are preserved.

The [ReactFlux contributor history](https://github.com/electh/ReactFlux/graphs/contributors) credits contributors to the upstream project; it is not a NewsFlux-specific contributor list.

## Requirements

- A Miniflux server running version 2.3.2 or newer.
- For local development, Node.js 22.22 or newer and pnpm 11.21.0.

## Local development

Clone the repository, install the locked dependencies, and start Vite:

```bash
git clone https://github.com/jfsdias/NewsFlux.git
cd NewsFlux
pnpm install --frozen-lockfile
pnpm dev
```

Vite serves the frontend on port 3000 by default. Connect it to your Miniflux server after it starts.

## Build and run locally

To create a production build and preview it locally:

```bash
pnpm run build
pnpm run preview
```

The repository Dockerfile can build and serve a local image on port 2000:

```bash
docker build -t newsflux:local .
docker run --rm -p 2000:2000 newsflux:local
```

The checked-in `docker-compose.yml` still starts the upstream `electh/reactflux` image, so it does not deploy NewsFlux.

## Screenshots

The checked-in screenshot assets are inherited from ReactFlux and do not show the current NewsFlux interface. They are omitted here until verified NewsFlux screenshots are available.

## License

The upstream MIT license and its copyright notice are preserved. See [LICENSE](LICENSE).
