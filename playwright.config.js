import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5193",
    channel: "chrome",
    hasTouch: true,
    viewport: { width: 1180, height: 820 },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5193 --strictPort",
    url: "http://127.0.0.1:5193",
    reuseExistingServer: false,
    env: { GOODMATH_DEMO_DIR: mkdtempSync(join(tmpdir(), "goodmath-qa-")) },
  },
});
