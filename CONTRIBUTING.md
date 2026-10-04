# Contributing

Useful contributions include small reproducible bug reports, accessibility improvements, image-decoding edge cases, and tests that protect the comparison contract.

Before a large feature, open an issue explaining the use case and tradeoffs. Avoid adding remote processing or telemetry as a default: local image processing is central to the application.

## Development

Use Node.js 22.12 or newer, then run:

```sh
npm ci
npm run dev
```

Before submitting changes:

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
python -m pip install -e ./python
python -m unittest discover -s python/tests -v
```

On Windows, the browser tests use an installed Microsoft Edge. CI uses Chromium and exercises the production build. Set `E2E_PREVIEW=1` to exercise the built production app locally instead of the development server (PowerShell: `$env:E2E_PREVIEW='1'`). Browser tests create small synthetic images and check application behavior; engine and Python tests share golden fixtures.

Read [the engine contract](docs/CONTRACT.md) before changing comparison math. If a comparison rule changes, update both implementations, fixtures, and documentation together. Decisions must be cleared whenever the underlying comparison changes.

Describe the problem, resulting behavior, and checks run in your pull request. Include a screenshot for visible UI changes. Keep sample screenshots synthetic and free of personal information.
