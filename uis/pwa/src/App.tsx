import React, { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import LoadingSpinner from "./components/LoadingSpinner";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { setAuthToken } from "./services/api";
import { tenantService } from "./services/tenant/tenantService";
import { useAuthStore } from "./stores/authStore";

const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const OnboardingStart = lazy(() => import("./pages/OnboardingStart"));
const OnboardingAccountType = lazy(
  () => import("./pages/OnboardingAccountType"),
);
const OnboardingBvn = lazy(() => import("./pages/OnboardingBvn"));
const OnboardingAddress = lazy(() => import("./pages/OnboardingAddress"));
const OnboardingCompletion = lazy(() => import("./pages/OnboardingCompletion"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Wallet = lazy(() => import("./pages/Wallet"));
const SendMoney = lazy(() => import("./pages/SendMoney"));
const ReceiveMoney = lazy(() => import("./pages/ReceiveMoney"));
const Transactions = lazy(() => import("./pages/Transactions"));
const ExchangeRates = lazy(() => import("./pages/ExchangeRates"));
const Airtime = lazy(() => import("./pages/Airtime"));
const BillPayment = lazy(() => import("./pages/BillPayment"));
const VirtualAccount = lazy(() => import("./pages/VirtualAccount"));
const Cards = lazy(() => import("./pages/CardsPage"));
const KYC = lazy(() => import("./pages/KYC"));
const PropertyKYC = lazy(() => import("./pages/PropertyKYC"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));
const Support = lazy(() => import("./pages/Support"));
const Beneficiaries = lazy(() => import("./pages/Beneficiaries"));
const MPesa = lazy(() => import("./pages/MPesa"));
const WiseTransfer = lazy(() => import("./pages/WiseTransfer"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Security = lazy(() => import("./pages/Security"));
const IPLoginHistory = lazy(() => import("./pages/IPLoginHistory"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const AccountHealth = lazy(() => import("./pages/AccountHealth"));
const PaymentPerformance = lazy(() => import("./pages/PaymentPerformance"));
const Disputes = lazy(() => import("./pages/Disputes"));
const Stablecoin = lazy(() => import("./pages/Stablecoin"));
const TransferTracking = lazy(() => import("./pages/TransferTracking"));
const BatchPayments = lazy(() => import("./pages/BatchPayments"));
const SavingsGoals = lazy(() => import("./pages/SavingsGoals"));
const FXAlerts = lazy(() => import("./pages/FXAlerts"));
const OperationsMap = lazy(() => import("./pages/OperationsMap"));
const PlatformHealth = lazy(() => import("./pages/PlatformHealth"));
// ── BDC console (F1) — route base /bdc, guarded per existing patterns ──
const BdcRateBoard = lazy(() => import("./pages/bdc/BdcRateBoard"));
const BdcTeller = lazy(() => import("./pages/bdc/BdcTeller"));
const BdcDealerDesk = lazy(() => import("./pages/bdc/BdcDealerDesk"));
const BdcBranchManager = lazy(() => import("./pages/bdc/BdcBranchManager"));
const BdcMlroConsole = lazy(() => import("./pages/bdc/BdcMlroConsole"));
const BdcMdDashboard = lazy(() => import("./pages/bdc/BdcMdDashboard"));
// ── BDC console (wave12) — ops consoles gated AdminRoute, pickup teller-facing ──
const BdcReversals = lazy(() => import("./pages/bdc/BdcReversals"));
const BdcRescreening = lazy(() => import("./pages/bdc/BdcRescreening"));
const BdcOffboarding = lazy(() => import("./pages/bdc/BdcOffboarding"));
const BdcPickup = lazy(() => import("./pages/bdc/BdcPickup"));
const BdcTellerFraud = lazy(() => import("./pages/bdc/BdcTellerFraud"));
// W13-MERCHANT
const MerchantOnboarding = lazy(() => import("./pages/MerchantOnboarding"));
const MerchantKybConsole = lazy(() => import("./pages/MerchantKybConsole"));
// W13-PARTNER
const PartnerApply = lazy(() => import("./pages/PartnerApply"));
const PartnerApplicationsConsole = lazy(() => import("./pages/PartnerApplicationsConsole"));
// /W13-PARTNER
// W15-K5 — camera-based KYC capture flow (MediaPipe WASM is lazy-loaded inside
// the flow, so this chunk stays lean) + admin capture-session review console.
const CaptureFlow = lazy(() => import("./pages/kyc/CaptureFlow"));
const KycCaptureSessionsConsole = lazy(
  () => import("./components/enhanced-features/EnhancedKYCVerification"),
);
// W16 — investment surfaces (C6/C7) + admin KYC review console (C5)
const InvestHub = lazy(() => import("./pages/invest/InvestHub"));
const BondsPage = lazy(() => import("./pages/invest/BondsPage"));
const BondDetailPage = lazy(() => import("./pages/invest/BondDetailPage"));
const StocksPage = lazy(() => import("./pages/invest/StocksPage"));
const InvestRealEstate = lazy(() => import("./pages/invest/RealEstate"));
const InvestStartups = lazy(() => import("./pages/invest/Startups"));
const InvestCommunity = lazy(() => import("./pages/invest/Community"));
const InvestEscrow = lazy(() => import("./pages/invest/Escrow"));
const KycReviewConsole = lazy(() => import("./pages/admin/kyc-review/KycReviewConsole"));
// W17-C2 — admin security/insider-threat/feature-flags consoles
const SecurityAuditConsole = lazy(() => import("./pages/admin/security-audit/SecurityAuditConsole"));
const InsiderThreatConsole = lazy(() => import("./pages/admin/insider-threat/InsiderThreatConsole"));
const FeatureFlagsConsole = lazy(() => import("./pages/admin/feature-flags/FeatureFlagsConsole"));
// W17-C3 — admin compliance console + user travel-rule/TRISA pages
const ComplianceConsole = lazy(() => import("./pages/admin/compliance/ComplianceConsole"));
const TravelRulePage = lazy(() => import("./pages/travel-rule/TravelRulePage"));
const TrisaPage = lazy(() => import("./pages/travel-rule/TrisaPage"));

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  // Selector subscription — re-render only when the auth flag flips.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const AdminRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const refreshAuth = useAuthStore((s) => s.refreshAuth);
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Load tenant configuration and initialize auth on app startup.
  // PERF (wave14): tenant config fetch and auth refresh previously ran as a
  // sequential waterfall (two serialized round trips before first paint).
  // They are independent, so they now run concurrently via allSettled.
  // Fail-closed semantics are unchanged: a tenant-config failure still shows
  // the blocking error screen, and refreshAuth failures still resolve to
  // logged-out state internally (authStore.refreshAuth never throws — every
  // failure path ends in logout()/isAuthenticated=false, which routes to
  // /login via ProtectedRoute). A defensive rejection of refreshAuth is
  // treated as unauthenticated as well.
  useEffect(() => {
    const initializeApp = async () => {
      // If user has a token, set it in the API client before any request.
      // Cookie-based SSO sessions carry no bearer token but still need
      // re-verification against the platform server on every boot.
      if (token) {
        setAuthToken(token);
      }

      const tenantId = tenantService.getTenantId();
      console.log("Loading tenant configuration for:", tenantId);

      const tenantTask = tenantService.hasTenantConfig()
        ? Promise.resolve()
        : tenantService.getTenant(tenantId || undefined);
      const authTask =
        token || isAuthenticated ? refreshAuth() : Promise.resolve();

      const [tenantResult, authResult] = await Promise.allSettled([
        tenantTask,
        authTask,
      ]);

      if (authResult.status === "rejected") {
        // Defensive fail-closed: refreshAuth is designed not to throw, but
        // if it ever does, force unauthenticated so protected routes bounce
        // to /login instead of rendering with a stale session.
        console.error("Auth refresh failed during boot:", authResult.reason);
        useAuthStore.getState().logout();
      }

      if (tenantResult.status === "rejected") {
        console.error(
          "Failed to load tenant configuration:",
          tenantResult.reason,
        );
        setTenantError(
          tenantResult.reason instanceof Error
            ? tenantResult.reason.message
            : "Failed to load configuration",
        );
      }
      setTenantLoading(false);
    };

    initializeApp();
  }, [token, isAuthenticated, refreshAuth]);

  // Show loading screen while loading tenant config
  if (tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-slate-600">Loading configuration...</p>
        </div>
      </div>
    );
  }

  // Show error screen if tenant loading failed
  if (tenantError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-1.959-1.333-2.73 0L4.083 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            Configuration Error
          </h2>
          <p className="text-slate-600 mb-4">{tenantError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <OfflineIndicator />
      {/* PERF (wave14): this root Suspense now only covers the public lazy
          routes (login/register/onboarding/partner). Authenticated child
          routes are caught by a dedicated Suspense inside Layout around
          <Outlet/>, so a lazy page chunk suspending no longer unmounts the
          already-painted app shell (sidebar/header/bottom-nav). */}
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/onboarding/start" element={<OnboardingStart />} />
          <Route
            path="/onboarding/account-type"
            element={<OnboardingAccountType />}
          />
          <Route path="/onboarding/bvn" element={<OnboardingBvn />} />
          <Route path="/onboarding/address" element={<OnboardingAddress />} />
          <Route
            path="/onboarding/completion"
            element={<OnboardingCompletion />}
          />
          {/* W13-PARTNER — public partner application (submit + status check) */}
          <Route path="/partner/apply" element={<PartnerApply />} />
          {/* /W13-PARTNER */}

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="send" element={<SendMoney />} />
            <Route path="receive" element={<ReceiveMoney />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="exchange-rates" element={<ExchangeRates />} />
            <Route path="airtime" element={<Airtime />} />
            <Route path="bills" element={<BillPayment />} />
            <Route path="virtual-account" element={<VirtualAccount />} />
            <Route path="cards" element={<Cards />} />
            <Route path="kyc" element={<KYC />} />
            {/* W15-K5: guided camera capture; /kyc keeps the upload fallback */}
            <Route path="kyc/capture" element={<CaptureFlow />} />
            <Route path="property-kyc" element={<PropertyKYC />} />
            <Route path="settings" element={<Settings />} />
            <Route path="profile" element={<Profile />} />
            <Route path="support" element={<Support />} />
            <Route path="beneficiaries" element={<Beneficiaries />} />
            <Route path="mpesa" element={<MPesa />} />
            <Route path="wise" element={<WiseTransfer />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="security" element={<Security />} />
            <Route path="login-history" element={<IPLoginHistory />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="account-health" element={<AccountHealth />} />
            <Route
              path="payment-performance"
              element={<PaymentPerformance />}
            />
            <Route path="disputes" element={<Disputes />} />
            <Route path="stablecoin" element={<Stablecoin />} />
            <Route
              path="transfer-tracking/:transferId"
              element={<TransferTracking />}
            />
            <Route path="batch-payments" element={<BatchPayments />} />
            <Route path="savings-goals" element={<SavingsGoals />} />
            <Route path="fx-alerts" element={<FXAlerts />} />
            {/* W16-C6/C7 — investment surfaces (diaspora bonds, NGX stocks,
                real estate, startups, community, escrow) */}
            <Route path="invest" element={<InvestHub />} />
            <Route path="invest/bonds" element={<BondsPage />} />
            <Route path="invest/bonds/:bondId" element={<BondDetailPage />} />
            <Route path="invest/stocks" element={<StocksPage />} />
            <Route path="invest/real-estate" element={<InvestRealEstate />} />
            <Route path="invest/startups" element={<InvestStartups />} />
            <Route path="invest/community" element={<InvestCommunity />} />
            <Route path="invest/escrow" element={<InvestEscrow />} />
            <Route path="operations-map" element={<AdminRoute><OperationsMap /></AdminRoute>} />
            <Route path="platform-status" element={<PlatformHealth />} />
            {/* BDC console (F1). /bdc/rates and /bdc/teller are open to any
                authenticated tenant user (server-side bdc.* procedure guards
                remain authoritative); the privileged consoles use the existing
                AdminRoute pattern (authStore role union is admin|user|partner —
                finer BDC roles are enforced by the bdc.* procedures). */}
            <Route path="bdc/rates" element={<BdcRateBoard />} />
            <Route path="bdc/teller" element={<BdcTeller />} />
            <Route path="bdc/dealer" element={<AdminRoute><BdcDealerDesk /></AdminRoute>} />
            <Route path="bdc/branch" element={<AdminRoute><BdcBranchManager /></AdminRoute>} />
            <Route path="bdc/mlro" element={<AdminRoute><BdcMlroConsole /></AdminRoute>} />
            <Route path="bdc/dashboard" element={<AdminRoute><BdcMdDashboard /></AdminRoute>} />
            {/* BDC console (wave12). /bdc/pickup is teller-facing like
                /bdc/teller (any authenticated tenant user; server-side bdc.*
                guards are authoritative — revoke is an admin procedure and
                fails closed for tellers); the rest are ops consoles. */}
            <Route path="bdc/reversals" element={<AdminRoute><BdcReversals /></AdminRoute>} />
            <Route path="bdc/rescreening" element={<AdminRoute><BdcRescreening /></AdminRoute>} />
            <Route path="bdc/offboarding" element={<AdminRoute><BdcOffboarding /></AdminRoute>} />
            <Route path="bdc/pickup" element={<BdcPickup />} />
            <Route path="bdc/teller-fraud" element={<AdminRoute><BdcTellerFraud /></AdminRoute>} />
            {/* W13-MERCHANT: /merchant/onboarding is user-facing;
                /admin/merchant-kyb is the admin review console. */}
            <Route path="merchant/onboarding" element={<MerchantOnboarding />} />
            <Route path="admin/merchant-kyb" element={<AdminRoute><MerchantKybConsole /></AdminRoute>} />
            {/* W13-PARTNER — admin review queue for partner applications */}
            <Route path="admin/partner-applications" element={<AdminRoute><PartnerApplicationsConsole /></AdminRoute>} />
            {/* /W13-PARTNER */}
            {/* W15-K5: admin viewer for kycCapture pipeline sessions */}
            <Route path="admin/kyc-capture-sessions" element={<AdminRoute><KycCaptureSessionsConsole /></AdminRoute>} />
            {/* W16-C5: admin KYC review console */}
            <Route path="admin/kyc-review" element={<AdminRoute><KycReviewConsole /></AdminRoute>} />
            {/* W17-C2: admin security, insider-threat, feature-flags consoles */}
            <Route path="admin/security-audit" element={<AdminRoute><SecurityAuditConsole /></AdminRoute>} />
            <Route path="admin/insider-threat" element={<AdminRoute><InsiderThreatConsole /></AdminRoute>} />
            <Route path="admin/feature-flags" element={<AdminRoute><FeatureFlagsConsole /></AdminRoute>} />
            {/* W17-C3: admin compliance console */}
            <Route path="admin/compliance" element={<AdminRoute><ComplianceConsole /></AdminRoute>} />
            {/* W17-C3: user-facing travel rule / TRISA pages (protected like
                the invest/* routes — server-side guards remain authoritative;
                trisa.pendingReview/approve fail closed for non-admins) */}
            <Route path="travel-rule" element={<TravelRulePage />} />
            <Route path="travel-rule/trisa" element={<TrisaPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
};

export default App;
