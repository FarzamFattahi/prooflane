# Farzam's workers comparison

The original user-supplied JPEG files are preserved as `baseline.jpg` (the filename starting with `hhardworking`) and `candidate.jpg` (the edited filename starting with `hardworking`). PNGs are the browser-decoded comparison inputs, not generated substitutes. These user-supplied third-party example photographs are separate from the MIT-licensed software; no ownership of the underlying photography is claimed.

`comparison.json`, `difference.png`, and `workspace-difference.png` come from the actual browser app at threshold 0.08 / minimum region size 8. Python verifies the same 2,620 changed pixels and seven region IDs against the decoded PNGs.

```python
from prooflane import compare, render_difference, save_report
result = compare("docs/examples/workers/baseline.png", "docs/examples/workers/candidate.png")
assert result.changedPixels == 2620
assert len(result.regions) == 7
render_difference("docs/examples/workers/candidate.png", result).save("workers-python-diff.png")
save_report(result, "workers-python-report.json")
```

Python and browser difference images use different highlight styles. JPEG decoders may differ slightly across platforms; use the included lossless PNGs to reproduce exact counts.
