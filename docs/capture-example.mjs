// Capture real evidence from Prooflane. Optionally supply the user's image pair:
// node docs/capture-example.mjs [app URL] [baseline path] [candidate path]
// Images published by this script include the originals; use approved public examples.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appUrl = process.argv[2] ?? "http://127.0.0.1:5186";
const baselinePath = process.argv[3];
const candidatePath = process.argv[4];
if (Boolean(baselinePath) !== Boolean(candidatePath))
  throw new Error(
    "Supply both image paths, or neither for the built-in example.",
  );
const destination = new URL(
  baselinePath ? "./examples/supplied-pair/" : "./examples/checkout/",
  import.meta.url,
);
await mkdir(destination, { recursive: true });
const pathFor = (name) => fileURLToPath(new URL(name, destination));
const browser = await chromium.launch(
  process.platform === "win32" ? { channel: "msedge" } : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 1,
  });
  await page.goto(appUrl);
  await expect(page.getByTestId("region-card").first()).toBeVisible();
  if (baselinePath) {
    await page.getByTestId("baseline-input").setInputFiles(baselinePath);
    await page.getByTestId("candidate-input").setInputFiles(candidatePath);
    await expect(page.getByTestId("export-report")).toBeEnabled();
  }
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  for (const [label, filename] of [
    ["Baseline screenshot", "baseline.png"],
    ["Candidate screenshot", "candidate.png"],
  ]) {
    const src = await page
      .getByRole("img", { name: label, exact: true })
      .getAttribute("src");
    if (!src?.startsWith("data:image/png;base64,"))
      throw new Error("Expected a local PNG input.");
    await writeFile(
      pathFor(filename),
      Buffer.from(src.split(",")[1], "base64"),
    );
  }
  await page.getByRole("button", { name: "Difference", exact: true }).click();
  await page.getByTestId("export-report").click();
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download JSON/ }).click();
  const report = JSON.parse(
    await readFile(await (await reportDownload).path(), "utf8"),
  );
  await writeFile(
    pathFor("comparison.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const diffDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download difference PNG/ }).click();
  await (await diffDownload).saveAs(pathFor("difference.png"));
  await page.keyboard.press("Escape");
  const dismissNotice = page.getByRole("button", {
    name: "Dismiss notification",
    exact: true,
  });
  if (await dismissNotice.isVisible()) await dismissNotice.click();
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".comparison-panel").screenshot({
    path: pathFor("workspace-difference.png"),
    animations: "disabled",
  });
  const region = report.regions[0];
  if (region) {
    const [before, after] = await page
      .locator(".region-crops img")
      .evaluateAll((images) =>
        images.map((image) => image.getAttribute("src")),
      );
    for (const [src, filename] of [
      [before, "detail-before.png"],
      [after, "detail-after.png"],
    ]) {
      if (!src?.startsWith("data:image/png;base64,"))
        throw new Error("Expected a local region crop.");
      await writeFile(
        pathFor(filename),
        Buffer.from(src.split(",")[1], "base64"),
      );
    }
  }
  console.log(
    JSON.stringify({
      destination: fileURLToPath(destination),
      example: baselinePath ? "supplied pair" : "built-in checkout",
      summary: report.summary,
      regions: report.regions,
    }),
  );
} finally {
  await browser.close();
}
