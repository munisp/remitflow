/**
 * Insider Threat Dashboard — Admin Security Control Panel
 *
 * Provides visibility into:
 * - Maker-Checker pending approvals
 * - JIT access grants (active + expired)
 * - DLP blocked events
 * - Canary token alerts
 * - Geo/time fence status
 * - WebAuthn key management
 * - Delayed reversal queue
 * - Audit chain integrity
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

// Types matching the backend
interface SecurityOverview {
  pendingMakerCheckerRequests: number;
  activeJITGrants: number;
  dlpBlockedEvents: number;
  pendingHighValueReversals: number;
  canaryAlertsTotal: number;
  webauthnKeysRegistered: number;
  geoTimeFenceActive: boolean;
  withinBusinessHours: boolean;
}

interface MakerCheckerRequest {
  id: string;
  operationType: string;
  requestedBy: number;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
  riskScore: number;
  requiredApprovers: number;
  currentApprovals: number;
  payload: Record<string, unknown>;
}

interface JITGrant {
  id: string;
  userId: number;
  privilege: string;
  grantedAt: string;
  expiresAt: string;
  reason: string;
  revoked: boolean;
  actionsPerformed: number;
}

interface DLPEvent {
  id: string;
  userId: number;
  action: string;
  table: string;
  recordCount: number;
  timestamp: string;
  blocked: boolean;
  reason?: string;
}

// Severity badge color mapping
function getSeverityColor(score: number): string {
  if (score >= 70) return "bg-red-100 text-red-800 border-red-200";
  if (score >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-green-100 text-green-800 border-green-200";
}

function getRiskLabel(score: number): string {
  if (score >= 70) return "Critical";
  if (score >= 40) return "High";
  return "Standard";
}

export default function InsiderThreatDashboard() {
  const [activeTab, setActiveTab] = useState<
    "overview" | "maker-checker" | "jit" | "dlp" | "canary" | "webauthn" | "reversals"
  >("overview");

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Insider Threat Controls
          </h1>
          <p className="mt-2 text-gray-600">
            Security dashboard for monitoring and managing insider threat prevention controls.
            All actions are logged to an immutable audit chain.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-8">
            {[
              { id: "overview", label: "Overview" },
              { id: "maker-checker", label: "Maker-Checker" },
              { id: "jit", label: "JIT Access" },
              { id: "dlp", label: "DLP Events" },
              { id: "canary", label: "Canary Alerts" },
              { id: "webauthn", label: "Security Keys" },
              { id: "reversals", label: "Delayed Reversals" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && <OverviewPanel />}
        {activeTab === "maker-checker" && <MakerCheckerPanel />}
        {activeTab === "jit" && <JITAccessPanel />}
        {activeTab === "dlp" && <DLPPanel />}
        {activeTab === "canary" && <CanaryPanel />}
        {activeTab === "webauthn" && <WebAuthnPanel />}
        {activeTab === "reversals" && <ReversalsPanel />}
      </div>
    </div>
  );
}

// ─── Overview Panel ──────────────────────────────────────────────────────────

function OverviewPanel() {
  // In production: useQuery with tRPC client
  const stats: SecurityOverview = {
    pendingMakerCheckerRequests: 3,
    activeJITGrants: 1,
    dlpBlockedEvents: 7,
    pendingHighValueReversals: 2,
    canaryAlertsTotal: 0,
    webauthnKeysRegistered: 12,
    geoTimeFenceActive: true,
    withinBusinessHours: true,
  };

  const cards = [
    { label: "Pending Approvals", value: stats.pendingMakerCheckerRequests, color: stats.pendingMakerCheckerRequests > 0 ? "text-orange-600" : "text-green-600", icon: "🔐" },
    { label: "Active JIT Grants", value: stats.activeJITGrants, color: stats.activeJITGrants > 0 ? "text-blue-600" : "text-gray-600", icon: "⏱️" },
    { label: "DLP Blocks (24h)", value: stats.dlpBlockedEvents, color: stats.dlpBlockedEvents > 5 ? "text-red-600" : "text-gray-600", icon: "🛡️" },
    { label: "Delayed Reversals", value: stats.pendingHighValueReversals, color: stats.pendingHighValueReversals > 0 ? "text-yellow-600" : "text-green-600", icon: "⏳" },
    { label: "Canary Alerts", value: stats.canaryAlertsTotal, color: stats.canaryAlertsTotal > 0 ? "text-red-600" : "text-green-600", icon: "🐦" },
    { label: "Security Keys", value: stats.webauthnKeysRegistered, color: "text-gray-600", icon: "🔑" },
  ];

  return (
    <div>
      {/* Status Banner */}
      <div className={`rounded-lg p-4 mb-6 ${stats.canaryAlertsTotal > 0 ? "bg-red-50 border border-red-200" : "bg-green-50 border border-green-200"}`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{stats.canaryAlertsTotal > 0 ? "⚠️" : "✅"}</span>
          <div>
            <p className="font-semibold text-gray-900">
              {stats.canaryAlertsTotal > 0 ? "ALERT: Canary tokens tripped — potential insider threat detected" : "No active insider threat indicators"}
            </p>
            <p className="text-sm text-gray-600">
              Geo fence: {stats.geoTimeFenceActive ? "Active" : "Disabled"} |
              Business hours: {stats.withinBusinessHours ? "Within bounds" : "After hours"} |
              Last audit chain verification: 2 minutes ago (valid)
            </p>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{card.label}</p>
                <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
              </div>
              <span className="text-3xl opacity-60">{card.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Defense Layers Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Defense Layers Status</h3>
        <div className="space-y-3">
          {[
            { layer: "Maker-Checker Dual Auth", status: "active", detail: "Enforced on transfers >$10K, FX overrides, role changes" },
            { layer: "JIT Privileged Access", status: "active", detail: "Max 2h grants, 3/day limit, auto-revoke on expiry" },
            { layer: "Geo + Time Fencing", status: "active", detail: "CA/NG/US/GB/KE/GH/ZA, Mon-Fri 6AM-10PM UTC" },
            { layer: "Data Loss Prevention", status: "active", detail: "100 records/query, 50 queries/hour on PII tables" },
            { layer: "WebAuthn/FIDO2", status: "active", detail: `${stats.webauthnKeysRegistered} keys registered, required for high-risk ops` },
            { layer: "Canary Tokens", status: "active", detail: "5 honey records deployed across key tables" },
            { layer: "Immutable Audit Sink", status: "active", detail: "Go service with HMAC-SHA256 hash chain, S3 Object Lock" },
            { layer: "Delayed Reversals", status: "active", detail: "4-hour cooling period for reversals >$10K" },
          ].map((layer) => (
            <div key={layer.layer} className="flex items-center justify-between p-3 bg-gray-50 rounded">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${layer.status === "active" ? "bg-green-500" : "bg-red-500"}`} />
                <span className="font-medium text-gray-900">{layer.layer}</span>
              </div>
              <span className="text-sm text-gray-500">{layer.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Maker-Checker Panel ─────────────────────────────────────────────────────

function MakerCheckerPanel() {
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);

  // Mock data (in production: tRPC query)
  const pendingRequests: MakerCheckerRequest[] = [
    {
      id: "mc_example_001",
      operationType: "transfer_reversal",
      requestedBy: 42,
      requestedAt: new Date(Date.now() - 3600000).toISOString(),
      status: "pending",
      riskScore: 65,
      requiredApprovers: 2,
      currentApprovals: 1,
      payload: { transferRef: "TRF-NGN-123456", amount: 75000, justification: "Customer reported unauthorized transaction" },
    },
    {
      id: "mc_example_002",
      operationType: "fx_rate_override",
      requestedBy: 15,
      requestedAt: new Date(Date.now() - 7200000).toISOString(),
      status: "pending",
      riskScore: 85,
      requiredApprovers: 2,
      currentApprovals: 0,
      payload: { pair: "USD/NGN", newRate: 1550.0, justification: "Market rate correction for after-hours settlement" },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Maker-Checker Approvals</h2>
        <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium">
          {pendingRequests.length} pending
        </span>
      </div>

      <div className="space-y-4">
        {pendingRequests.map((req) => (
          <div key={req.id} className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getSeverityColor(req.riskScore)}`}>
                    Risk: {getRiskLabel(req.riskScore)} ({req.riskScore}/100)
                  </span>
                  <span className="text-sm text-gray-500">
                    {req.operationType.replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  Requested by User #{req.requestedBy} at {new Date(req.requestedAt).toLocaleString()}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Justification: {String(req.payload.justification ?? "No justification provided")}
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Approvals: {req.currentApprovals}/{req.requiredApprovers} required
                </p>
              </div>
              <div className="flex gap-2">
                <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                  Approve
                </button>
                <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {pendingRequests.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No pending approval requests</p>
          <p className="text-sm mt-2">All maker-checker requests have been processed.</p>
        </div>
      )}
    </div>
  );
}

// ─── JIT Access Panel ────────────────────────────────────────────────────────

function JITAccessPanel() {
  const activeGrants: JITGrant[] = [
    {
      id: "jit_example_001",
      userId: 7,
      privilege: "bulk_export",
      grantedAt: new Date(Date.now() - 1800000).toISOString(),
      expiresAt: new Date(Date.now() + 5400000).toISOString(),
      reason: "Monthly compliance report generation for CBN submission",
      revoked: false,
      actionsPerformed: 3,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Just-In-Time Access</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          Request JIT Access
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>Policy:</strong> Admin privileges are granted for a maximum of 2 hours.
          Max 3 grants per day per user. All actions performed during JIT access are logged.
          Access auto-revokes on expiry.
        </p>
      </div>

      <div className="space-y-4">
        {activeGrants.map((grant) => {
          const expiresIn = Math.max(0, Math.floor((new Date(grant.expiresAt).getTime() - Date.now()) / 60000));
          return (
            <div key={grant.id} className="bg-white rounded-lg border border-blue-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                      {grant.privilege.replace(/_/g, " ").toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">
                      User #{grant.userId}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{grant.reason}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Expires in {expiresIn} minutes | {grant.actionsPerformed} actions performed
                  </p>
                </div>
                <button className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200">
                  Revoke
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DLP Panel ───────────────────────────────────────────────────────────────

function DLPPanel() {
  const events: DLPEvent[] = [
    { id: "dlp_001", userId: 23, action: "bulk_query", table: "users", recordCount: 500, timestamp: new Date(Date.now() - 600000).toISOString(), blocked: true, reason: "Bulk access to PII table exceeds 100 record limit" },
    { id: "dlp_002", userId: 23, action: "query", table: "transactions", recordCount: 50, timestamp: new Date(Date.now() - 900000).toISOString(), blocked: false },
    { id: "dlp_003", userId: 8, action: "query", table: "kyc_documents", recordCount: 150, timestamp: new Date(Date.now() - 1200000).toISOString(), blocked: true, reason: "Bulk access to PII table exceeds 100 record limit" },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Data Loss Prevention Events</h2>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">
          <strong>DLP Policy:</strong> Max 100 records per query on PII tables (users, kyc_documents, wallets, transactions, agent_network).
          Max 50 queries per hour. Blocked attempts require maker-checker approval for bulk export.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Table</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Records</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.map((event) => (
              <tr key={event.id} className={event.blocked ? "bg-red-50" : ""}>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${event.blocked ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>
                    {event.blocked ? "BLOCKED" : "ALLOWED"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">User #{event.userId}</td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">{event.table}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{event.recordCount}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{new Date(event.timestamp).toLocaleTimeString()}</td>
                <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{event.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Canary Panel ────────────────────────────────────────────────────────────

function CanaryPanel() {
  const canaryTokens = [
    { table: "users", recordId: "9999", status: "active", lastCheck: "2 min ago", tripCount: 0 },
    { table: "wallets", recordId: "9999", status: "active", lastCheck: "2 min ago", tripCount: 0 },
    { table: "transactions", recordId: "9999", status: "active", lastCheck: "2 min ago", tripCount: 0 },
    { table: "kyc_documents", recordId: "9999", status: "active", lastCheck: "2 min ago", tripCount: 0 },
    { table: "agent_network", recordId: "9999", status: "active", lastCheck: "2 min ago", tripCount: 0 },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Canary Token Monitoring</h2>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-gray-700">
          <strong>How it works:</strong> Honey records are planted in key database tables.
          Any access to these records triggers an immediate critical alert, as legitimate
          operations should never touch them. This detects insider data exploration/exfiltration.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {canaryTokens.map((token) => (
          <div key={token.table} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-sm font-medium text-gray-900">{token.table}</span>
              <span className={`w-2 h-2 rounded-full ${token.tripCount > 0 ? "bg-red-500 animate-pulse" : "bg-green-500"}`} />
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p>Record ID: {token.recordId}</p>
              <p>Status: {token.status}</p>
              <p>Last check: {token.lastCheck}</p>
              <p>Trips: {token.tripCount}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <button className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900">
          Test Canary (trigger alert)
        </button>
      </div>
    </div>
  );
}

// ─── WebAuthn Panel ──────────────────────────────────────────────────────────

function WebAuthnPanel() {
  const keys = [
    { id: "wak_001", name: "YubiKey 5 NFC", createdAt: "2024-01-15", lastUsed: "2 hours ago" },
    { id: "wak_002", name: "Backup Titan Key", createdAt: "2024-01-20", lastUsed: "5 days ago" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Hardware Security Keys (WebAuthn/FIDO2)</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          Register New Key
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>Required for:</strong> FX rate overrides, role changes, bulk data exports,
          break-glass access, and all operations with risk score {">"}70.
          Hardware keys prevent SIM-swap and phishing attacks on admin accounts.
        </p>
      </div>

      <div className="space-y-3">
        {keys.map((key) => (
          <div key={key.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-xl">
                🔑
              </div>
              <div>
                <p className="font-medium text-gray-900">{key.name}</p>
                <p className="text-xs text-gray-500">Registered: {key.createdAt} | Last used: {key.lastUsed}</p>
              </div>
            </div>
            <button className="text-sm text-red-600 hover:text-red-800 font-medium">Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Reversals Panel ─────────────────────────────────────────────────────────

function ReversalsPanel() {
  const pendingReversals = [
    {
      id: "rev_001",
      transferRef: "TRF-NGN-789012",
      amount: 25000,
      requestedBy: 42,
      requestedAt: new Date(Date.now() - 7200000).toISOString(),
      executeAt: new Date(Date.now() + 7200000).toISOString(),
      status: "pending" as const,
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Delayed High-Value Reversals</h2>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">
          <strong>Policy:</strong> Reversals above $10,000 USD have a 4-hour cooling period.
          During this window, the compliance team can cancel suspicious reversals.
          This prevents insiders from quickly extracting funds via unauthorized reversals.
        </p>
      </div>

      <div className="space-y-4">
        {pendingReversals.map((rev) => {
          const executeIn = Math.max(0, Math.floor((new Date(rev.executeAt).getTime() - Date.now()) / 60000));
          return (
            <div key={rev.id} className="bg-white rounded-lg border border-yellow-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {rev.transferRef} — ${rev.amount.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Requested by User #{rev.requestedBy} at {new Date(rev.requestedAt).toLocaleString()}
                  </p>
                  <p className="text-sm text-orange-600 mt-1 font-medium">
                    Executes in {executeIn} minutes
                  </p>
                </div>
                <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
                  Cancel Reversal
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
