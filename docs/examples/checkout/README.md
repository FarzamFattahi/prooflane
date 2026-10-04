# Checkout comparison example

This is the app's original, deterministic built-in checkout example. The images in this folder are actual inputs and outputs captured from Prooflane, rather than an illustration of supposed results. They are not user-uploaded images.

- `baseline.png`: original checkout screenshot.
- `candidate.png`: revised checkout screenshot.
- `difference.png`: full-resolution pixel difference map produced by the app.
- `workspace-difference.png`: the real comparison panel with region outlines.
- `detail-before.png` / `detail-after.png`: the selected region's actual before/after crops.
- `comparison.json`: the app's exported settings, pixel hashes, statistics, and unreviewed region records.

The candidate changes shipping from Free to $12.00, total from $84.00 to $96.00, the button from green to terracotta, and dispatch from 1–2 to 3–5 business days. All images are 1,120 × 730 pixels. At threshold `.08`, minimum region size `8`, and no exclusions, 15,793 of 817,600 pixels change (1.9316291585%), grouped into four regions.

Orange pixels in the difference map are changed pixels. Grayscale is visual context. Numbered outlines represent spatial groups and the blue outline identifies the selected region; outline colors do not add to changed-pixel statistics. Region decisions in `comparison.json` are intentionally unreviewed.

## Reproduce in the browser

Open [Prooflane](https://farzamfattahi.github.io/prooflane/) and choose **Load example**, or upload `baseline.png` and `candidate.png` as the two inputs. Select **Difference**, inspect the four regions, and export the JSON or PNG.

To regenerate the evidence from a running local app, after `npm ci`:

```sh
node docs/capture-example.mjs http://127.0.0.1:5186/
```

You can also pass a baseline and candidate path after the URL to capture a supplied pair. Those outputs go into `docs/examples/supplied-pair/`; only publish images approved for public sharing.

## Reproduce with Python

From the repository root after installing `./python`:

```sh
prooflane docs/examples/checkout/baseline.png docs/examples/checkout/candidate.png --threshold .08 --min-region-pixels 8 --output comparison.json --diff difference.png
```

The Python engine uses the same pixel and region rules. Its PNG visualization uses a pink candidate overlay, while the browser's PNG uses orange changed pixels over grayscale context; the changed-pixel statistics are the same. JSON records use different packaging fields for the CLI and browser, but share the underlying engine results.
