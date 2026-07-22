/**
 * KYCStatusTracker.tsx — Real-time KYC/KYB Status & Trigger Event Dashboard
 *
 * Shows:
 *  - Current KYC tier with progress bar to next tier
 *  - Live trigger event history (polling every 10s)
 *  - Transaction limit display per tier
 *  - Re-KYC schedule and expiry warnings
 *  - Account freeze status with reason
 *  - KYB business verification status
 */

import React, { useEffect, useState } from "react";

interface TriggerEvent {
  id: string;
  triggerType: string;
  status: "fired" | "processing" | "workflow_started" | "completed" | "failed" | "ignored";
  amount?: number;
  currency?: string;
  firedAt: string;
  processedAt?: string;
  metadata?: Record<string, unknown>;
}

interface KYCDashboardData {
  userId: string;
  kycTier: number;
  kycStatus: string;
  frozen: boolean;
  freezeReason?: string;
  kycExpiresAt?: string;
  riskScore?: number;
  isPep?: boolean;
  recentTriggers: TriggerEvent[];
  reKYCDueAt?: string;
  dailyLimitUsed: number;
  dailyLimitTotal: number;
  monthlyLimitUsed: number;
  monthlyLimitTotal: number;
}

const TIER_COLORS: Record<number, string> = {
  0: "gray",
  1: "yellow",
  2: "blue",
  3: "purple",
  4: "green",
};

const TRIGGER_LABELS: Record<string, string> = {
  user_registration: "Account Created",
  first_transfer_attempt: "First Transfer Attempted",
  transaction_over_1000: "Transaction >$1,000 (Travel Rule)",
  transaction_over_10000: "Transaction >$10,000 (CTR)",
  pep_match_detected: "PEP Match Detected",
  sanctions_hit: "Sanctions Screening Hit",
  high_risk_score: "High Risk Score Flagged",
  periodic_rekyc_due: "Annual Re-KYC Due",
  country_risk_change: "Country Risk Level Changed",
  sar_filed: "Suspicious Activity Report Filed",
  business_registration: "Business Registration",
  director_change: "Director/Officer Change",
  merchant_onboarding: "Merchant Onboarding",
  license_expiry: "Business License Expiring",
  beneficial_owner_change: "Beneficial Owner Change",
  kyc_tier_upgrade_required: "KYC Tier Upgrade Required",
};

const TRIGGER_ICONS: Record<string, string> = {
  user_registration: "👤",
  first_transfer_attempt: "💸",
  transaction_over_1000: "📋",
  transaction_over_10000: "🏦",
  pep_match_detected: "⚠️",
  sanctions_hit: "🚫",
  high_risk_score: "🔴",
  periodic_rekyc_due: "📅",
  country_risk_change: "🌍",
  sar_filed: "🔒",
  business_registration: "🏢",
  director_change: "👔",
  merchant_onboarding: "🏪",
  license_expiry: "📜",
  beneficial_owner_change: "💼",
  kyc_tier_upgrade_required: "⬆️",
};

const STATUS_COLORS: Record<string, string> = {
  fired: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  workflow_started: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  ignored: "bg-gray-100 text-gray-600",
};

const KYC_PIPELINE_URL = import.meta.env.VITE_KYC_PIPELINE_URL ?? "/api/kyc";

const KYCStatusTracker: React.FC = () => {
  const [data, setData] = useState<KYCDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "triggers" | "limits">("overview");
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setError(null);
      const res = await fetch(`${KYC_PIPELINE_URL}/dashboard`);
      if (!res.ok) throw new Error(`KYC dashboard request failed with status ${res.status}`);
      setData(await res.json() as KYCDashboardData);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "KYC dashboard data could not be loaded from the backend.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "KYC dashboard data is unavailable."}
        </div>
      </div>
    );
  }

  const tierColor = TIER_COLORS[data.kycTier] ?? "gray";
  const dailyPercent = data.dailyLimitTotal > 0 ? (data.dailyLimitUsed / data.dailyLimitTotal) * 100 : 0;
  const monthlyPercent = data.monthlyLimitTotal > 0 ? (data.monthlyLimitUsed / data.monthlyLimitTotal) * 100 : 0;

  const daysUntilExpiry = data.kycExpiresAt
    ? Math.ceil((new Date(data.kycExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Frozen alert */}
      {data.frozen && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔒</span>
            <div>
              <h3 className="font-bold text-red-800">Account Frozen</h3>
              <p className="text-sm text-red-700">{data.freezeReason ?? "Compliance review in progress"}</p>
            </div>
          </div>
          <button
            onClick={() => (window.location.href = "/support")}
            className="mt-3 w-full bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700"
          >
            Contact Support
          </button>
        </div>
      )}

      {/* KYC expiry warning */}
      {daysUntilExpiry !== null && daysUntilExpiry <= 30 && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h3 className="font-bold text-yellow-800">KYC Expiring Soon</h3>
              <p className="text-sm text-yellow-700">
                Your verification expires in {daysUntilExpiry} days. Please re-verify to maintain access.
              </p>
            </div>
          </div>
          <button
            onClick={() => (window.location.href = "/kyc/onboarding")}
            className="mt-3 w-full bg-yellow-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-yellow-600"
          >
            Re-verify Now
          </button>
        </div>
      )}

      {/* KYC Tier Card */}
      <div className={`bg-${tierColor}-50 border border-${tierColor}-200 rounded-2xl p-6`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-gray-500 font-medium">Verification Level</p>
            <h2 className={`text-2xl font-bold text-${tierColor}-700`}>
              Tier {data.kycTier} — {["Unverified", "Basic", "Standard", "Enhanced", "Institutional"][data.kycTier]}
            </h2>
          </div>
          <div
            className={`w-16 h-16 rounded-full bg-${tierColor}-100 border-4 border-${tierColor}-400 flex items-center justify-center`}
          >
            <span className={`text-2xl font-black text-${tierColor}-600`}>{data.kycTier}</span>
          </div>
        </div>

        {/* Tier progress */}
        {data.kycTier < 3 && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Tier {data.kycTier}</span>
              <span>Tier {data.kycTier + 1}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`bg-${tierColor}-500 h-2 rounded-full`}
                style={{ width: `${(data.kycTier / 3) * 100}%` }}
              />
            </div>
            <button
              onClick={() => (window.location.href = "/kyc/onboarding")}
              className={`mt-3 w-full bg-${tierColor}-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-${tierColor}-700`}
            >
              Upgrade to Tier {data.kycTier + 1} →
            </button>
          </div>
        )}

        {/* Risk score */}
        {data.riskScore !== undefined && (
          <div className="mt-4 flex items-center gap-4 text-sm">
            <div>
              <span className="text-gray-500">Risk Score: </span>
              <span
                className={`font-bold ${data.riskScore > 75 ? "text-red-600" : data.riskScore > 50 ? "text-yellow-600" : "text-green-600"}`}
              >
                {data.riskScore.toFixed(0)}/100
              </span>
            </div>
            {data.isPep && (
              <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full text-xs font-medium">
                PEP Flagged
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(["overview", "triggers", "limits"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "triggers" ? "Trigger History" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">KYC Status</p>
              <p
                className={`font-bold capitalize ${data.kycStatus === "verified" ? "text-green-600" : data.kycStatus === "rejected" ? "text-red-600" : "text-yellow-600"}`}
              >
                {data.kycStatus === "verified" ? "✓ Verified" : data.kycStatus}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Trigger Events</p>
              <p className="font-bold text-gray-900">{data.recentTriggers.length} recent</p>
            </div>
          </div>

          {data.reKYCDueAt && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Next Re-KYC Due</p>
              <p className="font-bold text-gray-900">{new Date(data.reKYCDueAt).toLocaleDateString()}</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Trigger History */}
      {activeTab === "triggers" && (
        <div className="space-y-3">
          {data.recentTriggers.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-4xl mb-2">📋</p>
              <p>No trigger events yet</p>
            </div>
          ) : (
            data.recentTriggers.map((trigger) => (
              <div key={trigger.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{TRIGGER_ICONS[trigger.triggerType] ?? "🔔"}</span>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">
                        {TRIGGER_LABELS[trigger.triggerType] ?? trigger.triggerType}
                      </p>
                      {trigger.amount && (
                        <p className="text-xs text-gray-500">
                          Amount: {trigger.currency} {trigger.amount.toLocaleString()}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(trigger.firedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[trigger.status] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {trigger.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Limits */}
      {activeTab === "limits" && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex justify-between items-center mb-2">
              <p className="font-medium text-gray-900">Daily Limit</p>
              <p className="text-sm text-gray-500">
                ${data.dailyLimitUsed.toLocaleString()} / ${data.dailyLimitTotal.toLocaleString()}
              </p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${dailyPercent > 90 ? "bg-red-500" : dailyPercent > 70 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${Math.min(dailyPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">{(100 - dailyPercent).toFixed(0)}% remaining today</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex justify-between items-center mb-2">
              <p className="font-medium text-gray-900">Monthly Limit</p>
              <p className="text-sm text-gray-500">
                ${data.monthlyLimitUsed.toLocaleString()} / ${data.monthlyLimitTotal.toLocaleString()}
              </p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${monthlyPercent > 90 ? "bg-red-500" : monthlyPercent > 70 ? "bg-yellow-500" : "bg-blue-500"}`}
                style={{ width: `${Math.min(monthlyPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">{(100 - monthlyPercent).toFixed(0)}% remaining this month</p>
          </div>

          {data.kycTier < 3 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
              <p className="text-sm text-blue-800 font-medium">
                Upgrade to Tier {data.kycTier + 1} to increase your limits
              </p>
              <button
                onClick={() => (window.location.href = "/kyc/onboarding")}
                className="mt-2 bg-blue-600 text-white py-2 px-6 rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                Upgrade Now
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default KYCStatusTracker;
