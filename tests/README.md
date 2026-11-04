# Rendering checks

`rendering.cjs` opens the website and admin panel in Chromium with intercepted API fixtures. It does not connect to MongoDB or use real accounts. It checks loading, retries, categories, safe text rendering, product details, pagination, search, exports, stale responses, message drafts, marketplace totals, college filtering, account ratings and numeric normalization. A public product route check uses a stubbed model to verify seller summaries and private-field removal.

From the project root in PowerShell, install the test browser driver in a temporary folder and run:

```powershell
$testPrefix = Join-Path $env:TEMP 'cirvio-render-check'
npm.cmd install --prefix $testPrefix --no-save --no-package-lock playwright@1.56.1
$env:NODE_PATH = Join-Path $testPrefix 'node_modules'
node tests/rendering.cjs
node tests/admin-mobile.cjs
```

The runner uses installed Google Chrome on Windows. Otherwise install Playwright's Chromium or set `CIRVIO_BROWSER_PATH` to a Chromium executable. The backend's existing dependencies must be installed.

`admin-mobile.cjs` checks every admin section at 320, 390, 768 and 1280 pixels, the mobile menu, card tables, chat filtering and navigation, drafts, failed and duplicate sends, order editing, staff permissions and login. PWA checks use a temporary regular browser profile, a real service worker and Chromium installability checks. Offline recovery is tested with a simulated transport failure; no staff API responses may appear in Cache Storage. Temporary browser profiles are removed after the run.

To investigate a single group in PowerShell, set `$env:ADMIN_TEST_FILTER = 'Manifest'` (or another test-name fragment). Remove it with `Remove-Item Env:ADMIN_TEST_FILTER` before the full run.
