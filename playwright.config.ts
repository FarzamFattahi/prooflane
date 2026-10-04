import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);
const production = ci || Boolean(process.env.E2E_PREVIEW);
const port = production ? 4186 : 5186;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 2,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}${production ? "/prooflane/" : "/"}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.platform === "win32" && !ci ? { channel: "msedge" } : {}),
  },
  webServer: {
    command: production ? "npm run preview" : "npm run dev",
    url: `http://127.0.0.1:${port}${production ? "/prooflane/" : "/"}`,
    reuseExistingServer: !ci,
    timeout: 30_000,
  },
});
