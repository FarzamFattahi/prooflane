import { describe, it, expect } from "vitest";
import { escapeHtml, reportHtml } from "./reports";
describe("portable report boundaries", () => {
  it("escapes HTML and both quote styles", () =>
    expect(escapeHtml(`<img onerror="alert('x')"> &`)).toBe(
      "&lt;img onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;",
    ));
  it("rejects remote image sources", () => {
    const report = {
      createdAt: "2026-10-04T00:00:00.000Z",
      methodology: "Test",
      candidate: { name: "x" },
      baseline: { name: "y" },
      regions: [],
      summary: {
        changedPercent: 0,
        changedPixels: 0,
        ignoredPixels: 0,
        omittedRegions: 0,
        omittedPixels: 0,
      },
      options: { ignores: [] },
    } as unknown as Parameters<typeof reportHtml>[0];
    expect(() =>
      reportHtml(
        report,
        "https://remote.example/a.png",
        "data:image/png;base64,AA==",
        "data:image/png;base64,AA==",
      ),
    ).toThrow("local PNG");
  });
});
