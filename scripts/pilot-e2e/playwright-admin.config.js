import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  // Files run in name order with one worker: the migration suite starts from its own fresh store.
  testMatch: /ai-settings-(admin|migration)\.spec\.js$/u,
  workers: 1,
  retries: 0,
  outputDir: "../../test-results/ai-settings-admin",
  use: { baseURL: "http://127.0.0.1:14191", browserName: "chromium", trace: "off" },
  webServer: [
    {
      command:
        "cd ../.. && python -m uvicorn scripts.pilot-e2e.admin_backend:app --host 127.0.0.1 --port 18889 --proxy-headers --forwarded-allow-ips 127.0.0.1",
      url: "http://127.0.0.1:18889/healthz",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "cd ../.. && VITE_ARTICLE_INTELLIGENCE_ENABLED=1 pnpm exec vite --config scripts/pilot-e2e/vite-admin.config.js --host 127.0.0.1 --port 14191 --strictPort",
      url: "http://127.0.0.1:14191/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
