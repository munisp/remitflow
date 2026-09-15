import React, { useCallback, useEffect, useState } from "react";
import {
  bdc,
  errMsg,
  fmtDateTime,
  TELLER_FRAUD_SIGNAL_TYPES,
  type TellerFraudScanResult,
  type TellerFraudSignalRow,
  type TellerFraudSignalStatus,
  type TellerFraudSignalType,
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
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

const STATUS_FILTERS: readonly TellerFraudSignalStatus[] = [
  "open",
  "reviewing",
  "escalated",
  "cleared",
];

const TRANSITIONS = ["reviewing", "escalated", "cleared"] as const;

function signalStatusTone(status: string): "ok" | "warn" | "bad" | "info" | "neutral" {
  switch (status) {
    case "open":
      return "bad";
    case "reviewing":
      return "warn";
    case "escalated":
      return "info";
    case "cleared":
      return "ok";
    default:
      return "neutral";
  }
}

/** Compact one-line evidence summary; the full jsonb is behind <details>. */
function evidenceSummary(evidence: unknown): string {
  try {
    const s = JSON.stringify(evidence);
    return s.length > 180 ? `${s.slice(0, 180)}…` : s;
  } catch {
    return String(evidence);
  }
}

/**
 * Teller-fraud analytics (SPEC-wave12 §4.9 / §6.1).
 *
 * runTellerFraudScan calls the python-teller-analytics service via the TS
 * gateway — fail-closed: unconfigured/unreachable service surfaces as
 * PRECONDITION_FAILED / UNAVAILABLE (rendered verbatim; never a fabricated
 * count). Triage transitions are guarded single-winner flips server-side.
 */
const BdcTellerFraud: React.FC = () => {
  // ── scan ──
  const [windowDays, setWindowDays] = useState("30");
  const [scanTotp, setScanTotp] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResult, setScanResult] = useState<TellerFraudScanResult | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);

  // ── signals list ──
  const [rows, setRows] = useState<TellerFraudSignalRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [tellerFilter, setTellerFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // ── triage ──
  const [triageTotp, setTriageTotp] = useState<Record<number, string>>({});
  const [rowMsg, setRowMsg] = useState<Record<number, { kind: "ok" | "err"; text: string }>>({});

  const load = useCallback(
    async (cursor?: number) => {
      setListLoading(true);
      setListErr(null);
      try {
        const res = await bdc.analytics.listTellerFraudSignals.query({
          ...(tellerFilter ? { tellerUserId: Number(tellerFilter) } : {}),
          ...(typeFilter ? { signalType: typeFilter as TellerFraudSignalType } : {}),
          ...(statusFilter ? { status: statusFilter as TellerFraudSignalStatus } : {}),
          ...(cursor ? { cursor } : {}),
        });
        setRows((prev) => (cursor ? [...prev, ...res.rows] : res.rows));
        setNextCursor(res.nextCursor);
      } catch (e) {
        setListErr(errMsg(e));
        if (!cursor) setRows([]);
      } finally {
        setListLoading(false);
      }
    },
    [tellerFilter, typeFilter, statusFilter],
  );

  useEffect(() => {
    load();
  }, [load]);

  const runScan = async () => {
    setScanBusy(true);
    setScanResult(null);
    setScanErr(null);
    try {
      const res = await bdc.analytics.runTellerFraudScan.mutate({
        windowDays: Number(windowDays),
        totpCode: scanTotp,
      });
      setScanResult(res);
      setScanTotp("");
      await load();
    } catch (e) {
      // Fail-closed config (PRECONDITION_FAILED) and upstream outages
      // (UNAVAILABLE) surface verbatim — no fabricated counts.
      setScanErr(errMsg(e));
    } finally {
      setScanBusy(false);
    }
  };

  const triage = async (signalId: number, status: (typeof TRANSITIONS)[number]) => {
    const code = triageTotp[signalId] ?? "";
    setRowMsg((m) => ({ ...m, [signalId]: { kind: "ok", text: `Moving to '${status}'…` } }));
    try {
      const res = await bdc.analytics.updateSignalStatus.mutate({
        signalId,
        status,
        totpCode: code,
      });
      setRowMsg((m) => ({
        ...m,
        [signalId]: {
          kind: "ok",
          text: res.unchanged
            ? `Signal #${signalId} already '${status}'.`
            : `Signal #${signalId} → '${status}'.`,
        },
      }));
      setTriageTotp((m) => ({ ...m, [signalId]: "" }));
      await load();
    } catch (e) {
      // CONFLICT on concurrent triage — refresh and retry.
      setRowMsg((m) => ({ ...m, [signalId]: { kind: "err", text: errMsg(e) } }));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Teller-Fraud Analytics"
        subtitle="Scan windows and triage teller-fraud signals (bdc.analytics.*)"
      />

      <Card title="Run scan (bdc.analytics.runTellerFraudScan + TOTP)">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Calls the teller-analytics service over the selected window (1–90
            days). Fail-closed: if the service is not configured or unreachable
            the error below is the honest outcome.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Window (days)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={windowDays}
                  onChange={(e) => setWindowDays(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
            <TotpField value={scanTotp} onChange={setScanTotp} label="Admin TOTP" />
            <button
              className={btnPrimaryCls}
              disabled={
                !windowDays ||
                Number(windowDays) < 1 ||
                Number(windowDays) > 90 ||
                scanTotp.length !== 6 ||
                scanBusy
              }
              onClick={runScan}
            >
              {scanBusy ? "Scanning…" : "Run teller-fraud scan"}
            </button>
          </div>
          {scanErr && <ErrorNote error={scanErr} />}
          {scanResult && (
            <SuccessNote>
              Scan complete: {scanResult.signals_written} signal(s) written for
              window {scanResult.window_start} → {scanResult.window_end} (
              {scanResult.tenantId == null ? "all tenants" : `tenant ${scanResult.tenantId}`}).
              {scanResult.skipped.length > 0
                ? ` Skipped: ${scanResult.skipped.join("; ")}.`
                : ""}
            </SuccessNote>
          )}
        </div>
      </Card>

      <Card title="Signals (bdc.analytics.listTellerFraudSignals)">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Teller user ID">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={tellerFilter}
                  onChange={(e) => setTellerFilter(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
            <div className="w-56">
              <Field label="Signal type">
                <select
                  className={inputCls}
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="">all</option>
                  {TELLER_FRAUD_SIGNAL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Status">
                <select
                  className={inputCls}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">all</option>
                  {STATUS_FILTERS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <button className={btnSecondaryCls} onClick={() => load()}>
              Refresh list
            </button>
          </div>
          {listErr && <ErrorNote error={listErr} />}
          {listLoading && rows.length === 0 ? (
            <Spinner label="Loading signals…" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">No teller-fraud signals found.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {rows.map((r) => (
                <div key={r.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{r.id} · {r.signalType} · teller {r.tellerUserId} · score {r.score}
                      </p>
                      <p className="text-xs text-slate-400">
                        window {r.windowStart} → {r.windowEnd}
                        {r.createdAt ? ` · raised ${fmtDateTime(r.createdAt)}` : ""}
                      </p>
                    </div>
                    <Badge tone={signalStatusTone(r.status)}>{r.status}</Badge>
                  </div>
                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer font-mono break-all">
                      {evidenceSummary(r.evidence)}
                    </summary>
                    <pre className="mt-2 p-3 bg-slate-50 rounded-xl font-mono overflow-auto max-h-60">
                      {JSON.stringify(r.evidence, null, 2)}
                    </pre>
                  </details>
                  <div className="flex flex-wrap items-end gap-2">
                    <TotpField
                      value={triageTotp[r.id] ?? ""}
                      onChange={(c) => setTriageTotp((m) => ({ ...m, [r.id]: c }))}
                      label="Analyst TOTP"
                    />
                    {TRANSITIONS.map((t) => (
                      <button
                        key={t}
                        className={btnSecondaryCls}
                        disabled={r.status === t || (triageTotp[r.id] ?? "").length !== 6}
                        onClick={() => triage(r.id, t)}
                      >
                        Mark {t}
                      </button>
                    ))}
                  </div>
                  {rowMsg[r.id] &&
                    (rowMsg[r.id].kind === "ok" ? (
                      <SuccessNote>{rowMsg[r.id].text}</SuccessNote>
                    ) : (
                      <ErrorNote error={rowMsg[r.id].text} />
                    ))}
                </div>
              ))}
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

export default BdcTellerFraud;
