/**
 * RemitFlow React Native — Keycloak SSO Service
 * ──────────────────────────────────────────────
 * Explicit state machine for the Keycloak Authorization Code + PKCE flow:
 *
 *   idle → probing → ready ──initiate()──▶ openingBrowser → awaitingReturn
 *      ↘ unavailable                       ↘ failed (browser could not open)
 *   awaitingReturn ──deep link / app resume──▶ completing → authenticated
 *                                                     ↘ failed (no session)
 *
 * The platform server owns the code exchange (/api/oauth/callback) and
 * establishes a session cookie. On mobile the system browser is opened via
 * Linking; the app detects the return through a deep link (universal link
 * or the remitflow:// scheme) and verifies the session via tRPC auth.me.
 * If the native cookie store is not shared with the system browser on a
 * given platform, verification fails LOUDLY with a clear message — the
 * state machine never fabricates an authenticated state.
 */
import { AppState, Linking } from "react-native";
import { apiUrl, isApiConfigured } from "./apiConfig";

export interface SsoUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

export type SsoState =
  | { phase: "idle" }
  | { phase: "probing" }
  | { phase: "unavailable"; reason: string }
  | { phase: "ready" }
  | { phase: "openingBrowser" }
  | { phase: "awaitingReturn"; state: string; startedAt: number }
  | { phase: "completing" }
  | { phase: "authenticated"; user: SsoUser }
  | { phase: "failed"; message: string };

interface KeycloakLoginInitiation {
  authorizationUrl: string;
  state: string;
}

type Listener = (state: SsoState) => void;

class SsoService {
  private state: SsoState = { phase: "idle" };
  private listeners = new Set<Listener>();
  private linkSubscription: { remove: () => void } | null = null;
  private appStateSubscription: { remove: () => void } | null = null;

  getState(): SsoState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(state: SsoState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Reset to idle and detach platform listeners. */
  reset(): void {
    this.detachListeners();
    this.setState({ phase: "idle" });
  }

  private detachListeners(): void {
    this.linkSubscription?.remove();
    this.linkSubscription = null;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }

  private async fetchLoginInitiation(): Promise<KeycloakLoginInitiation> {
    if (!isApiConfigured()) {
      throw new Error("RemitFlow API URL is not configured for this build.");
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(apiUrl("/auth/keycloak/login"), {
        headers: { Accept: "application/json" },
        credentials: "include",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeoutId);
      throw new Error("Could not reach the platform server.");
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        response.status === 404 || response.status === 501
          ? "Single sign-on is not configured on this deployment."
          : `SSO initiation failed (HTTP ${response.status}).`,
      );
    }

    const data = (await response.json().catch(() => null)) as Partial<KeycloakLoginInitiation> | null;
    if (!data?.authorizationUrl || !data?.state) {
      throw new Error("Single sign-on is not configured on this deployment.");
    }
    return { authorizationUrl: data.authorizationUrl, state: data.state };
  }

  /** Probe SSO availability: idle → probing → ready | unavailable. */
  async probe(): Promise<SsoState> {
    this.setState({ phase: "probing" });
    try {
      await this.fetchLoginInitiation();
      this.setState({ phase: "ready" });
    } catch (err) {
      this.setState({
        phase: "unavailable",
        reason: err instanceof Error ? err.message : "SSO is unavailable.",
      });
    }
    return this.state;
  }

  /**
   * Start the flow: fetch a fresh authorization URL and open it in the
   * system browser. Registers deep-link and app-resume listeners so the
   * return from Keycloak is picked up however the OS delivers it.
   */
  async initiate(): Promise<void> {
    let initiation: KeycloakLoginInitiation;
    try {
      initiation = await this.fetchLoginInitiation();
    } catch (err) {
      this.setState({
        phase: "failed",
        message: err instanceof Error ? err.message : "SSO initiation failed.",
      });
      return;
    }

    this.setState({ phase: "openingBrowser" });

    const supported = await Linking.canOpenURL(initiation.authorizationUrl).catch(
      () => false,
    );
    if (!supported) {
      this.setState({
        phase: "failed",
        message: "No browser on this device can open the sign-in page.",
      });
      return;
    }

    try {
      await Linking.openURL(initiation.authorizationUrl);
    } catch (err) {
      this.setState({
        phase: "failed",
        message:
          err instanceof Error
            ? `Could not open the sign-in browser: ${err.message}`
            : "Could not open the sign-in browser.",
      });
      return;
    }

    this.setState({
      phase: "awaitingReturn",
      state: initiation.state,
      startedAt: Date.now(),
    });
    this.attachReturnListeners();
  }

  /**
   * Listen for (a) deep links carrying the OAuth callback and (b) the app
   * returning to the foreground, both of which trigger session completion.
   */
  private attachReturnListeners(): void {
    this.detachListeners();

    this.linkSubscription = Linking.addEventListener("url", ({ url }) => {
      void this.handleDeepLink(url);
    });

    this.appStateSubscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && this.state.phase === "awaitingReturn") {
        void this.complete();
      }
    });
  }

  /**
   * Handle an incoming deep link. Only links that plausibly carry the
   * OAuth callback advance the state machine; anything else is ignored.
   */
  async handleDeepLink(url: string): Promise<void> {
    if (this.state.phase !== "awaitingReturn") return;
    const isCallback =
      url.includes("oauth/callback") ||
      url.startsWith("remitflow://") ||
      url.includes("code=");
    if (!isCallback) return;
    await this.complete();
  }

  /**
   * Verify the session established by the system browser via tRPC auth.me.
   * Fails loudly when the session is not visible to the app (e.g. the
   * platform does not share cookies with the system browser).
   */
  async complete(): Promise<void> {
    if (this.state.phase !== "awaitingReturn") return;
    const startedAt = this.state.startedAt;

    this.detachListeners();

    if (Date.now() - startedAt > 15 * 60 * 1000) {
      this.setState({ phase: "failed", message: "Sign-in expired. Please try again." });
      return;
    }

    this.setState({ phase: "completing" });

    const input = encodeURIComponent(JSON.stringify({ json: null }));
    let response: Response;
    try {
      response = await fetch(apiUrl(`/trpc/auth.me?input=${input}`), {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
    } catch {
      this.setState({
        phase: "failed",
        message: "Could not verify the sign-in session. Please try again.",
      });
      return;
    }

    if (!response.ok) {
      this.setState({
        phase: "failed",
        message:
          response.status === 401 || response.status === 403
            ? "Sign-in completed in the browser, but the session is not visible to the app on this device. Please sign in with email and password."
            : `Session verification failed (HTTP ${response.status}).`,
      });
      return;
    }

    const envelope = (await response.json().catch(() => null)) as {
      result?: { data?: { json?: Record<string, unknown> } };
    } | null;
    const user = envelope?.result?.data?.json;
    if (!user || typeof user !== "object") {
      this.setState({
        phase: "failed",
        message: "Session verification returned an unexpected response.",
      });
      return;
    }

    this.setState({
      phase: "authenticated",
      user: {
        id: String(user.openId ?? user.id ?? ""),
        email: typeof user.email === "string" ? user.email : "",
        name: typeof user.name === "string" ? user.name : undefined,
        role: typeof user.role === "string" ? user.role : undefined,
      },
    });
  }
}

export const ssoService = new SsoService();
export default ssoService;
