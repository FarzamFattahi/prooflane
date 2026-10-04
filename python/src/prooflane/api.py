"""Convenient file, Pillow and NumPy entry points for application developers."""
from __future__ import annotations

import json
from os import PathLike
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageOps

from .engine import MAX_PIXELS, MAX_SIDE, Comparison, Rect, compare_images

ImageInput = str | PathLike[str] | Image.Image | np.ndarray


def load_image(source: ImageInput) -> Image.Image:
    """Return an owned, oriented RGBA image. Arrays use RGB, never OpenCV BGR.

    Accept uint8 grayscale H×W, RGB H×W×3, or RGBA H×W×4 arrays.
    Multi-frame files are rejected rather than silently comparing frame zero.
    """
    if isinstance(source, (str, PathLike)):
        with Image.open(source) as image:
            return load_image(image)
    if isinstance(source, np.ndarray):
        if source.dtype != np.uint8 or not (
            source.ndim == 2 or (source.ndim == 3 and source.shape[2] in (3, 4))
        ):
            raise ValueError("arrays must be uint8 grayscale, RGB, or RGBA")
        height, width = source.shape[:2]
        if not 1 <= width <= MAX_SIDE or not 1 <= height <= MAX_SIDE or width * height > MAX_PIXELS:
            raise ValueError("image dimensions exceed comparison limits")
        source = Image.fromarray(source)
    if not isinstance(source, Image.Image):
        raise TypeError("source must be a file path, Pillow image, or NumPy array")
    width, height = source.size
    if not 1 <= width <= MAX_SIDE or not 1 <= height <= MAX_SIDE or width * height > MAX_PIXELS:
        raise ValueError("image dimensions exceed comparison limits")
    if getattr(source, "n_frames", 1) != 1:
        raise ValueError("multi-frame images are unsupported; export one frame")
    return ImageOps.exif_transpose(source).convert("RGBA")


def compare(
    baseline: ImageInput, candidate: ImageInput, *, threshold: float = 0.08,
    min_region_pixels: int = 8, ignores: Iterable[Rect] = (),
) -> Comparison:
    """Compare paths, Pillow images, or uint8 arrays without uploading them.

    The result exposes exact statistics, region boxes and an H×W binary mask.
    Inputs align at the top left; no resizing or semantic detection occurs.
    """
    return compare_images(load_image(baseline), load_image(candidate),
                          threshold=threshold, min_region_pixels=min_region_pixels,
                          ignores=ignores)


def render_difference(candidate: ImageInput, result: Comparison) -> Image.Image:
    """Create a Pillow RGBA image highlighting the result's changed pixels.

    Pass the same candidate used for comparison. Saving is left to the caller.
    """
    image = load_image(candidate)
    if image.width > result.width or image.height > result.height:
        raise ValueError("candidate exceeds comparison canvas")
    if result.mask.shape != (result.height, result.width):
        raise ValueError("comparison mask dimensions do not match canvas")
    canvas = Image.new("RGBA", (result.width, result.height), "white")
    canvas.alpha_composite(image)
    pixels = np.asarray(canvas).copy()
    changed = result.mask.astype(bool)
    pixels[changed, :3] = np.rint(
        pixels[changed, :3] * 0.35 + np.array([246, 71, 104]) * 0.65
    ).astype(np.uint8)
    return Image.fromarray(pixels)


def save_report(result: Comparison, path: str | PathLike[str], *, include_mask: bool = False) -> None:
    """Write JSON statistics; optionally include the flattened pixel mask.

    Parent directories must exist. Existing files are replaced.
    """
    Path(path).write_text(json.dumps(result.to_dict(include_mask=include_mask),
                                    indent=2, allow_nan=False) + "\n", encoding="utf-8")
