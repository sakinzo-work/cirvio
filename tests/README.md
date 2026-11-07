# Rendering checks

`rendering.cjs` opens the website and admin panel in Chromium with intercepted API fixtures. It does not connect to MongoDB or use real accounts. It checks loading, retries, categories, safe text rendering, product details, pagination, search, exports, stale responses, message drafts, marketplace totals, college filtering, account ratings and numeric normalization. A public product route check uses a stubbed model to verify seller summaries and private-field removal.

From the project root in PowerShell, install the test browser driver in a temporary folder and run:

```powershell
$testPrefix = Join-Path $env:TEMP 'cirvio-render-check'
npm.cmd install --prefix $testPrefix --no-save --no-package-lock playwright@1.56.1
$env:NODE_PATH = Join-Path $testPrefix 'node_modules'
node tests/rendering.cjs
node tests/admin-mobile.cjs
node tests/messaging-api.cjs
node tests/notifications-categories.cjs
node tests/listing-lifecycle.cjs
```

The runner uses installed Google Chrome on Windows. Otherwise install Playwright's Chromium or set `CIRVIO_BROWSER_PATH` to a Chromium executable. The backend's existing dependencies must be installed.

`admin-mobile.cjs` checks every admin section at 320, 390, 768 and 1280 pixels, the mobile menu, card tables, chat filtering and navigation, drafts, failed and duplicate sends, order editing, staff permissions and login. PWA checks use a temporary regular browser profile, a real service worker and Chromium installability checks. Offline recovery is tested with a simulated transport failure; no staff API responses may appear in Cache Storage. Temporary browser profiles are removed after the run.

To investigate a single group in PowerShell, set `$env:ADMIN_TEST_FILTER = 'Manifest'` (or another test-name fragment). Remove it with `Remove-Item Env:ADMIN_TEST_FILTER` before the full run.

Messaging checks cover recipient search, starting/reopening private chats from Users and listing reviews, search/open failures, phone and desktop layouts, and user replies without a product. `messaging-api.cjs` exercises the actual authenticated Express routes and Mongoose validation with isolated model adapters: concurrent opens, the unique conversation index, literal search, input limits, staff access, private participant isolation and legacy group chats. It also checks that the website worker bypasses private API calls and preserves the admin cache during updates. It requires only the backend dependencies.

Category and notification checks exercise school streams, degree/master's courses and years, general item types, clearing incompatible fields, draft/publish persistence, notification counts and chat links, explicit push permission, denied permission, failed subscription setup and opt-out. `notifications-categories.cjs` validates the actual category/subscription API routes, private-key handling, recipient selection, expired subscriptions and both worker click handlers. Browser push tests use a mocked push manager; no real push notification is sent. Device delivery must be checked on the deployed HTTPS app after enabling notifications.

Use `$env:RENDER_TEST_FILTER = 'Push alerts'` to run one browser group; remove that environment variable before a full rendering run.

Use `$env:RENDER_TEST_FILTER = 'Notification'` for the visit popup and Settings controls. These checks cover guest sign-in, a click before requesting browser permission, 320/390/768-pixel popup layouts, Not now and Escape dismissal, a seven-day reminder delay, persisted opt-out, unsupported browsers, reloading an enabled subscription, failed setup, duplicate clicks and staff Settings. Push setup remains mocked; no real phone alerts are sent.

`listing-lifecycle.cjs` runs authenticated review, approval, edit, checkout and notification-history routes against isolated model adapters and real schema validation. It checks deduplicated views/decisions, review resets, owner-only history/read state, invalid and failed checkout rollback, competing buyers, durable order notification retries and seller-order privacy. Browser checks cover the mobile milestone tracker, notification links, buyer-detail retries, persisted reads, no synthetic chat messages, and duplicate checkout prevention. Worker checks cover all listing alert types and focusing an existing status window. No test sends a real push or touches production data.

User-initiated admin chats are covered by `messaging-api.cjs`: no listing, authenticated ownership, first/repeated/concurrent sends, shared staff conversation keys, participant isolation and notification queuing. It also verifies staff-only profile access, contact/photo/ID fields, invalid/missing users and exclusion of credentials/ratings. Use `$env:RENDER_TEST_FILTER = 'User'` to check 320/1280-pixel support chats, drafts after failure, duplicate sends, stale inbox responses, reloads, profile photos/fallbacks, safe text, profile retries and navigation from Users, chats and listing review. These use fixture accounts only.
