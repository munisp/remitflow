/**
 * Small shared UI primitives for the BDC console pages, styled to match the
 * existing PWA pages (Tailwind, rounded-2xl cards, indigo accents — see
 * pages/Transactions.tsx).
 */
import React from "react";

export const inputCls =
  "w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50";

export const btnPrimaryCls =
  "px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40";
export const btnSecondaryCls =
  "px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40";
export const btnDangerCls =
  "px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40";

export const PageHeader: React.FC<{ title: string; subtitle: string }> = ({
  title,
  subtitle,
}) => (
  <div>
    <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
    <p className="text-slate-500 mt-1">{subtitle}</p>
  </div>
);

export const Card: React.FC<{
  title?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, children, className = "" }) => (
  <div className={`bg-white rounded-2xl border border-slate-100 p-5 ${className}`}>
    {title && (
      <h2 className="text-sm font-semibold text-slate-900 mb-3">{title}</h2>
    )}
    {children}
  </div>
);

export const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
}> = ({ label, children, hint }) => (
  <div>
    <label className="block text-xs font-medium text-slate-500 mb-1">
      {label}
    </label>
    {children}
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

const badgeStyles: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-600",
  info: "bg-indigo-50 text-indigo-600",
  neutral: "bg-slate-50 text-slate-600",
};

export const Badge: React.FC<{
  tone?: keyof typeof badgeStyles;
  children: React.ReactNode;
}> = ({ tone = "neutral", children }) => (
  <span
    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeStyles[tone]}`}
  >
    {children}
  </span>
);

/** Map common bdc.* entity statuses to badge tones. */
export function statusTone(status: string | null | undefined): keyof typeof badgeStyles {
  switch ((status ?? "").toLowerCase()) {
    case "active":
    case "published":
    case "settled":
    case "approved":
    case "delivered":
    case "acknowledged":
    case "verified":
    case "funded":
    case "liquidated":
      return "ok";
    case "pending":
    case "draft":
    case "submitted":
    case "requested":
    case "selling":
    case "in_transit":
    case "staged":
    case "accrued":
    case "aip":
    case "provisional":
      return "warn";
    case "failed":
    case "rejected":
    case "reversed":
    case "suspended":
    case "expired":
    case "disputed":
    case "quarantined":
    case "closed":
      return "bad";
    default:
      return "neutral";
  }
}

export const ErrorNote: React.FC<{ error: unknown }> = ({ error }) => {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700 whitespace-pre-wrap">
      {msg}
    </div>
  );
};

export const SuccessNote: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700">
    {children}
  </div>
);

/**
 * Honest placeholder for a UI whose backing bdc.* procedure is not in the
 * SPEC §3 contract. We never invent endpoints — the gap is surfaced instead.
 */
export const EndpointPending: React.FC<{ procedure: string; note?: string }> = ({
  procedure,
  note,
}) => (
  <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
    <span className="font-medium">Endpoint pending:</span>{" "}
    <code className="font-mono text-xs">{procedure}</code> is not in the frozen
    SPEC §3 contract.
    {note && <span className="block mt-1 text-xs text-amber-600">{note}</span>}
  </div>
);

export const JsonView: React.FC<{ data: unknown }> = ({ data }) => (
  <pre className="p-3 bg-slate-50 rounded-xl text-xs font-mono text-slate-700 overflow-auto max-h-80">
    {JSON.stringify(data, null, 2)}
  </pre>
);

export const Spinner: React.FC<{ label?: string }> = ({ label = "Loading..." }) => (
  <div className="flex items-center justify-center py-8">
    <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    <span className="ml-3 text-slate-500 text-sm">{label}</span>
  </div>
);
