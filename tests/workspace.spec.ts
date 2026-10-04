import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { copyFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

async function png(
  page: Page,
  name: string,
  width = 64,
  height = 64,
  changed = false,
  color = "#000000",
) {
  const data = await page.evaluate(
    ({ width, height, changed, color }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      if (changed) {
        context.fillStyle = color;
        context.fillRect(16, 16, 8, 8);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height, changed, color },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

async function uploadPair(page: Page, changed = true, candidateWidth = 64) {
  await page
    .getByTestId("baseline-input")
    .setInputFiles(await png(page, "before.png"));
  await page
    .getByTestId("candidate-input")
    .setInputFiles(await png(page, "after.png", candidateWidth, 64, changed));
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    `${candidateWidth === 64 ? (changed ? "64" : "0") : "1,024"} changed pixels`,
  );
}

async function loadWorkspace(page: Page) {
  await page.goto("");
  await expect(page.getByTestId("region-card").first()).toBeVisible();
}

test("example is a real comparison with reviewable changes and all visual modes", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  const uncaughtErrors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      url.hostname !== "127.0.0.1"
    )
      externalRequests.push(request.url());
  });
  page.on("pageerror", (error) => uncaughtErrors.push(error.message));
  await loadWorkspace(page);
  await expect(page.getByText("Example review", { exact: true })).toBeVisible();
  const pixels = Number(
    (await page.getByTestId("changed-pixels").innerText())
      .replaceAll(",", "")
      .split(" ")[0],
  );
  expect(pixels).toBeGreaterThan(0);
  for (const mode of ["Overlay", "Split", "Side by side", "Difference"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(
      page.getByRole("button", { name: mode, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await uploadPair(page);
  expect(externalRequests).toEqual([]);
  expect(uncaughtErrors).toEqual([]);
});

test("uploaded identical images have zero changes; dimension differences stay meaningful", async ({
  page,
}) => {
  await loadWorkspace(page);
  await uploadPair(page, false);
  await expect(page.getByTestId("region-card")).toHaveCount(0);
  await expect(page.getByTestId("changed-percent")).toContainText("0");
  await page
    .getByTestId("candidate-input")
    .setInputFiles(await png(page, "wider.png", 80, 64));
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "1,024 changed pixels",
  );
  await expect(page.getByTestId("changed-percent")).toContainText("20");
  await expect(page.getByTestId("region-card")).toHaveCount(1);
});

test("unsupported and undecodable image files display actionable errors", async ({
  page,
}) => {
  await loadWorkspace(page);
  await page.getByTestId("baseline-input").setInputFiles({
    name: "readme.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("PNG, JPEG, or WebP");
  await page.getByTestId("baseline-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid PNG bytes"),
  });
  await expect(page.getByRole("alert")).toContainText("could not be decoded");
});

test("review decisions and notes export as safe portable evidence", async ({
  page,
}, testInfo) => {
  await loadWorkspace(page);
  await uploadPair(page);
  const region = page.getByTestId("region-card").first();
  await region.getByRole("button", { name: "Expected", exact: true }).click();
  await expect(
    region.getByRole("button", { name: "Expected", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await region.getByRole("button", { name: "Needs fix", exact: true }).click();
  const note = 'Check contrast <script>alert("x")</script> & keep this note';
  await page
    .getByRole("textbox", { name: "Review note", exact: true })
    .fill(note);
  await page.getByTestId("export-report").click();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download JSON/ }).click();
  const report = JSON.parse(
    await readFile((await (await jsonDownload).path())!, "utf8"),
  );
  expect(report.schemaVersion).toBe(1);
  expect(report.engine).toBe("prooflane-rgb-v1");
  expect(report.baseline).toMatchObject({
    name: "before.png",
    width: 64,
    height: 64,
  });
  expect(report.baseline.rgbaSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.summary).toMatchObject({
    changedPixels: 64,
    comparedPixels: 4096,
    ignoredPixels: 0,
  });
  expect(report.regions).toHaveLength(1);
  expect(report.regions[0]).toMatchObject({
    decision: "fix",
    note,
    pixels: 64,
  });
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download HTML report/ }).click();
  const htmlPath = (await (await htmlDownload).path())!;
  const html = await readFile(htmlPath, "utf8");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  const parsed = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return {
      images: [...doc.images].map((img) => img.getAttribute("src")),
      note: doc.querySelector(".note")?.textContent,
      csp: doc
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
    };
  }, html);
  expect(parsed.images).toHaveLength(3);
  expect(
    parsed.images.every((url) => url?.startsWith("data:image/png;base64,")),
  ).toBe(true);
  expect(parsed.note).toBe(note);
  expect(parsed.csp).toContain("default-src 'none'");
  const portablePath = testInfo.outputPath("portable-review.html");
  await copyFile(htmlPath, portablePath);
  const offlineContext = await page
    .context()
    .browser()!
    .newContext({ offline: true });
  try {
    const offlinePage = await offlineContext.newPage();
    const dialogs: string[] = [];
    offlinePage.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await offlinePage.goto(pathToFileURL(portablePath).href);
    await expect(offlinePage.locator("img")).toHaveCount(3);
    await expect
      .poll(() =>
        offlinePage
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth === 64,
            ),
          ),
      )
      .toBe(true);
    await expect(offlinePage.getByText(note, { exact: true })).toBeVisible();
    await expect(offlinePage.locator("script")).toHaveCount(0);
    expect(dialogs).toEqual([]);
  } finally {
    await offlineContext.close();
  }
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download difference PNG/ }).click();
  const diff = await readFile((await (await pngDownload).path())!);
  expect([...diff.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test("exclusion rectangles update totals and invalidate prior reviews", async ({
  page,
}) => {
  await loadWorkspace(page);
  await uploadPair(page);
  await page
    .getByTestId("region-card")
    .getByRole("button", { name: "Expected", exact: true })
    .click();
  await page.getByText("Or enter coordinates", { exact: true }).click();
  for (const [field, value] of [
    ["x", "16"],
    ["y", "16"],
    ["width", "4"],
    ["height", "8"],
  ]) {
    await page.getByTestId(`ignore-${field}`).fill(value);
  }
  await page.getByTestId("add-ignore").click();
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "32 changed pixels",
  );
  await expect(
    page
      .getByTestId("region-card")
      .getByRole("button", { name: "Expected", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page
      .getByTestId("region-card")
      .getByRole("button", { name: "Needs fix", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("clear-ignores").click();
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "64 changed pixels",
  );
});

test("threshold, region filtering, swap, and clear have consistent state", async ({
  page,
}) => {
  await loadWorkspace(page);
  await uploadPair(page);
  await page
    .getByTestId("region-card")
    .getByRole("button", { name: "Expected", exact: true })
    .click();
  await page.getByTestId("min-region-input").selectOption("256");
  await expect(page.getByTestId("region-card")).toHaveCount(0);
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "64 changed pixels",
  );
  await page.getByTestId("min-region-input").selectOption("8");
  await expect(
    page
      .getByTestId("region-card")
      .getByRole("button", { name: "Expected", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page
    .getByTestId("candidate-input")
    .setInputFiles(await png(page, "after.png", 64, 64, true, "#cccccc"));
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "64 changed pixels",
  );
  await page.getByTestId("threshold-input").press("End");
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "0 changed pixels",
  );
  await page.getByTestId("threshold-input").press("Home");
  for (let i = 0; i < 8; i++)
    await page.getByTestId("threshold-input").press("ArrowRight");
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "64 changed pixels",
  );
  await page.getByTestId("swap-images").click();
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "64 changed pixels",
  );
  await page.getByTestId("export-report").click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download JSON/ }).click();
  const report = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  expect(report.baseline.name).toBe("after.png");
  expect(report.candidate.name).toBe("before.png");
  await page.keyboard.press("Escape");
  await page.getByTestId("reset-workspace").click();
  await expect(page.getByTestId("region-card")).toHaveCount(0);
  await expect(page.getByTestId("export-report")).toBeDisabled();
  await page.getByTestId("sample-button").click();
  await expect(page.getByTestId("region-card").first()).toBeVisible();
});

test("coordinate exclusions reject invalid bounds and safely handle a fully excluded canvas", async ({
  page,
}) => {
  await loadWorkspace(page);
  await uploadPair(page);
  await page.getByText("Or enter coordinates", { exact: true }).click();
  await page.getByTestId("ignore-x").fill("64");
  await page.getByTestId("add-ignore").click();
  await expect(page.getByRole("alert")).toContainText("start inside");
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "64 changed pixels",
  );
  await page.getByTestId("ignore-x").fill("0");
  await page.getByTestId("ignore-width").fill("0");
  await page.getByTestId("add-ignore").click();
  await expect(page.getByRole("alert")).toContainText("whole pixels");
  await page.getByTestId("ignore-width").fill("64");
  await page.getByTestId("ignore-height").fill("64");
  await page.getByTestId("add-ignore").click();
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "0 changed pixels",
  );
  await expect(page.getByTestId("changed-percent")).toHaveText("0.00%");
  await page.getByTestId("export-report").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download JSON/ }).click();
  const report = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(report.options.ignores).toEqual([
    { x: 0, y: 0, width: 64, height: 64 },
  ]);
  expect(report.summary).toMatchObject({
    changedPixels: 0,
    comparedPixels: 0,
    ignoredPixels: 4096,
    changedPercent: 0,
  });
  expect(report.regions).toEqual([]);
});

test("drawing an exclusion transforms screen coordinates into exact image pixels", async ({
  page,
}) => {
  await loadWorkspace(page);
  await uploadPair(page);
  await page
    .getByTestId("region-card")
    .getByRole("button", { name: "Expected", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw an exclusion", exact: true })
    .click();
  const image = page.locator(".image-stack");
  await image.scrollIntoViewIfNeeded();
  const bounds = (await image.boundingBox())!;
  const point = (pixel: number) => ({
    x: bounds.x + ((pixel + 0.5) * bounds.width) / 64,
    y: bounds.y + ((pixel + 0.5) * bounds.height) / 64,
  });
  const start = point(16),
    end = point(23);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("changed-pixels")).toHaveText(
    "0 changed pixels",
  );
  await expect(page.getByTestId("region-card")).toHaveCount(0);
  await page.getByTestId("export-report").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download JSON/ }).click();
  const report = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(report.options.ignores).toEqual([
    { x: 16, y: 16, width: 8, height: 8 },
  ]);
  expect(report.summary).toMatchObject({
    changedPixels: 0,
    comparedPixels: 4032,
    ignoredPixels: 64,
  });
});

test("workspace and native dialog pass automated accessibility and keyboard checks", async ({
  page,
}) => {
  await loadWorkspace(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  const help = page.getByRole("button", { name: "How it works", exact: true });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialogResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(dialogResults.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(help).toBeFocused();
});

test("mobile comparison and dialog fit the viewport without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWorkspace(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const workspaceResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(workspaceResults.violations).toEqual([]);
  await page.getByTestId("export-report").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const mobileResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(mobileResults.violations).toEqual([]);
});
