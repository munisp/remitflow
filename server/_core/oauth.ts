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
  exchangeKeycloakCode,
  getKeycloakUserInfo,
  isKeycloakConfigured,
} from "./keycloak";
import { sdk } from "./sdk";

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

      if (isKeycloakConfigured()) {
        // ── Keycloak OIDC flow ──────────────────────────────────────────────
        // state encodes the redirect_uri (base64) — same convention as before
        const redirectUri = atob(state);
        const tokens = await exchangeKeycloakCode(code, redirectUri);
        const userInfo = await getKeycloakUserInfo(tokens.access_token);

        openId = userInfo.sub;
        name = userInfo.name ?? userInfo.preferred_username ?? null;
        email = userInfo.email ?? null;
        loginMethod = "keycloak";
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
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      // Set CSRF double-submit cookie so the frontend can read it
      setCsrfCookie(req, res);
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
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

  // ─── Dev-login bypass (sandbox / demo only) ────────────────────────────────
  // Creates a session for a test user without requiring a running Keycloak.
  // Disabled automatically when NODE_ENV=production.
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/dev-login", async (req: Request, res: Response) => {
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
        console.error("[Dev-Login] Failed", error);
        res.status(500).json({ error: "Dev login failed", detail: String(error) });
      }
    });

    console.log("[Auth] Dev-login endpoint enabled at /api/dev-login (non-production only)");
  }
}
