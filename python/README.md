# Prooflane for Python

Compare image revisions locally, generate exact change statistics, and fail a CI job when a change budget is exceeded. The same deterministic algorithm powers the browser review app. No image upload, API key, model download, or GPU is required.

## Install and run

Requires Python 3.10 or newer. From this directory:

```sh
python -m pip install .
prooflane baseline.png candidate.png --output report.json --diff diff.png
prooflane baseline.png candidate.png --threshold .08 --min-region-pixels 8 --ignore 0,0,200,50 --ignore 100,100,40,40 --fail-above 0.5
```

`python -m prooflane` also works. Omit `--output` to print JSON to standard output; diagnostics go to standard error. Output folders must already exist. Existing output files are replaced, but paths matching either input are rejected. `--diff` writes a PNG showing the candidate on a white union canvas, with changed pixels highlighted in pink.

Exit codes: **0** for success within the optional budget, **1** if `changedPercent` is strictly greater than `--fail-above` (reports are still produced), and **2** for invalid arguments, invalid images, or file errors. The budget is a percentage from 0 to 100. A budget of `0.5` means half a percent.

## Python API

```python
from PIL import Image
from prooflane import Rect, compare_images

with Image.open("before.png") as before, Image.open("after.png") as after:
    result = compare_images(before, after, ignores=[Rect(0, 0, 200, 50)])
print(result.changedPercent)
for region in result.regions:
    print(region.id, region.pixels)
report = result.to_dict()
mask = result.mask  # H×W uint8 array: 1 changed, 0 unchanged or ignored
```

The API also accepts `numpy.uint8` RGBA arrays shaped `(height, width, 4)`. The CLI normalizes EXIF orientation during decoding; the API expects already oriented images.

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
