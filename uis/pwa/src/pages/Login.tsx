import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authService } from "../services/authService";
import { useAuthStore } from "../stores/authStore";

const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showKycModal, setShowKycModal] = useState(false);
  const [kycUrl, setKycUrl] = useState<string | null>(null);
  const [ssoAvailable, setSsoAvailable] = useState<boolean | null>(null);
  const [ssoLoading, setSsoLoading] = useState(false);
  const ssoCompletionAttempted = useRef(false);
  const { login, completeSsoLogin, logout, isLoading, error, clearError, setError } =
    useAuthStore();
  const navigate = useNavigate();

  // Handle the redirect back from the Keycloak SSO flow (the platform
  // server completes the code exchange and lands the browser back here),
  // then probe whether SSO is offered on this deployment. When it is not,
  // the page silently falls back to credential login only.
  useEffect(() => {
    let cancelled = false;

    const completePendingSso = async () => {
      if (ssoCompletionAttempted.current) return;
      if (!authService.hasPendingSso()) return;
      ssoCompletionAttempted.current = true;
      setSsoLoading(true);
      try {
        await completeSsoLogin();
        if (!cancelled && useAuthStore.getState().isAuthenticated) {
          navigate("/", { replace: true });
        }
      } catch {
        // The store already carries the failure message; the credential
        // form below remains fully usable as the fallback.
      } finally {
        if (!cancelled) setSsoLoading(false);
      }
    };

    const probeSso = async () => {
      const available = await authService.probeKeycloakSso();
      if (!cancelled) setSsoAvailable(available);
    };

    void completePendingSso().then(probeSso, probeSso);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSsoSignIn = async () => {
    clearError();
    setSsoLoading(true);
    try {
      // Redirects the browser; code below only runs if initiation fails.
      await authService.initiateKeycloakLogin("/");
    } catch (err) {
      setSsoLoading(false);
      setSsoAvailable(false);
      setError(
        err instanceof Error
          ? err.message
          : "Single sign-on is unavailable. Sign in with email and password.",
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);

    const state = useAuthStore.getState();
    if (!state.isAuthenticated) {
      return;
    }

    const user = state.user;
    const isUnverified =
      user?.isVerified === false ||
      (user?.kycStatus !== undefined && user.kycStatus !== "verified");

    if (isUnverified) {
      setKycUrl(user?.kycUrl || null);
      setShowKycModal(true);
      return;
    }

    navigate("/");
  };

  const handleLogout = () => {
    logout();
    setShowKycModal(false);
    setEmail("");
    setPassword("");
  };

  const handleCompleteVerification = () => {
    if (kycUrl) {
      window.open(kycUrl, "_blank");
    }
  };

  return (
    <>
      {showKycModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-100 p-6 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-amber-500 text-white flex items-center justify-center mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">KYC Verification Required</h2>
              <p className="text-slate-600 mt-2">
                To protect your account and meet regulatory requirements, complete identity verification before accessing your account.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-sm font-semibold text-blue-900">Why KYC is Required</p>
                <p className="text-sm text-blue-700 mt-1">KYC helps maintain a secure banking environment for all users.</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-semibold text-emerald-900">Quick &amp; Simple Process</p>
                <p className="text-sm text-emerald-700 mt-1">Verification takes a few minutes with a valid government ID.</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
              >
                Logout
              </button>
              <button
                type="button"
                onClick={handleCompleteVerification}
                disabled={!kycUrl}
                className="w-full py-2.5 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-60"
              >
                Complete Verification
              </button>
            </div>

            <p className="text-xs text-slate-500 text-center mt-4">
              After completing verification, log in again to access your account.
            </p>
          </div>
        </div>
      )}

      <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-violet-300 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/20 backdrop-blur-sm">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </div>
            <span className="text-2xl font-bold">54RemitFlow</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Send money anywhere in the world
          </h1>
          <p className="text-lg text-indigo-100 leading-relaxed">
            Fast, secure, and affordable cross-border transfers. Trusted by
            thousands across Africa and beyond.
          </p>
          <div className="mt-12 grid grid-cols-3 gap-6">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <p className="text-2xl font-bold">150+</p>
              <p className="text-sm text-indigo-200">Countries</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <p className="text-2xl font-bold">$2B+</p>
              <p className="text-sm text-indigo-200">Transferred</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <p className="text-2xl font-bold">500K+</p>
              <p className="text-sm text-indigo-200">Users</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-10">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-indigo-600 to-violet-600">
              <svg
                className="w-4.5 h-4.5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              54RemitFlow
            </span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-1">
            Welcome back
          </h2>
          <p className="text-slate-500 mb-8">
            Sign in to your account to continue
          </p>

          {error && (
            <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <svg
                className="w-5 h-5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <span className="flex-1">{error}</span>
              <button
                onClick={clearError}
                className="text-red-400 hover:text-red-600"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}

          {ssoAvailable === true && (
            <>
              <button
                type="button"
                onClick={handleSsoSignIn}
                disabled={ssoLoading || isLoading}
                className="w-full mb-6 flex items-center justify-center gap-3 py-3 px-6 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl shadow-sm hover:border-indigo-300 hover:text-indigo-700 hover:shadow transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {ssoLoading ? (
                  <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-5 h-5 text-indigo-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={1.75}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                )}
                {ssoLoading ? "Redirecting to sign-in..." : "Sign in with SSO"}
              </button>
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-slate-50 px-3 text-slate-400 uppercase tracking-wider">
                    or continue with email
                  </span>
                </div>
              </div>
            </>
          )}

          {ssoLoading && ssoAvailable !== true && (
            <div className="mb-6 flex items-center gap-3 p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-700">
              <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              Completing single sign-on...
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 transition-all duration-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none hover:border-slate-300"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 transition-all duration-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none hover:border-slate-300 pr-12"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-600">Remember me</span>
              </label>
              {/* Password recovery is handled through the SSO provider when
                  Keycloak is configured; no self-service reset endpoint exists
                  for credential accounts, so no dead link is shown. */}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-lg"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-500">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
    </>
  );
};

export default Login;
