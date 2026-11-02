import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3187",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/serve.js",
    url: "http://127.0.0.1:3187/api/public",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
