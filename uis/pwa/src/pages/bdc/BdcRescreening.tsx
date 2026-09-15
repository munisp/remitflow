import React, { useCallback, useEffect, useState } from "react";
import {
  bdc,
  errMsg,
  fmtDateTime,
  type CustomerScreeningStatus,
  type RescreeningResultRow,
} from "./api";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  ErrorNote,
  Field,
  inputCls,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

const VERDICT_FILTERS = ["clear", "match", "error"] as const;

function verdictTone(verdict: string): string {
  switch (verdict) {
    case "clear":
      return "ok";
    case "error":
      return "warn";
    case "match":
      return "bad";
    default:
      return statusTone(verdict);
  }
}

/**
 * BDC customer rescreening (SPEC-wave12 §4.4 / §6.1).
 *
 * runRescreening returns an honest STARTED state — the run continues in the
 * background and appends rows; this page never claims the run finished.
 * Blocked customers (latest verdict 'match') are surfaced with a red flag;
 * the sale-path gate itself is server-side (assertCustomerNotRescreenBlocked).
 */
const BdcRescreening: React.FC = () => {
  // ── run ──
  const [runTotp, setRunTotp] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  // ── results list ──
  const [rows, setRows] = useState<RescreeningResultRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(false);

  // ── single-customer status lookup ──
  const [statusCustomerId, setStatusCustomerId] = useState("");
  const [statusResult, setStatusResult] = useState<CustomerScreeningStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(
    async (cursor?: number) => {
      setListLoading(true);
      setListErr(null);
      try {
        const res = await bdc.rescreening.listRescreeningResults.query({
          ...(customerFilter ? { customerId: Number(customerFilter) } : {}),
          ...(verdictFilter ? { verdict: verdictFilter as (typeof VERDICT_FILTERS)[number] } : {}),
          ...(blockedOnly ? { blockedOnly: true } : {}),
          ...(cursor ? { cursor } : {}),
        });
        setRows((prev) => (cursor ? [...prev, ...res.results] : res.results));
        setNextCursor(res.nextCursor);
      } catch (e) {
        setListErr(errMsg(e));
        if (!cursor) setRows([]);
      } finally {
        setListLoading(false);
      }
    },
    [verdictFilter, customerFilter, blockedOnly],
  );

  useEffect(() => {
    load();
  }, [load]);

  const startRun = async () => {
    setRunBusy(true);
    setRunMsg(null);
    setRunErr(null);
    try {
      const res = await bdc.rescreening.runRescreening.mutate({ totpCode: runTotp });
      // Honest started-state: the server returns immediately and the run
      // appends result rows in the background.
      setRunMsg(
        `Rescreening run ${res.runId} started (${res.tenantId == null ? "all tenants" : `tenant ${res.tenantId}`}) — results appear below as the run progresses; refresh to poll.`,
      );
      setRunTotp("");
    } catch (e) {
      // CONFLICT when a run is already in flight; TOTP/PRECONDITION errors
      // surface verbatim.
      setRunErr(errMsg(e));
    } finally {
      setRunBusy(false);
    }
  };

  const lookupCustomer = async () => {
    setStatusBusy(true);
    setStatusResult(null);
    setStatusErr(null);
    try {
      const res = await bdc.rescreening.getCustomerScreeningStatus.query({
        customerId: Number(statusCustomerId),
      });
      setStatusResult(res);
    } catch (e) {
      setStatusErr(errMsg(e));
    } finally {
      setStatusBusy(false);
    }
  };

  const blockedCount = rows.filter((r) => r.blocked).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Customer Rescreening"
        subtitle="Periodic sanctions/PEP re-screening of KYC-verified customers (bdc.rescreening.*)"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Run rescreening (bdc.rescreening.runRescreening + TOTP)">
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Starts a background run over all tenants you administer and returns
              immediately — the started state below is the honest state, not a
              completion. Only one run may be in flight (server: CONFLICT).
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <TotpField value={runTotp} onChange={setRunTotp} label="Admin TOTP" />
              <button
                className={btnPrimaryCls}
                disabled={runTotp.length !== 6 || runBusy}
                onClick={startRun}
              >
                {runBusy ? "Starting…" : "Start rescreening run"}
              </button>
            </div>
            {runMsg && <SuccessNote>{runMsg}</SuccessNote>}
            {runErr && <ErrorNote error={runErr} />}
          </div>
        </Card>

        <Card title="Customer screening status (bdc.rescreening.getCustomerScreeningStatus)">
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="w-48">
                <Field label="BDC customer ID">
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={statusCustomerId}
                    onChange={(e) => setStatusCustomerId(e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              </div>
              <button
                className={btnSecondaryCls}
                disabled={!statusCustomerId || statusBusy}
                onClick={lookupCustomer}
              >
                {statusBusy ? "Checking…" : "Check status"}
              </button>
            </div>
            {statusErr && <ErrorNote error={statusErr} />}
            {statusResult && (
              <div className="space-y-2">
                {statusResult.blocked ? (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                    <span className="font-medium">Customer BLOCKED.</span> Latest
                    rescreening verdict is a sanctions/PEP match — sales and
                    pickup authorizations are refused server-side until an MLRO
                    review clears it.
                  </div>
                ) : (
                  <SuccessNote>
                    {statusResult.latest
                      ? "Customer is not blocked by the latest rescreening result."
                      : "No rescreening result yet — the customer has not been re-screened (onboarding screening remains the gate)."}
                  </SuccessNote>
                )}
                {statusResult.latest && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <Badge tone={verdictTone(statusResult.latest.verdict)}>
                      {statusResult.latest.verdict}
                    </Badge>
                    <span>
                      run {statusResult.latest.runId}
                      {statusResult.latest.score != null ? ` · score ${statusResult.latest.score}` : ""}
                      {statusResult.latest.createdAt
                        ? ` · ${fmtDateTime(statusResult.latest.createdAt)}`
                        : ""}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card title="Rescreening results (bdc.rescreening.listRescreeningResults)">
        <div className="space-y-4">
          {blockedCount > 0 && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <span className="font-medium">{blockedCount} blocked customer(s)</span>{" "}
              in the current page — these customers cannot transact until an MLRO
              review clears the match.
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Verdict">
                <select
                  className={inputCls}
                  value={verdictFilter}
                  onChange={(e) => setVerdictFilter(e.target.value)}
                >
                  <option value="">all</option>
                  {VERDICT_FILTERS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Customer ID">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 pb-2">
              <input
                type="checkbox"
                checked={blockedOnly}
                onChange={(e) => setBlockedOnly(e.target.checked)}
                className="rounded border-slate-300"
              />
              Blocked only
            </label>
            <button className={btnSecondaryCls} onClick={() => load()}>
              Refresh list
            </button>
          </div>
          {listErr && <ErrorNote error={listErr} />}
          {listLoading && rows.length === 0 ? (
            <Spinner label="Loading results…" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">No rescreening results found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-3 font-medium">ID</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Run</th>
                    <th className="py-2 pr-3 font-medium">Verdict</th>
                    <th className="py-2 pr-3 font-medium">Score</th>
                    <th className="py-2 pr-3 font-medium">Blocked</th>
                    <th className="py-2 pr-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 text-slate-900">#{r.id}</td>
                      <td className="py-2 pr-3">{r.customerId}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.runId}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge>
                      </td>
                      <td className="py-2 pr-3">{r.score ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {r.blocked ? (
                          <Badge tone="bad">BLOCKED</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">no</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {fmtDateTime(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor != null && (
            <button
              className={btnSecondaryCls}
              disabled={listLoading}
              onClick={() => load(nextCursor)}
            >
              {listLoading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
};

export default BdcRescreening;
