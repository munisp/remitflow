/**
 * Admin console — KYC camera-capture session review (wave-15 SPEC §7).
 *
 * Replaces the pre-wave-15 empty scaffold in place (the stub was unrouted and
 * unused). Chosen over deletion because the kycCapture pipeline produces
 * sessions ending in `manual_review`, and no existing admin console (KYB,
 * partner applications, audit logs) surfaces them — reviewers need a list +
 * drill-down over captureSessions.list / captureSession.detail.
 *
 * Wired at /admin/kyc-capture-sessions (AdminRoute; server-side guards on the
 * captureSessions.* procedures remain authoritative). Uses the structural
 * client typing convention from pages/bdc/api.ts (see pages/kyc/api.ts).
 *
 * Honesty: pipeline stage results and detector events are displayed verbatim
 * from the server; this console renders data, it does not adjudicate.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  kycCaptureApi,
  errorMessage,
  type CaptureSessionDetail,
  type CaptureSessionSummary,
} from "../../pages/kyc/api";

const STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "manual_review", label: "Manual review" },
  { id: "failed", label: "Failed" },
  { id: "processing", label: "Processing" },
] as const;

const statusBadge = (status: string) =>
  status === "verified"
    ? "bg-emerald-50 text-emerald-700"
    : status === "failed"
      ? "bg-red-50 text-red-700"
      : status === "manual_review"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";

const EnhancedKYCVerification: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [items, setItems] = useState<CaptureSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CaptureSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await kycCaptureApi.captureSessions.list.query({
          ...(statusFilter ? { status: statusFilter } : {}),
          limit: 25,
          ...(cursor ? { cursor } : {}),
        });
        setItems((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor ?? null);
      } catch (err) {
        // Honest failure — the admin procedures may not be deployed yet.
        setLoadError(
          errorMessage(
            err,
            "Capture sessions could not be loaded. The admin review API may be unavailable.",
          ),
        );
        if (!cursor) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (sessionId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setSelected(null);
    try {
      const detail = await kycCaptureApi.captureSession.detail.query({ sessionId });
      setSelected(detail);
    } catch (err) {
      setDetailError(errorMessage(err, "Session detail could not be loaded."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          KYC Capture Sessions
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Camera-capture pipeline sessions and their stage results. Stage
          outcomes are shown exactly as the pipeline recorded them.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === f.id
                ? "bg-indigo-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:border-indigo-300"
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto px-3 py-1.5 rounded-full text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : items.length === 0 && !loadError ? (
          <p className="py-16 text-center text-sm text-slate-500">
            No capture sessions match this filter.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Doc type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr
                  key={s.sessionId}
                  onClick={() => void openDetail(s.sessionId)}
                  className="border-b border-slate-50 hover:bg-indigo-50/40 cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {s.sessionId.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {s.docType?.replace(/_/g, " ") ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${statusBadge(s.status)}`}
                    >
                      {s.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.createdAt ? new Date(s.createdAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextCursor && (
          <div className="p-3 text-center border-t border-slate-100">
            <button
              onClick={() => void load(nextCursor)}
              disabled={loading}
              className="text-sm text-indigo-600 font-medium disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {/* Session drill-down */}
      {(detailLoading || detailError || selected) && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Session detail
            </h2>
            <button
              onClick={() => {
                setSelected(null);
                setDetailError(null);
              }}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              Close
            </button>
          </div>

          {detailLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              Loading session…
            </div>
          )}
          {detailError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
              {detailError}
            </div>
          )}

          {selected && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Session ID</p>
                  <p className="font-mono text-xs break-all">{selected.sessionId}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Status</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(selected.status)}`}>
                    {selected.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Verdict</p>
                  <p className="text-slate-700">{selected.verdict ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Document type</p>
                  <p className="text-slate-700">{selected.docType?.replace(/_/g, " ") ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">User</p>
                  <p className="font-mono text-xs">{selected.userId ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Created</p>
                  <p className="text-slate-700">
                    {selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "—"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Pipeline stages
                </p>
                {selected.pipelineResults && selected.pipelineResults.length > 0 ? (
                  <div className="space-y-2">
                    {selected.pipelineResults.map((r, i) => (
                      <div
                        key={`${r.stage}-${i}`}
                        className={`flex items-start justify-between gap-3 p-3 rounded-xl ${
                          r.ok ? "bg-emerald-50" : "bg-red-50"
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-800 capitalize">
                            {r.stage.replace(/_/g, " ")}
                          </p>
                          {r.reason && (
                            <p className="text-xs text-slate-600 mt-0.5">{r.reason}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-xs font-semibold ${r.ok ? "text-emerald-600" : "text-red-600"}`}>
                            {r.ok ? "Pass" : "Fail"}
                          </span>
                          {typeof r.score === "number" && (
                            <p className="text-xs text-slate-500">
                              score {r.score.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    No pipeline stage results recorded for this session.
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Challenge events
                </p>
                {selected.events && selected.events.length > 0 ? (
                  <div className="space-y-1">
                    {[...selected.events]
                      .sort((a, b) => a.seq - b.seq)
                      .map((e) => (
                        <div
                          key={e.seq}
                          className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50"
                        >
                          <span className="text-slate-700">
                            <span className="text-slate-400 mr-2">#{e.seq}</span>
                            {e.event.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(e.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    No challenge events recorded for this session.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export { EnhancedKYCVerification };
export default EnhancedKYCVerification;
