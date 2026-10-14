# NewsFlux

NewsFlux is a selectively maintained fork of [ReactFlux](https://github.com/electh/ReactFlux), built as a Miniflux frontend for a calmer, more editorial reading experience across desktop, mobile, tablet, and foldable screens.

## Why NewsFlux

- An editorial Home that gives stories a clearer reading hierarchy.
- A responsive, single-pane reader on phones, tablets, and foldable devices.
- OLED-aware content surfaces with restrained Liquid Glass navigation chrome.
- Miniflux remains the source of truth for feeds, categories, read status, and starred articles.
- Upstream changes are reviewed selectively; NewsFlux follows its own presentation and product direction.

## Current highlights

- Home with Highlights and a Recent continuation.
- Article reading in its own full-content view, with configurable column, card, and list browsing layouts.
- Search and feed/category views powered by the existing Miniflux integration.
- Read/unread and starred state synchronized with Miniflux.
- Home personalization can use the currently starred Miniflux corpus for Secondary Highlights and Recent, within freshness and diversity rules. The Primary remains the newest eligible unread story, and All/Unread keep their chronological behavior.

## Relationship to ReactFlux

NewsFlux is a fork of [ReactFlux](https://github.com/electh/ReactFlux). We preserve the upstream project’s history, license, and attribution. Upstream work is reviewed for selective integration, while NewsFlux intentionally diverges in presentation and product direction.

The [ReactFlux contributor history](https://github.com/electh/ReactFlux/graphs/contributors) credits contributors to the upstream project; it is not a NewsFlux-specific contributor list.

## Requirements

- A Miniflux server version 2.3.2 or newer.
- For local development: Node.js 22.22 or newer and pnpm 11.21.0.

NewsFlux is a frontend for Miniflux; it does not replace the Miniflux server or store feed data itself.

## Run NewsFlux

### Local development

Clone this repository, then run:

```bash
corepack enable
pnpm install
pnpm dev
```

Open the local development URL printed by Vite and connect the app to your Miniflux server.

### Build a local Docker image

NewsFlux does not publish its own Docker image. The inherited [docker-compose.yml](docker-compose.yml) still starts the upstream electh/reactflux image, so it is not a NewsFlux deployment. Build and run the image from this repository instead:

```bash
docker build -t newsflux:local .
docker run --rm -p 2000:2000 newsflux:local
```

These commands use the repository’s Dockerfile and serve the built frontend on port 2000.

## Screenshots

The repository’s current screenshot assets are inherited from upstream ReactFlux and do not represent the current NewsFlux interface. They are omitted here until verified NewsFlux captures are available.

## License

NewsFlux retains the upstream MIT license and attribution. See [LICENSE](LICENSE).
