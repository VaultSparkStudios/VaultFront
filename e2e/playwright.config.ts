import { defineConfig, devices } from "@playwright/test";

export function normalizeE2EBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

const configuredBaseUrl = normalizeE2EBaseUrl(process.env.E2E_BASE_URL);
const baseURL = configuredBaseUrl ?? "http://localhost:9000";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  // The game client is intentionally heavyweight; cap local concurrency so browser
  // readiness assertions measure product behavior instead of CPU starvation.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  webServer: configuredBaseUrl
    ? undefined
    : [
        {
          command: "npm run start:e2e-fixture",
          url: "http://127.0.0.1:39081/_health",
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: "npm run start:e2e-client",
          url: baseURL,
          reuseExistingServer: false,
          // Competing Studio sessions can put substantial pressure on Windows
          // process startup. Keep the product assertions strict while giving
          // the heavyweight Vite game bundle a bounded readiness window.
          timeout: 180_000,
        },
      ],
});
