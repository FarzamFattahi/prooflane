// Recreate the README image against a running local app.
// Run: node docs/capture-workspace.mjs [app URL]
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch(
  process.platform === "win32" ? { channel: "msedge" } : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto(process.argv[2] ?? "http://127.0.0.1:5186");
  await page.getByTestId("region-card").first().waitFor();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await page
    .getByTestId("region-card")
    .first()
    .getByRole("button", { name: "Needs fix", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Review note", exact: true })
    .fill("Confirm checkout button styling before release.");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("heading", { level: 1 }).click();
  await mkdir(new URL("./assets/", import.meta.url), { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL("./assets/workspace.png", import.meta.url)),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL("./assets/mobile.png", import.meta.url)),
    animations: "disabled",
    fullPage: true,
  });
} finally {
  await browser.close();
}
