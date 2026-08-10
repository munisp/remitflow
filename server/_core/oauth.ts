/**
 * OAuth / OIDC Routes
 *
 * Supports two modes:
 *  1. Keycloak OIDC  — when KEYCLOAK_URL is set (production / staging)
 *  2. Dev-login bypass — when KEYCLOAK_URL is absent (local sandbox / demo)
 *
 * The session cookie and JWT layer (sdk.ts) are unchanged in both modes.
 */

import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import {
  buildKeycloakAuthUrl,
  exchangeKeycloakCode,
  generatePkce,
  getKeycloakUserInfo,
  isKeycloakConfigured,
} from "./keycloak";
import { keycloakSessionTtlMs, sdk } from "./sdk";
import { logger } from "./logger";

/** httpOnly cookie holding the PKCE verifier between login initiation and callback. */
const PKCE_VERIFIER_COOKIE = "kc_pkce_verifier";
/** httpOnly cookie holding the Keycloak refresh token for session rotation. */
const REFRESH_TOKEN_COOKIE = "kc_refresh_token";
const PKCE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const sep = part.indexOf("=");
    if (sep <= 0) continue;
    if (part.slice(0, sep).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(sep + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolve the OIDC redirect_uri for login initiation. Absolute URIs are only
 * accepted on this server's own origin — anything else is rejected loudly to
 * prevent the endpoint from being used as an open-redirect oracle.
 */
function resolveRedirectUri(req: Request): string {
  const origin = `${req.protocol}://${req.get("host")}`;
  const raw = getQueryParam(req, "redirect_uri");
  if (!raw) return `${origin}/api/oauth/callback`;
  if (raw.startsWith("/") && !raw.startsWith("//")) return `${origin}${raw}`;
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host === req.get("host")) {
      return parsed.toString();
    }
  } catch { /* fall through to error */ }
  throw new Error("redirect_uri must be a relative path or an absolute URL on this server's origin");
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/** Generate and set the CSRF double-submit cookie on the response. */
function setCsrfCookie(req: Request, res: Response): string {
  const token = crypto.randomBytes(32).toString("hex");
  const baseOpts = getSessionCookieOptions(req);
  res.cookie("csrf_token", token, {
    ...baseOpts,
    // CSRF cookie must be readable by JS (not httpOnly) so the client can send it as a header
    httpOnly: false,
    maxAge: ONE_YEAR_MS,
    sameSite: (baseOpts.sameSite as any) ?? "lax",
  });
  return token;
}

export function registerOAuthRoutes(app: Express) {
  // ─── CSRF token endpoint ───────────────────────────────────────────────────
  // GET /api/csrf-token — issues a fresh CSRF cookie and returns the token in JSON.
  app.get("/api/csrf-token", (req: Request, res: Response) => {
    const token = setCsrfCookie(req, res);
    res.json({ csrfToken: token });
  });

  // ─── Keycloak login initiation (KC3) ───────────────────────────────────────
  // GET /api/auth/keycloak/login?redirect_uri=<optional>&redirect=1
  //
  // Starts the OIDC authorization-code + PKCE flow. Generates the PKCE
  // verifier/challenge server-side, stores the verifier in a short-lived
  // httpOnly cookie (bound to the callback), and returns the Keycloak
  // authorization URL for the frontend to navigate to.
  //
  // Response contract (200):
  //   {
  //     authorizationUrl: string  // navigate the browser here
  //     state: string             // base64(redirect_uri), echoed back by Keycloak
  //     pkceMethod: "S256"
  //     expiresIn: 600            // seconds the PKCE verifier cookie remains valid
  //   }
  // Errors: 503 when Keycloak is not configured, 400 for an invalid redirect_uri.
  // With ?redirect=1 the endpoint responds 302 to authorizationUrl instead of JSON.
  app.get("/api/auth/keycloak/login", (req: Request, res: Response) => {
    if (!isKeycloakConfigured()) {
      res.status(503).json({ error: "Keycloak login is not configured on this server" });
      return;
    }
    try {
      const redirectUri = resolveRedirectUri(req);
      // state encodes the redirect_uri (base64) — the callback's standing convention
      const state = Buffer.from(redirectUri, "utf8").toString("base64");
      const pkce = generatePkce();

      const baseOpts = getSessionCookieOptions(req);
      res.cookie(PKCE_VERIFIER_COOKIE, pkce.verifier, {
        ...baseOpts,
        httpOnly: true,
        maxAge: PKCE_COOKIE_MAX_AGE_MS,
        sameSite: (baseOpts.sameSite as any) ?? "lax",
      });

      const authorizationUrl = buildKeycloakAuthUrl(redirectUri, state, {
        challenge: pkce.challenge,
        method: "S256",
      });

      if (getQueryParam(req, "redirect") === "1") {
        res.redirect(302, authorizationUrl);
        return;
      }
      res.json({
        authorizationUrl,
        state,
        pkceMethod: "S256",
        expiresIn: PKCE_COOKIE_MAX_AGE_MS / 1000,
      });
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, "[Auth] Keycloak login initiation rejected");
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─── Session refresh via Keycloak refresh-token rotation (KC1) ─────────────
  // POST /api/auth/refresh — exchanges the httpOnly refresh-token cookie for a
  // new access token, re-mints the short-lived session cookie, and rotates the
  // refresh cookie (Keycloak revokeRefreshToken=true issues a fresh refresh
  // token on every use). 401 + cleared cookies when rotation fails.
  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    if (!isKeycloakConfigured()) {
      res.status(400).json({ error: "Keycloak is not configured on this server" });
      return;
    }
    const refreshToken = getCookie(req, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      res.status(401).json({ error: "No refresh token present" });
      return;
    }
    try {
      const { refreshAccessToken } = await import("../integrations/keycloak/enhanced");
      const tokens = await refreshAccessToken(refreshToken);
      const userInfo = await getKeycloakUserInfo(tokens.accessToken);

      await db.upsertUser({
        openId: userInfo.sub,
        name: userInfo.name ?? userInfo.preferred_username ?? null,
        email: userInfo.email ?? null,
        loginMethod: "keycloak",
        lastSignedIn: new Date(),
      });

      const sessionTtlMs = Math.max(30_000, Math.min(tokens.expiresIn * 1000, keycloakSessionTtlMs()));
      const sessionToken = await sdk.createSessionToken(userInfo.sub, {
        name: userInfo.name ?? userInfo.preferred_username ?? "",
        expiresInMs: sessionTtlMs,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: sessionTtlMs });
      if (tokens.refreshToken) {
        // Rotate the refresh token cookie — the old one has been revoked by Keycloak.
        const refreshMaxAgeMs = (tokens.refreshExpiresIn ?? 1800) * 1000;
        res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
          ...cookieOptions,
          httpOnly: true,
          maxAge: refreshMaxAgeMs,
        });
      }
      res.json({ success: true, expiresIn: sessionTtlMs / 1000 });
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, "[Auth] Session refresh failed — clearing auth cookies");
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(COOKIE_NAME, cookieOptions);
      res.clearCookie(REFRESH_TOKEN_COOKIE, cookieOptions);
      res.status(401).json({ error: "Session refresh failed — please log in again" });
    }
  });

  // ─── Keycloak OIDC callback ────────────────────────────────────────────────
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      let openId: string;
      let name: string | null = null;
      let email: string | null = null;
      let loginMethod: string | null = null;
      let sessionTtlMs = ONE_YEAR_MS;
      let keycloakRefresh: { token: string; maxAgeMs: number } | null = null;

      if (isKeycloakConfigured()) {
        // ── Keycloak OIDC flow ──────────────────────────────────────────────
        // state encodes the redirect_uri (base64) — same convention as before
        const redirectUri = atob(state);
        // PKCE: the verifier was stored in an httpOnly cookie at login initiation.
        const codeVerifier = getCookie(req, PKCE_VERIFIER_COOKIE);
        const tokens = await exchangeKeycloakCode(code, redirectUri, codeVerifier);
        // The verifier is single-use — clear it immediately after the exchange.
        res.clearCookie(PKCE_VERIFIER_COOKIE, getSessionCookieOptions(req));
        const userInfo = await getKeycloakUserInfo(tokens.access_token);

        openId = userInfo.sub;
        name = userInfo.name ?? userInfo.preferred_username ?? null;
        email = userInfo.email ?? null;
        loginMethod = "keycloak";
        // KC1: the app session mirrors the realm access-token lifetime instead
        // of a 1-year cookie; continuity comes from refresh-token rotation.
        sessionTtlMs = Math.max(30_000, tokens.expires_in * 1000);
        if (tokens.refresh_token) {
          keycloakRefresh = {
            token: tokens.refresh_token,
            maxAgeMs: (tokens.refresh_expires_in ?? 1800) * 1000,
          };
        }
      } else {
        // ── Legacy Manus OAuth flow (fallback when Keycloak not configured) ──
        const tokenResponse = await sdk.exchangeCodeForToken(code, state);
        const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

        if (!userInfo.openId) {
          res.status(400).json({ error: "openId missing from user info" });
          return;
        }
        openId = userInfo.openId;
        name = userInfo.name ?? null;
        email = userInfo.email ?? null;
        loginMethod = userInfo.loginMethod ?? userInfo.platform ?? null;
      }

      const { isNew } = await db.upsertUser({
        openId,
        name,
        email,
        loginMethod,
        lastSignedIn: new Date(),
      });

      // Send welcome email to brand-new users (non-blocking)
      if (isNew && email) {
        import("../email.service")
          .then(({ sendEmail, buildWelcomeEmail }) => {
            sendEmail({
              to: email!,
              ...buildWelcomeEmail({ userName: name ?? "Valued Customer", email: email! }),
            }).catch(() => {});
          })
          .catch(() => {});
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: name ?? "",
        expiresInMs: sessionTtlMs,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: sessionTtlMs });
      if (keycloakRefresh) {
        res.cookie(REFRESH_TOKEN_COOKIE, keycloakRefresh.token, {
          ...cookieOptions,
          httpOnly: true,
          maxAge: keycloakRefresh.maxAgeMs,
        });
      }
      // Set CSRF double-submit cookie so the frontend can read it
      setCsrfCookie(req, res);
      res.redirect(302, "/");
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, "[OAuth] Callback failed");
      // ─── v149: Record login failure for DB-persisted lockout tracking ──────
      // If the error carries an openId (e.g. token exchange succeeded but
      // session creation failed), record the failed attempt so the lockout
      // counter increments. Non-blocking — errors are swallowed.
      try {
        const failedOpenId = (error as any)?.openId as string | undefined;
        if (failedOpenId) {
          const user = await db.getUserByOpenId(failedOpenId);
          if (user?.id) {
            await db.recordLoginFailure(user.id);
          }
        }
      } catch (_) { /* swallow — never block the error response */ }
      res.status(500).json({ error: "OAuth callback failed", detail: String(error) });
    }
  });

  // ─── Dev-login bypass (local sandbox / demo only) ──────────────────────────
  // Creates a session for a test user without requiring a running Keycloak.
  // KC2: registered ONLY when ALLOW_DEV_LOGIN=true is set explicitly AND the
  // process is not running in production. NODE_ENV alone is not sufficient —
  // a misconfigured deployment must never silently expose this endpoint.
  const devLoginAllowed = process.env.ALLOW_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
  if (devLoginAllowed) {
    app.get("/api/dev-login", async (req: Request, res: Response) => {
      // Defense in depth: refuse at request time as well, even if the process
      // env was mutated after route registration.
      if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_LOGIN !== "true") {
        res.status(403).json({ error: "Dev login is disabled" });
        return;
      }
      try {
        const testOpenId = "dev-user-001";
        const testName = "Demo User";
        const testEmail = "demo@remitflow.app";

        await db.upsertUser({
          openId: testOpenId,
          name: testName,
          email: testEmail,
          loginMethod: "dev",
          lastSignedIn: new Date(),
        });

        const sessionToken = await sdk.createSessionToken(testOpenId, {
          name: testName,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        // Set CSRF double-submit cookie
        setCsrfCookie(req, res);

        // Security: validate returnTo is a relative path to prevent open redirect
        const rawReturnTo = getQueryParam(req, "returnTo") ?? "/dashboard";
        const returnTo = rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//") && !rawReturnTo.includes(":") ? rawReturnTo : "/dashboard";
        res.redirect(302, returnTo);
      } catch (error) {
        logger.error({ err: error instanceof Error ? error.message : String(error) }, "[Dev-Login] Failed");
        res.status(500).json({ error: "Dev login failed", detail: String(error) });
      }
    });

    logger.info("[Auth] Dev-login endpoint enabled at /api/dev-login (ALLOW_DEV_LOGIN=true, non-production)");
  } else if (process.env.ALLOW_DEV_LOGIN === "true" && process.env.NODE_ENV === "production") {
    logger.error("[Auth] ALLOW_DEV_LOGIN=true was set in production — /api/dev-login REFUSED and not registered");
  }
}
