import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeRegion,
  Comparison,
  CompareOptions,
  LoadedImage,
  Rect,
  Review,
  WorkerResponse,
} from "./types";
import { diffImage, exampleImages, loadImage } from "./images";
import { buildReport, download, reportHtml } from "./reports";
import {
  ArrowLeftRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Download,
  Expand,
  Github,
  ImagePlus,
  Layers2,
  LockKeyhole,
  Maximize2,
  MousePointer2,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  SquareDashed,
  X,
} from "lucide-react";

type Mode = "Difference" | "Overlay" | "Split" | "Side by side";
const initialOptions: CompareOptions = {
  threshold: 0.08,
  minRegionPixels: 8,
  ignores: [],
};
const number = (n: number) => n.toLocaleString();
const defaultReview: Review = { decision: "unreviewed", note: "" };

function UploadSlot({
  title,
  image,
  loading,
  testId,
  onUpload,
}: {
  title: string;
  image: LoadedImage | null;
  loading: boolean;
  testId: string;
  onUpload: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      className={`upload-slot ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
      }}
    >
      <span className="slot-label">
        {title}
        <span>{image ? "Replace" : "Add image"}</span>
      </span>
      <div className="slot-content">
        {image ? (
          <img src={image.url} alt="" />
        ) : (
          <span className="upload-icon">
            <ImagePlus size={20} />
          </span>
        )}
        <div>
          <strong>
            {loading ? "Opening image…" : (image?.name ?? "Drop a screenshot")}
          </strong>
          <span>
            {image
              ? `${number(image.width)} × ${number(image.height)} px`
              : "or click to browse"}
          </span>
        </div>
        <Plus className="slot-plus" size={16} />
      </div>
      <input
        data-testid={testId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={`${title} image`}
        disabled={loading}
        onChange={(e) => {
          if (e.target.files?.[0]) onUpload(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function crop(image: LoadedImage, region: Rect): string {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 320 / region.width, 160 / region.height);
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  source
    .getContext("2d")!
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height,
      ),
      0,
      0,
    );
  context.drawImage(
    source,
    -region.x * scale,
    -region.y * scale,
    image.width * scale,
    image.height * scale,
  );
  return canvas.toDataURL("image/png");
}

export default function App() {
  const [images, setImages] = useState<{
    baseline: LoadedImage | null;
    candidate: LoadedImage | null;
  }>(() => {
    const [baseline, candidate] = exampleImages();
    return { baseline, candidate };
  });
  const { baseline, candidate } = images;
  const [isExample, setIsExample] = useState(true);
  const [options, setOptions] = useState<CompareOptions>(initialOptions);
  const [result, setResult] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState({ baseline: false, candidate: false });
  const uploads = useRef({ baseline: 0, candidate: 0 });
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<Mode>("Difference");
  const [split, setSplit] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const [zoom, setZoom] = useState(100);
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const [maskForm, setMaskForm] = useState({
    x: "0",
    y: "0",
    width: "100",
    height: "100",
  });
  const [maskError, setMaskError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const guide = useRef<HTMLDialogElement>(null),
    exports = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setResult(null);
    setReviews({});
    setSelected("");
    if (!baseline || !candidate) {
      setBusy(false);
      return;
    }
    setBusy(true);
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL("./compare.worker.ts", import.meta.url), {
          type: "module",
        });
        worker.onmessage = ({ data }: { data: WorkerResponse }) => {
          setBusy(false);
          if (data.error) {
            setError(data.error);
            return;
          }
          if (data.result) {
            setResult(data.result);
            setSelected(data.result.regions[0]?.id ?? "");
          }
        };
        worker.onerror = () => {
          setBusy(false);
          setError(
            "The comparison could not finish. Try smaller images or reload the page.",
          );
        };
        const beforeData = baseline.data.slice(),
          afterData = candidate.data.slice();
        worker.postMessage(
          {
            id: 1,
            baseline: {
              width: baseline.width,
              height: baseline.height,
              data: beforeData,
            },
            candidate: {
              width: candidate.width,
              height: candidate.height,
              data: afterData,
            },
            options,
          },
          [beforeData.buffer, afterData.buffer],
        );
      } catch {
        setBusy(false);
        setError(
          "This browser could not start image comparison. Try a current Chrome, Edge, Firefox, or Safari.",
        );
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [baseline, candidate, options]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const diff = useMemo(
    () =>
      result && baseline && candidate
        ? diffImage(baseline, candidate, result)
        : "",
    [result, baseline, candidate],
  );
  const activeRegion = result?.regions.find((r) => r.id === selected);
  const crops = useMemo(
    () =>
      activeRegion && baseline && candidate
        ? [crop(baseline, activeRegion), crop(candidate, activeRegion)]
        : null,
    [activeRegion, baseline, candidate],
  );
  const reviewed =
    result?.regions.filter(
      (r) => reviews[r.id]?.decision && reviews[r.id].decision !== "unreviewed",
    ).length ?? 0;
  const needsFix =
    result?.regions.filter((r) => reviews[r.id]?.decision === "fix").length ??
    0;
  const totalRegions = result?.regions.length ?? 0;

  function invalidate() {
    setResult(null);
    setBusy(Boolean(baseline && candidate));
    setReviews({});
    setSelected("");
  }
  function changeOptions(next: CompareOptions) {
    invalidate();
    setError("");
    setOptions(next);
  }
  async function upload(slot: "baseline" | "candidate", file: File) {
    const token = ++uploads.current[slot];
    invalidate();
    setIsExample(false);
    setError("");
    setImages((previous) => ({ ...previous, [slot]: null }));
    setLoading((previous) => ({ ...previous, [slot]: true }));
    try {
      const image = await loadImage(file);
      if (uploads.current[slot] !== token) return;
      setImages((previous) => ({ ...previous, [slot]: image }));
      setOptions((previous) => ({ ...previous, ignores: [] }));
      setNotice(
        `${slot === "baseline" ? "Baseline" : "Candidate"} opened. Previous reviews and exclusions cleared.`,
      );
    } catch (reason) {
      if (uploads.current[slot] === token)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not open this image.",
        );
    } finally {
      if (uploads.current[slot] === token)
        setLoading((previous) => ({ ...previous, [slot]: false }));
    }
  }
  function reset(example = false) {
    uploads.current.baseline++;
    uploads.current.candidate++;
    invalidate();
    setOptions(initialOptions);
    setIsExample(example);
    setLoading({ baseline: false, candidate: false });
    setError("");
    setMaskError("");
    setDrawMode(false);
    setDraft(null);
    setMode("Difference");
    setZoom(100);
    setNotice("");
    if (example) {
      const [a, b] = exampleImages();
      setImages({ baseline: a, candidate: b });
    } else {
      setImages({ baseline: null, candidate: null });
      setBusy(false);
    }
  }
  function addMask(rect: Rect) {
    setMaskError("");
    if (options.ignores.length >= 50) {
      setMaskError(
        "You can add up to 50 exclusion areas. Remove one to add another.",
      );
      return;
    }
    changeOptions({ ...options, ignores: [...options.ignores, rect] });
    setDraft(null);
    setDrawMode(false);
    setNotice(
      "Exclusion added. The comparison and review decisions have been refreshed.",
    );
  }
  function submitMask() {
    const rect = {
      x: Number(maskForm.x),
      y: Number(maskForm.y),
      width: Number(maskForm.width),
      height: Number(maskForm.height),
    };
    if (
      Object.values(maskForm).some((v) => v.trim() === "") ||
      !Object.values(rect).every(Number.isSafeInteger) ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.width < 1 ||
      rect.height < 1
    ) {
      setMaskError("Use whole pixels: x and y ≥ 0; width and height ≥ 1.");
      return;
    }
    if (!result || rect.x >= result.width || rect.y >= result.height) {
      setMaskError("The exclusion must start inside the comparison image.");
      return;
    }
    addMask({
      ...rect,
      width: Math.min(rect.width, result.width - rect.x),
      height: Math.min(rect.height, result.height - rect.y),
    });
  }
  function pointerPosition(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          (result?.width ?? 1) - 1,
          Math.floor(
            ((event.clientX - bounds.left) / bounds.width) *
              (result?.width ?? 1),
          ),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          (result?.height ?? 1) - 1,
          Math.floor(
            ((event.clientY - bounds.top) / bounds.height) *
              (result?.height ?? 1),
          ),
        ),
      ),
    };
  }
  function updateReview(id: string, update: Partial<Review>) {
    setReviews((previous) => ({
      ...previous,
      [id]: { ...(previous[id] ?? defaultReview), ...update },
    }));
  }
  async function exportFile(kind: "html" | "json" | "png") {
    if (!baseline || !candidate || !result || exporting) return;
    setExporting(true);
    try {
      if (kind === "png") {
        const response = await fetch(diff);
        download(await response.blob(), "prooflane-difference.png");
      } else {
        const report = await buildReport(
          baseline,
          candidate,
          result,
          options,
          reviews,
        );
        if (kind === "html")
          download(
            reportHtml(report, baseline.url, candidate.url, diff),
            "prooflane-review.html",
            "text/html",
          );
        else download(JSON.stringify(report, null, 2), "prooflane-review.json");
      }
      setNotice("Export downloaded.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? `Export failed: ${reason.message}`
          : "Export failed. Try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  function regionOverlay(regions: ChangeRegion[]) {
    return (
      <svg
        className={`region-overlay ${drawMode ? "drawing" : ""}`}
        viewBox={`0 0 ${result!.width} ${result!.height}`}
        role="img"
        aria-label={
          drawMode
            ? "Draw an exclusion rectangle; coordinate fields are available in the sidebar"
            : "Changed regions and exclusion areas"
        }
        onPointerDown={(e) => {
          if (!drawMode || !e.isPrimary) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragStart.current = { ...pointerPosition(e), id: e.pointerId };
          setDraft({ ...pointerPosition(e), width: 1, height: 1 });
        }}
        onPointerMove={(e) => {
          const start = dragStart.current;
          if (!start || start.id !== e.pointerId) return;
          const p = pointerPosition(e);
          setDraft({
            x: Math.min(start.x, p.x),
            y: Math.min(start.y, p.y),
            width: Math.abs(p.x - start.x) + 1,
            height: Math.abs(p.y - start.y) + 1,
          });
        }}
        onPointerUp={(e) => {
          if (!dragStart.current || dragStart.current.id !== e.pointerId)
            return;
          dragStart.current = null;
          if (draft && draft.width > 2 && draft.height > 2) addMask(draft);
          else setDraft(null);
        }}
        onPointerCancel={() => {
          dragStart.current = null;
          setDraft(null);
        }}
      >
        {regions.map((r, i) => (
          <g
            key={r.id}
            className={`region-box ${selected === r.id ? "selected" : ""}`}
            onClick={() => {
              if (!drawMode) setSelected(r.id);
            }}
          >
            <rect x={r.x} y={r.y} width={r.width} height={r.height} />
            <rect
              className="region-tag"
              x={r.x}
              y={Math.max(0, r.y - 22)}
              width={28}
              height={22}
            />
            <text
              x={r.x + 14}
              y={Math.max(0, r.y - 22) + 15}
              textAnchor="middle"
            >
              {i + 1}
            </text>
          </g>
        ))}
        {options.ignores.map((r, i) => (
          <g className="mask-box" key={i}>
            <rect {...r} />
            <text x={r.x + 5} y={r.y + 18}>
              Excluded {i + 1}
            </text>
          </g>
        ))}
        {draft && <rect className="draft-mask" {...draft} />}
      </svg>
    );
  }

  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to comparison
      </a>
      <header className="app-header">
        <a className="brand" href="./" aria-label="Prooflane home">
          <span className="brand-mark">
            <ScanLine size={23} />
          </span>
          prooflane<span className="version">v1.0</span>
        </a>
        <nav aria-label="Main navigation">
          <span className="nav-current">Workspace</span>
          <button
            className="text-button"
            onClick={() => guide.current?.showModal()}
          >
            <CircleHelp size={16} />
            How it works
          </button>
          <a
            className="github-link"
            href="https://github.com/FarzamFattahi/prooflane"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} />
            <span>GitHub</span>
          </a>
        </nav>
        <span className="private-badge">
          <LockKeyhole size={14} />
          Local & private
        </span>
      </header>
      <div className="app-layout">
        <aside className="sidebar" aria-label="Comparison setup">
          <div className="sidebar-title">
            <span className="eyebrow">YOUR COMPARISON</span>
            <button
              className="icon-button"
              aria-label="Clear workspace"
              data-testid="reset-workspace"
              title="Clear workspace"
              onClick={() => reset()}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <UploadSlot
            title="Baseline"
            image={baseline}
            loading={loading.baseline}
            testId="baseline-input"
            onUpload={(f) => void upload("baseline", f)}
          />
          <button
            className="swap-button"
            data-testid="swap-images"
            disabled={
              !baseline || !candidate || loading.baseline || loading.candidate
            }
            onClick={() => {
              invalidate();
              setImages({ baseline: candidate, candidate: baseline });
              setOptions({ ...options, ignores: [] });
              setNotice("Images swapped. Reviews and exclusions cleared.");
            }}
          >
            <ArrowLeftRight size={14} />
            Swap images
          </button>
          <UploadSlot
            title="Candidate"
            image={candidate}
            loading={loading.candidate}
            testId="candidate-input"
            onUpload={(f) => void upload("candidate", f)}
          />
          <p className="input-hint">
            PNG, JPEG, WebP · 25 MB per image
            <br /> Up to 12 MP · no image uploads
          </p>
          <div className="sidebar-section">
            <h2>
              <SlidersHorizontal size={16} />
              Comparison settings
            </h2>
            <label className="range-label" htmlFor="threshold">
              Color tolerance<span>{Math.round(options.threshold * 100)}%</span>
            </label>
            <input
              id="threshold"
              data-testid="threshold-input"
              type="range"
              min="0"
              max="30"
              step="1"
              value={Math.round(options.threshold * 100)}
              onChange={(e) =>
                changeOptions({
                  ...options,
                  threshold: Number(e.target.value) / 100,
                })
              }
            />
            <p className="field-hint">
              Higher values ignore subtler color differences.
            </p>
            <label className="select-label" htmlFor="min-region">
              Minimum region size
            </label>
            <div className="select-wrap">
              <select
                id="min-region"
                data-testid="min-region-input"
                value={options.minRegionPixels}
                onChange={(e) =>
                  changeOptions({
                    ...options,
                    minRegionPixels: Number(e.target.value),
                  })
                }
              >
                <option value={1}>1 pixel · show every region</option>
                <option value={8}>8 pixels · balanced</option>
                <option value={64}>64 pixels · less noise</option>
                <option value={256}>256 pixels · large changes</option>
              </select>
              <ChevronDown size={14} />
            </div>
            <p className="field-hint">
              Filters the list. All changes stay in pixel totals.
            </p>
          </div>
          <div className="sidebar-section exclusions">
            <div className="section-heading">
              <h2>
                <SquareDashed size={16} />
                Exclusion areas
              </h2>
              <span className="count-badge">{options.ignores.length}</span>
            </div>
            <p className="field-hint">
              Ignore clocks, ads, or other dynamic content.
            </p>
            <button
              className={`outline-button draw-button ${drawMode ? "active" : ""}`}
              disabled={!result || mode === "Side by side"}
              onClick={() => {
                setDrawMode(!drawMode);
                setDraft(null);
                dragStart.current = null;
              }}
            >
              <SquareDashed size={15} />
              {drawMode ? "Cancel drawing" : "Draw an exclusion"}
            </button>
            {drawMode && (
              <p className="draw-hint" role="status">
                Drag over the image to exclude an area.
              </p>
            )}
            <details className="coordinates">
              <summary>Or enter coordinates</summary>
              <div className="coordinate-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key} htmlFor={`ignore-${key}`}>
                    {key === "x"
                      ? "X"
                      : key === "y"
                        ? "Y"
                        : key === "width"
                          ? "Width"
                          : "Height"}
                    <input
                      id={`ignore-${key}`}
                      data-testid={`ignore-${key}`}
                      type="number"
                      min={key === "x" || key === "y" ? 0 : 1}
                      step="1"
                      value={maskForm[key]}
                      onChange={(e) =>
                        setMaskForm({ ...maskForm, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                className="outline-button"
                data-testid="add-ignore"
                disabled={!result}
                onClick={submitMask}
              >
                <Plus size={14} />
                Add exclusion
              </button>
            </details>
            {maskError && (
              <p className="form-error" role="alert">
                {maskError}
              </p>
            )}
            {options.ignores.map((r, i) => (
              <div className="mask-item" key={i}>
                <span>
                  Area {i + 1}
                  <small>
                    {r.x}, {r.y} · {r.width} × {r.height}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`Remove exclusion ${i + 1}`}
                  onClick={() =>
                    changeOptions({
                      ...options,
                      ignores: options.ignores.filter(
                        (_, index) => index !== i,
                      ),
                    })
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            {options.ignores.length > 0 && (
              <button
                className="text-button clear-masks"
                data-testid="clear-ignores"
                onClick={() => changeOptions({ ...options, ignores: [] })}
              >
                Clear all exclusions
              </button>
            )}
          </div>
          <button
            className="sample-button"
            data-testid="sample-button"
            onClick={() => reset(true)}
          >
            <Layers2 size={16} />
            Load example
          </button>
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <div>
              <strong>Your screenshots stay yours.</strong>
              <p>
                Processed on this device. No accounts, analytics, or image
                uploads.
              </p>
            </div>
          </div>
        </aside>

        <main id="workspace" className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="breadcrumb">
                WORKSPACE<span>/</span>VISUAL REVIEW
              </div>
              <h1>
                See the change.<span>Make the call.</span>
              </h1>
              <p>
                Compare screenshots, review the differences, and share the
                evidence.
              </p>
            </div>
            <button
              className="primary-button"
              data-testid="export-report"
              disabled={!result || busy}
              onClick={() => exports.current?.showModal()}
            >
              <Download size={16} />
              Export review
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {isExample && (
            <div className="example-banner">
              <span className="example-tag">Example review</span>
              <span>
                A checkout refresh with a few changes worth a second look.
              </span>
              <button className="text-button" onClick={() => reset()}>
                Use your screenshots
              </button>
            </div>
          )}
          <div className="stats-row" aria-live="polite">
            <div className="stat">
              <span>Visual difference</span>
              <strong data-testid="changed-percent">
                {busy
                  ? "—"
                  : result
                    ? `${result.changedPercent.toFixed(2)}%`
                    : "—"}
                <i className="stat-swatch" />
              </strong>
              <small data-testid="changed-pixels">
                {result
                  ? `${number(result.changedPixels)} changed pixels`
                  : "Awaiting two screenshots"}
              </small>
            </div>
            <div className="stat">
              <span>Change regions</span>
              <strong>
                {result ? number(totalRegions) : "—"}
                <span className="stat-unit">to inspect</span>
              </strong>
              <small>
                {result
                  ? `${number(result.omittedRegions)} small or excess regions hidden`
                  : "Changes grouped into nearby areas"}
              </small>
            </div>
            <div className="stat">
              <span>Review progress</span>
              <strong>
                {reviewed}
                <span className="stat-unit">/ {totalRegions}</span>
              </strong>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Review progress"
                aria-valuemin={0}
                aria-valuemax={totalRegions || 1}
                aria-valuenow={reviewed}
                aria-valuetext={`${reviewed} of ${totalRegions} regions reviewed`}
              >
                <span
                  style={{
                    width: `${totalRegions ? (reviewed / totalRegions) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <div className="stat">
              <span>Needs a fix</span>
              <strong className={needsFix ? "fix-count" : ""}>
                {needsFix}
                <span className="stat-unit">flagged</span>
              </strong>
              <small>
                {needsFix
                  ? "Included in your review report"
                  : "Mark changes as you review"}
              </small>
            </div>
          </div>

          <div className="review-layout">
            <section className="comparison-panel" aria-label="Image comparison">
              <div className="viewer-toolbar">
                <div className="mode-tabs" aria-label="Comparison view">
                  {(
                    ["Difference", "Overlay", "Split", "Side by side"] as Mode[]
                  ).map((value) => (
                    <button
                      key={value}
                      className={mode === value ? "active" : ""}
                      aria-pressed={mode === value}
                      onClick={() => {
                        setMode(value);
                        setDrawMode(false);
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <label className="zoom-control">
                  <Maximize2 size={14} />
                  <span className="sr-only">Image zoom</span>
                  <select
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  >
                    <option value={100}>Fit</option>
                    <option value={150}>150%</option>
                    <option value={200}>200%</option>
                  </select>
                </label>
              </div>
              <div className="viewer-caption">
                <span>
                  <span className="caption-mark before" />
                  Baseline
                </span>
                <span>
                  <span className="caption-mark after" />
                  Candidate
                </span>
                <span className="caption-hint">
                  {mode === "Difference"
                    ? "Orange = changed pixels"
                    : mode === "Split"
                      ? "Drag the slider to compare"
                      : mode === "Overlay"
                        ? "Blend the candidate over the baseline"
                        : "Original screenshots, without resizing"}
                </span>
              </div>
              <div
                className={`viewer-stage ${!result ? "waiting" : ""}`}
                data-testid="comparison-status"
                aria-busy={busy}
              >
                {result && baseline && candidate ? (
                  <div className="image-size" style={{ width: `${zoom}%` }}>
                    {mode === "Side by side" ? (
                      <div className="side-by-side">
                        <div
                          className="image-stack"
                          style={{
                            aspectRatio: `${result.width}/${result.height}`,
                          }}
                        >
                          <img
                            style={{
                              width: `${(baseline.width / result.width) * 100}%`,
                              height: `${(baseline.height / result.height) * 100}%`,
                            }}
                            src={baseline.url}
                            alt="Baseline screenshot"
                          />
                        </div>
                        <div
                          className="image-stack"
                          style={{
                            aspectRatio: `${result.width}/${result.height}`,
                          }}
                        >
                          <img
                            style={{
                              width: `${(candidate.width / result.width) * 100}%`,
                              height: `${(candidate.height / result.height) * 100}%`,
                            }}
                            src={candidate.url}
                            alt="Candidate screenshot"
                          />
                        </div>
                      </div>
                    ) : (
                      <div
                        className="image-stack"
                        style={{
                          aspectRatio: `${result.width}/${result.height}`,
                        }}
                      >
                        {mode === "Difference" ? (
                          <img
                            className="diff-image"
                            src={diff}
                            alt="Difference map: changed pixels are orange"
                          />
                        ) : (
                          <>
                            <img
                              style={{
                                width: `${(baseline.width / result.width) * 100}%`,
                                height: `${(baseline.height / result.height) * 100}%`,
                              }}
                              src={baseline.url}
                              alt="Baseline screenshot"
                            />
                            <div
                              className="candidate-layer"
                              style={{
                                clipPath:
                                  mode === "Split"
                                    ? `inset(0 ${100 - split}% 0 0)`
                                    : undefined,
                                opacity: mode === "Overlay" ? opacity / 100 : 1,
                              }}
                            >
                              <img
                                style={{
                                  width: `${(candidate.width / result.width) * 100}%`,
                                  height: `${(candidate.height / result.height) * 100}%`,
                                }}
                                src={candidate.url}
                                alt="Candidate screenshot"
                              />
                            </div>
                          </>
                        )}
                        {regionOverlay(result.regions)}
                        {mode === "Split" && (
                          <div
                            className="split-line"
                            style={{ left: `${split}%` }}
                          >
                            <span>
                              <ArrowLeftRight size={17} />
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="viewer-empty">
                    <span className="empty-icon">
                      {busy ? <ScanLine size={32} /> : <Layers2 size={32} />}
                    </span>
                    <h2>
                      {busy
                        ? "Comparing your screenshots…"
                        : "A clear view of what changed."}
                    </h2>
                    <p>
                      {busy
                        ? "Finding changed pixels and grouping nearby regions."
                        : "Add a baseline and candidate in the sidebar, or explore the example."}
                    </p>
                    {!busy && (
                      <button
                        className="outline-button"
                        onClick={() => reset(true)}
                      >
                        Explore example
                      </button>
                    )}
                  </div>
                )}
              </div>
              {(mode === "Split" || mode === "Overlay") && result && (
                <div className="blend-control">
                  <label htmlFor="blend">
                    {mode === "Split"
                      ? "Comparison slider"
                      : "Candidate opacity"}
                  </label>
                  <input
                    id="blend"
                    type="range"
                    min="0"
                    max="100"
                    value={mode === "Split" ? split : opacity}
                    onChange={(e) =>
                      mode === "Split"
                        ? setSplit(Number(e.target.value))
                        : setOpacity(Number(e.target.value))
                    }
                  />
                  <span>{mode === "Split" ? split : opacity}%</span>
                </div>
              )}
              <div className="viewer-footer">
                <span>
                  <MousePointer2 size={14} />
                  {drawMode
                    ? "Draw a rectangle to exclude pixels"
                    : "Select a region to inspect it"}
                </span>
                <span>
                  {result
                    ? `${number(result.width)} × ${number(result.height)} px`
                    : "No images loaded"}
                  <span className="footer-divider">·</span>
                  {result
                    ? `${Math.round(result.durationMs)} ms`
                    : "Local processing"}
                </span>
              </div>
              {baseline &&
                candidate &&
                (baseline.width !== candidate.width ||
                  baseline.height !== candidate.height) && (
                  <p className="dimension-note">
                    Different image dimensions. Both are placed at the top left
                    without resizing; pixels outside either image count as
                    changes.
                  </p>
                )}
              {result?.comparedPixels === 0 && (
                <p className="dimension-note">
                  All pixels are excluded. Remove exclusions to compare the
                  screenshots.
                </p>
              )}
            </section>

            <section
              className="region-panel"
              aria-label="Review change regions"
            >
              <div className="region-panel-heading">
                <h2>
                  Change regions
                  <span className="count-badge">{totalRegions}</span>
                </h2>
                <span>
                  {totalRegions
                    ? `${totalRegions - reviewed} unreviewed`
                    : "Review queue"}
                </span>
              </div>
              <div className="region-list">
                {result?.regions.map((region, i) => {
                  const review = reviews[region.id] ?? defaultReview;
                  const active = region.id === selected;
                  return (
                    <article
                      key={region.id}
                      data-testid="region-card"
                      className={`region-card ${active ? "active" : ""} ${review.decision}`}
                    >
                      <button
                        className="region-select"
                        aria-expanded={active}
                        onClick={() => setSelected(region.id)}
                      >
                        <span className="region-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          <strong>
                            Region {String(i + 1).padStart(2, "0")}
                          </strong>
                          <small>{number(region.pixels)} changed pixels</small>
                        </span>
                        <span
                          className={`decision-dot ${review.decision}`}
                          title={
                            review.decision === "fix"
                              ? "Needs fix"
                              : review.decision
                          }
                        >
                          {review.decision === "expected" ? (
                            <Check size={13} />
                          ) : review.decision === "fix" ? (
                            "!"
                          ) : (
                            "·"
                          )}
                        </span>
                      </button>
                      {active && (
                        <div className="region-detail">
                          <div className="region-coordinates">
                            x {region.x}, y {region.y}
                            <span>
                              {region.width} × {region.height} px
                            </span>
                          </div>
                          {crops && (
                            <div className="region-crops">
                              <figure>
                                <img
                                  src={crops[0]}
                                  alt={`Baseline crop for region ${i + 1}`}
                                />
                                <figcaption>Before</figcaption>
                              </figure>
                              <figure>
                                <img
                                  src={crops[1]}
                                  alt={`Candidate crop for region ${i + 1}`}
                                />
                                <figcaption>After</figcaption>
                              </figure>
                            </div>
                          )}
                          <div className="decision-actions">
                            <button
                              className={
                                review.decision === "expected"
                                  ? "chosen expected"
                                  : ""
                              }
                              aria-pressed={review.decision === "expected"}
                              onClick={() =>
                                updateReview(region.id, {
                                  decision: "expected",
                                })
                              }
                            >
                              <Check size={14} />
                              Expected
                            </button>
                            <button
                              className={
                                review.decision === "fix" ? "chosen fix" : ""
                              }
                              aria-pressed={review.decision === "fix"}
                              onClick={() =>
                                updateReview(region.id, { decision: "fix" })
                              }
                            >
                              <CircleHelp size={14} />
                              Needs fix
                            </button>
                          </div>
                          <label
                            className="note-label"
                            htmlFor={`note-${region.id}`}
                          >
                            Review note
                            <textarea
                              id={`note-${region.id}`}
                              maxLength={2000}
                              value={review.note}
                              placeholder="What changed? What should happen?"
                              onChange={(e) =>
                                updateReview(region.id, {
                                  note: e.target.value,
                                })
                              }
                            />
                          </label>
                          {review.decision !== "unreviewed" && (
                            <button
                              className="undo-decision"
                              onClick={() =>
                                updateReview(region.id, {
                                  decision: "unreviewed",
                                })
                              }
                            >
                              <RotateCcw size={12} />
                              Mark unreviewed
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!result && (
                  <div className="queue-empty">
                    <ScanLine size={24} />
                    <p>
                      {busy
                        ? "Your review queue is on its way."
                        : "Your changes will appear here."}
                    </p>
                  </div>
                )}
                {result && totalRegions === 0 && (
                  <div className="queue-empty">
                    <CheckCheck size={28} />
                    <h3>
                      {result.changedPixels === 0 && result.comparedPixels > 0
                        ? "No visible differences"
                        : "No regions to review"}
                    </h3>
                    <p>
                      {result.comparedPixels === 0
                        ? "Every pixel is excluded. Remove an exclusion to compare."
                        : result.changedPixels > 0
                          ? "Changes are below the region-size filter. Lower the minimum to inspect them."
                          : "The images match at your current color tolerance."}
                    </p>
                  </div>
                )}
                {result && totalRegions > 0 && reviewed === totalRegions && (
                  <div className="review-complete">
                    <CheckCheck size={18} />
                    <span>
                      Review complete.
                      <br />
                      <small>
                        {needsFix
                          ? `${needsFix} regions need a fix.`
                          : "All visible changes marked expected."}
                      </small>
                    </span>
                  </div>
                )}
              </div>
              <div className="queue-footer">
                <LockKeyhole size={13} />
                Decisions stay in this tab until exported.
              </div>
            </section>
          </div>
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} />
              On your device. Under your control.
            </span>
            <span>
              Built by{" "}
              <a
                href="https://github.com/FarzamFattahi"
                target="_blank"
                rel="noreferrer"
              >
                Farzam Fattahi
              </a>
              <span>·</span>Open source, MIT
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <dialog ref={guide} className="modal" aria-labelledby="guide-title">
        <div className="modal-heading">
          <span className="eyebrow">A SMALL TOOL FOR A CLEARER REVIEW</span>
          <button
            className="icon-button"
            aria-label="Close guide"
            onClick={() => guide.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="guide-title">From pixels to decisions.</h2>
        <p>
          Prooflane helps you inspect visual changes between two screenshots. It
          detects differences; you decide whether they’re correct.
        </p>
        <ol className="guide-steps">
          <li>
            <strong>Add your screenshots.</strong>
            <span>
              Use PNG for precise comparisons. JPEG compression can introduce
              extra differences.
            </span>
          </li>
          <li>
            <strong>Separate change from noise.</strong>
            <span>
              Adjust color tolerance and exclude dynamic areas. Changes are
              grouped in 16-pixel tiles; nearby changes can share a region.
            </span>
          </li>
          <li>
            <strong>Review and hand off.</strong>
            <span>
              Mark each region Expected or Needs fix, add a note, and export an
              HTML report that opens offline.
            </span>
          </li>
        </ol>
        <div className="guide-details">
          <h3>What to know</h3>
          <p>
            Images are composited over white and compared using a weighted RGB
            color distance. No image is resized. The tolerance is a
            color-distance threshold, not a confidence score. Small regions
            hidden from the list still count toward the difference percentage.
          </p>
          <p>
            Use matching viewport sizes, browser versions, and font settings for
            repeatable results. Text antialiasing may appear as changes.
            Prooflane does not read page structure or judge accessibility,
            correctness, or usability.
          </p>
          <p>
            Images and decisions live in this tab’s memory. Reloading clears
            them. Exports include screenshots and notes, so check their contents
            before sharing.
          </p>
        </div>
        <a
          className="outline-button"
          href="https://github.com/FarzamFattahi/prooflane#readme"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={16} />
          Read the documentation
        </a>
      </dialog>
      <dialog
        ref={exports}
        className="modal export-modal"
        aria-labelledby="export-title"
      >
        <div className="modal-heading">
          <span className="eyebrow">TAKE YOUR REVIEW WITH YOU</span>
          <button
            className="icon-button"
            aria-label="Close export"
            disabled={exporting}
            onClick={() => exports.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="export-title">Share the evidence.</h2>
        <p>
          {reviewed} of {totalRegions} regions reviewed
          {needsFix ? ` · ${needsFix} flagged for a fix` : ""}. Unreviewed
          regions are included and labeled.
        </p>
        <div className="export-warning">
          <LockKeyhole size={19} />
          <p>
            The HTML report includes both original screenshots and your notes.
            Check for sensitive content before sharing.
          </p>
        </div>
        <button
          className="export-choice"
          disabled={exporting}
          onClick={() => void exportFile("html")}
        >
          <span className="export-icon">
            <Expand size={23} />
          </span>
          <span>
            <strong>Download HTML report</strong>
            <small>
              Screenshots, difference map, decisions & notes. Opens offline.
            </small>
          </span>
          <Download size={18} />
        </button>
        <button
          className="export-choice"
          data-testid="export-session"
          disabled={exporting}
          onClick={() => void exportFile("json")}
        >
          <span className="export-icon">
            <Layers2 size={23} />
          </span>
          <span>
            <strong>Download JSON</strong>
            <small>
              Settings, pixel hashes, region coordinates & review decisions.
            </small>
          </span>
          <Download size={18} />
        </button>
        <button
          className="export-choice"
          disabled={exporting}
          onClick={() => void exportFile("png")}
        >
          <span className="export-icon">
            <ImagePlus size={23} />
          </span>
          <span>
            <strong>Download difference PNG</strong>
            <small>
              Full-resolution difference map for tickets and pull requests.
            </small>
          </span>
          <Download size={18} />
        </button>
        <p className="export-footnote">
          {exporting
            ? "Preparing your export…"
            : "Generated locally. Nothing is sent to a server."}
        </p>
      </dialog>
    </>
  );
}
