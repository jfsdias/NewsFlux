/* eslint-disable import/no-relative-parent-imports -- Isolated test reuses the application Vite configuration. */
import { mergeConfig } from "vite"

import baseConfig from "../../vite.config.js"

export default mergeConfig(baseConfig({ mode: "development" }), {
  server: {
    proxy: {
      "/api/ai": {
        target: "http://127.0.0.1:18888",
        configure(proxy) {
          proxy.on("proxyReq", (request) => {
            request.setHeader("host", "newsflux.example")
            request.setHeader("origin", "https://newsflux.example")
            request.setHeader("x-forwarded-proto", "https")
          })
        },
      },
      "/__pilot": "http://127.0.0.1:18888",
    },
  },
})
