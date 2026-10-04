"""Run: python python/examples/compare_pair.py before.png after.png output-folder"""
import argparse
from pathlib import Path

from prooflane import compare, render_difference, save_report

parser = argparse.ArgumentParser(description="Compare a pair using the installed Python library")
parser.add_argument("baseline", type=Path)
parser.add_argument("candidate", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
outputs = [args.output / "report.json", args.output / "difference.png"]
if any(path.resolve() in {args.baseline.resolve(), args.candidate.resolve()} for path in outputs):
    parser.error("outputs must not overwrite either input")
result = compare(args.baseline, args.candidate)
save_report(result, outputs[0])
render_difference(args.candidate, result).save(outputs[1])
print(f"{result.changedPixels:,} changed pixels ({result.changedPercent:.3f}%), {len(result.regions)} regions")
