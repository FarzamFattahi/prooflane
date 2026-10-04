from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from prooflane.cli import main


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.baseline = self.directory / "before.png"
        self.candidate = self.directory / "after.png"
        Image.new("RGB", (4, 2), "white").save(self.baseline)
        image = Image.new("RGB", (4, 2), "white")
        image.putpixel((0, 0), (0, 0, 0))
        image.save(self.candidate)

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, *options):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main([str(self.baseline), str(self.candidate), *map(str, options)])
        return code, out.getvalue(), err.getvalue()

    def test_budget_strictly_greater_and_stdout_json(self):
        code, output, error = self.run_cli("--fail-above", "12.5")
        self.assertEqual(code, 0)
        report = json.loads(output)
        self.assertEqual(report["changedPercent"], 12.5)
        self.assertEqual(report["omittedPixels"], 1)
        self.assertEqual(error, "")
        self.assertEqual(self.run_cli("--fail-above", "12.4")[0], 1)

    def test_report_and_png_still_written_when_budget_fails(self):
        report, diff = self.directory / "report.json", self.directory / "diff.any"
        code, stdout, stderr = self.run_cli("--output", report, "--diff", diff, "--fail-above", 0)
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")
        self.assertIn("12.5000%", stderr)
        self.assertEqual(json.loads(report.read_text())["baseline"], "before.png")
        with Image.open(diff) as image:
            self.assertEqual(image.format, "PNG")
            self.assertEqual(image.size, (4, 2))
            self.assertEqual(image.getpixel((1, 0)), (255, 255, 255, 255))
            self.assertNotEqual(image.getpixel((0, 0)), (0, 0, 0, 255))

    def test_repeated_ignores(self):
        code, output, _ = self.run_cli("--ignore", "0,0,1,1", "--ignore", "1,0,1,1", "--fail-above", 0)
        self.assertEqual(code, 0)
        report = json.loads(output)
        self.assertEqual(report["ignoredPixels"], 2)
        self.assertEqual(report["changedPixels"], 0)

    def test_input_protection_and_separate_outputs(self):
        original = self.baseline.read_bytes()
        code, _, error = self.run_cli("--output", self.baseline)
        self.assertEqual(code, 2)
        self.assertIn("differ", error)
        self.assertEqual(self.baseline.read_bytes(), original)
        self.assertEqual(self.run_cli("--output", self.directory / "same", "--diff", self.directory / "same")[0], 2)

    def test_invalid_budget_options_missing_input_and_output_directory(self):
        for options in (("--fail-above", "nan"), ("--fail-above", 101), ("--threshold", -1), ("--min-region-pixels", 0), ("--output", self.directory / "missing" / "report.json")):
            with self.subTest(options=options):
                self.assertEqual(self.run_cli(*options)[0], 2)
        self.baseline.unlink()
        self.assertEqual(self.run_cli()[0], 2)

    def test_invalid_ignore_exits_two(self):
        with self.assertRaises(SystemExit) as error, contextlib.redirect_stderr(io.StringIO()):
            self.run_cli("--ignore", "1,2,0,4")
        self.assertEqual(error.exception.code, 2)

    def test_multiframe_input_rejected(self):
        frame = Image.new("RGB", (4, 2), "white")
        frame.save(self.baseline, format="GIF", save_all=True, append_images=[Image.new("RGB", (4, 2), "black")])
        code, _, error = self.run_cli()
        self.assertEqual(code, 2)
        self.assertIn("multi-frame", error)

    def test_exif_orientation_normalized(self):
        exif = Image.Exif()
        exif[274] = 6
        Image.new("RGB", (4, 2), "white").save(self.baseline, exif=exif)
        Image.new("RGB", (2, 4), "white").save(self.candidate)
        code, output, _ = self.run_cli()
        self.assertEqual(code, 0)
        report = json.loads(output)
        self.assertEqual((report["width"], report["height"], report["changedPixels"]), (2, 4, 0))


if __name__ == "__main__":
    unittest.main()
