"""Command-line entry point: local files in, JSON/diff files out."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .engine import Rect, compare_images
from .api import load_image, render_difference


def _ignore(value: str) -> Rect:
    try:
        fields = value.split(",")
        if len(fields) != 4:
            raise ValueError("expected four comma-separated integers")
        rectangle = Rect(*(int(field) for field in fields))
        rectangle.validate()
        return rectangle
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid --ignore {value!r}: {exc}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare two images locally and export exact pixel-change statistics.")
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--output", type=Path, help="Write a JSON report (otherwise print JSON to stdout)")
    parser.add_argument("--diff", type=Path, help="Write a PNG candidate image with changed pixels highlighted")
    parser.add_argument("--threshold", type=float, default=0.08, help="Weighted RGB distance threshold, 0..1 (default: .08)")
    parser.add_argument("--min-region-pixels", type=int, default=8, help="Minimum displayed region size (default: 8)")
    parser.add_argument("--ignore", type=_ignore, action="append", default=[], metavar="X,Y,W,H")
    parser.add_argument("--fail-above", type=float, metavar="PERCENT", help="Exit 1 when changed percentage exceeds this limit, 0..100")
    args = parser.parse_args(argv)
    try:
        if args.fail_above is not None and (not math.isfinite(args.fail_above) or not 0 <= args.fail_above <= 100):
            raise ValueError("--fail-above must be finite and between 0 and 100")
        inputs = {args.baseline.resolve(), args.candidate.resolve()}
        outputs = [path.resolve() for path in (args.output, args.diff) if path is not None]
        if any(path in inputs for path in outputs):
            raise ValueError("Output paths must differ from both input paths")
        if len(outputs) != len(set(outputs)):
            raise ValueError("JSON report and diff PNG need separate output paths")
        baseline, candidate = load_image(args.baseline), load_image(args.candidate)
        result = compare_images(baseline, candidate, threshold=args.threshold,
                                min_region_pixels=args.min_region_pixels, ignores=args.ignore)
        report = result.to_dict()
        report.update({
            "schemaVersion": 1,
            "baseline": args.baseline.name,
            "candidate": args.candidate.name,
            "options": {"threshold": args.threshold, "minRegionPixels": args.min_region_pixels,
                        "ignores": [vars(rect) for rect in args.ignore]},
        })
        payload = json.dumps(report, indent=2, allow_nan=False) + "\n"
        if args.diff:
            render_difference(candidate, result).save(args.diff, format="PNG")
        if args.output:
            args.output.write_text(payload, encoding="utf-8")
            print(f"{result.changedPixels:,} / {result.comparedPixels:,} pixels changed ({result.changedPercent:.4f}%). Report: {args.output}", file=sys.stderr)
        else:
            print(payload, end="")
        return int(args.fail_above is not None and result.changedPercent > args.fail_above)
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        print(f"prooflane: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
