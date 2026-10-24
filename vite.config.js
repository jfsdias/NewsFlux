import path from "node:path"
import { fileURLToPath } from "node:url"

import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { visualizer } from "rollup-plugin-visualizer"
import { defineConfig, loadEnv } from "vite"
import { VitePWA } from "vite-plugin-pwa"

import {
  RUNTIME_BUILD_ASSET_CACHE_NAME,
  runtimeBuildAssetCachePlugin,
} from "./src/utils/pwa-runtime-asset-cache.js" // eslint-disable-line import/extensions

const { dirname, resolve } = path
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const BASE_PATH_PATTERN = /^\/(?:[A-Za-z0-9._~-]+\/)*$/

const getBasePath = (value) => {
  const basePath = value?.trim() || "/"
  const segments = basePath.split("/").filter(Boolean)

  if (
    !BASE_PATH_PATTERN.test(basePath) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      'VITE_BASE_PATH must be "/" or an absolute path that starts and ends with "/" (for example, "/reactflux/"). Path segments may contain only letters, numbers, ".", "_", "~", and "-".',
    )
  }

  return basePath
}

export default defineConfig(({ mode }) => {
  const basePath = getBasePath(loadEnv(mode, __dirname).VITE_BASE_PATH)

  return {
    base: basePath,
    plugins: [
      react(),
      babel({
        presets: [reactCompilerPreset()],
      }),
      VitePWA({
        registerType: "prompt",
        devOptions: {
          enabled: false,
        },
        manifest: {
          name: "NewsFlux",
          short_name: "NewsFlux",
          description: "A Simple but Powerful RSS Reader for Miniflux",
          // PROVISIONAL (PWA-01A D1): Base-path-aligned manifest identity matching start_url and scope.
          id: basePath,
          start_url: basePath,
          scope: basePath,
          icons: [
            {
              src: "favicon.ico",
              sizes: "64x64 32x32 24x24 16x16",
              type: "image/x-icon",
              purpose: "any",
            },
            {
              src: "logo192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "logo512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            // PROVISIONAL (PWA-01A D3): Mechanically padded maskable icons derived from existing glyph.
            {
              src: "maskable-icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "maskable-icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          // PROVISIONAL (PWA-01A D2): OLED-first standalone launch palette matching index.html dark theme-color.
          theme_color: "#0B0D10",
          background_color: "#0B0D10",
          display: "standalone",
        },
        workbox: {
          cleanupOutdatedCaches: true,
          // A new worker waits for the user (see src/utils/pwa-update.js), so there is no skipWaiting.
          // Claiming clients keeps a first install in control of the page without a reload.
          clientsClaim: true,
          globPatterns: [
            "**/*.html",
            "styles/*.css",
            "assets/index-*.{js,css}",
            "assets/react-*.js",
            "assets/rolldown-runtime-*.js",
            "assets/workbox-window*.js",
          ],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/.*\.(?:css|js)$/,
              handler: "CacheFirst",
              options: {
                cacheName: RUNTIME_BUILD_ASSET_CACHE_NAME,
                plugins: [runtimeBuildAssetCachePlugin],
                expiration: {
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                  maxEntries: 80,
                },
              },
            },
            {
              urlPattern: /\/fonts\/.*\.woff2$/,
              handler: "CacheFirst",
              options: {
                cacheName: "runtime-fonts",
                expiration: {
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                  maxEntries: 40,
                },
              },
            },
          ],
        },
      }),
      mode === "analyze" &&
        visualizer({
          brotliSize: true,
          filename: "stats.html",
          gzipSize: true,
        }),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
    },
    build: {
      outDir: "build",
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "react",
                test: /[\\/]node_modules[\\/](react|react-dom|react-router)[\\/]/,
              },
            ],
          },
        },
      },
    },
  }
})
