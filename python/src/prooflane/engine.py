"""Pixel comparison matching the browser engine's documented contract."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import isfinite
from time import perf_counter
from typing import Iterable

import numpy as np
from PIL import Image

MAX_PIXELS = 12_000_000
MAX_SIDE = 8192
MAX_REGIONS = 1000
TILE_SIZE = 16
MAX_SAFE_INTEGER = 2**53 - 1


def _integer(value: object, label: str, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, np.integer)):
        raise ValueError(f"{label} must be an integer")
    value = int(value)
    if not minimum <= value <= MAX_SAFE_INTEGER:
        raise ValueError(f"{label} must be between {minimum} and {MAX_SAFE_INTEGER}")
    return value


@dataclass(frozen=True)
class Rect:
    """An integer half-open rectangle: x <= pixel < x + width."""

    x: int
    y: int
    width: int
    height: int

    def validate(self) -> None:
        _integer(self.x, "ignore x", 0)
        _integer(self.y, "ignore y", 0)
        _integer(self.width, "ignore width", 1)
        _integer(self.height, "ignore height", 1)
        _integer(self.x + self.width, "ignore right edge", 1)
        _integer(self.y + self.height, "ignore bottom edge", 1)


@dataclass(frozen=True)
class Region:
    id: str
    x: int
    y: int
    width: int
    height: int
    pixels: int


@dataclass
class Comparison:
    width: int
    height: int
    changedPixels: int
    comparedPixels: int
    ignoredPixels: int
    changedPercent: float
    regions: list[Region]
    omittedRegions: int
    omittedPixels: int
    mask: np.ndarray
    durationMs: float

    def to_dict(self, *, include_mask: bool = False) -> dict:
        """JSON-compatible engine fields; an optional flat mask matches JS."""
        result = {
            "width": self.width,
            "height": self.height,
            "changedPixels": self.changedPixels,
            "comparedPixels": self.comparedPixels,
            "ignoredPixels": self.ignoredPixels,
            "changedPercent": self.changedPercent,
            "regions": [asdict(region) for region in self.regions],
            "omittedRegions": self.omittedRegions,
            "omittedPixels": self.omittedPixels,
            "durationMs": self.durationMs,
        }
        if include_mask:
            result["mask"] = self.mask.reshape(-1).tolist()
        return result


def _pixels(image: Image.Image | np.ndarray, label: str) -> np.ndarray:
    if isinstance(image, Image.Image):
        width, height = image.size
        if width < 1 or height < 1 or width > MAX_SIDE or height > MAX_SIDE:
            raise ValueError(f"{label} dimensions must be 1..{MAX_SIDE}")
        if width * height > MAX_PIXELS:
            raise ValueError(f"{label} exceeds {MAX_PIXELS:,} pixels")
        image = np.asarray(image.convert("RGBA"))
    if not isinstance(image, np.ndarray) or image.ndim != 3 or image.shape[2] != 4:
        raise ValueError(f"{label} must be a Pillow image or H×W×4 uint8 RGBA array")
    if image.dtype != np.uint8:
        raise ValueError(f"{label} RGBA array must have uint8 dtype")
    height, width = image.shape[:2]
    if width < 1 or height < 1 or width > MAX_SIDE or height > MAX_SIDE:
        raise ValueError(f"{label} dimensions must be 1..{MAX_SIDE}")
    return image


def _regions(mask: np.ndarray, minimum: int) -> tuple[list[Region], int, int]:
    height, width = mask.shape
    tile_height = (height + TILE_SIZE - 1) // TILE_SIZE
    tile_width = (width + TILE_SIZE - 1) // TILE_SIZE
    # Each occupied tile stores exact changed-pixel bounds and count.
    tiles: dict[tuple[int, int], tuple[int, int, int, int, int]] = {}
    for ty in range(tile_height):
        top = ty * TILE_SIZE
        for tx in range(tile_width):
            left = tx * TILE_SIZE
            ys, xs = np.nonzero(mask[top : top + TILE_SIZE, left : left + TILE_SIZE])
            if xs.size:
                tiles[(ty, tx)] = (
                    left + int(xs.min()), top + int(ys.min()),
                    left + int(xs.max()), top + int(ys.max()), int(xs.size),
                )
    regions: list[Region] = []
    omitted_regions = omitted_pixels = 0
    while tiles:
        start = next(iter(tiles))
        x0, y0, x1, y1, count = tiles.pop(start)
        stack = [start]
        while stack:
            ty, tx = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    tile = tiles.pop((ty + dy, tx + dx), None)
                    if tile is not None:
                        ax, ay, bx, by, pixels = tile
                        x0, y0, x1, y1 = min(x0, ax), min(y0, ay), max(x1, bx), max(y1, by)
                        count += pixels
                        stack.append((ty + dy, tx + dx))
        region_width, region_height = x1 - x0 + 1, y1 - y0 + 1
        if count < minimum:
            omitted_regions += 1
            omitted_pixels += count
        else:
            regions.append(Region(f"r-{x0}-{y0}-{region_width}-{region_height}", x0, y0,
                                  region_width, region_height, count))
    regions.sort(key=lambda region: (-region.pixels, region.y, region.x))
    excess = regions[MAX_REGIONS:]
    return regions[:MAX_REGIONS], omitted_regions + len(excess), omitted_pixels + sum(r.pixels for r in excess)


def compare_images(
    baseline: Image.Image | np.ndarray,
    candidate: Image.Image | np.ndarray,
    *,
    threshold: float = 0.08,
    min_region_pixels: int = 8,
    ignores: Iterable[Rect] = (),
) -> Comparison:
    """Compare top-left aligned images, white-composited, without resizing.

    ``threshold`` is weighted RGB RMS distance on [0, 1]. Pixels outside
    either image always differ. Ignored pixels do not enter the denominator.
    Small regions remain in statistics even when filtered from the region list.
    """
    started = perf_counter()
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float, np.number)):
        raise ValueError("threshold must be a finite number between 0 and 1")
    threshold = float(threshold)
    if not isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("threshold must be a finite number between 0 and 1")
    minimum = _integer(min_region_pixels, "min_region_pixels", 1)
    rectangles = list(ignores)
    for rectangle in rectangles:
        if not isinstance(rectangle, Rect):
            raise ValueError("ignores must contain Rect instances")
        rectangle.validate()
    a, b = _pixels(baseline, "baseline"), _pixels(candidate, "candidate")
    ah, aw = a.shape[:2]
    bh, bw = b.shape[:2]
    height, width = max(ah, bh), max(aw, bw)
    if width * height > MAX_PIXELS:
        raise ValueError(f"Union canvas exceeds {MAX_PIXELS:,} pixels")
    mask = np.ones((height, width), dtype=np.uint8)
    overlap_height, overlap_width = min(ah, bh), min(aw, bw)
    # Bounded chunks avoid creating full-canvas float64 RGBA intermediates.
    for top in range(0, overlap_height, 128):
        bottom = min(top + 128, overlap_height)
        ac = a[top:bottom, :overlap_width].astype(np.float64)
        bc = b[top:bottom, :overlap_width].astype(np.float64)
        alpha_a, alpha_b = ac[:, :, 3:4] / 255, bc[:, :, 3:4] / 255
        delta = ac[:, :, :3] * alpha_a + 255 * (1 - alpha_a)
        delta -= bc[:, :, :3] * alpha_b + 255 * (1 - alpha_b)
        distance = np.sqrt((0.2126 * delta[:, :, 0] ** 2
                            + 0.7152 * delta[:, :, 1] ** 2
                            + 0.0722 * delta[:, :, 2] ** 2)) / 255
        mask[top:bottom, :overlap_width] = distance > threshold
    # The union rectangle's corners outside both source extents also count.
    ignored = np.zeros_like(mask)
    for rect in rectangles:
        right, bottom = min(width, rect.x + rect.width), min(height, rect.y + rect.height)
        if rect.x < width and rect.y < height:
            ignored[rect.y:bottom, rect.x:right] = 1
    mask[ignored != 0] = 0
    ignored_pixels = int(np.count_nonzero(ignored))
    changed_pixels = int(np.count_nonzero(mask))
    compared_pixels = width * height - ignored_pixels
    regions, omitted_regions, omitted_pixels = _regions(mask, minimum)
    return Comparison(width, height, changed_pixels, compared_pixels, ignored_pixels,
                      changed_pixels / compared_pixels * 100 if compared_pixels else 0.0,
                      regions, omitted_regions, omitted_pixels, mask,
                      (perf_counter() - started) * 1000)
