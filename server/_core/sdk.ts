import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { isKeycloakConfigured } from "./keycloak";
import { verifyKeycloakAccessToken } from "../lib/keycloak-jwks";
import { logger } from "./logger";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/authTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

/**
 * When Keycloak is the IdP, app sessions must not outlive the realm's access
 * token. The remitflow realm issues 300s access tokens (refresh-token rotation
 * extends the session via /api/auth/refresh); KEYCLOAK_SESSION_TTL_MS overrides.
 */
export function keycloakSessionTtlMs(): number {
  const override = Number(process.env.KEYCLOAK_SESSION_TTL_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return 300_000; // matches realm accessTokenLifespan (300s)
}

function defaultSessionTtlMs(): number {
  return isKeycloakConfigured() ? keycloakSessionTtlMs() : ONE_YEAR_MS;
}

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    logger.info({ baseURL: ENV.oAuthServerUrl }, "[OAuth] Initialized");
    if (!ENV.oAuthServerUrl) {
      logger.error("[OAuth] OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.");
    }
  }

  private decodeState(state: string): string {
    const redirectUri = atob(state);
    return redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private parseCookies(cookieHeader: string | undefined): Map<string, string> {
    const cookies = new Map<string, string>();
    if (!cookieHeader) return cookies;
    for (const part of cookieHeader.split(";")) {
      const separator = part.indexOf("=");
      if (separator <= 0) continue;
      const name = part.slice(0, separator).trim();
      const encodedValue = part.slice(separator + 1).trim();
      if (!name) continue;
      try {
        cookies.set(name, decodeURIComponent(encodedValue));
      } catch {
        // Ignore malformed individual values rather than accepting an ambiguous session token.
      }
    }
    return cookies;
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? defaultSessionTtlMs();
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      logger.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        logger.warn("[Auth] Session payload missing required fields");
        return null;
      }

      return {
        openId,
        appId,
        name,
      };
    } catch (error) {
      logger.warn({ err: String(error) }, "[Auth] Session verification failed");
      return null;
    }
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  /**
   * KC1: Authenticate a Keycloak-issued RS256 access token presented as a
   * bearer credential. The token is verified locally against the realm JWKS
   * (signature + RS256 allowlist + issuer + audience + expiry) — no token is
   * trusted on presentation alone, and any verification failure is a hard 403.
   */
  private async authenticateKeycloakBearer(token: string): Promise<User> {
    let claims;
    try {
      claims = await verifyKeycloakAccessToken(token);
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, "[Auth] Keycloak bearer token verification failed");
      throw ForbiddenError("Invalid Keycloak access token");
    }

    const signedInAt = new Date();
    let user = await db.getUserByOpenId(claims.sub);
    if (!user) {
      try {
        await db.upsertUser({
          openId: claims.sub,
          name: claims.name ?? claims.preferred_username ?? null,
          email: claims.email ?? null,
          loginMethod: "keycloak",
          lastSignedIn: signedInAt,
        });
        user = await db.getUserByOpenId(claims.sub);
      } catch (error) {
        logger.error({ err: error instanceof Error ? error.message : String(error) }, "[Auth] Failed to sync Keycloak user");
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) throw ForbiddenError("User not found");

    await this.enforceAccountLockout(user);
    await db.upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
    return user;
  }

  /** DB-persisted account lockout enforcement shared by all auth paths. */
  private async enforceAccountLockout(user: User): Promise<void> {
    try {
      const lockStatus = await db.checkDbUserLockout(user.id);
      if (lockStatus.locked) {
        const { emitSecurityEvent } = await import("../security.attacks.js");
        emitSecurityEvent({
          type: "auth.lockout_enforced",
          severity: "high",
          userId: user.id,
          detail: `Session rejected — account locked. Retry in ${lockStatus.retryAfterSec}s`,
        });
        throw ForbiddenError(`Account temporarily locked. Retry in ${lockStatus.retryAfterSec} seconds. Unlock: /unlock?userId=${user.id}`);
      }
    } catch (err: any) {
      if (err?.message?.includes("Account temporarily locked")) throw err;
      // Swallow import/DB errors — fail open to avoid blocking legitimate users
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    // ── Keycloak bearer-token path (KC1) ─────────────────────────────────────
    const authzHeader = req.headers.authorization;
    if (typeof authzHeader === "string" && authzHeader.startsWith("Bearer ")) {
      if (!isKeycloakConfigured()) {
        // No trusted token issuer is configured — never silently ignore a bearer credential.
        logger.warn("[Auth] Bearer token rejected: KEYCLOAK_URL is not configured");
        throw ForbiddenError("Bearer authentication is not enabled on this server");
      }
      return this.authenticateKeycloakBearer(authzHeader.slice("Bearer ".length).trim());
    }

    // Regular authentication flow
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user = await db.getUserByOpenId(sessionUserId);

    // If user not in DB, sync from OAuth server automatically
    if (!user) {
      try {
        if (!sessionCookie) throw ForbiddenError("Invalid session cookie");
        const userInfo = await this.getUserInfoWithJwt(sessionCookie);
        await db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt,
        });
        user = await db.getUserByOpenId(userInfo.openId);
      } catch (error) {
        logger.error({ err: error instanceof Error ? error.message : String(error) }, "[Auth] Failed to sync user from OAuth");
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!user) {
      throw ForbiddenError("User not found");
    }

    // ─── v148: Enforce user-ID-based account lockout (DB-persisted) ────────────
    await this.enforceAccountLockout(user);

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt,
    });

    return user;
  }
}

export const sdk = new SDKServer();
