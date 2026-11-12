import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "pilot.spec.js",
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:14190", browserName: "chromium", trace: "retain-on-failure" },
  webServer: [
    {
      command:
        "cd ../.. && python -m uvicorn scripts.pilot-e2e.backend:app --host 127.0.0.1 --port 18888 --proxy-headers --forwarded-allow-ips 127.0.0.1",
      url: "http://127.0.0.1:18888/healthz",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "cd ../.. && pnpm exec vite --config scripts/pilot-e2e/vite.config.js --host 127.0.0.1 --port 14190 --strictPort",
      url: "http://127.0.0.1:14190/",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
