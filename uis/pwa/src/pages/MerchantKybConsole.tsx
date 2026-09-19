/**
 * W13-MERCHANT (SPEC-wave13 §4.6) — Admin merchant KYB review console.
 *
 * Lists merchant_kyb_reviews (merchantOnboarding.adminList) and lets an admin
 * approve/reject with a risk rating, rejection reason (required on reject),
 * and TOTP step-up (merchantOnboarding.adminReview — server-side guarded
 * pending→approved|rejected, CONFLICT on double-decision).
 *
 * Visual standard: low-saturation warm palette (stone/amber), ample whitespace.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  merchantApiErrMsg,
  merchantOnboardingApi,
  type MerchantKybQueueRow,
  type MerchantKybReviewStatus,
} from "../api";

const inputCls =
  "w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-50";
const btnPrimaryCls =
  "px-5 py-2.5 bg-amber-700 text-white rounded-xl text-sm font-medium hover:bg-amber-800 transition-colors disabled:opacity-40";
const btnDangerCls =
  "px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40";

const STATUS_FILTERS: Array<{ value: "" | MerchantKybReviewStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function statusBadgeCls(status: string): string {
  switch (status) {
    case "active":
    case "approved":
      return "bg-emerald-50 text-emerald-700";
    case "rejected":
    case "suspended":
      return "bg-red-50 text-red-600";
    case "pending_kyb":
    case "pending":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-stone-100 text-stone-600";
  }
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const MerchantKybConsole: React.FC = () => {
  const [rows, setRows] = useState<MerchantKybQueueRow[]>([]);
  const [filter, setFilter] = useState<"" | MerchantKybReviewStatus>("pending");
  const [listErr, setListErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<MerchantKybQueueRow | null>(null);
  const [riskRating, setRiskRating] = useState<"low" | "medium" | "high">("medium");
  const [rejectionReason, setRejectionReason] = useState("");
  const [notes, setNotes] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListErr(null);
    try {
      const res = await merchantOnboardingApi.adminList.query(
        filter ? { status: filter } : undefined,
      );
      setRows(res);
    } catch (e) {
      setListErr(merchantApiErrMsg(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (decision: "approved" | "rejected") => {
    if (!selected) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await merchantOnboardingApi.adminReview.mutate({
        reviewId: selected.id,
        decision,
        riskRating,
        rejectionReason: decision === "rejected" ? rejectionReason.trim() : undefined,
        notes: notes.trim() || undefined,
        totpCode: totpCode.trim() || undefined,
      });
      setActionMsg(`Review #${res.reviewId} ${res.status} — merchant is now ${res.merchantStatus}.`);
      setSelected(null);
      setTotpCode("");
      setRejectionReason("");
      setNotes("");
      await load();
    } catch (e) {
      setActionErr(merchantApiErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">Merchant KYB console</h1>
        <p className="text-stone-500 mt-2 text-sm leading-relaxed">
          Review merchant onboarding applications. Approving activates the
          merchant account; every decision requires a 2FA code and is audited.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-amber-700 text-white"
                : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-stone-400">Loading review queue…</p>}
      {listErr && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {listErr}
        </div>
      )}
      {!loading && !listErr && rows.length === 0 && (
        <p className="text-sm text-stone-400">No applications in this state.</p>
      )}

      {rows.length > 0 && (
        <section className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                <th className="px-5 py-3 font-medium">Business</th>
                <th className="px-5 py-3 font-medium">Country</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Merchant</th>
                <th className="px-5 py-3 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-stone-50 cursor-pointer hover:bg-stone-50 ${
                    selected?.id === r.id ? "bg-amber-50" : ""
                  }`}
                  onClick={() => {
                    setSelected(r);
                    setActionErr(null);
                    setActionMsg(null);
                  }}
                >
                  <td className="px-5 py-3 text-stone-800">{r.businessName}</td>
                  <td className="px-5 py-3 text-stone-600">{r.country}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-stone-600">{r.merchantStatus ?? "—"}</td>
                  <td className="px-5 py-3 text-stone-500">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selected && (
        <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900">
              Review #{selected.id} — {selected.businessName}
            </h2>
            <button
              type="button"
              className="text-xs text-stone-400 hover:text-stone-600"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-stone-400 text-xs">Registration no.</dt>
              <dd className="text-stone-700">{selected.registrationNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Industry</dt>
              <dd className="text-stone-700">{selected.industry ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Expected monthly volume</dt>
              <dd className="text-stone-700">{selected.expectedMonthlyVol ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Website</dt>
              <dd className="text-stone-700 break-all">{selected.website ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Applicant user id</dt>
              <dd className="text-stone-700">{selected.userId}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Current risk rating</dt>
              <dd className="text-stone-700">{selected.riskRating ?? "—"}</dd>
            </div>
          </dl>

          {selected.status === "pending" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Risk rating
                  </label>
                  <select
                    className={inputCls}
                    value={riskRating}
                    onChange={(e) => setRiskRating(e.target.value as "low" | "medium" | "high")}
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    2FA code (required)
                  </label>
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">
                  Rejection reason (required to reject)
                </label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">
                  Reviewer notes (optional)
                </label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {actionErr && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {actionErr}
                </div>
              )}
              {actionMsg && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {actionMsg}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={btnPrimaryCls}
                  disabled={busy || !totpCode.trim()}
                  onClick={() => void decide("approved")}
                >
                  {busy ? "Working…" : "Approve"}
                </button>
                <button
                  type="button"
                  className={btnDangerCls}
                  disabled={busy || !totpCode.trim() || rejectionReason.trim().length < 5}
                  onClick={() => void decide("rejected")}
                >
                  {busy ? "Working…" : "Reject"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-500">
              This application has already been decided ({selected.status})
              {selected.rejectionReason ? ` — ${selected.rejectionReason}` : ""}.
            </p>
          )}
        </section>
      )}
    </div>
  );
};

export default MerchantKybConsole;
