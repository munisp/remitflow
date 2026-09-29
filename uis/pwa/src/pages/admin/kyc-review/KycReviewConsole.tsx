/**
 * W16-C5 — Admin KYC review console (/admin/kyc-review, AdminRoute-gated).
 *
 * First UI consumer of the mounted `admin` KYC namespace
 * (server/routers.ts:4784+ — 48 adminProcedure procs with zero PWA consumers
 * before this wave):
 *   - queue:    admin.listPendingKyc        (status filter + pagination)
 *   - evidence: admin.getKycDocumentHistory (per-user document history incl.
 *               extractedData) and captureSessions.list (camera-capture
 *               pipeline sessions for the same user — selfie/liveness evidence)
 *   - actions:  admin.setKycUnderReview, admin.approveKyc (PBAC
 *               kycApproveProcedure), admin.rejectKyc (reason min 5 chars)
 *
 * TOTP step-up follows the BDC console pattern (pages/bdc/TotpField.tsx):
 * the 6-digit code is collected on the action panel and forwarded as
 * `totpCode`; the PBAC middleware enforces MFA fail-closed whenever a policy
 * requires it, and any server "2FA_REQUIRED"/FORBIDDEN error is surfaced
 * verbatim. This console renders server data and records decisions — it never
 * fabricates queue entries.
 *
 * Visual/interaction standard: MerchantKybConsole + BDC consoles (Tailwind,
 * rounded-2xl cards, indigo accents, shared primitives from pages/bdc/ui.tsx).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  adminKycApi,
  errorMessage,
  type CaptureSessionRow,
  type KycDocumentRow,
  type KycStatusFilter,
  type PendingKycDoc,
} from "./api";
import TotpField from "../../bdc/TotpField";
import {
  Badge,
  btnDangerCls,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  ErrorNote,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "../../bdc/ui";

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: KycStatusFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "Under review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const fmtDocType = (v: string | null | undefined) => v?.replace(/_/g, " ") ?? "—";

const KycReviewConsole: React.FC = () => {
  // ── queue ──
  const [filter, setFilter] = useState<KycStatusFilter>("pending");
  const [page, setPage] = useState(1);
  const [docs, setDocs] = useState<PendingKycDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  // ── detail / evidence ──
  const [selected, setSelected] = useState<PendingKycDoc | null>(null);
  const [history, setHistory] = useState<KycDocumentRow[] | null>(null);
  const [sessions, setSessions] = useState<CaptureSessionRow[] | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── actions ──
  const [advanceTier, setAdvanceTier] = useState(true);
  const [reason, setReason] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListErr(null);
    try {
      const res = await adminKycApi.admin.listPendingKyc.query({
        page,
        limit: PAGE_SIZE,
        status: filter,
      });
      setDocs(res.docs);
      setTotal(res.total);
      setPages(res.pages);
    } catch (e) {
      // Honest failure — server-side admin guard or outage; never fabricate rows.
      setListErr(
        errorMessage(e, "Pending KYC queue could not be loaded. The admin API may be unavailable."),
      );
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to first page when the filter changes.
  useEffect(() => {
    setPage(1);
  }, [filter]);

  const openDetail = useCallback(async (doc: PendingKycDoc) => {
    setSelected(doc);
    setHistory(null);
    setSessions(null);
    setDetailErr(null);
    setActionErr(null);
    setActionMsg(null);
    setReason("");
    setTotp("");
    setAdvanceTier(true);
    setDetailLoading(true);
    try {
      // Evidence reads are independent — load concurrently, each fail-closed
      // but non-blocking for the other.
      const [historyRes, sessionsRes] = await Promise.allSettled([
        adminKycApi.admin.getKycDocumentHistory.query({ userId: doc.userId }),
        adminKycApi.captureSessions.list.query({ userId: doc.userId, limit: 10 }),
      ]);
      if (historyRes.status === "fulfilled") {
        setHistory(historyRes.value.docs);
      }
      if (sessionsRes.status === "fulfilled") {
        setSessions(sessionsRes.value.sessions);
      }
      if (historyRes.status === "rejected" && sessionsRes.status === "rejected") {
        setDetailErr(
          errorMessage(
            historyRes.reason,
            "Document evidence could not be loaded for this user.",
          ),
        );
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const runAction = async (action: "approve" | "reject" | "under_review") => {
    if (!selected) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const totpCode = totp.length === 6 ? totp : undefined;
      if (action === "approve") {
        await adminKycApi.admin.approveKyc.mutate({
          docId: selected.id,
          advanceTier,
          ...(totpCode ? { totpCode } : {}),
        });
        setActionMsg(
          `Document #${selected.id} approved${advanceTier ? " and user tier advanced" : ""}.`,
        );
      } else if (action === "reject") {
        await adminKycApi.admin.rejectKyc.mutate({
          docId: selected.id,
          reason: reason.trim(),
          ...(totpCode ? { totpCode } : {}),
        });
        setActionMsg(`Document #${selected.id} rejected.`);
      } else {
        await adminKycApi.admin.setKycUnderReview.mutate({ docId: selected.id });
        setActionMsg(`Document #${selected.id} marked under review.`);
      }
      setTotp("");
      setReason("");
      await load();
      // The queue row changed status — close the panel (its actions are stale).
      setSelected(null);
    } catch (e) {
      // Surface the server message verbatim — includes PBAC denials and
      // "2FA_REQUIRED …" step-up failures.
      setActionErr(errorMessage(e, "Action failed."));
    } finally {
      setBusy(false);
    }
  };

  const actionable = selected && (selected.status === "pending" || selected.status === "under_review");

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="KYC review console"
        subtitle="Review pending identity documents and camera-capture evidence. Approving a document advances the user's KYC tier (server-side PBAC guard, audited)."
      />

      {/* ── queue filter ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-indigo-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:border-indigo-300"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-2">
          {loading ? "…" : `${total} document${total === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto px-3 py-1.5 rounded-full text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {listErr && <ErrorNote error={listErr} />}

      {/* ── queue table ── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {loading && docs.length === 0 ? (
          <Spinner label="Loading queue…" />
        ) : docs.length === 0 && !listErr ? (
          <p className="py-16 text-center text-sm text-slate-500">
            No KYC documents match this filter.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3">Doc</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Doc type</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => void openDetail(d)}
                  className={`border-b border-slate-50 hover:bg-indigo-50/40 cursor-pointer ${
                    selected?.id === d.id ? "bg-indigo-50/60" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">#{d.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-800">{d.userName ?? `User #${d.userId}`}</p>
                    <p className="text-xs text-slate-400">{d.userEmail ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{fmtDocType(d.docType)}</td>
                  <td className="px-4 py-3 text-slate-600">{d.userKycTier ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(d.status)}>{(d.status ?? "—").replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-slate-100 text-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || page <= 1}
              className={btnSecondaryCls}
            >
              Previous
            </button>
            <span className="text-xs text-slate-400">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={loading || page >= pages}
              className={btnSecondaryCls}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* ── detail / evidence / actions ── */}
      {selected && (
        <Card className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Document #{selected.id} — {selected.userName ?? `User #${selected.userId}`}
            </h2>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">User</p>
              <p className="text-slate-700">{selected.userName ?? "—"}</p>
              <p className="text-xs text-slate-400">{selected.userEmail ?? `id ${selected.userId}`}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Document type</p>
              <p className="text-slate-700 capitalize">{fmtDocType(selected.docType)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Status</p>
              <Badge tone={statusTone(selected.status)}>
                {(selected.status ?? "—").replace(/_/g, " ")}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-slate-400">Current KYC tier</p>
              <p className="text-slate-700">{selected.userKycTier ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Submitted</p>
              <p className="text-slate-700">{fmtDate(selected.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Reviewed</p>
              <p className="text-slate-700">{fmtDate(selected.reviewedAt)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-slate-400">Document file</p>
              {selected.fileUrl ? (
                <a
                  href={selected.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:underline break-all text-xs font-mono"
                >
                  {selected.fileUrl}
                </a>
              ) : (
                <p className="text-slate-500">No file URL recorded</p>
              )}
            </div>
            {selected.rejectionReason && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-xs text-slate-400">Prior rejection reason</p>
                <p className="text-sm text-red-600">{selected.rejectionReason}</p>
              </div>
            )}
          </div>

          {detailLoading && <Spinner label="Loading evidence…" />}
          {detailErr && <ErrorNote error={detailErr} />}

          {/* Document evidence — full history incl. OCR extraction for this doc */}
          {history && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Document history ({history.length})
              </p>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">No documents recorded for this user.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className={`p-3 rounded-xl border text-sm ${
                        h.id === selected.id
                          ? "border-indigo-200 bg-indigo-50/40"
                          : "border-slate-100 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-slate-700">
                          <span className="font-mono text-xs text-slate-400 mr-2">#{h.id}</span>
                          <span className="capitalize">{fmtDocType(h.docType)}</span>
                          {h.id === selected.id && (
                            <span className="ml-2 text-xs text-indigo-600 font-medium">
                              under review
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-3">
                          <Badge tone={statusTone(h.status)}>
                            {(h.status ?? "—").replace(/_/g, " ")}
                          </Badge>
                          <span className="text-xs text-slate-400">{fmtDate(h.createdAt)}</span>
                        </span>
                      </div>
                      {h.rejectionReason && (
                        <p className="text-xs text-red-600 mt-1">Rejected: {h.rejectionReason}</p>
                      )}
                      {h.id === selected.id && h.extractedData != null && (
                        <div className="mt-2">
                          <p className="text-xs text-slate-400 mb-1">
                            OCR-extracted data (as recorded by the pipeline):
                          </p>
                          <JsonView data={h.extractedData} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Camera-capture (selfie/liveness) evidence for the same user */}
          {sessions && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Camera-capture sessions ({sessions.length})
              </p>
              {sessions.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No camera-capture sessions recorded for this user.
                </p>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div key={s.id} className="p-3 rounded-xl bg-slate-50/60 border border-slate-100">
                      <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
                        <span className="font-mono text-xs text-slate-500">
                          {s.id.slice(0, 12)}…
                          <span className="ml-2 text-slate-700 capitalize">
                            {fmtDocType(s.docType)}
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Badge tone={statusTone(s.status)}>{s.status.replace(/_/g, " ")}</Badge>
                          <span className="text-xs text-slate-400">{fmtDate(s.createdAt)}</span>
                        </span>
                      </div>
                      {s.pipelineResults.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {s.pipelineResults.map((r) => (
                            <span
                              key={r.id}
                              title={typeof r.score === "number" ? `score ${r.score.toFixed(2)}` : undefined}
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                r.success
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-red-50 text-red-600"
                              }`}
                            >
                              {r.stage.replace(/_/g, " ")}
                              {typeof r.score === "number" ? ` ${r.score.toFixed(2)}` : ""}
                              {r.simulated ? " (simulated)" : ""}
                            </span>
                          ))}
                        </div>
                      )}
                      {s.verdict != null && (
                        <p className="text-xs text-slate-500 mt-1.5 font-mono break-all">
                          verdict: {JSON.stringify(s.verdict)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── actions ── */}
          {actionable ? (
            <div className="border-t border-slate-100 pt-4 space-y-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Decision
              </p>

              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={advanceTier}
                  onChange={(e) => setAdvanceTier(e.target.checked)}
                  disabled={busy}
                  className="mt-0.5"
                />
                <span>
                  Advance user KYC tier on approval
                  <span className="block text-xs text-slate-400">
                    Server bumps tier0→tier1→tier2→tier3 and audits the decision.
                  </span>
                </span>
              </label>

              <Field label="Rejection reason (required to reject, 5–500 chars)">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. Document expired — please resubmit a valid passport."
                  className={inputCls}
                />
              </Field>

              <TotpField
                value={totp}
                onChange={setTotp}
                disabled={busy}
                label="TOTP step-up code (if your account requires 2FA)"
              />

              {actionErr && <ErrorNote error={actionErr} />}
              {actionMsg && <SuccessNote>{actionMsg}</SuccessNote>}

              <div className="flex items-center gap-2 flex-wrap">
                {selected.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => void runAction("under_review")}
                    disabled={busy}
                    className={btnSecondaryCls}
                  >
                    Mark under review
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void runAction("approve")}
                  disabled={busy}
                  className={btnPrimaryCls}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void runAction("reject")}
                  disabled={busy || reason.trim().length < 5}
                  className={btnDangerCls}
                >
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 border-t border-slate-100 pt-4">
              This document has already been {selected.status?.replace(/_/g, " ")} — no further
              action is available from this console.
            </p>
          )}
        </Card>
      )}
    </div>
  );
};

export default KycReviewConsole;
