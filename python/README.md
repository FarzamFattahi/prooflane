# Prooflane for Python

Compare image revisions locally, generate exact change statistics, and fail a CI job when a change budget is exceeded. The same deterministic algorithm powers the browser review app. No image upload, API key, model download, or GPU is required.

## Install and run

Requires Python 3.10 or newer. Install the released wheel:

```sh
python -m pip install https://github.com/FarzamFattahi/prooflane/releases/download/v1.1.0/prooflane-1.1.0-py3-none-any.whl
```

Or install from this directory:

```sh
python -m pip install .
prooflane baseline.png candidate.png --output report.json --diff diff.png
prooflane baseline.png candidate.png --threshold .08 --min-region-pixels 8 --ignore 0,0,200,50 --ignore 100,100,40,40 --fail-above 0.5
```

`python -m prooflane` also works. Omit `--output` to print JSON to standard output; diagnostics go to standard error. Output folders must already exist. Existing output files are replaced, but paths matching either input are rejected. `--diff` writes a PNG showing the candidate on a white union canvas, with changed pixels highlighted in pink.

Exit codes: **0** for success within the optional budget, **1** if `changedPercent` is strictly greater than `--fail-above` (reports are still produced), and **2** for invalid arguments, invalid images, or file errors. The budget is a percentage from 0 to 100. A budget of `0.5` means half a percent.

## Python API

```python
from prooflane import Rect, compare, render_difference, save_report

result = compare("before.png", "after.png", threshold=0.08,
                 min_region_pixels=8, ignores=[Rect(0, 0, 200, 50)])
print(result.changedPercent)
for region in result.regions:
    print(region.id, region.x, region.y, region.width, region.height, region.pixels)
render_difference("after.png", result).save("difference.png")
save_report(result, "report.json")
mask = result.mask  # H×W uint8: 1 changed; 0 unchanged/ignored
```

`compare(baseline, candidate, *, threshold=0.08, min_region_pixels=8, ignores=())` accepts paths (`str` or `Path`), Pillow images, or NumPy uint8 grayscale H×W, RGB H×W×3, and RGBA H×W×4 arrays. Inputs may have different types and sizes. Arrays are RGB: convert OpenCV BGR via `cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)`. Inputs are not modified. File handles are closed before returning, EXIF orientation is normalized, and animated inputs are rejected.

`load_image(source)` returns an owned Pillow RGBA image using the same normalization. `render_difference(candidate, result)` returns a Pillow image; pass the same candidate used in the comparison. `save_report(result, path, include_mask=False)` writes JSON; parent folders must exist and existing output files are replaced. `result.to_dict()` returns statistics without writing files. `include_mask=True` adds a flattened mask and may make reports large.

`Comparison` exposes width, height, changedPixels, comparedPixels, ignoredPixels, changedPercent, regions, omittedRegions, omittedPixels, mask, and durationMs. `Rect(x, y, width, height)` defines exclusions. Each `Region` has id, x, y, width, height, and pixels. Camel-case statistics match the browser JSON contract. Type hints and `py.typed` are included.

The lower-level `compare_images` remains available for already-oriented Pillow images or uint8 RGBA arrays. It intentionally does not normalize EXIF orientation.

### NumPy integration and CI

```python
import numpy as np
from prooflane import compare

before = np.full((100, 100, 3), 255, dtype=np.uint8)
after = before.copy()
after[10:20, 30:40] = 0
result = compare(before, after)
assert result.changedPixels == 100
assert result.changedPercent == 1.0
# In your screenshot regression job:
if result.changedPercent > 0.5:
    raise SystemExit("Visual change budget exceeded")
```

Errors raise `ValueError` for unsupported arrays/options/dimensions or multi-frame images, `TypeError` for unsupported source types, and Pillow/OSError exceptions for unreadable files. The CLI converts these to exit code 2. Reports are engine output; browser review decisions and interactive HTML handoffs belong to the browser application.

## What is measured

Images align at the top left without resizing. The canvas uses the largest width and largest height; all pixels outside either input count as changed, including union corners outside both. Overlapping pixels composite over white and use weighted RGB RMS distance: `sqrt(.2126*dr² + .7152*dg² + .0722*db²)/255`. Distance must be strictly greater than the threshold to count as a change.

Ignore rectangles use integer half-open coordinates `x,y,width,height`, clip to the canvas, and exclude their pixels from both the numerator and denominator. Overlapping ignores count once. If all pixels are ignored, `changedPercent` is zero.

Changed pixels are grouped through occupied 16×16 tiles with eight-neighbor connectivity. Region bounds and counts describe actual changed pixels; grouping can bridge separate nearby shapes in adjacent tiles. Regions sort by decreasing pixel count, then top and left coordinates. Stable coordinate IDs take the form `r-x-y-width-height`. Region filtering affects only the displayed list; total changes still include filtered pixels. `omittedRegions` and `omittedPixels` account for filtered regions and the 1,000-region display limit.

Input dimensions must be 1–8,192 pixels per side and the union canvas must contain at most 12,000,000 pixels. Animated or multi-frame CLI inputs are rejected; export a single frame first.

This is a pixel comparison tool, not semantic vision: it does not recognize objects, infer whether a change is correct, align shifted screenshots, or compensate for rendering noise. Color profiles and decoder differences can affect comparisons across image formats; lossless PNG screenshots are recommended for consistent CI runs. Alpha-only differences that look identical over white do not count. It does not apply anti-aliasing heuristics or SSIM. Reports contain filenames, comparison options, coordinates, counts, and elapsed computation time; they contain no source image pixels.

## Tests

From this directory after installing:

```sh
python -m unittest discover -s tests -v
```

Tests cover thresholds, alpha, dimension changes, ignores, region bounds/order/limits, CLI exit behavior, and the repository's shared browser/Python golden fixtures.

License: MIT. Author: Farzam Fattahi.
