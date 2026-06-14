import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:4328",
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: "pnpm preview --host 127.0.0.1 --port 4328",
    url: "http://127.0.0.1:4328",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
