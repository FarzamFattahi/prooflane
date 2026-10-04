import { describe, expect, it } from "vitest";
import { compareImages } from "./engine";
import type { CompareOptions, ImagePixels } from "./types";
import golden from "../tests/fixtures/comparison-golden.json";

function image(
  width: number,
  height: number,
  color = [255, 255, 255, 255],
): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return { width, height, data };
}

function pixel(
  target: ImagePixels,
  x: number,
  y: number,
  rgba = [0, 0, 0, 255],
): void {
  target.data.set(rgba, (y * target.width + x) * 4);
}

describe("shared Python and browser golden comparisons", () => {
  for (const fixture of golden.cases) {
    it(fixture.name, () => {
      const baseline = {
        ...fixture.baseline,
        data: new Uint8ClampedArray(fixture.baseline.data),
      };
      const candidate = {
        ...fixture.candidate,
        data: new Uint8ClampedArray(fixture.candidate.data),
      };
      const { durationMs, mask, ...result } = compareImages(
        baseline,
        candidate,
        fixture.options,
      );
      const { changedPercent, ...expected } = fixture.expected;
      expect(result.changedPercent).toBeCloseTo(changedPercent, 12);
      expect({ ...result, changedPercent: undefined, mask: [...mask] }).toEqual(
        { ...expected, changedPercent: undefined },
      );
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });
  }
});

describe("pixel comparison", () => {
  it("defaults to an 8-pixel region minimum while retaining all changed pixels", () => {
    const candidate = image(4, 4);
    pixel(candidate, 2, 3);
    const result = compareImages(image(4, 4), candidate);
    expect(result.changedPixels).toBe(1);
    expect(result.regions).toEqual([]);
    expect(result.omittedPixels).toBe(1);
    expect(result.omittedRegions).toBe(1);
  });

  it("uses a strict weighted RMS threshold", () => {
    const baseline = image(1, 1, [0, 0, 0, 255]);
    const candidate = image(1, 1, [255, 0, 0, 255]);
    const distance = Math.sqrt(0.2126 * 255 * 255) / 255;
    expect(
      compareImages(baseline, candidate, {
        threshold: distance,
        minRegionPixels: 1,
      }).changedPixels,
    ).toBe(0);
    expect(
      compareImages(baseline, candidate, {
        threshold: distance - 1e-10,
        minRegionPixels: 1,
      }).changedPixels,
    ).toBe(1);
    expect(
      compareImages(image(1, 1), image(1, 1, [0, 0, 0, 255]), { threshold: 1 })
        .changedPixels,
    ).toBe(0);
  });

  it("ignores hidden RGB under complete transparency", () => {
    const baseline = image(2, 1, [255, 0, 0, 0]);
    const candidate = image(2, 1, [0, 255, 200, 0]);
    expect(
      compareImages(baseline, candidate, { threshold: 0 }).changedPixels,
    ).toBe(0);
  });

  it("counts dimension changes even at threshold 1 and permits masking them", () => {
    const result = compareImages(image(1, 2), image(2, 1), {
      threshold: 1,
      minRegionPixels: 1,
      ignores: [{ x: 1, y: 1, width: 1, height: 1 }],
    });
    expect(result.changedPixels).toBe(2);
    expect(result.ignoredPixels).toBe(1);
    expect(result.comparedPixels).toBe(3);
    expect([...result.mask]).toEqual([0, 1, 1, 0]);
  });

  it("defines a fully ignored canvas as zero percent and never mutates inputs", () => {
    const baseline = image(3, 2);
    const candidate = image(3, 2, [0, 0, 0, 255]);
    const original = [...candidate.data];
    const result = compareImages(baseline, candidate, {
      ignores: [{ x: 0, y: 0, width: 3, height: 2 }],
    });
    expect(result.comparedPixels).toBe(0);
    expect(result.ignoredPixels).toBe(6);
    expect(result.changedPercent).toBe(0);
    expect(result.regions).toEqual([]);
    expect([...candidate.data]).toEqual(original);
  });
});

describe("16-pixel tile region grouping", () => {
  it("joins diagonal occupied tiles with exact actual-pixel bounds", () => {
    const candidate = image(48, 48);
    pixel(candidate, 1, 2);
    pixel(candidate, 31, 30);
    const result = compareImages(image(48, 48), candidate, {
      minRegionPixels: 1,
    });
    expect(result.regions).toEqual([
      { id: "r-1-2-31-29", x: 1, y: 2, width: 31, height: 29, pixels: 2 },
    ]);
  });

  it("groups separated pixels in one tile but preserves empty tile gaps", () => {
    const candidate = image(64, 16);
    pixel(candidate, 0, 0);
    pixel(candidate, 15, 15);
    pixel(candidate, 48, 0);
    const result = compareImages(image(64, 16), candidate, {
      minRegionPixels: 1,
    });
    expect(
      result.regions.map(({ x, y, width, height, pixels }) => ({
        x,
        y,
        width,
        height,
        pixels,
      })),
    ).toEqual([
      { x: 0, y: 0, width: 16, height: 16, pixels: 2 },
      { x: 48, y: 0, width: 1, height: 1, pixels: 1 },
    ]);
  });

  it("sorts equal-size regions by y then x", () => {
    const candidate = image(96, 64);
    pixel(candidate, 64, 0);
    pixel(candidate, 0, 32);
    pixel(candidate, 32, 0);
    const result = compareImages(image(96, 64), candidate, {
      minRegionPixels: 1,
    });
    expect(result.regions.map((region) => [region.x, region.y])).toEqual([
      [32, 0],
      [64, 0],
      [0, 32],
    ]);
  });

  it("removes an ignored connecting tile before grouping", () => {
    const candidate = image(48, 1, [0, 0, 0, 255]);
    const result = compareImages(image(48, 1), candidate, {
      minRegionPixels: 1,
      ignores: [{ x: 16, y: 0, width: 16, height: 1 }],
    });
    expect(result.regions.map((region) => region.pixels)).toEqual([16, 16]);
    expect(result.changedPixels).toBe(32);
    expect(result.comparedPixels).toBe(32);
  });

  it("caps displayed regions while accounting for every omitted pixel", () => {
    const candidate = image(1024, 1024);
    for (let y = 0; y < 1024; y += 32)
      for (let x = 0; x < 1024; x += 32) pixel(candidate, x, y);
    const result = compareImages(image(1024, 1024), candidate, {
      minRegionPixels: 1,
    });
    expect(result.regions).toHaveLength(1000);
    expect(result.changedPixels).toBe(1024);
    expect(result.omittedRegions).toBe(24);
    expect(result.omittedPixels).toBe(24);
    expect(result.regions[0].id).toBe("r-0-0-1-1");
  });
});

describe("input limits and invalid data", () => {
  it.each([0, -1, 0.5, NaN, Infinity, 8193])(
    "rejects invalid dimensions %s",
    (width) => {
      expect(() =>
        compareImages(
          { width, height: 1, data: new Uint8ClampedArray() },
          image(1, 1),
        ),
      ).toThrow(/dimensions/);
    },
  );
  it("rejects incomplete buffers and untyped input", () => {
    expect(() =>
      compareImages(
        { width: 2, height: 1, data: new Uint8ClampedArray(4) },
        image(1, 1),
      ),
    ).toThrow(/RGBA/);
    expect(() =>
      compareImages(
        { width: 1, height: 1, data: [0, 0, 0, 255] } as unknown as ImagePixels,
        image(1, 1),
      ),
    ).toThrow(/RGBA/);
  });
  it("checks union canvas size before allocating comparison output", () => {
    expect(() => compareImages(image(8192, 1), image(1, 1465))).toThrow(
      /pixel limit/,
    );
  });
  it.each([-0.1, 1.1, NaN, Infinity, "0.1", null])(
    "rejects threshold %s",
    (threshold) => {
      expect(() =>
        compareImages(image(1, 1), image(1, 1), {
          threshold,
        } as unknown as CompareOptions),
      ).toThrow();
    },
  );
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects minimum region size %s",
    (minRegionPixels) => {
      expect(() =>
        compareImages(image(1, 1), image(1, 1), { minRegionPixels }),
      ).toThrow(/region size/);
    },
  );
  it.each([
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: Infinity },
    { x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 1 },
  ])("rejects invalid ignore rectangle %j", (rect) => {
    expect(() =>
      compareImages(image(1, 1), image(1, 1), { ignores: [rect] }),
    ).toThrow(/rectangles/);
  });
  it("ignores rectangles completely outside the union canvas", () => {
    const result = compareImages(image(1, 1), image(1, 1), {
      ignores: [{ x: 50, y: 50, width: 2, height: 2 }],
    });
    expect(result.ignoredPixels).toBe(0);
  });
});
