from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from prooflane import Rect, compare_images


def white(width: int, height: int) -> np.ndarray:
    return np.full((height, width, 4), 255, dtype=np.uint8)


class ComparisonTests(unittest.TestCase):
    def test_identical_and_strict_threshold(self):
        a = white(2, 1)
        self.assertEqual(compare_images(a, a).changedPixels, 0)
        b = np.zeros_like(a)
        b[:, :, 3] = 255
        self.assertEqual(compare_images(a, b, threshold=1).changedPixels, 0)
        self.assertEqual(compare_images(a, b, threshold=0.999).changedPixels, 2)

    def test_transparency_composites_white_without_rounding(self):
        a = np.array([[[0, 0, 0, 0], [0, 0, 0, 128]]], dtype=np.uint8)
        b = np.array([[[255, 0, 255, 0], [127, 127, 127, 255]]], dtype=np.uint8)
        self.assertEqual(compare_images(a, b, threshold=1e-12).changedPixels, 0)
        b[0, 1, :3] = 126
        self.assertEqual(compare_images(a, b, threshold=0.003).changedPixels, 1)

    def test_union_counts_missing_extents_including_both_absent_corner(self):
        result = compare_images(white(4, 2), white(2, 4), min_region_pixels=1)
        self.assertEqual((result.width, result.height), (4, 4))
        self.assertEqual(result.changedPixels, 12)
        self.assertEqual(result.changedPercent, 75)
        self.assertEqual(result.mask[3, 3], 1)

    def test_exact_ignore_union_clipping_and_all_ignored(self):
        a, b = white(4, 3), white(4, 3)
        b[:, :, :3] = 0
        result = compare_images(a, b, ignores=[Rect(0, 0, 2, 2), Rect(1, 1, 8, 8), Rect(50, 50, 2, 2)])
        self.assertEqual(result.ignoredPixels, 9)
        self.assertEqual((result.changedPixels, result.comparedPixels), (3, 3))
        self.assertEqual(result.changedPercent, 100)
        ignored = compare_images(a, b, ignores=[Rect(0, 0, 4, 3)])
        self.assertEqual(ignored.changedPercent, 0)
        self.assertEqual(ignored.comparedPixels, 0)
        self.assertEqual(ignored.regions, [])

    def test_tile_diagonal_connectivity_real_bounds_counts_and_ids(self):
        a, b = white(48, 48), white(48, 48)
        b[15, 15, :3] = 0
        b[16, 16, :3] = 0
        result = compare_images(a, b, min_region_pixels=1)
        self.assertEqual(len(result.regions), 1)
        region = result.regions[0]
        self.assertEqual((region.x, region.y, region.width, region.height, region.pixels), (15, 15, 2, 2, 2))
        self.assertEqual(region.id, "r-15-15-2-2")

    def test_filtered_changes_stay_in_statistics(self):
        a, b = white(100, 10), white(100, 10)
        b[0, 0, :3] = 0
        b[0, 64:68, :3] = 0
        result = compare_images(a, b, min_region_pixels=3)
        self.assertEqual(result.changedPixels, 5)
        self.assertEqual((result.omittedRegions, result.omittedPixels), (1, 1))
        self.assertEqual(result.regions[0].pixels, 4)

    def test_sort_by_count_then_y_then_x(self):
        a, b = white(160, 80), white(160, 80)
        b[64, 0:2, :3] = 0
        b[0, 64, :3] = 0
        b[0, 128, :3] = 0
        b[64, 128, :3] = 0
        result = compare_images(a, b, min_region_pixels=1)
        self.assertEqual([r.id for r in result.regions], ["r-0-64-2-1", "r-64-0-1-1", "r-128-0-1-1", "r-128-64-1-1"])

    def test_region_limit_keeps_total_and_reports_omissions(self):
        a, b = white(1985, 1985), white(1985, 1985)
        b[::64, ::64, :3] = 0
        result = compare_images(a, b, min_region_pixels=1)
        self.assertEqual(result.changedPixels, 1024)
        self.assertEqual(len(result.regions), 1000)
        self.assertEqual((result.omittedRegions, result.omittedPixels), (24, 24))

    def test_pillow_images_and_json_mask(self):
        result = compare_images(Image.new("RGB", (2, 2), "white"), Image.new("RGB", (2, 2), "black"), min_region_pixels=1)
        payload = result.to_dict(include_mask=True)
        self.assertEqual(payload["mask"], [1, 1, 1, 1])
        self.assertEqual(payload["regions"][0]["pixels"], 4)
        json.dumps(payload, allow_nan=False)

    def test_reject_invalid_options_and_arrays(self):
        a = white(1, 1)
        for threshold in (float("nan"), float("inf"), -1, 1.1, True, "0.1"):
            with self.subTest(threshold=threshold), self.assertRaises(ValueError):
                compare_images(a, a, threshold=threshold)
        for minimum in (0, -1, 1.5, True, 2**53):
            with self.subTest(minimum=minimum), self.assertRaises(ValueError):
                compare_images(a, a, min_region_pixels=minimum)
        for rectangle in (Rect(-1, 0, 1, 1), Rect(0, 0, 0, 1), Rect(0, 0, 1.5, 1), Rect(True, 0, 1, 1)):
            with self.subTest(rectangle=rectangle), self.assertRaises(ValueError):
                compare_images(a, a, ignores=[rectangle])
        for array in (np.zeros((1, 1, 3), dtype=np.uint8), np.zeros((1, 1, 4), dtype=float), np.zeros((0, 1, 4), dtype=np.uint8)):
            with self.subTest(shape=array.shape), self.assertRaises(ValueError):
                compare_images(array, a)

    def test_reject_dimension_and_union_limits(self):
        with self.assertRaises(ValueError):
            compare_images(white(1, 1), white(1, 1), ignores=[Rect(2**53 - 1, 0, 1, 1)])
        with self.assertRaises(ValueError):
            compare_images(white(8193, 1), white(1, 1))
        with self.assertRaises(ValueError):
            compare_images(white(4000, 1), white(1, 4000))


class SharedGoldenTests(unittest.TestCase):
    def test_browser_python_parity(self):
        fixture = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "comparison-golden.json"
        cases = json.loads(fixture.read_text(encoding="utf-8"))["cases"]
        self.assertTrue(cases, "Shared golden cases must not be empty")
        for case in cases:
            with self.subTest(name=case["name"]):
                images = []
                for name in ("baseline", "candidate"):
                    source = case[name]
                    images.append(np.asarray(source["data"], dtype=np.uint8).reshape(source["height"], source["width"], 4))
                options = case.get("options", {})
                result = compare_images(*images, threshold=options.get("threshold", 0.08),
                                        min_region_pixels=options.get("minRegionPixels", 8),
                                        ignores=[Rect(**rect) for rect in options.get("ignores", [])])
                actual = result.to_dict(include_mask=True)
                for key, expected in case["expected"].items():
                    if key == "changedPercent":
                        self.assertAlmostEqual(actual[key], expected, places=12)
                    else:
                        self.assertEqual(actual[key], expected, key)


if __name__ == "__main__":
    unittest.main()
