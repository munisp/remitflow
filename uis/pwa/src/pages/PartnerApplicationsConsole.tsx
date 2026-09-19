/**
 * W13-PARTNER — Admin console for partner applications.
 *
 * Queue + detail + TOTP-gated approve/reject against
 * partnerApplications.adminList / adminGetDetail / startReview / approve /
 * reject (SPEC-wave13 §5.1). All transitions are guarded server-side
 * (CONFLICT on stale state) and approve requires the SLA to be signed.
 * approve returns emailSent honestly — when false the invite code must be
 * delivered manually (the console surfaces this prominently).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  errMsg,
  partner,
  type PartnerApplicationRow,
} from "../api";

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelCls = "block text-sm font-medium text-stone-700 mb-1";

const STATUS_FILTERS = [
  "all",
  "submitted",
  "under_review",
  "additional_info_required",
  "approved",
  "rejected",
] as const;

const statusTone = (s: string): string =>
  s === "approved"
    ? "bg-green-100 text-green-800"
    : s === "rejected"
      ? "bg-red-100 text-red-800"
      : s === "under_review"
        ? "bg-blue-100 text-blue-800"
        : "bg-stone-100 text-stone-700";

const PartnerApplicationsConsole: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("submitted");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PartnerApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<(PartnerApplicationRow & { comments?: any[] }) | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [totpCode, setTotpCode] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [plan, setPlan] = useState<"starter" | "growth" | "enterprise" | "white_label">("starter");
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await partner.partnerApplications.adminList.query({
        status: statusFilter,
        search: search || undefined,
        limit: 50,
      });
      setRows(res.applications);
      setTotal(res.total);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: number) => {
    setDetailError(null);
    setActionError(null);
    setActionResult(null);
    setTotpCode("");
    setRejectReason("");
    try {
      const detail = await partner.partnerApplications.adminGetDetail.query({ id });
      setSelected(detail);
      setPlan((detail.requested_plan as any) ?? "starter");
    } catch (err) {
      setDetailError(errMsg(err));
    }
  };

  const doAction = async (fn: () => Promise<void>) => {
    setActing(true);
    setActionError(null);
    setActionResult(null);
    try {
      await fn();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setActing(false);
    }
  };

  const onStartReview = () =>
    doAction(async () => {
      if (!selected) return;
      await partner.partnerApplications.startReview.mutate({ id: selected.id });
      setActionResult("Moved to under_review.");
      await openDetail(selected.id);
      void load();
    });

  const onApprove = () =>
    doAction(async () => {
      if (!selected) return;
      const res = await partner.partnerApplications.approve.mutate({
        id: selected.id,
        reviewNotes: reviewNotes || undefined,
        plan,
        totpCode: totpCode || undefined,
      });
      setActionResult(
        res.emailSent
          ? `Approved. Tenant #${res.tenantId} created (trial). Approval email sent — invite code: ${res.inviteCode}`
          : `Approved. Tenant #${res.tenantId} created (trial). WARNING: approval email was NOT sent (${res.emailError ?? "transport unavailable"}) — deliver invite code manually: ${res.inviteCode}`,
      );
      await openDetail(selected.id);
      void load();
    });

  const onReject = () =>
    doAction(async () => {
      if (!selected) return;
      await partner.partnerApplications.reject.mutate({
        id: selected.id,
        rejectionReason: rejectReason,
        reviewNotes: reviewNotes || undefined,
        totpCode: totpCode || undefined,
      });
      setActionResult("Application rejected.");
      await openDetail(selected.id);
      void load();
    });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">Partner applications</h1>
        <p className="mt-1 text-sm text-stone-600">
          Review queue. Approvals require 2FA and a signed SLA, and create a trial tenant.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className={inputCls + " max-w-xs"}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          className={inputCls + " max-w-xs"}
          placeholder="Search company / brand / email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          onClick={() => void load()}
          className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-900"
        >
          Refresh
        </button>
        <span className="text-sm text-stone-500">{total} application(s)</span>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-stone-500">Loading…</p>}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-2">Company</th>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">SLA</th>
              <th className="px-4 py-2">Submitted</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium text-stone-900">{r.company_name}</div>
                  <div className="text-xs text-stone-500">{r.slug}</div>
                </td>
                <td className="px-4 py-2 text-stone-700">{r.contact_email}</td>
                <td className="px-4 py-2 text-stone-700">{r.requested_plan}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(r.status)}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-stone-700">{r.sla_signed_at ? "signed" : "—"}</td>
                <td className="px-4 py-2 text-stone-700">
                  {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => void openDetail(r.id)}
                    className="text-sm font-medium text-amber-700 underline"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-500">
                  No applications in this state.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detailError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</p>}

      {selected && (
        <section className="rounded-xl border border-stone-200 bg-white p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                {selected.company_name} <span className="text-sm font-normal text-stone-500">({selected.slug})</span>
              </h2>
              <p className="text-sm text-stone-600">
                {selected.contact_name} · {selected.contact_email} · {selected.country}
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="text-sm text-stone-500 underline">
              Close
            </button>
          </div>

          <p className="whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
            {selected.business_description ?? "—"}
          </p>

          {selected.sla_signed_at ? (
            <p className="text-sm text-green-700">SLA signed {new Date(selected.sla_signed_at).toLocaleString()}</p>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              SLA not signed — approval is blocked until the applicant signs.
            </p>
          )}

          {(selected.comments ?? []).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-stone-800">History</h3>
              {(selected.comments ?? []).map((c: any) => (
                <div key={c.id} className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  <span className="font-medium">{c.author_name ?? "system"}</span>: {c.comment}
                  <span className="ml-2 text-xs text-stone-400">{new Date(c.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>2FA code (required for approve/reject)</label>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder="6-digit code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Plan</label>
              <select className={inputCls} value={plan} onChange={(e) => setPlan(e.target.value as any)}>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
                <option value="white_label">White label</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Review notes (internal)</label>
              <input className={inputCls} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Rejection reason (min 10 chars, required to reject)</label>
              <input className={inputCls} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </div>
          </div>

          {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
          {actionResult && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{actionResult}</p>}

          <div className="flex flex-wrap gap-3">
            {(selected.status === "submitted" || selected.status === "additional_info_required") && (
              <button
                onClick={onStartReview}
                disabled={acting}
                className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-900 disabled:opacity-50"
              >
                Start review
              </button>
            )}
            {(selected.status === "submitted" || selected.status === "under_review") && (
              <>
                <button
                  onClick={onApprove}
                  disabled={acting || !totpCode || !selected.sla_signed_at}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Approve (creates trial tenant)
                </button>
                <button
                  onClick={onReject}
                  disabled={acting || !totpCode || rejectReason.length < 10}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default PartnerApplicationsConsole;
