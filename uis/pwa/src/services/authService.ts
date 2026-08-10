/**
 * Authentication Service
 * Handles authentication with Keycloak via core banking auth service
 * Based on 54remit core banking authentication pattern
 */

import { getTenantHeadersFromStorage } from "./tenant/getTenantHeaders";
import { tenantService } from "./tenant/tenantService";

const CORE_BANKING_BASE = (
  import.meta.env.VITE_CORE_BANKING_URL ||
  (typeof window !== "undefined" ? `${window.location.origin}/api` : "/api")
).replace(/\/$/, "");

/**
 * Base URL of the RemitFlow platform API (the server that owns
 * /api/auth/keycloak/login, /api/oauth/callback and /api/trpc).
 * In a unified deployment this is same-origin; an explicit gateway
 * base may be provided via VITE_API_BASE_URL (with or without the
 * trailing /api path segment).
 */
const PLATFORM_API_BASE = (() => {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
  if (configured) {
    return configured.endsWith("/api") ? configured : `${configured}/api`;
  }
  return typeof window !== "undefined" ? `${window.location.origin}/api` : "/api";
})();

/** Contract returned by GET /api/auth/keycloak/login (PKCE initiation). */
export interface KeycloakLoginInitiation {
  authorizationUrl: string;
  state: string;
}

interface PendingSsoFlow {
  state: string;
  returnTo: string;
  startedAt: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  keycloak_id?: string;
  user?: User;
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  keycloak_id?: string;
  keycloakId?: string;
  kycStatus?: "pending" | "verified" | "rejected";
  isVerified?: boolean;
  kycUrl?: string;
  status?: string;
  createdAt?: string;
  tenant_id?: string;
  role?: "admin" | "user" | "partner";
}

class AuthService {
  private readonly AUTH_TOKEN_KEY = "auth_token";
  private readonly REFRESH_TOKEN_KEY = "refresh_token";
  private readonly AUTH_USER_KEY = "auth_user";
  private readonly KEYCLOAK_ID_KEY = "keycloak_id";
  private readonly TOKEN_EXPIRY_KEY = "token_expiry";
  private readonly SSO_PENDING_KEY = "keycloak_sso_pending";
  private readonly SSO_PROBE_KEY = "keycloak_sso_probe";
  private readonly SSO_PROBE_TTL_MS = 5 * 60 * 1000;

  // ─── Keycloak SSO (Authorization Code + PKCE) ─────────────────────────────

  /**
   * Fetch a fresh PKCE login initiation from the platform server.
   * Throws when the endpoint is absent (Keycloak unconfigured) or the
   * payload does not match the documented { authorizationUrl, state }
   * contract — callers use this to fall back to credential login.
   */
  private async fetchKeycloakLoginInitiation(): Promise<KeycloakLoginInitiation> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(`${PLATFORM_API_BASE}/auth/keycloak/login`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeoutId);
      throw new Error("SSO unavailable: could not reach the platform server.");
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        response.status === 404 || response.status === 501
          ? "SSO is not configured on this deployment."
          : `SSO initiation failed (HTTP ${response.status}).`,
      );
    }

    const data = (await response.json().catch(() => null)) as Partial<KeycloakLoginInitiation> | null;
    if (
      !data ||
      typeof data.authorizationUrl !== "string" ||
      data.authorizationUrl.length === 0 ||
      typeof data.state !== "string" ||
      data.state.length === 0
    ) {
      throw new Error("SSO is not configured on this deployment.");
    }
    return { authorizationUrl: data.authorizationUrl, state: data.state };
  }

  /**
   * Probe whether Keycloak SSO is available on this deployment.
   * Result is cached in sessionStorage for 5 minutes to avoid hammering
   * the initiation endpoint on every login-page render.
   */
  async probeKeycloakSso(): Promise<boolean> {
    try {
      const cached = sessionStorage.getItem(this.SSO_PROBE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { available: boolean; at: number };
        if (Date.now() - parsed.at < this.SSO_PROBE_TTL_MS) {
          return parsed.available;
        }
      }
    } catch {
      // Corrupt cache — re-probe below.
    }

    let available = false;
    try {
      await this.fetchKeycloakLoginInitiation();
      available = true;
    } catch {
      available = false;
    }

    try {
      sessionStorage.setItem(
        this.SSO_PROBE_KEY,
        JSON.stringify({ available, at: Date.now() }),
      );
    } catch {
      // Storage unavailable (private mode) — probe result still returned.
    }
    return available;
  }

  /**
   * Begin the Keycloak PKCE flow: fetches a fresh authorization URL from
   * the platform server, records the pending flow, and redirects the
   * browser to Keycloak. The server-side /api/oauth/callback endpoint
   * performs the code exchange and redirects back to the app.
   */
  async initiateKeycloakLogin(returnTo: string = "/"): Promise<void> {
    const initiation = await this.fetchKeycloakLoginInitiation();
    const pending: PendingSsoFlow = {
      state: initiation.state,
      returnTo,
      startedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(this.SSO_PENDING_KEY, JSON.stringify(pending));
    } catch {
      // Continue without local marker — completion will fail closed below.
    }
    window.location.assign(initiation.authorizationUrl);
  }

  /** True when an SSO flow was started from this tab and not yet completed. */
  hasPendingSso(): boolean {
    try {
      return sessionStorage.getItem(this.SSO_PENDING_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** Abandon any pending SSO flow (used on explicit user cancel). */
  clearPendingSso(): void {
    try {
      sessionStorage.removeItem(this.SSO_PENDING_KEY);
    } catch {
      // Ignore storage errors.
    }
  }

  /**
   * Verify the cookie-based platform SSO session by calling the tRPC
   * `auth.me` endpoint. Returns the mapped user when a valid session
   * exists and null when the server definitively rejects the session.
   * Throws when the server cannot be reached, so callers can
   * distinguish "no session" from "indeterminate".
   */
  async fetchSsoSessionUser(): Promise<User | null> {
    const input = encodeURIComponent(JSON.stringify({ json: null }));
    let response: Response;
    try {
      response = await fetch(`${PLATFORM_API_BASE}/trpc/auth.me?input=${input}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });
    } catch {
      throw new Error("Could not reach the platform server to verify the session.");
    }
    if (!response.ok) return null;

    // tRPC v11 + superjson envelope: { result: { data: { json: <user> } } }
    const envelope = (await response.json().catch(() => null)) as {
      result?: { data?: { json?: Record<string, unknown> } };
    } | null;
    const platformUser = envelope?.result?.data?.json;
    if (!platformUser || typeof platformUser !== "object") return null;

    const name = typeof platformUser.name === "string" ? platformUser.name : "";
    const [firstName, ...rest] = name.trim().split(/\s+/).filter(Boolean);
    const openId =
      typeof platformUser.openId === "string" ? platformUser.openId : undefined;
    const role =
      platformUser.role === "admin" || platformUser.role === "partner"
        ? platformUser.role
        : "user";

    return {
      id: openId || String(platformUser.id ?? ""),
      email: typeof platformUser.email === "string" ? platformUser.email : "",
      firstName: firstName || undefined,
      lastName: rest.length > 0 ? rest.join(" ") : undefined,
      keycloak_id: openId,
      keycloakId: openId,
      status: typeof platformUser.status === "string" ? platformUser.status : undefined,
      role,
    };
  }

  /**
   * Complete the SSO flow after the platform server redirects back to the
   * app. The server has already exchanged the authorization code and set
   * the session cookie; here we verify a real session exists via
   * `auth.me` and map the platform user onto the local user shape.
   *
   * Fails loudly (throws) when no pending flow exists or the session is
   * missing/invalid — never fabricates an authenticated state.
   */
  async completeKeycloakLogin(): Promise<User> {
    let pending: PendingSsoFlow | null = null;
    try {
      const raw = sessionStorage.getItem(this.SSO_PENDING_KEY);
      pending = raw ? (JSON.parse(raw) as PendingSsoFlow) : null;
    } catch {
      pending = null;
    }
    if (!pending) {
      throw new Error("No SSO sign-in is in progress.");
    }

    // Stale flows (older than 15 minutes) are abandoned.
    if (Date.now() - pending.startedAt > 15 * 60 * 1000) {
      this.clearPendingSso();
      throw new Error("SSO sign-in expired. Please try again.");
    }

    let user: User | null = null;
    try {
      user = await this.fetchSsoSessionUser();
    } catch {
      throw new Error("Could not verify the SSO session. Please try again.");
    }
    if (!user) {
      this.clearPendingSso();
      throw new Error(
        "SSO sign-in did not establish a session. Please try again or sign in with email and password.",
      );
    }

    this.clearPendingSso();
    this.setUser(user);
    if (user.keycloak_id) this.setKeycloakId(user.keycloak_id);
    return user;
  }

  /**
   * Login user with email and password
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    try {
      // Make sure tenant config is loaded first
      const tenantId = tenantService.getTenantId();
      if (!tenantService.hasTenantConfig()) {
        console.log("Loading tenant configuration before login...");
        await tenantService.getTenant(tenantId || undefined);
      }

      // Get tenant headers for authentication
      const tenantHeaders = getTenantHeadersFromStorage();

      const response = await fetch(`${CORE_BANKING_BASE}/auth/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...tenantHeaders,
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || "Login failed. Please check your credentials.",
        );
      }

      const data: LoginResponse = await response.json();

      // Store tokens
      if (data.access_token) {
        this.setToken(data.access_token);

        // Calculate token expiry
        if (data.expires_in) {
          const expiryTime = Date.now() + data.expires_in * 1000;
          localStorage.setItem(this.TOKEN_EXPIRY_KEY, String(expiryTime));
        }
      }

      if (data.refresh_token) {
        localStorage.setItem(this.REFRESH_TOKEN_KEY, data.refresh_token);
      }

      // Extract and store keycloak_id from login response
      // Check root level first, then nested user object
      let keycloakId =
        data.keycloak_id || data.user?.keycloak_id || data.user?.keycloakId;

      console.log("🔑 Initial keycloakId from response:", keycloakId);

      // Fallback: decode JWT sub claim (Keycloak always puts keycloak ID in sub)
      if (!keycloakId && data.access_token) {
        try {
          const tokenParts = data.access_token.split(".");
          if (tokenParts.length === 3) {
            const payload = JSON.parse(atob(tokenParts[1]));
            keycloakId = payload.sub;
            console.log("🔑 Extracted keycloakId from JWT:", keycloakId);
          }
        } catch (err) {
          console.error("Failed to decode JWT:", err);
        }
      }

      if (keycloakId) {
        this.setKeycloakId(keycloakId);
        console.log("🔑 Stored keycloakId in localStorage:", keycloakId);
      } else {
        console.warn("⚠️ No keycloakId found in login response or JWT");
      }

      // Store user info if provided
      if (data.user) {
        const loginUser = data.user as User & {
          is_verified?: boolean;
          kyc_url?: string;
          kyc_verification_url?: string;
          tenant_id?: string;
        };

        const userData: User = {
          id: loginUser.id || keycloakId || "",
          email: loginUser.email || credentials.email,
          firstName: loginUser.firstName,
          lastName: loginUser.lastName,
          phone: loginUser.phone,
          keycloak_id: keycloakId,
          keycloakId: keycloakId,
          kycStatus: loginUser.kycStatus,
          isVerified:
            loginUser.is_verified !== undefined
              ? Boolean(loginUser.is_verified)
              : loginUser.isVerified,
          kycUrl:
            loginUser.kyc_url ||
            loginUser.kycUrl ||
            loginUser.kyc_verification_url,
          status: loginUser.status,
          createdAt: loginUser.createdAt,
          tenant_id: loginUser.tenant_id || tenantService.getTenantId() || undefined,
          role: loginUser.role,
        };
        this.setUser(userData);
      } else {
        // Create minimal user object
        const minimalUser: User = {
          id: keycloakId || "",
          email: credentials.email,
          keycloak_id: keycloakId,
          keycloakId: keycloakId,
          tenant_id: tenantService.getTenantId() || undefined,
        };
        this.setUser(minimalUser);
      }

      return data;
    } catch (error: any) {
      console.error("Login error:", error);
      throw new Error(error.message || "Login failed. Please try again.");
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(): Promise<LoginResponse | null> {
    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);

    if (!refreshToken) {
      return null;
    }

    try {
      const tenantHeaders = getTenantHeadersFromStorage();
      const keycloakId = this.getKeycloakId();

      const response = await fetch(`${CORE_BANKING_BASE}/auth/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...tenantHeaders,
          ...(keycloakId ? { "x-keycloak-id": keycloakId } : {}), // Add if available
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        // Refresh failed, clear tokens
        this.logout();
        return null;
      }

      const data: LoginResponse = await response.json();

      // Update tokens
      if (data.access_token) {
        this.setToken(data.access_token);

        if (data.expires_in) {
          const expiryTime = Date.now() + data.expires_in * 1000;
          localStorage.setItem(this.TOKEN_EXPIRY_KEY, String(expiryTime));
        }
      }

      if (data.refresh_token) {
        localStorage.setItem(this.REFRESH_TOKEN_KEY, data.refresh_token);
      }

      return data;
    } catch (error) {
      console.error("Token refresh failed:", error);
      this.logout();
      return null;
    }
  }

  /**
   * Check if token is expired or about to expire
   */
  isTokenExpired(): boolean {
    const expiry = localStorage.getItem(this.TOKEN_EXPIRY_KEY);
    if (!expiry) return true;

    const expiryTime = parseInt(expiry);
    const now = Date.now();

    // Consider token expired if it expires within 5 minutes
    return now >= expiryTime - 5 * 60 * 1000;
  }

  /**
   * Logout current user
   */
  logout(): void {
    this.removeToken();
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
    this.removeUser();
    this.removeKeycloakId();

    // Note: We don't clear tenant config as it can be reused
  }

  /**
   * Get current auth token
   */
  getToken(): string | null {
    return localStorage.getItem(this.AUTH_TOKEN_KEY);
  }

  /**
   * Set auth token
   */
  setToken(token: string): void {
    localStorage.setItem(this.AUTH_TOKEN_KEY, token);
  }

  /**
   * Remove auth token
   */
  removeToken(): void {
    localStorage.removeItem(this.AUTH_TOKEN_KEY);
  }

  /**
   * Get current user
   */
  getUser(): User | null {
    const userStr = localStorage.getItem(this.AUTH_USER_KEY);
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }

  /**
   * Set user info
   */
  setUser(user: User): void {
    localStorage.setItem(this.AUTH_USER_KEY, JSON.stringify(user));
  }

  /**
   * Remove user info
   */
  removeUser(): void {
    localStorage.removeItem(this.AUTH_USER_KEY);
  }

  /**
   * Get keycloak_id from localStorage
   */
  getKeycloakId(): string | null {
    return localStorage.getItem(this.KEYCLOAK_ID_KEY);
  }

  /**
   * Set keycloak_id in localStorage
   */
  setKeycloakId(keycloakId: string): void {
    localStorage.setItem(this.KEYCLOAK_ID_KEY, keycloakId);
  }

  /**
   * Remove keycloak_id from localStorage
   */
  removeKeycloakId(): void {
    localStorage.removeItem(this.KEYCLOAK_ID_KEY);
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = this.getToken();

    if (!token) {
      return false;
    }

    // Check if token is expired
    if (this.isTokenExpired()) {
      return false;
    }

    return true;
  }

  /**
   * Get user details from user service using keycloak_id
   */
  async fetchUserDetails(keycloakId?: string): Promise<User | null> {
    try {
      const id = keycloakId || this.getKeycloakId();
      if (!id) {
        throw new Error("Keycloak ID not found");
      }

      const tenantHeaders = getTenantHeadersFromStorage();
      const token = this.getToken();

      const response = await fetch(
        `${CORE_BANKING_BASE}/user/user?keycloak=${id}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...tenantHeaders,
            "x-keycloak-id": id, // Add logged-in user's keycloak ID
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch user details");
      }

      const data = await response.json();
      const userData = data.user || data;

      if (userData) {
        // Update stored user
        const user: User = {
          id: userData.id || id,
          email: userData.email,
          firstName: userData.first_name || userData.firstName,
          lastName: userData.last_name || userData.lastName,
          phone: userData.phone_number || userData.phone,
          keycloak_id: id,
          keycloakId: id,
          kycStatus: userData.kyc_verification_status || userData.kycStatus,
          isVerified:
            userData.is_verified !== undefined
              ? Boolean(userData.is_verified)
              : userData.isVerified,
          kycUrl:
            userData.kyc_url ||
            userData.kycUrl ||
            userData.kyc_verification_url,
          status: userData.status,
          createdAt: userData.created_at || userData.createdAt,
          tenant_id:
            userData.tenant_id || tenantService.getTenantId() || undefined,
        };

        this.setUser(user);
        return user;
      }

      return null;
    } catch (error: any) {
      console.error("Failed to fetch user details:", error);
      return null;
    }
  }
}

// Export singleton instance
export const authService = new AuthService();
export default authService;
