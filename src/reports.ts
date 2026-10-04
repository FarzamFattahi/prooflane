import type { Comparison, CompareOptions, LoadedImage, Review } from "./types";
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function buildReport(
  baseline: LoadedImage,
  candidate: LoadedImage,
  result: Comparison,
  options: CompareOptions,
  reviews: Record<string, Review>,
) {
  const digest = async (image: LoadedImage) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          image.data.slice().buffer as ArrayBuffer,
        ),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const [beforeHash, afterHash] = await Promise.all([
    digest(baseline),
    digest(candidate),
  ]);
  return {
    schemaVersion: 1,
    engine: "prooflane-rgb-v1",
    createdAt: new Date().toISOString(),
    baseline: {
      name: baseline.name,
      width: baseline.width,
      height: baseline.height,
      rgbaSha256: beforeHash,
    },
    candidate: {
      name: candidate.name,
      width: candidate.width,
      height: candidate.height,
      rgbaSha256: afterHash,
    },
    options,
    summary: {
      width: result.width,
      height: result.height,
      changedPixels: result.changedPixels,
      comparedPixels: result.comparedPixels,
      ignoredPixels: result.ignoredPixels,
      changedPercent: result.changedPercent,
      omittedRegions: result.omittedRegions,
      omittedPixels: result.omittedPixels,
    },
    regions: result.regions.map((region) => ({
      ...region,
      ...(reviews[region.id] ?? { decision: "unreviewed", note: "" }),
    })),
    methodology:
      "RGBA composited on white; weighted RGB RMS distance; no resizing. 16px tiles, 8-neighbor region grouping. Pixels outside either image count as changed. Filtered regions remain in changed-pixel totals. Visual difference is not a judgment of correctness.",
  };
}
export function reportHtml(
  report: Awaited<ReturnType<typeof buildReport>>,
  beforeUrl: string,
  afterUrl: string,
  diffUrl: string,
): string {
  const e = escapeHtml,
    s = report.summary;
  const safeImage = (url: string) => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url))
      throw new Error("Reports only embed local PNG images.");
    return url;
  };
  const reviewed = report.regions.filter(
    (r) => r.decision !== "unreviewed",
  ).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Prooflane review — ${e(report.candidate.name)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#172339;font:16px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:48px 24px}header{border-bottom:2px solid #172339;padding-bottom:24px}h1{font-size:40px;letter-spacing:-1.5px;margin:12px 0}h2{font-size:23px;margin:32px 0 12px}.brand{font-weight:750;font-size:21px}.muted{color:#536174}.stats{display:flex;flex-wrap:wrap;gap:32px;padding:24px 0}.stats strong{font-size:30px;display:block}.images{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}img{width:100%;height:auto;border:1px solid #ced6df;background:white}figcaption{font-weight:600;padding:8px 0;overflow-wrap:anywhere}article{background:white;border:1px solid #ced6df;border-radius:10px;padding:20px;margin:12px 0;break-inside:avoid}article h3{margin:0 0 6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace}.note{white-space:pre-wrap;overflow-wrap:anywhere}.tag{font-size:14px;font-weight:650;text-transform:uppercase}.fix{color:#a93220}.expected{color:#245d39}.unreviewed{color:#536174}details{margin:24px 0}summary{cursor:pointer;font-weight:600}footer{margin-top:40px;border-top:1px solid #ced6df;padding-top:18px}.warning{background:#fff0db;padding:12px 16px;border-radius:8px}@media(max-width:700px){.images{grid-template-columns:1fr}h1{font-size:30px}}@media print{body{background:white}main{padding:0}.images{grid-template-columns:1fr 1fr}details>*{display:block}}
  </style></head><body><main><header><div class="brand">prooflane / visual review</div><h1>${s.changedPercent.toFixed(2)}% of compared pixels changed</h1><p class="muted">${e(report.baseline.name)} compared with ${e(report.candidate.name)}<br>Generated ${e(report.createdAt)} · Engine ${report.engine}</p></header>
  <div class="stats"><div><strong>${report.regions.length}</strong>visible regions</div><div><strong>${reviewed} / ${report.regions.length}</strong>regions reviewed</div><div><strong>${s.changedPixels.toLocaleString()}</strong>changed pixels</div><div><strong>${s.ignoredPixels.toLocaleString()}</strong>excluded pixels</div></div>
  <p class="warning">This report contains the original screenshots and review notes. Share only with people who should see them. Review decisions reflect the author’s assessment; this report does not certify correctness.</p>
  <h2>Before &amp; after</h2><div class="images"><figure><img alt="Baseline screenshot" src="${safeImage(beforeUrl)}"><figcaption>Baseline · ${e(report.baseline.name)} · ${report.baseline.width} × ${report.baseline.height}</figcaption></figure><figure><img alt="Candidate screenshot" src="${safeImage(afterUrl)}"><figcaption>Candidate · ${e(report.candidate.name)} · ${report.candidate.width} × ${report.candidate.height}</figcaption></figure></div>
  <h2>Difference map</h2><p class="muted">Orange pixels exceed the configured color threshold. Exclusions and unchanged pixels are shown in grayscale.</p><img alt="Difference map: orange indicates changed pixels" src="${safeImage(diffUrl)}">
  <h2>Review decisions</h2>${report.regions.length === 0 ? "<p>No regions at the configured minimum size.</p>" : ""}${report.regions.map((r, i) => `<article><h3>Region ${String(i + 1).padStart(2, "0")} <span class="tag ${r.decision}">${r.decision === "fix" ? "Needs fix" : r.decision}</span></h3><div class="muted">${r.pixels.toLocaleString()} changed pixels · x ${r.x}, y ${r.y} · ${r.width} × ${r.height} px</div>${r.note ? `<p class="note">${e(r.note)}</p>` : ""}</article>`).join("")}
  <p class="muted">${s.omittedRegions} regions (${s.omittedPixels.toLocaleString()} changed pixels) omitted by the region-size filter or 1,000-region display limit. These pixels remain in the totals.</p>
  <details><summary>Method, settings &amp; provenance</summary><p>${e(report.methodology)}</p><p>Threshold ${report.options.threshold}; minimum region ${report.options.minRegionPixels} pixels. Comparison canvas ${s.width} × ${s.height}; ${s.comparedPixels.toLocaleString()} non-excluded pixels.</p><pre>${e(JSON.stringify({ exclusions: report.options.ignores, baseline: report.baseline, candidate: report.candidate }, null, 2))}</pre><p class="muted">SHA-256 identifies decoded RGBA pixels, before white compositing. It does not identify original file bytes.</p></details><footer>Made with Prooflane. All comparison and report generation happens on the author’s device.</footer></main></body></html>`;
}
export function download(
  content: Blob | string,
  name: string,
  mime = "application/json",
) {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
