# Test Report: Cache Busting on Deployment (PR #5)

**Summary:** Ran build verification, dev server HTTP endpoints, deploy script execution, and code inspection. 8/9 tests passed; 1 bug found (SW stamping no-op).

## Results

- **Test 1: Content-hash filenames** — passed (495 JS + 1 CSS, all with hash suffixes like `ABTestingAdmin-B1LhT1Su.js`)
- **Test 2: Build manifest** — passed (`build-manifest.json` has correct 12-hex hash, version, ISO timestamp)
- **Test 3: /api/version endpoint** — passed (HTTP 200, returns `{"hash":"dev","version":"dev"}` in dev mode, `Cache-Control: no-store`)
- **Test 4: Cache headers** — passed (`sw.js` → `no-cache`, `manifest.json` → `no-cache`, API → `no-store`)
- **Test 5: Deploy script SW stamping** — **FAILED (bug)** — `sed` reports success but `CACHE_VERSION` not found in dist/public/sw.js before or after. VitePWA's `generateSW` overwrites custom sw.js with Workbox SW.
- **Test 6: TypeScript compilation** — passed (0 errors)
- **Test 7: Unit test regression** — passed (1524/1528 pass; 4 pre-existing failures: 2 beneficiaries.add, 2 Go FX Aggregator port 8081)
- **Test 8: useVersionCheck hook** — passed (all 7 behavioral checks: 5min poll, visibilitychange, SW_UPDATED listener, reload, no-store fetch, error handling, reg.update)
- **Test 9: CDN purge flags** — passed (graceful skip for all 3 providers when env vars not set, exit 0)

## Escalation: SW Stamping Bug

The deploy script `ops/deploy/cache-bust.sh` has a silent failure:

```
Before stamp: grep -c "CACHE_VERSION" dist/public/sw.js → 0
Script output: "✓ SW CACHE_VERSION set to 'v-1ab6ce7b3575'"
After stamp:  grep -c "CACHE_VERSION" dist/public/sw.js → 0
```

**Root cause:** VitePWA is configured with `generateSW` mode (default when no `srcSW` specified). At build time, it generates a Workbox-based service worker that completely replaces `client/public/sw.js`. The generated SW uses Workbox's precache manifest (which does have content hashes for cache busting), but it does NOT contain the `const CACHE_VERSION = '...'` line that the deploy script's `sed` targets.

**Impact:** The custom caching strategies defined in `client/public/sw.js` (FX rate caching, API caching, community/revenue-share caches, offline sync) are NOT present in the production build. Only Workbox's default precaching applies.

**Fix options:**
1. Switch VitePWA to `injectManifest` mode with `srcSW: "client/public/sw.js"` so the custom SW is preserved
2. Or modify the deploy script to stamp the Workbox SW's precache revision instead

## Evidence

```
# Test 1: Content-hash filenames
$ ls dist/public/assets/*.js | head -3
ABTestingAdmin-B1LhT1Su.js
ABTestingDashboard-ZrnrUHAo.js
AIChatBox-9qeN4AzP.js

# Test 2: Build manifest
$ cat dist/public/build-manifest.json
{"hash":"1ab6ce7b3575","timestamp":"2026-06-19T14:07:31Z","version":"v-1ab6ce7b3575"}

# Test 3: /api/version
$ curl -s http://localhost:3001/api/version
{"hash":"dev","timestamp":"2026-06-19T14:03:26.683Z","version":"dev"}
$ curl -sI http://localhost:3001/api/version | grep Cache-Control
Cache-Control: no-store

# Test 4: Cache headers
$ curl -sI http://localhost:3001/sw.js | grep Cache-Control
Cache-Control: no-cache
$ curl -sI http://localhost:3001/manifest.json | grep Cache-Control
Cache-Control: no-cache

# Test 5: SW stamping bug
$ grep -c "CACHE_VERSION" dist/public/sw.js
0  (before AND after stamp)

# Test 6: TypeScript
$ npx tsc --noEmit → exit 0

# Test 7: vitest
Test Files: 2 failed | 54 passed (56)
Tests: 4 failed | 1524 passed (1528)
(all failures pre-existing)

# Test 9: CDN purge
$ ./ops/deploy/cache-bust.sh --purge-cdn --dry-run
⚠ Cloudflare: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not set — skipping
⚠ CloudFront: CLOUDFRONT_DISTRIBUTION_ID not set — skipping
⚠ Fastly: FASTLY_SERVICE_ID or FASTLY_API_KEY not set — skipping
```
