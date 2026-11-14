# Reader delta audit: production `79f1574` → main `94c080e`

Production Reader image revision: `79f1574bb9101c8537b5d0cd6a3e7e93130c5e91`. Candidate base:
`94c080e147f949e132fe240d1726692b82bf2c5e` (29 commits, 22 non-merge).

## What reaches the Reader image

The Reader image is built from `Dockerfile` (Vite bundle of `src/`, `public/`, `index.html`, served by
Caddy with the bind-mounted pilot Caddyfile). Files outside those paths do not change the served app.

```text
git diff --name-only 79f1574..94c080e -- Dockerfile Caddyfile package.json pnpm-lock.yaml vite.config.js \
  index.html public src/routes* src/App.jsx src/apis/{entries,feeds,categories,ofetch}.js src/utils/auth.js \
  src/store/{authState,contentState}.js src/components/{Home*,Main,Sidebar}
→ (empty)
```

Only one commit changes `src/`: `1e3f1e4` (jfsdias/NewsFlux#241). It touches 19 files, all in the
Article-Intelligence surface:

| Area         | Files                                                                                                                                    | Behavioural change                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings     | `Settings/ArticleIntelligence.{jsx,css}`, `Settings/Reading.jsx` (+2 lines), `utils/settings-schema.js`                                  | New section, rendered only when `VITE_ARTICLE_INTELLIGENCE_ENABLED=1` and an API key is provisioned; 5 new closed-ID preferences with sanitizers |
| Reader       | `Article/ArticleDetail.{jsx,css}`, `Article/ArticleSummaryResult.jsx`, `hooks/useArticleSummary.js`, `hooks/useReaderContentRecovery.js` | Summary v2 rendering; recovery consent/cancel (button hidden when the recovery base path is empty)                                               |
| API/contract | `apis/article-intelligence.js`, `utils/article-intelligence-{profile,summary}.js`                                                        | Same-origin `GET /api/ai/v1/models`; v2 summary body                                                                                             |
| i18n         | 6 locale files                                                                                                                           | Additive keys only                                                                                                                               |

No change to: navigation/routing, authentication and session handling, Miniflux API clients
(`entries`, `feeds`, `categories`, `ofetch`), Home/All/Unread/cards/ranking, build tooling, dependencies,
the root Caddyfile or the Dockerfile.

## Regression evidence (CI on #241 HEAD `deb7297`, merged as `94c080e`)

- `Playwright scenarios`: the frozen 75-scenario product inventory (navigation, Reader, startup/feed,
  search/sort, card quick actions, bulk read, PWA/routing, resilience, recovery) — PASS.
- `Tests (Node 22/24)`: 684 unit tests including settings-schema sanitization — PASS.
- `Article Intelligence Reader Chromium scenarios`, `UX-REACH-01`, `synthetic-reader`,
  `Exact-source Docker Compose pilot gate`, `Exact-SHA images and same-origin HTTPS` — PASS.

## Residual Reader risks

1. Deploying the new Reader before the new Summary API makes the summary action show
   "model unavailable" (catalog 404/403). The operator procedure orders Summary → Caddy → Reader.
2. A stored preference from the new settings is local to the browser profile (documented in #241).
3. No physical-device verification.
