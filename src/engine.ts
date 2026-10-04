import type {
  ChangeRegion,
  CompareOptions,
  Comparison,
  ImagePixels,
  Rect,
} from "./types";

export const MAX_SIDE = 8192;
export const MAX_PIXELS = 12_000_000;
export const MAX_REGIONS = 1000;
const TILE_SIZE = 16;

function validateImage(image: ImagePixels, label: string): void {
  if (
    !image ||
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_SIDE ||
    image.height > MAX_SIDE
  ) {
    throw new Error(
      `${label} must have positive integer dimensions of at most ${MAX_SIDE}px per side.`,
    );
  }
  if (
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new Error(
      `${label} must contain exactly width × height × 4 RGBA bytes.`,
    );
  }
}

function validateOptions(
  input: Partial<CompareOptions> | undefined,
): CompareOptions {
  if (
    input !== undefined &&
    (input === null || typeof input !== "object" || Array.isArray(input))
  ) {
    throw new Error("Comparison options must be an object.");
  }
  const threshold = input?.threshold ?? 0.08;
  const minRegionPixels = input?.minRegionPixels ?? 8;
  const ignores = input?.ignores ?? [];
  // Explicit nulls are invalid, even though omitted options receive defaults.
  if (
    input &&
    (("threshold" in input && input.threshold == null) ||
      ("minRegionPixels" in input && input.minRegionPixels == null) ||
      ("ignores" in input && input.ignores == null))
  ) {
    throw new Error("Comparison options cannot be null.");
  }
  if (
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    throw new Error("Threshold must be a finite number between 0 and 1.");
  }
  if (!Number.isSafeInteger(minRegionPixels) || minRegionPixels < 1) {
    throw new Error("Minimum region size must be a positive safe integer.");
  }
  if (!Array.isArray(ignores))
    throw new Error("Ignore rectangles must be an array.");
  for (const rect of ignores) {
    if (
      !rect ||
      typeof rect !== "object" ||
      !Number.isSafeInteger(rect.x) ||
      !Number.isSafeInteger(rect.y) ||
      !Number.isSafeInteger(rect.width) ||
      !Number.isSafeInteger(rect.height) ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.width < 1 ||
      rect.height < 1 ||
      !Number.isSafeInteger(rect.x + rect.width) ||
      !Number.isSafeInteger(rect.y + rect.height)
    ) {
      throw new Error(
        "Ignore rectangles require nonnegative integer coordinates and positive integer dimensions.",
      );
    }
  }
  return { threshold, minRegionPixels, ignores };
}

/** Mark clipped, half-open rectangles once per pixel, even when many masks overlap. */
function markIgnores(
  mask: Uint8Array,
  width: number,
  height: number,
  ignores: Rect[],
): void {
  const events = new Map<
    number,
    { id: number; add: boolean; x: number; end: number }[]
  >();
  ignores.forEach((rect, id) => {
    const endX = Math.min(width, rect.x + rect.width);
    const endY = Math.min(height, rect.y + rect.height);
    if (rect.x >= endX || rect.y >= endY) return;
    const start = events.get(rect.y) ?? [];
    start.push({ id, add: true, x: rect.x, end: endX });
    events.set(rect.y, start);
    const end = events.get(endY) ?? [];
    end.push({ id, add: false, x: rect.x, end: endX });
    events.set(endY, end);
  });
  const ys = [...events.keys()].sort((a, b) => a - b);
  const active = new Map<number, { x: number; end: number }>();
  for (let i = 0; i < ys.length - 1; i++) {
    const y = ys[i];
    for (const event of events.get(y)!) {
      if (event.add) active.set(event.id, event);
      else active.delete(event.id);
    }
    const spans = [...active.values()].sort((a, b) => a.x - b.x);
    const merged: { x: number; end: number }[] = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span.x <= last.end) last.end = Math.max(last.end, span.end);
      else merged.push({ x: span.x, end: span.end });
    }
    for (let row = y; row < ys[i + 1]; row++) {
      for (const span of merged)
        mask.fill(2, row * width + span.x, row * width + span.end);
    }
  }
}

/** Deterministic pixel comparison. No resizing, color rounding, or semantic inference. */
export function compareImages(
  baseline: ImagePixels,
  candidate: ImagePixels,
  input?: Partial<CompareOptions>,
): Comparison {
  const started = performance.now();
  validateImage(baseline, "Baseline");
  validateImage(candidate, "Candidate");
  const options = validateOptions(input);
  const width = Math.max(baseline.width, candidate.width);
  const height = Math.max(baseline.height, candidate.height);
  if (width * height > MAX_PIXELS)
    throw new Error(
      `Union canvas exceeds the ${MAX_PIXELS.toLocaleString("en-US")} pixel limit.`,
    );

  const mask = new Uint8Array(width * height);
  markIgnores(mask, width, height, options.ignores);
  const tilesX = Math.ceil(width / TILE_SIZE);
  const tilesY = Math.ceil(height / TILE_SIZE);
  const tileLength = tilesX * tilesY;
  const counts = new Uint32Array(tileLength);
  const minX = new Uint16Array(tileLength);
  const minY = new Uint16Array(tileLength);
  const maxX = new Uint16Array(tileLength);
  const maxY = new Uint16Array(tileLength);
  let changedPixels = 0;
  let ignoredPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (mask[index] === 2) {
        ignoredPixels++;
        mask[index] = 0;
        continue;
      }
      let changed =
        x >= baseline.width ||
        y >= baseline.height ||
        x >= candidate.width ||
        y >= candidate.height;
      if (!changed) {
        const ai = (y * baseline.width + x) * 4;
        const bi = (y * candidate.width + x) * 4;
        const aa = baseline.data[ai + 3] / 255;
        const ba = candidate.data[bi + 3] / 255;
        const dr =
          baseline.data[ai] * aa +
          255 * (1 - aa) -
          (candidate.data[bi] * ba + 255 * (1 - ba));
        const dg =
          baseline.data[ai + 1] * aa +
          255 * (1 - aa) -
          (candidate.data[bi + 1] * ba + 255 * (1 - ba));
        const db =
          baseline.data[ai + 2] * aa +
          255 * (1 - aa) -
          (candidate.data[bi + 2] * ba + 255 * (1 - ba));
        changed =
          Math.sqrt(0.2126 * dr * dr + 0.7152 * dg * dg + 0.0722 * db * db) /
            255 >
          options.threshold;
      }
      if (!changed) continue;
      mask[index] = 1;
      changedPixels++;
      const tile =
        Math.floor(y / TILE_SIZE) * tilesX + Math.floor(x / TILE_SIZE);
      if (counts[tile] === 0) {
        minX[tile] = maxX[tile] = x;
        minY[tile] = maxY[tile] = y;
      } else {
        minX[tile] = Math.min(minX[tile], x);
        minY[tile] = Math.min(minY[tile], y);
        maxX[tile] = Math.max(maxX[tile], x);
        maxY[tile] = Math.max(maxY[tile], y);
      }
      counts[tile]++;
    }
  }

  const visited = new Uint8Array(tileLength);
  const queue = new Uint32Array(tileLength);
  const allRegions: ChangeRegion[] = [];
  for (let tile = 0; tile < tileLength; tile++) {
    if (!counts[tile] || visited[tile]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = tile;
    visited[tile] = 1;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    let pixels = 0;
    while (head < tail) {
      const current = queue[head++];
      left = Math.min(left, minX[current]);
      top = Math.min(top, minY[current]);
      right = Math.max(right, maxX[current]);
      bottom = Math.max(bottom, maxY[current]);
      pixels += counts[current];
      const tx = current % tilesX;
      const ty = Math.floor(current / tilesX);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || nx >= tilesX || ny < 0 || ny >= tilesY) continue;
          const next = ny * tilesX + nx;
          if (!counts[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    const regionWidth = right - left + 1;
    const regionHeight = bottom - top + 1;
    allRegions.push({
      id: `r-${left}-${top}-${regionWidth}-${regionHeight}`,
      x: left,
      y: top,
      width: regionWidth,
      height: regionHeight,
      pixels,
    });
  }
  allRegions.sort((a, b) => b.pixels - a.pixels || a.y - b.y || a.x - b.x);
  const regions: ChangeRegion[] = [];
  let omittedRegions = 0;
  let omittedPixels = 0;
  for (const region of allRegions) {
    if (
      region.pixels < options.minRegionPixels ||
      regions.length >= MAX_REGIONS
    ) {
      omittedRegions++;
      omittedPixels += region.pixels;
    } else regions.push(region);
  }
  const comparedPixels = width * height - ignoredPixels;
  return {
    width,
    height,
    changedPixels,
    comparedPixels,
    ignoredPixels,
    changedPercent: comparedPixels ? (changedPixels / comparedPixels) * 100 : 0,
    regions,
    omittedRegions,
    omittedPixels,
    mask,
    durationMs: performance.now() - started,
  };
}
