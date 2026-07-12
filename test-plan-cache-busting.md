# Test Plan: Cache Busting on Deployment (PR #5)

## What Changed
- Vite build config: explicit content-hash filenames (`[name]-[hash].js/css`)
- Vite plugin: `vitePluginBuildMetadata()` injects `__BUILD_HASH__`/`__BUILD_TIMESTAMP__`, writes `build-manifest.json`
- Express: `cacheBustingHeaders()` middleware + `/api/version` endpoint in `server/_core/vite.ts`
- Service worker: `KNOWN_CACHE_PREFIXES`, stale cache cleanup on activate, `SW_UPDATED` postMessage
- Client: `useVersionCheck` hook polls `/api/version` every 5min
- Deploy script: `ops/deploy/cache-bust.sh` stamps SW + purges CDN
- CI/CD: `cache-bust` job in `deploy.yml`

## Test Environment
- Dev server at `http://localhost:3001` (dev mode, Vite middleware)
- Production build at `dist/public/` (already built)
- Deploy script at `ops/deploy/cache-bust.sh`

---

## Test 1: Build Outputs Have Content-Hash Filenames

**Action:** Inspect `dist/public/assets/` directory after `npm run build`.

**Pass criteria:**
- ALL `.js` files match pattern `[name]-[a-zA-Z0-9]{8}.js` (8-char hash suffix)
- ALL `.css` files match pattern `[name]-[a-zA-Z0-9]{8}.css`
- Zero files without a hash suffix in the assets/ directory (excluding .map files)

**Fail if:** Any `.js` or `.css` file in `assets/` lacks a hash suffix.

---

## Test 2: Build Manifest Written Correctly

**Action:** Read `dist/public/build-manifest.json` after build.

**Pass criteria:**
- File exists
- JSON has exactly 3 keys: `hash`, `timestamp`, `version`
- `hash` is a 12-character hex string matching `/^[a-f0-9]{12}$/`
- `version` equals `"v-" + hash`
- `timestamp` is valid ISO 8601

**Fail if:** File missing, keys wrong, hash not 12 hex chars, or version doesn't match `v-{hash}`.

---

## Test 3: /api/version Endpoint

**Action:** `curl -s http://localhost:3001/api/version`

**Pass criteria:**
- HTTP 200
- Response body is JSON with `hash`, `timestamp`, `version` keys
- In dev mode: `hash` = `"dev"`, `version` = `"dev"`
- `Cache-Control` header = `no-store` (verified via `curl -I`)

**Fail if:** Endpoint returns 404, missing keys, or wrong Cache-Control header.

---

## Test 4: Cache Headers — sw.js and manifest.json Served with no-cache

**Action:** `curl -I http://localhost:3001/sw.js` and `curl -I http://localhost:3001/manifest.json`

**Pass criteria:**
- `Cache-Control` header contains `no-cache` for both files

**Fail if:** Cache-Control is missing, or set to `max-age` > 0, or `immutable`.

---

## Test 5: Deploy Script — SW Stamping Bug (EXPECTED FAILURE)

**Action:** Run `npm run build` then `./ops/deploy/cache-bust.sh` and inspect `dist/public/sw.js` for `CACHE_VERSION`.

**Pass criteria (for the script running):**
- Script exits 0
- Reports a build hash and "Cache busting complete"
- Writes `build-manifest.json` with new hash

**KNOWN BUG — SW stamping is a no-op:**
- VitePWA generates a Workbox-based SW that overwrites `client/public/sw.js`
- The generated SW does NOT contain `const CACHE_VERSION = '...'`
- Therefore `sed` finds no match and the SW is NOT stamped
- Verify: `grep -c "CACHE_VERSION" dist/public/sw.js` should return `0`

**Fail if:** The script crashes or `build-manifest.json` is not written.

---

## Test 6: TypeScript Compilation

**Action:** `npx tsc --noEmit`

**Pass criteria:** Exit code 0, zero errors.

**Fail if:** Any TypeScript error.

---

## Test 7: Unit Tests Regression

**Action:** `npx vitest run`

**Pass criteria:** 
- 1526+ tests pass
- Only 2 pre-existing failures (`beneficiaries.add`)
- No new failures related to cache busting changes

**Fail if:** New test failures appear.

---

## Test 8: useVersionCheck Hook — Code Inspection

**Action:** Read `client/src/hooks/useVersionCheck.ts` and verify:

**Pass criteria:**
- Polls `/api/version` every 5 minutes (`VERSION_CHECK_INTERVAL = 5 * 60 * 1000`)
- Checks on `visibilitychange` event
- Listens for `SW_UPDATED` message → `window.location.reload()`
- Uses `cache: "no-store"` on fetch
- Gracefully handles network errors (try/catch)

**Fail if:** Missing any of the above behaviors.

---

## Test 9: Deploy Script — CDN Purge Flags

**Action:** Run `./ops/deploy/cache-bust.sh --purge-cdn --dry-run`

**Pass criteria:**
- Script reports CDN providers as skipped (env vars not set)
- Specifically prints messages about CLOUDFLARE_ZONE_ID, CLOUDFRONT_DISTRIBUTION_ID, FASTLY_SERVICE_ID not being set
- Does NOT crash when CDN env vars are missing

**Fail if:** Script crashes or attempts real CDN purge without credentials.

---

## Escalation: SW Stamping Bug

The deploy script's `sed` command to stamp `CACHE_VERSION` is ineffective because VitePWA's `generateSW` mode produces a Workbox-based service worker that replaces the custom `client/public/sw.js`. The custom SW's `CACHE_VERSION` line does not exist in the production build output.

This means: **the service worker is NOT cache-busted by the deploy script**. The Workbox SW has its own precache manifest with content hashes, which provides *some* cache busting, but the custom caching strategies (FX rates, API, community, revenue share) defined in the custom SW are lost entirely in production builds.
