import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from prooflane import compare, load_image, render_difference, save_report


class PublicApiTests(unittest.TestCase):
    def test_paths_arrays_exports_and_owned_images(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            before = np.full((20, 20, 3), 255, dtype=np.uint8)
            after = before.copy()
            after[2:6, 3:8] = 0
            Image.fromarray(before).save(root / "before.png")
            Image.fromarray(after).save(root / "after.png")
            result = compare(root / "before.png", root / "after.png")
            self.assertEqual(result.changedPixels, 20)
            self.assertEqual(compare(before, after).changedPixels, 20)
            self.assertEqual(result.regions[0].pixels, 20)
            save_report(result, root / "report.json", include_mask=True)
            report = json.loads((root / "report.json").read_text())
            self.assertEqual(sum(report["mask"]), 20)
            diff = render_difference(root / "after.png", result)
            self.assertEqual(diff.getpixel((0, 0)), (255, 255, 255, 255))
            self.assertNotEqual(diff.getpixel((3, 2)), (0, 0, 0, 255))
            diff.save(root / "difference.png")
            loaded = load_image(root / "before.png")
            (root / "before.png").unlink()
            self.assertEqual(loaded.getpixel((0, 0)), (255, 255, 255, 255))

    def test_grayscale_and_exif_orientation(self):
        pixels = np.zeros((2, 3), dtype=np.uint8)
        self.assertEqual(compare(pixels, pixels).changedPixels, 0)
        image = Image.new("RGB", (3, 2))
        image.getexif()[274] = 6
        self.assertEqual(load_image(image).size, (2, 3))

    def test_invalid_arrays_and_multiframe(self):
        for image in (np.zeros((2, 2, 2), dtype=np.uint8), np.zeros((2, 2, 3))):
            with self.assertRaises(ValueError):
                load_image(image)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "animated.gif"
            Image.new("RGB", (2, 2), "white").save(
                path, save_all=True, append_images=[Image.new("RGB", (2, 2), "black")])
            with self.assertRaises(ValueError):
                load_image(path)

    def test_workers_agrees_with_browser_export(self):
        root = Path(__file__).resolve().parents[2] / "docs/examples/workers"
        if not root.exists():
            self.skipTest("repository example is not installed with the wheel")
        result = compare(root / "baseline.png", root / "candidate.png")
        report = json.loads((root / "comparison.json").read_text())
        for key, value in report["summary"].items():
            self.assertEqual(getattr(result, key), value)
        self.assertEqual([r.id for r in result.regions], [r["id"] for r in report["regions"]])
