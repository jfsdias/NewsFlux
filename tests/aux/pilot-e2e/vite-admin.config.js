import { mergeConfig } from "vite"

import baseConfig from "../../../vite.config.js"

export default mergeConfig(baseConfig({ mode: "development" }), {
  server: {
    proxy: {
      "/api/ai": {
        target: "http://127.0.0.1:18889",
        configure(proxy) {
          proxy.on("proxyReq", (request) => {
            // Same trusted TLS edge contract as the production Caddy route (PR #264).
            request.setHeader("host", "newsflux.example")
            request.setHeader("origin", "https://newsflux.example")
            request.setHeader("x-forwarded-proto", "https")
          })
        },
      },
      "/__admin": "http://127.0.0.1:18889",
    },
  },
})
