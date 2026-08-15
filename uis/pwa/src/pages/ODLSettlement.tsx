/**
 * ODL Settlement — On-Demand Liquidity transfer flow
 *
 * Allows users to settle cross-border payments via bridge assets
 * (USDC, USDT, XLM, XRP) without pre-funded Nostro accounts.
 * Features:
 *  - Real-time ODL quote with 30-second rate lock countdown
 *  - Multi-rail comparison (ODL vs SWIFT vs SEPA vs PAPSS)
 *  - Bridge asset selector (USDC / USDT / XLM / XRP)
 *  - Live settlement status tracker with audit trail
 *  - Slippage protection indicator
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

type BridgeAsset = "USDC" | "USDT" | "XLM" | "XRP";
type ODLProvider = "CIRCLE" | "RIPPLE" | "STELLAR" | "POLYGON";
type SettlementStatus =
  | "IDLE"
  | "QUOTING"
  | "QUOTED"
  | "PENDING"
  | "ON_RAMPING"
  | "BRIDGING"
  | "OFF_RAMPING"
  | "COMPLETED"
  | "FAILED"
  | "FAILED_SLIPPAGE";

interface ODLQuote {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  sendAmount: number;
  receiveAmount: number;
  bridgeAsset: BridgeAsset;
  provider: ODLProvider;
  totalFeePct: number;
  totalFeeAmount: number;
  slippagePct: number;
  expiresAt: string;
  lockedRate: boolean;
}

interface RailOption {
  rail: string;
  name: string;
  estimatedTime: string;
  totalFeePct: number;
  available: boolean;
  recommended: boolean;
  description: string;
  icon: string;
}

interface AuditEvent {
  timestamp: string;
  event: string;
  details: string;
  txId?: string;
}

interface ODLSettlement {
  settlementId: string;
  status: SettlementStatus;
  bridgeAsset: BridgeAsset;
  onRampTxId?: string;
  bridgeTxHash?: string;
  offRampTxId?: string;
  actualSlippage?: number;
  completedAt?: string;
  failureReason?: string;
  auditTrail: AuditEvent[];
}

// ── Mock data (replace with real API calls) ───────────────────────────────────

const MOCK_RAILS: RailOption[] = [
  {
    rail: "odl",
    name: "On-Demand Liquidity",
    estimatedTime: "< 30 seconds",
    totalFeePct: 0.15,
    available: true,
    recommended: true,
    description: "Bridge via USDC — no pre-funding required",
    icon: "⚡",
  },
  {
    rail: "papss",
    name: "PAPSS",
    estimatedTime: "1–2 minutes",
    totalFeePct: 0.25,
    available: true,
    recommended: false,
    description: "Pan-African Payment & Settlement System",
    icon: "🌍",
  },
  {
    rail: "swift",
    name: "SWIFT",
    estimatedTime: "1–3 business days",
    totalFeePct: 1.2,
    available: true,
    recommended: false,
    description: "Traditional correspondent banking",
    icon: "🏦",
  },
  {
    rail: "stablecoin",
    name: "Stablecoin Direct",
    estimatedTime: "< 2 minutes",
    totalFeePct: 0.10,
    available: true,
    recommended: false,
    description: "Direct USDC transfer on Polygon",
    icon: "🪙",
  },
];

const BRIDGE_ASSETS: { asset: BridgeAsset; name: string; network: string; icon: string }[] = [
  { asset: "USDC", name: "USD Coin", network: "Polygon", icon: "💲" },
  { asset: "USDT", name: "Tether", network: "Ethereum", icon: "💵" },
  { asset: "XLM", name: "Stellar Lumens", network: "Stellar", icon: "⭐" },
  { asset: "XRP", name: "XRP", network: "Ripple", icon: "🔷" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatusColor(status: SettlementStatus): string {
  switch (status) {
    case "COMPLETED": return "text-green-600 bg-green-50";
    case "FAILED":
    case "FAILED_SLIPPAGE": return "text-red-600 bg-red-50";
    case "ON_RAMPING":
    case "BRIDGING":
    case "OFF_RAMPING": return "text-blue-600 bg-blue-50";
    case "QUOTED": return "text-amber-600 bg-amber-50";
    default: return "text-slate-600 bg-slate-50";
  }
}

function getStatusLabel(status: SettlementStatus): string {
  switch (status) {
    case "IDLE": return "Ready";
    case "QUOTING": return "Getting quote…";
    case "QUOTED": return "Rate locked";
    case "PENDING": return "Initiating";
    case "ON_RAMPING": return "Converting to bridge asset";
    case "BRIDGING": return "Bridging across network";
    case "OFF_RAMPING": return "Converting to local currency";
    case "COMPLETED": return "Settlement complete";
    case "FAILED": return "Settlement failed";
    case "FAILED_SLIPPAGE": return "Aborted — slippage exceeded";
    default: return status;
  }
}

function getProgressPct(status: SettlementStatus): number {
  switch (status) {
    case "IDLE": return 0;
    case "QUOTING": return 5;
    case "QUOTED": return 15;
    case "PENDING": return 25;
    case "ON_RAMPING": return 45;
    case "BRIDGING": return 65;
    case "OFF_RAMPING": return 85;
    case "COMPLETED": return 100;
    case "FAILED":
    case "FAILED_SLIPPAGE": return 100;
    default: return 0;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ODLSettlementPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Form state
  const [fromCurrency, setFromCurrency] = useState(searchParams.get("from") || "USD");
  const [toCurrency, setToCurrency] = useState(searchParams.get("to") || "NGN");
  const [amount, setAmount] = useState(searchParams.get("amount") || "");
  const [selectedRail, setSelectedRail] = useState<string>("odl");
  const [selectedBridge, setSelectedBridge] = useState<BridgeAsset>("USDC");

  // Quote state
  const [quote, setQuote] = useState<ODLQuote | null>(null);
  const [quoteCountdown, setQuoteCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Settlement state
  const [settlement, setSettlement] = useState<ODLSettlement | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<SettlementStatus>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Quote countdown ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (quote && quoteCountdown > 0) {
      countdownRef.current = setInterval(() => {
        setQuoteCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current!);
            setQuote(null);
            setSettlementStatus("IDLE");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [quote]);

  // ── Get ODL quote ───────────────────────────────────────────────────────────

  const getQuote = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    setIsLoading(true);
    setError(null);
    setSettlementStatus("QUOTING");

    try {
      // In production: fetch from /api/odl/quote
      await new Promise((r) => setTimeout(r, 800));
      const mockQuote: ODLQuote = {
        quoteId: `QUOTE-${Date.now()}`,
        fromCurrency,
        toCurrency,
        sendAmount: parseFloat(amount),
        receiveAmount: parseFloat(amount) * 1595.5 * (1 - 0.0015),
        bridgeAsset: selectedBridge,
        provider: "CIRCLE",
        totalFeePct: 0.15,
        totalFeeAmount: parseFloat(amount) * 0.0015,
        slippagePct: 0.05,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        lockedRate: true,
      };
      setQuote(mockQuote);
      setQuoteCountdown(30);
      setSettlementStatus("QUOTED");
    } catch (err) {
      setError("Failed to get ODL quote. Please try again.");
      setSettlementStatus("IDLE");
    } finally {
      setIsLoading(false);
    }
  }, [amount, fromCurrency, toCurrency, selectedBridge]);

  // ── Initiate settlement ─────────────────────────────────────────────────────

  const initiateSettlement = useCallback(async () => {
    if (!quote) return;
    setIsLoading(true);
    setError(null);
    setSettlementStatus("PENDING");

    try {
      // In production: POST /api/odl/settlements
      await new Promise((r) => setTimeout(r, 500));
      const mockSettlement: ODLSettlement = {
        settlementId: `ODL-${Date.now()}`,
        status: "PENDING",
        bridgeAsset: quote.bridgeAsset,
        auditTrail: [
          {
            timestamp: new Date().toISOString(),
            event: "SETTLEMENT_INITIATED",
            details: `ODL settlement started for ${quote.sendAmount} ${quote.fromCurrency}`,
          },
        ],
      };
      setSettlement(mockSettlement);

      // Simulate progression
      const steps: SettlementStatus[] = ["ON_RAMPING", "BRIDGING", "OFF_RAMPING", "COMPLETED"];
      let i = 0;
      pollingRef.current = setInterval(() => {
        if (i < steps.length) {
          const status = steps[i];
          setSettlementStatus(status);
          setSettlement((prev) =>
            prev
              ? {
                  ...prev,
                  status,
                  auditTrail: [
                    ...prev.auditTrail,
                    {
                      timestamp: new Date().toISOString(),
                      event: status,
                      details: getStatusLabel(status),
                      txId: `TX-${Date.now()}`,
                    },
                  ],
                }
              : prev
          );
          i++;
        } else {
          clearInterval(pollingRef.current!);
        }
      }, 2000);
    } catch (err) {
      setError("Failed to initiate ODL settlement.");
      setSettlementStatus("FAILED");
    } finally {
      setIsLoading(false);
    }
  }, [quote]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const isSettling = ["PENDING", "ON_RAMPING", "BRIDGING", "OFF_RAMPING"].includes(settlementStatus);
  const isComplete = settlementStatus === "COMPLETED";
  const isFailed = settlementStatus === "FAILED" || settlementStatus === "FAILED_SLIPPAGE";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full hover:bg-white transition-colors"
          >
            ←
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">On-Demand Liquidity</h1>
            <p className="text-sm text-slate-500">
              Bridge-asset settlement — no pre-funding required
            </p>
          </div>
        </div>

        {/* Rail Comparison */}
        {!isSettling && !isComplete && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mb-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">
              Choose Settlement Rail
            </h2>
            <div className="space-y-2">
              {MOCK_RAILS.map((rail) => (
                <button
                  key={rail.rail}
                  onClick={() => setSelectedRail(rail.rail)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${
                    selectedRail === rail.rail
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-100 hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{rail.icon}</span>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{rail.name}</span>
                        {rail.recommended && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            Recommended
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{rail.description}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-900">
                      {rail.totalFeePct}% fee
                    </div>
                    <div className="text-xs text-slate-500">{rail.estimatedTime}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ODL Form */}
        {selectedRail === "odl" && !isSettling && !isComplete && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mb-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">
              Transfer Details
            </h2>

            {/* Amount input */}
            <div className="mb-4">
              <label className="block text-sm text-slate-600 mb-1">Send Amount</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setQuote(null);
                      setSettlementStatus("IDLE");
                    }}
                    placeholder="0.00"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={fromCurrency}
                  onChange={(e) => setFromCurrency(e.target.value)}
                  className="px-3 py-3 border border-slate-200 rounded-xl bg-slate-50 font-medium"
                >
                  {["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Destination */}
            <div className="mb-4">
              <label className="block text-sm text-slate-600 mb-1">Destination Currency</label>
              <select
                value={toCurrency}
                onChange={(e) => setToCurrency(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 font-medium"
              >
                {["NGN", "GHS", "KES", "ZAR", "TZS", "PHP", "INR", "BRL"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Bridge asset */}
            <div className="mb-4">
              <label className="block text-sm text-slate-600 mb-2">Bridge Asset</label>
              <div className="grid grid-cols-4 gap-2">
                {BRIDGE_ASSETS.map(({ asset, name, network, icon }) => (
                  <button
                    key={asset}
                    onClick={() => setSelectedBridge(asset)}
                    className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all ${
                      selectedBridge === asset
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-100 hover:border-slate-200"
                    }`}
                  >
                    <span className="text-xl mb-1">{icon}</span>
                    <span className="text-xs font-semibold">{asset}</span>
                    <span className="text-xs text-slate-400">{network}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quote display */}
            {quote && settlementStatus === "QUOTED" && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 mb-4 border border-blue-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-blue-900">Locked Rate</span>
                  <div className="flex items-center gap-2">
                    <div
                      className={`text-sm font-bold px-3 py-1 rounded-full ${
                        quoteCountdown > 10
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {quoteCountdown}s
                    </div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">You send</span>
                    <span className="font-semibold">
                      {quote.sendAmount.toFixed(2)} {quote.fromCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Bridge via</span>
                    <span className="font-semibold text-blue-700">
                      {quote.bridgeAsset} ({quote.provider})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total fee</span>
                    <span className="font-semibold">
                      {quote.totalFeePct}% (${quote.totalFeeAmount.toFixed(2)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Max slippage</span>
                    <span className="font-semibold text-green-700">{quote.slippagePct}%</span>
                  </div>
                  <div className="border-t border-blue-200 pt-2 flex justify-between">
                    <span className="font-semibold text-slate-900">Recipient gets</span>
                    <span className="font-bold text-lg text-blue-900">
                      {quote.receiveAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                      {quote.toCurrency}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Action buttons */}
            {settlementStatus !== "QUOTED" ? (
              <button
                onClick={getQuote}
                disabled={isLoading || !amount}
                className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? "Getting quote…" : "Get ODL Quote"}
              </button>
            ) : (
              <button
                onClick={initiateSettlement}
                disabled={isLoading || quoteCountdown === 0}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold text-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-lg"
              >
                {isLoading ? "Initiating…" : `Confirm ODL Settlement (${quoteCountdown}s)`}
              </button>
            )}
          </div>
        )}

        {/* Settlement Progress */}
        {(isSettling || isComplete || isFailed) && settlement && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                Settlement Progress
              </h2>
              <span
                className={`text-xs font-semibold px-3 py-1 rounded-full ${getStatusColor(
                  settlementStatus
                )}`}
              >
                {getStatusLabel(settlementStatus)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
              <div
                className={`h-2 rounded-full transition-all duration-1000 ${
                  isFailed ? "bg-red-500" : "bg-blue-500"
                }`}
                style={{ width: `${getProgressPct(settlementStatus)}%` }}
              />
            </div>

            {/* Steps */}
            <div className="space-y-2 mb-4">
              {(
                [
                  { status: "ON_RAMPING", label: "On-ramp to bridge asset" },
                  { status: "BRIDGING", label: "Bridge network transfer" },
                  { status: "OFF_RAMPING", label: "Off-ramp to local currency" },
                  { status: "COMPLETED", label: "Settlement complete" },
                ] as { status: SettlementStatus; label: string }[]
              ).map(({ status, label }) => {
                const stepOrder = ["ON_RAMPING", "BRIDGING", "OFF_RAMPING", "COMPLETED"];
                const currentIdx = stepOrder.indexOf(settlementStatus);
                const stepIdx = stepOrder.indexOf(status);
                const isDone = currentIdx > stepIdx || isComplete;
                const isCurrent = settlementStatus === status;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        isDone
                          ? "bg-green-500 text-white"
                          : isCurrent
                          ? "bg-blue-500 text-white animate-pulse"
                          : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {isDone ? "✓" : stepIdx + 1}
                    </div>
                    <span
                      className={`text-sm ${
                        isDone
                          ? "text-green-700 font-medium"
                          : isCurrent
                          ? "text-blue-700 font-semibold"
                          : "text-slate-400"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Audit trail */}
            {settlement.auditTrail.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                  Audit Trail
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {settlement.auditTrail.map((event, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-slate-400 flex-shrink-0">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                      <div>
                        <span className="font-medium text-slate-700">{event.event}</span>
                        <span className="text-slate-500"> — {event.details}</span>
                        {event.txId && (
                          <span className="text-blue-500 ml-1 font-mono">{event.txId}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Complete actions */}
            {isComplete && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => navigate("/dashboard")}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors"
                >
                  Done
                </button>
                <button
                  onClick={() => navigate("/transactions")}
                  className="flex-1 py-3 border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
                >
                  View Receipt
                </button>
              </div>
            )}

            {/* Failed actions */}
            {isFailed && (
              <div className="mt-4">
                <div className="bg-red-50 rounded-xl p-3 mb-3 text-sm text-red-700">
                  {settlement.failureReason || "Settlement failed. Please try again."}
                </div>
                <button
                  onClick={() => {
                    setSettlement(null);
                    setSettlementStatus("IDLE");
                    setQuote(null);
                    setError(null);
                  }}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Info box */}
        {!isSettling && !isComplete && (
          <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">
              ⚡ What is On-Demand Liquidity?
            </h3>
            <p className="text-xs text-blue-700 leading-relaxed">
              ODL eliminates the need for pre-funded accounts in destination countries. Your payment
              is instantly converted to a bridge asset (USDC, XLM, or XRP), transferred across the
              network in seconds, and converted to the local currency — all in one atomic
              transaction. This frees up working capital and enables real-time settlement in 186
              corridors.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
