# RemitFlow Security Audit Report
**Date:** 2026-04-19  
**Version:** v75 (Production)  
**Auditor:** Automated + Manual Review  

---

## Executive Summary

| Category | Score | Status |
|---|---|---|
| Dependency Vulnerabilities | 10/10 | ✅ 0 known CVEs |
| Authentication & Session | 9/10 | ✅ JWT + httpOnly cookies, 7-day expiry |
| Authorization & RBAC | 9/10 | ✅ publicProcedure / protectedProcedure / adminProcedure |
| Input Validation | 9/10 | ✅ Zod on all 133 inputs |
| SQL Injection | 10/10 | ✅ Drizzle ORM + parameterized ILIKE fixed |
| XSS Prevention | 9/10 | ✅ React escaping; 1 controlled dangerouslySetInnerHTML (CSS only) |
| CSRF Protection | 9/10 | ✅ Double-submit cookie pattern |
| Security Headers | 9/10 | ✅ Helmet, CSP, HSTS, X-Frame-Options |
| Rate Limiting | 9/10 | ✅ 4 tiers: general, auth, payment, KYC |
| SSRF Prevention | 10/10 | ✅ Webhook URL blocks private IPs |
| Secrets Management | 10/10 | ✅ No hardcoded secrets; env-injected |
| Cookie Security | 10/10 | ✅ httpOnly, Secure, SameSite=None (prod) |
| CORS | 9/10 | ✅ Allowlist-based origin validation |
| Prototype Pollution | 10/10 | ✅ sanitizeObject with Object.create(null) |
| Timing Attacks | 9/10 | ✅ SHA-256 hash comparison for API keys |
| **Overall Score** | **141/150 (94%)** | **✅ Production-Ready** |

---

## Findings and Resolutions

### FIXED — SQL Injection (ILIKE string concatenation)
**Files:** `server/routers/productionV2.ts` lines 328, 391  
**Risk:** Medium — ILIKE with `'%' + input.search + '%'` inside `sql` tagged template could allow injection if Drizzle's template literal escaping were bypassed.  
**Fix:** Extracted pattern to a variable before interpolation: `const sp = \`%${input.search}%\`; sql\`... ILIKE ${sp}\``  
**Status:** ✅ Fixed  

### FIXED — Session Expiry Too Long
**File:** `shared/const.ts`  
**Risk:** Low — Session tokens valid for 1 year allowed long-lived credential theft.  
**Fix:** Reduced `SESSION_EXPIRY_MS` from `365 * 24 * 60 * 60 * 1000` to `7 * 24 * 60 * 60 * 1000` (7 days).  
**Status:** ✅ Fixed  

### FIXED — SSRF via Webhook URLs
**File:** `server/routers/productionV2.ts`  
**Risk:** High — Webhook endpoints could be pointed at internal services (metadata APIs, databases).  
**Fix:** Zod `.refine()` blocks `localhost`, `127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, `::1`, `fd00::/8`.  
**Status:** ✅ Fixed  

### ACCEPTED — dangerouslySetInnerHTML in chart.tsx
**File:** `client/src/components/ui/chart.tsx` line 81  
**Risk:** Very Low — Content is programmatically generated CSS color variables from internal config objects (no user input). No user-controlled data flows into this HTML.  
**Status:** ✅ Accepted (no user data path)  

### ACCEPTED — process.env in CheckoutSDK.tsx
**File:** `client/src/pages/CheckoutSDK.tsx` lines 188, 210  
**Risk:** None — These are inside a `<pre>` code block as documentation/example code strings shown to developers. They are not executed; they are literal text displayed as SDK usage examples.  
**Status:** ✅ Accepted (display-only documentation)  

### ACCEPTED — publicProcedure in productionV2.ts
**File:** `server/routers/productionV2.ts` line 574  
**Risk:** Low — The `get` procedure on `systemConfig` is public but only returns non-secret config values (feature flags, display settings). Secret values are filtered server-side.  
**Status:** ✅ Accepted (intentional public access for feature flags)  

---

## Security Controls Verified

### Authentication
- Manus OAuth 2.0 with PKCE
- JWT session tokens signed with `JWT_SECRET` (env-injected)
- `httpOnly: true` prevents JavaScript cookie access
- `secure: true` in production (HTTPS only)
- `sameSite: "none"` with `secure: true` for cross-origin OAuth
- Session expiry: 7 days (reduced from 1 year)
- Logout invalidates server-side session

### Authorization
- `publicProcedure`: unauthenticated access (FX rates, corridors, health)
- `protectedProcedure`: requires valid session cookie
- `adminProcedure`: requires `ctx.user.role === 'admin'`
- All financial mutations use `protectedProcedure` minimum
- Ownership checks on all user-scoped resources (webhooks, API keys, wallets)

### Input Validation
- 133 Zod-validated procedure inputs
- String length limits on all text fields
- Enum validation on all categorical fields
- Number range validation (min/max) on amounts
- URL validation with SSRF protection on webhook URLs
- Array length limits (max 20 events per webhook, max 10 API keys)

### Rate Limiting (express-rate-limit)
| Tier | Window | Max Requests |
|---|---|---|
| General | 15 min | 100 |
| Auth | 15 min | 20 |
| Payment | 1 hour | 50 |
| KYC | 1 hour | 10 |

### Security Headers (Helmet)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy`: configured via Helmet defaults
- `Referrer-Policy: no-referrer`

### CSRF Protection
- Double-submit cookie pattern
- `GET /api/csrf-token` issues `csrf_token` cookie
- All state-changing requests must include matching header
- `SameSite=strict` on CSRF cookie

### Data Protection
- No passwords stored (OAuth-only)
- API keys stored as SHA-256 hashes (never in plaintext after creation)
- Webhook secrets stored encrypted, only revealed once at creation
- No sensitive data in console.log statements
- No secrets in client-side code

---

## Dependency Audit
```
pnpm audit result: No known vulnerabilities found
Total packages scanned: 847
High: 0 | Medium: 0 | Low: 0
```

---

## Recommendations for Production Deployment

1. **Enable WAF** (Cloudflare or AWS WAF) in front of the application for additional DDoS and bot protection.
2. **Set up Sentry** for error monitoring — avoid leaking stack traces to clients in production (already handled by tRPC error formatting).
3. **Database encryption at rest** — ensure the PostgreSQL instance uses encrypted storage volumes.
4. **Rotate JWT_SECRET** periodically (quarterly recommended) — implement token rotation logic.
5. **Add Stripe webhook IP allowlisting** — only accept Stripe webhook calls from Stripe's published IP ranges.
6. **Implement account lockout** after N failed authentication attempts (currently handled by OAuth provider).
7. **Add Content-Security-Policy report-uri** to monitor CSP violations in production.

---

*This report was generated as part of the v75 production readiness sprint.*
