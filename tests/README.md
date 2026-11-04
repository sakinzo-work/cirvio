# Rendering checks

`rendering.cjs` opens the website and admin panel in Chromium with intercepted API fixtures. It does not connect to MongoDB or use real accounts. It checks loading, retries, categories, safe text rendering, product details, pagination, search, exports, stale responses, message drafts, marketplace totals, college filtering, account ratings and numeric normalization. A public product route check uses a stubbed model to verify seller summaries and private-field removal.

From the project root in PowerShell, install the test browser driver in a temporary folder and run:

```powershell
$testPrefix = Join-Path $env:TEMP 'cirvio-render-check'
npm.cmd install --prefix $testPrefix --no-save --no-package-lock playwright@1.56.1
$env:NODE_PATH = Join-Path $testPrefix 'node_modules'
node tests/rendering.cjs
```

The runner uses installed Google Chrome on Windows. Otherwise install Playwright's Chromium or set `CIRVIO_BROWSER_PATH` to a Chromium executable. The backend's existing dependencies must be installed.
