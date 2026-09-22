import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4173", viewport: { width: 1500, height: 820 }, deviceScaleFactor: 1 },
  webServer: {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: true,
  },
});
