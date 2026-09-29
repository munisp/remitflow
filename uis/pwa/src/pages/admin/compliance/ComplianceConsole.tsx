/**
 * W17-C3 — Admin compliance console (/admin/compliance, AdminRoute-gated).
 *
 * First PWA consumer of the mounted `complianceV2` router
 * (server/routers/complianceRouter.ts — 30 procedures, static mount at
 * server/routers.ts:7869, verified against audit/routers.json) plus the
 * admin-only `travelRule.adminList` queue (productionFeatures.ts:224).
 *
 * Tabs:
 *   queue       — reporting.queueSummary + reporting.listQueue +
 *                 reporting.requeueDeadLetter (adminProcedure, TOTP)
 *   filings     — reporting.fileCTR / fileSAR forms (TOTP) + getIndicators /
 *                 getCTRThresholds reference + shouldFileCTR checker +
 *                 detectStructuring analysis
 *   screening   — screening.run / enableMonitoring (TOTP) + checkEDD + getLists
 *   residency   — dataResidency.getRegion / canTransfer / submitDSAR (TOTP) /
 *                 validateProcessing / exportData / getPolicies / getCategories
 *   audit       — audit.verifyIntegrity / audit.export / audit.record (TOTP)
 *   kyc         — kyc.getAllTiers / getTierLimits / checkLimit viewers
 *   travel-rule — complianceV2.travelRule.getThresholds / checkThreshold /
 *                 resolveVASP / submit (IVMS101, TOTP)
 *   records     — travelRule.adminList (adminProcedure)
 *
 * Fail-closed: every panel surfaces server errors verbatim in a dismissible
 * red banner (useState — no toast lib in the PWA; pattern from
 * pages/Beneficiaries.tsx). Empty lists render an honest empty state; nothing
 * is fabricated. All mutations collect a 6-digit TOTP step-up code forwarded
 * as `totpCode` (pages/bdc/TotpField.tsx pattern); the server fails closed
 * with 2FA_REQUIRED when MFA is required.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  complianceApi as api,
  errorMessage,
  DATA_REGIONS,
  JURISDICTIONS,
  type DataCategory,
  type DataRegion,
  type DataResidencyPolicy,
  type DsarType,
  type FilingQueueRow,
  type FilingQueueStatus,
  type Jurisdiction,
  type PepMatchInput,
  type QueueSummary,
  type RiskLevel,
  type SanctionsListInfo,
  type SuspiciousIndicator,
  type TierLimits,
  type TransactionDetail,
  type TravelRuleAdminRecord,
  type TravelRuleAdminStatus,
} from "./api";
import TotpField from "../../bdc/TotpField";
import {
  Badge,
  btnDangerCls,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
  statusTone,
} from "../../bdc/ui";

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Dismissible fail-closed error banner (Beneficiaries.tsx pattern). */
const ErrBanner: React.FC<{ msg: string | null; onDismiss: () => void }> = ({ msg, onDismiss }) =>
  msg ? (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 flex items-start justify-between gap-4">
      <span className="text-sm whitespace-pre-wrap">{msg}</span>
      <button type="button" onClick={onDismiss} className="text-red-500 text-xs font-medium shrink-0">
        Dismiss
      </button>
    </div>
  ) : null;

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-2xl bg-white border border-slate-100 p-8 text-center text-slate-500 text-sm">
    {children}
  </div>
);

type TabKey =
  | "queue"
  | "filings"
  | "screening"
  | "residency"
  | "audit"
  | "kyc"
  | "travelRule"
  | "records";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "queue", label: "Reporting Queue" },
  { key: "filings", label: "CTR / SAR Filings" },
  { key: "screening", label: "Screening" },
  { key: "residency", label: "Data Residency" },
  { key: "audit", label: "Audit Trail" },
  { key: "kyc", label: "KYC Tier Limits" },
  { key: "travelRule", label: "Travel Rule (IVMS101)" },
  { key: "records", label: "Travel Rule Records" },
];

const QUEUE_STATUSES: FilingQueueStatus[] = ["pending", "processing", "retry", "submitted", "dead_letter"];

// ── Tab: Reporting queue ───────────────────────────────────────────────────

const QueueTab: React.FC = () => {
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [rows, setRows] = useState<FilingQueueRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<FilingQueueStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [totp, setTotp] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, list] = await Promise.all([
        api.complianceV2.reporting.queueSummary.query(),
        api.complianceV2.reporting.listQueue.query(statusFilter ? { status: statusFilter } : {}),
      ]);
      setSummary(s);
      setRows(list);
    } catch (e) {
      setErr(errorMessage(e, "Regulatory filing queue could not be loaded."));
      setSummary(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const requeue = async (queueId: number) => {
    setBusyId(queueId);
    setErr(null);
    setMsg(null);
    try {
      await api.complianceV2.reporting.requeueDeadLetter.mutate({
        queueId,
        totpCode: totp || undefined,
      });
      setMsg(`Queue entry #${queueId} requeued from dead letter.`);
      setTotp("");
      await load();
    } catch (e) {
      setErr(errorMessage(e, `Requeue of queue entry #${queueId} was rejected by the server.`));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <ErrBanner msg={err} onDismiss={() => setErr(null)} />
      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div>
      )}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(
            [
              ["Pending", summary.pending],
              ["Processing", summary.processing],
              ["Retry", summary.retry],
              ["Submitted", summary.submitted],
              ["Dead letter", summary.deadLetter],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-100 p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{n}</p>
            </div>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Field label="Status filter">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilingQueueStatus | "")}
              className={inputCls}
            >
              <option value="">All statuses</option>
              {QUEUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="TOTP step-up (requeue)">
            <TotpField value={totp} onChange={setTotp} label="" />
          </Field>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Requeue dead letter is an adminProcedure mutation — the server fails closed with
          2FA_REQUIRED when a step-up code is required.
        </p>
      </Card>
      {loading ? (
        <Spinner label="Loading filing queue…" />
      ) : rows.length === 0 ? (
        <Empty>No regulatory filings in the queue{statusFilter ? ` with status "${statusFilter.replace(/_/g, " ")}"` : ""}.</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    #{r.id} · {r.report_type} · {r.jurisdiction}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    report {r.report_id} · attempts {r.attempt_count}/{r.max_attempts} · next attempt{" "}
                    {fmtDate(r.next_attempt_at)}
                  </p>
                  {r.last_error && (
                    <p className="text-xs text-red-600 mt-1">Last error: {r.last_error}</p>
                  )}
                  {r.provider_reference && (
                    <p className="text-xs text-slate-500 mt-1">Provider ref: {r.provider_reference}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(r.status)}>{r.status.replace(/_/g, " ")}</Badge>
                  {r.status === "dead_letter" && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void requeue(r.id)}
                      className={btnDangerCls}
                    >
                      {busyId === r.id ? "Requeuing…" : "Requeue"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Tab: CTR / SAR filings ─────────────────────────────────────────────────

const emptySubject = {
  type: "individual" as "individual" | "entity",
  firstName: "",
  lastName: "",
  entityName: "",
  country: "",
  accountNumbers: "",
};

const emptyTx = {
  id: "",
  date: "",
  amount: "",
  currency: "USD",
  type: "wire" as TransactionDetail["type"],
  direction: "outbound" as TransactionDetail["direction"],
};

function parseTx(t: typeof emptyTx): TransactionDetail {
  return {
    id: t.id,
    date: t.date,
    amount: Number(t.amount),
    currency: t.currency,
    type: t.type,
    direction: t.direction,
  };
}

const FilingsTab: React.FC = () => {
  const [indicators, setIndicators] = useState<SuspiciousIndicator[] | null>(null);
  const [ctrThresholds, setCtrThresholds] = useState<Record<string, { amount: number; currency: string }> | null>(null);
  const [refErr, setRefErr] = useState<string | null>(null);

  // CTR form
  const [ctrSubject, setCtrSubject] = useState(emptySubject);
  const [ctrTx, setCtrTx] = useState(emptyTx);
  const [ctrJur, setCtrJur] = useState<Jurisdiction>("US");
  const [ctrTotp, setCtrTotp] = useState("");
  const [ctrBusy, setCtrBusy] = useState(false);
  const [ctrErr, setCtrErr] = useState<string | null>(null);
  const [ctrMsg, setCtrMsg] = useState<string | null>(null);

  // SAR form
  const [sarSubject, setSarSubject] = useState(emptySubject);
  const [sarTx, setSarTx] = useState(emptyTx);
  const [sarJur, setSarJur] = useState<Jurisdiction>("US");
  const [sarIndicators, setSarIndicators] = useState<string[]>([]);
  const [sarNarrative, setSarNarrative] = useState("");
  const [sarFrom, setSarFrom] = useState("");
  const [sarTo, setSarTo] = useState("");
  const [sarTotp, setSarTotp] = useState("");
  const [sarBusy, setSarBusy] = useState(false);
  const [sarErr, setSarErr] = useState<string | null>(null);
  const [sarMsg, setSarMsg] = useState<string | null>(null);

  // shouldFileCTR checker
  const [chkAmount, setChkAmount] = useState("");
  const [chkCurrency, setChkCurrency] = useState("USD");
  const [chkJur, setChkJur] = useState<Jurisdiction>("US");
  const [chkResult, setChkResult] = useState<boolean | null>(null);
  const [chkErr, setChkErr] = useState<string | null>(null);

  // detectStructuring
  const [structJur, setStructJur] = useState<Jurisdiction>("US");
  const [structJson, setStructJson] = useState("");
  const [structResult, setStructResult] = useState<SuspiciousIndicator[] | null>(null);
  const [structErr, setStructErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [inds, thr] = await Promise.all([
          api.complianceV2.reporting.getIndicators.query(),
          api.complianceV2.reporting.getCTRThresholds.query(),
        ]);
        setIndicators(inds);
        setCtrThresholds(thr);
      } catch (e) {
        setRefErr(errorMessage(e, "Reporting reference data could not be loaded."));
      }
    })();
  }, []);

  const subjectPayload = (s: typeof emptySubject) => ({
    type: s.type,
    ...(s.type === "individual"
      ? { firstName: s.firstName || undefined, lastName: s.lastName || undefined }
      : { entityName: s.entityName || undefined }),
    country: s.country,
    accountNumbers: s.accountNumbers
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
  });

  const fileCtr = async (e: React.FormEvent) => {
    e.preventDefault();
    setCtrBusy(true);
    setCtrErr(null);
    setCtrMsg(null);
    try {
      const res = await api.complianceV2.reporting.fileCTR.mutate({
        subject: subjectPayload(ctrSubject),
        transaction: parseTx(ctrTx),
        jurisdiction: ctrJur,
        totpCode: ctrTotp || undefined,
      });
      setCtrMsg(`CTR filed — report ${res.reportId}, queued as #${res.queueId} (status: ${res.status}).`);
      setCtrTotp("");
    } catch (err2) {
      setCtrErr(errorMessage(err2, "CTR filing was rejected by the server."));
    } finally {
      setCtrBusy(false);
    }
  };

  const fileSar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSarBusy(true);
    setSarErr(null);
    setSarMsg(null);
    try {
      const res = await api.complianceV2.reporting.fileSAR.mutate({
        subject: subjectPayload(sarSubject),
        transactions: [parseTx(sarTx)],
        indicators: sarIndicators,
        narrative: sarNarrative,
        jurisdiction: sarJur,
        dateRange: { from: sarFrom, to: sarTo },
        totpCode: sarTotp || undefined,
      });
      setSarMsg(`SAR filed — report ${res.reportId}, queued as #${res.queueId} (status: ${res.status}).`);
      setSarTotp("");
    } catch (err2) {
      setSarErr(errorMessage(err2, "SAR filing was rejected by the server."));
    } finally {
      setSarBusy(false);
    }
  };

  const runCtrCheck = async () => {
    setChkErr(null);
    setChkResult(null);
    try {
      setChkResult(
        await api.complianceV2.reporting.shouldFileCTR.query({
          amount: Number(chkAmount),
          currency: chkCurrency,
          jurisdiction: chkJur,
        }),
      );
    } catch (e) {
      setChkErr(errorMessage(e, "CTR threshold check failed."));
    }
  };

  const runStructuring = async () => {
    setStructErr(null);
    setStructResult(null);
    let txs: TransactionDetail[];
    try {
      const parsed: unknown = JSON.parse(structJson);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      txs = parsed as TransactionDetail[];
    } catch {
      setStructErr("Transactions must be a JSON array of { id, date, amount, currency, type, direction }.");
      return;
    }
    try {
      setStructResult(await api.complianceV2.reporting.detectStructuring.query({ transactions: txs, jurisdiction: structJur }));
    } catch (e) {
      setStructErr(errorMessage(e, "Structuring analysis failed."));
    }
  };

  const subjectFields = (
    s: typeof emptySubject,
    set: React.Dispatch<React.SetStateAction<typeof emptySubject>>,
  ) => (
    <>
      <Field label="Subject type">
        <select value={s.type} onChange={(e) => set({ ...s, type: e.target.value as "individual" | "entity" })} className={inputCls}>
          <option value="individual">Individual</option>
          <option value="entity">Entity</option>
        </select>
      </Field>
      {s.type === "individual" ? (
        <>
          <Field label="First name">
            <input value={s.firstName} onChange={(e) => set({ ...s, firstName: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Last name">
            <input value={s.lastName} onChange={(e) => set({ ...s, lastName: e.target.value })} className={inputCls} />
          </Field>
        </>
      ) : (
        <Field label="Entity name">
          <input value={s.entityName} onChange={(e) => set({ ...s, entityName: e.target.value })} className={inputCls} />
        </Field>
      )}
      <Field label="Country (ISO)">
        <input required value={s.country} onChange={(e) => set({ ...s, country: e.target.value })} className={inputCls} placeholder="US" maxLength={2} />
      </Field>
      <Field label="Account numbers (comma-separated)">
        <input required value={s.accountNumbers} onChange={(e) => set({ ...s, accountNumbers: e.target.value })} className={inputCls} placeholder="ACC-1, ACC-2" />
      </Field>
    </>
  );

  const txFields = (
    t: typeof emptyTx,
    set: React.Dispatch<React.SetStateAction<typeof emptyTx>>,
  ) => (
    <>
      <Field label="Transaction ID">
        <input required value={t.id} onChange={(e) => set({ ...t, id: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Date">
        <input required type="date" value={t.date} onChange={(e) => set({ ...t, date: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Amount">
        <input required type="number" min="0" step="any" value={t.amount} onChange={(e) => set({ ...t, amount: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Currency">
        <input required value={t.currency} onChange={(e) => set({ ...t, currency: e.target.value.toUpperCase() })} className={inputCls} maxLength={3} />
      </Field>
      <Field label="Type">
        <select value={t.type} onChange={(e) => set({ ...t, type: e.target.value as TransactionDetail["type"] })} className={inputCls}>
          {(["wire", "crypto", "cash", "mobile_money", "card"] as const).map((v) => (
            <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
          ))}
        </select>
      </Field>
      <Field label="Direction">
        <select value={t.direction} onChange={(e) => set({ ...t, direction: e.target.value as TransactionDetail["direction"] })} className={inputCls}>
          {(["inbound", "outbound", "internal"] as const).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </Field>
    </>
  );

  return (
    <div className="space-y-5">
      <ErrBanner msg={refErr} onDismiss={() => setRefErr(null)} />

      {/* Reference data */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="CTR thresholds (complianceV2.reporting.getCTRThresholds)">
          {ctrThresholds === null ? (
            <p className="text-sm text-slate-500">{refErr ? "Unavailable." : "Loading…"}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Jurisdiction</th>
                  <th className="py-1">Amount</th>
                  <th className="py-1">Currency</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ctrThresholds).map(([jur, t]) => (
                  <tr key={jur} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium text-slate-900">{jur}</td>
                    <td className="py-1.5">{t.amount.toLocaleString()}</td>
                    <td className="py-1.5">{t.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="CTR obligation checker (reporting.shouldFileCTR)">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Amount">
              <input type="number" min="0" step="any" value={chkAmount} onChange={(e) => setChkAmount(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Currency">
              <input value={chkCurrency} onChange={(e) => setChkCurrency(e.target.value.toUpperCase())} className={inputCls} maxLength={3} />
            </Field>
            <Field label="Jurisdiction">
              <select value={chkJur} onChange={(e) => setChkJur(e.target.value as Jurisdiction)} className={inputCls}>
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </Field>
          </div>
          <button type="button" onClick={() => void runCtrCheck()} disabled={!chkAmount} className={`${btnSecondaryCls} mt-3`}>
            Check obligation
          </button>
          {chkErr && <p className="text-sm text-red-600 mt-2">{chkErr}</p>}
          {chkResult !== null && (
            <p className="mt-3">
              <Badge tone={chkResult ? "warn" : "ok"}>
                {chkResult ? "CTR filing required" : "Below CTR threshold — no filing required"}
              </Badge>
            </p>
          )}
        </Card>
      </div>

      {/* fileCTR */}
      <Card title="File CTR (reporting.fileCTR — protected mutation, TOTP step-up)">
        <ErrBanner msg={ctrErr} onDismiss={() => setCtrErr(null)} />
        {ctrMsg && <p className="text-sm text-emerald-700 mb-3">{ctrMsg}</p>}
        <form onSubmit={(e) => void fileCtr(e)} className="grid md:grid-cols-3 gap-3 mt-3">
          {subjectFields(ctrSubject, setCtrSubject)}
          {txFields(ctrTx, setCtrTx)}
          <Field label="Jurisdiction">
            <select value={ctrJur} onChange={(e) => setCtrJur(e.target.value as Jurisdiction)} className={inputCls}>
              {JURISDICTIONS.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </Field>
          <TotpField value={ctrTotp} onChange={setCtrTotp} />
          <div className="flex items-end">
            <button type="submit" disabled={ctrBusy} className={btnPrimaryCls}>
              {ctrBusy ? "Filing…" : "File CTR"}
            </button>
          </div>
        </form>
      </Card>

      {/* fileSAR */}
      <Card title="File SAR (reporting.fileSAR — protected mutation, TOTP step-up)">
        <ErrBanner msg={sarErr} onDismiss={() => setSarErr(null)} />
        {sarMsg && <p className="text-sm text-emerald-700 mb-3">{sarMsg}</p>}
        <form onSubmit={(e) => void fileSar(e)} className="space-y-3 mt-3">
          <div className="grid md:grid-cols-3 gap-3">
            {subjectFields(sarSubject, setSarSubject)}
            {txFields(sarTx, setSarTx)}
            <Field label="Jurisdiction">
              <select value={sarJur} onChange={(e) => setSarJur(e.target.value as Jurisdiction)} className={inputCls}>
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </Field>
            <Field label="Date range — from">
              <input required type="date" value={sarFrom} onChange={(e) => setSarFrom(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Date range — to">
              <input required type="date" value={sarTo} onChange={(e) => setSarTo(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label={`Suspicious activity indicators (${sarIndicators.length} selected)`}>
            {indicators === null ? (
              <p className="text-sm text-slate-500">Indicator catalogue unavailable.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-1 max-h-48 overflow-auto border border-slate-100 rounded-xl p-3">
                {indicators.map((ind) => (
                  <label key={ind.code} className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={sarIndicators.includes(ind.code)}
                      onChange={(e) =>
                        setSarIndicators(
                          e.target.checked
                            ? [...sarIndicators, ind.code]
                            : sarIndicators.filter((c) => c !== ind.code),
                        )
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="font-mono text-xs text-slate-500">{ind.code}</span>{" "}
                      {ind.name ?? ind.description ?? ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Field>
          <Field label="Narrative (minimum 50 characters)" hint={`${sarNarrative.length}/50 minimum`}>
            <textarea
              required
              minLength={50}
              value={sarNarrative}
              onChange={(e) => setSarNarrative(e.target.value)}
              className={`${inputCls} min-h-[100px]`}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <TotpField value={sarTotp} onChange={setSarTotp} />
            <button type="submit" disabled={sarBusy || sarNarrative.length < 50} className={btnPrimaryCls}>
              {sarBusy ? "Filing…" : "File SAR"}
            </button>
          </div>
        </form>
      </Card>

      {/* detectStructuring */}
      <Card title="Structuring detection (reporting.detectStructuring)">
        <ErrBanner msg={structErr} onDismiss={() => setStructErr(null)} />
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <Field label="Jurisdiction">
            <select value={structJur} onChange={(e) => setStructJur(e.target.value as Jurisdiction)} className={inputCls}>
              {JURISDICTIONS.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </Field>
          <Field label="Transactions (JSON array)" hint='[{"id":"t1","date":"2025-01-01","amount":9500,"currency":"USD","type":"cash","direction":"inbound"}, …]'>
            <textarea value={structJson} onChange={(e) => setStructJson(e.target.value)} className={`${inputCls} font-mono text-xs min-h-[80px]`} />
          </Field>
        </div>
        <button type="button" onClick={() => void runStructuring()} disabled={!structJson.trim()} className={`${btnSecondaryCls} mt-3`}>
          Analyze
        </button>
        {structResult !== null &&
          (structResult.length === 0 ? (
            <p className="mt-3">
              <Badge tone="ok">No structuring indicators detected</Badge>
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {structResult.map((ind) => (
                <div key={ind.code} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                  <span className="font-mono text-xs text-amber-700">{ind.code}</span>{" "}
                  <span className="font-medium text-slate-900">{ind.name ?? ""}</span>
                  {ind.description && <p className="text-slate-600 mt-1">{ind.description}</p>}
                </div>
              ))}
            </div>
          ))}
      </Card>
    </div>
  );
};

// ── Tab: Screening ─────────────────────────────────────────────────────────

const ScreeningTab: React.FC = () => {
  const [lists, setLists] = useState<SanctionsListInfo[] | null>(null);
  const [listsErr, setListsErr] = useState<string | null>(null);

  // run
  const [runName, setRunName] = useState("");
  const [runDob, setRunDob] = useState("");
  const [runCountry, setRunCountry] = useState("");
  const [runTxId, setRunTxId] = useState("");
  const [runTotp, setRunTotp] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<unknown | null>(null);

  // enableMonitoring
  const [monName, setMonName] = useState("");
  const [monCountry, setMonCountry] = useState("");
  const [monDob, setMonDob] = useState("");
  const [monRisk, setMonRisk] = useState<RiskLevel>("low");
  const [monTotp, setMonTotp] = useState("");
  const [monBusy, setMonBusy] = useState(false);
  const [monErr, setMonErr] = useState<string | null>(null);
  const [monResult, setMonResult] = useState<unknown | null>(null);

  // checkEDD
  const [eddJson, setEddJson] = useState("");
  const [eddResult, setEddResult] = useState<{ required: boolean; reason: string; measures: string[] } | null>(null);
  const [eddErr, setEddErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLists(await api.complianceV2.screening.getLists.query());
      } catch (e) {
        setListsErr(errorMessage(e, "Sanctions list catalogue could not be loaded."));
      }
    })();
  }, []);

  const runScreening = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunBusy(true);
    setRunErr(null);
    setRunResult(null);
    try {
      setRunResult(
        await api.complianceV2.screening.run.mutate({
          name: runName,
          dateOfBirth: runDob || undefined,
          country: runCountry || undefined,
          transactionId: runTxId || undefined,
          totpCode: runTotp || undefined,
        }),
      );
      setRunTotp("");
    } catch (err2) {
      // Screening fails closed in production when the provider is unavailable —
      // surface the server error verbatim, never a fabricated "clear" result.
      setRunErr(errorMessage(err2, "Screening request was rejected by the server."));
    } finally {
      setRunBusy(false);
    }
  };

  const enableMonitoring = async (e: React.FormEvent) => {
    e.preventDefault();
    setMonBusy(true);
    setMonErr(null);
    setMonResult(null);
    try {
      setMonResult(
        await api.complianceV2.screening.enableMonitoring.mutate({
          name: monName,
          country: monCountry,
          dateOfBirth: monDob || undefined,
          riskLevel: monRisk,
          totpCode: monTotp || undefined,
        }),
      );
      setMonTotp("");
    } catch (err2) {
      setMonErr(errorMessage(err2, "Continuous monitoring could not be enabled."));
    } finally {
      setMonBusy(false);
    }
  };

  const runEdd = async () => {
    setEddErr(null);
    setEddResult(null);
    let matches: PepMatchInput[];
    try {
      const parsed: unknown = JSON.parse(eddJson);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      matches = parsed as PepMatchInput[];
    } catch {
      setEddErr("PEP matches must be a JSON array of { name, position, country, level, source }.");
      return;
    }
    try {
      setEddResult(await api.complianceV2.screening.checkEDD.query({ pepMatches: matches }));
    } catch (e) {
      setEddErr(errorMessage(e, "EDD check failed."));
    }
  };

  return (
    <div className="space-y-5">
      <Card title="Screened sanctions lists (screening.getLists)">
        <ErrBanner msg={listsErr} onDismiss={() => setListsErr(null)} />
        {lists === null ? (
          listsErr ? null : <Spinner label="Loading lists…" />
        ) : lists.length === 0 ? (
          <Empty>No sanctions lists are configured.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1">List</th>
                <th className="py-1">Regulator</th>
                <th className="py-1">Update frequency</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-1.5 font-medium text-slate-900">{l.name}</td>
                  <td className="py-1.5">{l.regulator}</td>
                  <td className="py-1.5">{l.updateFrequency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Run enhanced screening (screening.run — mutation, TOTP step-up)">
        <ErrBanner msg={runErr} onDismiss={() => setRunErr(null)} />
        <form onSubmit={(e) => void runScreening(e)} className="grid md:grid-cols-3 gap-3 mt-3">
          <Field label="Subject name">
            <input required value={runName} onChange={(e) => setRunName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Date of birth (optional)">
            <input type="date" value={runDob} onChange={(e) => setRunDob(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Country (ISO, optional)">
            <input value={runCountry} onChange={(e) => setRunCountry(e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
          </Field>
          <Field label="Transaction ID (optional)">
            <input value={runTxId} onChange={(e) => setRunTxId(e.target.value)} className={inputCls} />
          </Field>
          <TotpField value={runTotp} onChange={setRunTotp} />
          <div className="flex items-end">
            <button type="submit" disabled={runBusy} className={btnPrimaryCls}>
              {runBusy ? "Screening…" : "Run screening"}
            </button>
          </div>
        </form>
        {runResult !== null && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1">Server screening report:</p>
            <JsonView data={runResult} />
          </div>
        )}
      </Card>

      <Card title="Enable continuous monitoring (screening.enableMonitoring — mutation, TOTP step-up)">
        <ErrBanner msg={monErr} onDismiss={() => setMonErr(null)} />
        <form onSubmit={(e) => void enableMonitoring(e)} className="grid md:grid-cols-3 gap-3 mt-3">
          <Field label="Subject name">
            <input required value={monName} onChange={(e) => setMonName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Country (ISO)">
            <input required value={monCountry} onChange={(e) => setMonCountry(e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
          </Field>
          <Field label="Date of birth (optional)">
            <input type="date" value={monDob} onChange={(e) => setMonDob(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Risk level">
            <select value={monRisk} onChange={(e) => setMonRisk(e.target.value as RiskLevel)} className={inputCls}>
              {(["low", "medium", "high", "critical", "prohibited"] as const).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <TotpField value={monTotp} onChange={setMonTotp} />
          <div className="flex items-end">
            <button type="submit" disabled={monBusy} className={btnPrimaryCls}>
              {monBusy ? "Enabling…" : "Enable monitoring"}
            </button>
          </div>
        </form>
        {monResult !== null && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1">Monitoring profile created:</p>
            <JsonView data={monResult} />
          </div>
        )}
      </Card>

      <Card title="EDD requirement check (screening.checkEDD)">
        <ErrBanner msg={eddErr} onDismiss={() => setEddErr(null)} />
        <Field label="PEP matches (JSON array)" hint='[{"name":"…","position":"…","country":"NG","level":"senior_official","source":"…"}] — empty array [] checks the no-match baseline'>
          <textarea value={eddJson} onChange={(e) => setEddJson(e.target.value)} className={`${inputCls} font-mono text-xs min-h-[80px]`} />
        </Field>
        <button type="button" onClick={() => void runEdd()} disabled={!eddJson.trim()} className={`${btnSecondaryCls} mt-3`}>
          Check EDD
        </button>
        {eddResult && (
          <div className="mt-3 rounded-xl border border-slate-100 p-3">
            <Badge tone={eddResult.required ? "warn" : "ok"}>
              {eddResult.required ? "EDD required" : "EDD not required"}
            </Badge>
            <p className="text-sm text-slate-700 mt-2">{eddResult.reason}</p>
            {eddResult.measures.length > 0 && (
              <ul className="list-disc list-inside text-sm text-slate-600 mt-2 space-y-1">
                {eddResult.measures.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

// ── Tab: Data residency ────────────────────────────────────────────────────

const ResidencyTab: React.FC = () => {
  const [policies, setPolicies] = useState<DataResidencyPolicy[] | null>(null);
  const [categories, setCategories] = useState<DataCategory[] | null>(null);
  const [refErr, setRefErr] = useState<string | null>(null);

  // getRegion
  const [regionCountry, setRegionCountry] = useState("");
  const [regionResult, setRegionResult] = useState<DataResidencyPolicy | null>(null);
  const [regionErr, setRegionErr] = useState<string | null>(null);

  // canTransfer
  const [ctFrom, setCtFrom] = useState("");
  const [ctTo, setCtTo] = useState<DataRegion>("eu-west");
  const [ctResult, setCtResult] = useState<{ allowed: boolean; mechanism?: string; requiresConsent: boolean; documentation: string } | null>(null);
  const [ctErr, setCtErr] = useState<string | null>(null);

  // submitDSAR
  const [dsarType, setDsarType] = useState<DsarType>("access");
  const [dsarReason, setDsarReason] = useState("");
  const [dsarTotp, setDsarTotp] = useState("");
  const [dsarBusy, setDsarBusy] = useState(false);
  const [dsarErr, setDsarErr] = useState<string | null>(null);
  const [dsarResult, setDsarResult] = useState<unknown | null>(null);

  // validateProcessing
  const [vpCountry, setVpCountry] = useState("");
  const [vpCategory, setVpCategory] = useState("");
  const [vpPurpose, setVpPurpose] = useState("");
  const [vpConsent, setVpConsent] = useState(false);
  const [vpResult, setVpResult] = useState<unknown | null>(null);
  const [vpErr, setVpErr] = useState<string | null>(null);

  // exportData
  const [expCategories, setExpCategories] = useState<string[]>([]);
  const [expResult, setExpResult] = useState<unknown | null>(null);
  const [expErr, setExpErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, c] = await Promise.all([
          api.complianceV2.dataResidency.getPolicies.query(),
          api.complianceV2.dataResidency.getCategories.query(),
        ]);
        setPolicies(p);
        setCategories(c);
      } catch (e) {
        setRefErr(errorMessage(e, "Data residency reference data could not be loaded."));
      }
    })();
  }, []);

  const lookupRegion = async () => {
    setRegionErr(null);
    setRegionResult(null);
    try {
      setRegionResult(await api.complianceV2.dataResidency.getRegion.query({ country: regionCountry.toUpperCase() }));
    } catch (e) {
      setRegionErr(errorMessage(e, "Region lookup failed."));
    }
  };

  const checkTransfer = async () => {
    setCtErr(null);
    setCtResult(null);
    try {
      setCtResult(await api.complianceV2.dataResidency.canTransfer.query({ fromCountry: ctFrom.toUpperCase(), toRegion: ctTo }));
    } catch (e) {
      setCtErr(errorMessage(e, "Transfer check failed."));
    }
  };

  const submitDsar = async (e: React.FormEvent) => {
    e.preventDefault();
    setDsarBusy(true);
    setDsarErr(null);
    setDsarResult(null);
    try {
      setDsarResult(
        await api.complianceV2.dataResidency.submitDSAR.mutate({
          type: dsarType,
          reason: dsarReason || undefined,
          totpCode: dsarTotp || undefined,
        }),
      );
      setDsarTotp("");
    } catch (err2) {
      setDsarErr(errorMessage(err2, "Data subject request was rejected by the server."));
    } finally {
      setDsarBusy(false);
    }
  };

  const validateProcessing = async () => {
    setVpErr(null);
    setVpResult(null);
    try {
      setVpResult(
        await api.complianceV2.dataResidency.validateProcessing.query({
          country: vpCountry.toUpperCase(),
          dataCategory: vpCategory,
          purpose: vpPurpose,
          hasConsent: vpConsent,
        }),
      );
    } catch (e) {
      setVpErr(errorMessage(e, "Processing validation failed."));
    }
  };

  const runExport = async () => {
    setExpErr(null);
    setExpResult(null);
    try {
      setExpResult(await api.complianceV2.dataResidency.exportData.query({ categories: expCategories }));
    } catch (e) {
      setExpErr(errorMessage(e, "Data export failed."));
    }
  };

  return (
    <div className="space-y-5">
      <ErrBanner msg={refErr} onDismiss={() => setRefErr(null)} />

      <Card title="Residency policies (dataResidency.getPolicies)">
        {policies === null ? (
          refErr ? null : <Spinner label="Loading policies…" />
        ) : policies.length === 0 ? (
          <Empty>No residency policies are configured.</Empty>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Region</th>
                  <th className="py-1">Regulation</th>
                  <th className="py-1">Retention</th>
                  <th className="py-1">Cross-border</th>
                  <th className="py-1">Mechanism</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.region} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium text-slate-900">{p.region}</td>
                    <td className="py-1.5">{p.regulation}</td>
                    <td className="py-1.5">{p.retentionYears} yrs</td>
                    <td className="py-1.5">
                      <Badge tone={p.crossBorderAllowed ? "ok" : "bad"}>
                        {p.crossBorderAllowed ? "allowed" : "restricted"}
                      </Badge>
                    </td>
                    <td className="py-1.5">{p.crossBorderMechanism ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Region lookup (dataResidency.getRegion)">
          <div className="flex gap-2">
            <input value={regionCountry} onChange={(e) => setRegionCountry(e.target.value.toUpperCase())} className={inputCls} placeholder="Country ISO, e.g. NG" maxLength={2} />
            <button type="button" onClick={() => void lookupRegion()} disabled={!regionCountry} className={btnSecondaryCls}>
              Lookup
            </button>
          </div>
          {regionErr && <p className="text-sm text-red-600 mt-2">{regionErr}</p>}
          {regionResult && (
            <div className="mt-3 text-sm space-y-1">
              <p><span className="text-slate-500">Region:</span> <span className="font-medium">{regionResult.region}</span></p>
              <p><span className="text-slate-500">Regulation:</span> {regionResult.regulation}</p>
              <p><span className="text-slate-500">Retention:</span> {regionResult.retentionYears} years</p>
              <p><span className="text-slate-500">Encryption key:</span> <code className="text-xs">{regionResult.encryptionKeyId}</code></p>
            </div>
          )}
        </Card>

        <Card title="Cross-border transfer check (dataResidency.canTransfer)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From country (ISO)">
              <input value={ctFrom} onChange={(e) => setCtFrom(e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
            </Field>
            <Field label="To region">
              <select value={ctTo} onChange={(e) => setCtTo(e.target.value as DataRegion)} className={inputCls}>
                {DATA_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>
          <button type="button" onClick={() => void checkTransfer()} disabled={!ctFrom} className={`${btnSecondaryCls} mt-3`}>
            Check transfer
          </button>
          {ctErr && <p className="text-sm text-red-600 mt-2">{ctErr}</p>}
          {ctResult && (
            <div className="mt-3 text-sm space-y-1">
              <Badge tone={ctResult.allowed ? "ok" : "bad"}>{ctResult.allowed ? "Transfer allowed" : "Transfer restricted"}</Badge>
              {ctResult.mechanism && <p><span className="text-slate-500">Mechanism:</span> {ctResult.mechanism}</p>}
              <p><span className="text-slate-500">Consent required:</span> {ctResult.requiresConsent ? "yes" : "no"}</p>
              <p className="text-slate-600">{ctResult.documentation}</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="Submit data subject request (dataResidency.submitDSAR — mutation, TOTP step-up)">
        <ErrBanner msg={dsarErr} onDismiss={() => setDsarErr(null)} />
        <form onSubmit={(e) => void submitDsar(e)} className="grid md:grid-cols-3 gap-3 mt-3">
          <Field label="Request type">
            <select value={dsarType} onChange={(e) => setDsarType(e.target.value as DsarType)} className={inputCls}>
              {(["access", "erasure", "rectification", "portability", "restriction", "objection"] as const).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Reason (optional)">
            <input value={dsarReason} onChange={(e) => setDsarReason(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex items-end gap-4">
            <TotpField value={dsarTotp} onChange={setDsarTotp} />
            <button type="submit" disabled={dsarBusy} className={btnPrimaryCls}>
              {dsarBusy ? "Submitting…" : "Submit DSAR"}
            </button>
          </div>
        </form>
        {dsarResult !== null && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1">Data subject request recorded:</p>
            <JsonView data={dsarResult} />
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Processing legality check (dataResidency.validateProcessing)">
          <ErrBanner msg={vpErr} onDismiss={() => setVpErr(null)} />
          <div className="space-y-3 mt-1">
            <Field label="Country (ISO)">
              <input value={vpCountry} onChange={(e) => setVpCountry(e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
            </Field>
            <Field label="Data category">
              {categories && categories.length > 0 ? (
                <select value={vpCategory} onChange={(e) => setVpCategory(e.target.value)} className={inputCls}>
                  <option value="">Select category…</option>
                  {categories.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <input value={vpCategory} onChange={(e) => setVpCategory(e.target.value)} className={inputCls} />
              )}
            </Field>
            <Field label="Purpose">
              <input value={vpPurpose} onChange={(e) => setVpPurpose(e.target.value)} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={vpConsent} onChange={(e) => setVpConsent(e.target.checked)} />
              Subject consent obtained
            </label>
            <button type="button" onClick={() => void validateProcessing()} disabled={!vpCountry || !vpCategory || !vpPurpose} className={btnSecondaryCls}>
              Validate
            </button>
          </div>
          {vpResult !== null && (
            <div className="mt-3">
              <JsonView data={vpResult} />
            </div>
          )}
        </Card>

        <Card title="Data categories register (dataResidency.getCategories)">
          {categories === null ? (
            refErr ? null : <Spinner label="Loading categories…" />
          ) : categories.length === 0 ? (
            <Empty>No data categories are registered.</Empty>
          ) : (
            <div className="space-y-2 max-h-96 overflow-auto">
              {categories.map((c) => (
                <div key={c.name} className="rounded-xl border border-slate-100 p-3 text-sm">
                  <p className="font-medium text-slate-900">{c.name}</p>
                  <p className="text-slate-600 mt-0.5">{c.description}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Basis: {c.legalBasis} · Retention: {c.retentionPeriod}
                    {c.encryptionRequired && " · encryption required"}
                    {c.crossBorderRestricted && " · cross-border restricted"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Data export (dataResidency.exportData)">
        <ErrBanner msg={expErr} onDismiss={() => setExpErr(null)} />
        <Field label={`Categories to export (${expCategories.length} selected)`}>
          {categories && categories.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-1 border border-slate-100 rounded-xl p-3">
              {categories.map((c) => (
                <label key={c.name} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={expCategories.includes(c.name)}
                    onChange={(e) =>
                      setExpCategories(
                        e.target.checked ? [...expCategories, c.name] : expCategories.filter((n) => n !== c.name),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Category register unavailable — export requires category names.</p>
          )}
        </Field>
        <button type="button" onClick={() => void runExport()} disabled={expCategories.length === 0} className={`${btnSecondaryCls} mt-3`}>
          Generate export
        </button>
        {expResult !== null && (
          <div className="mt-3">
            <JsonView data={expResult} />
          </div>
        )}
      </Card>
    </div>
  );
};

// ── Tab: Audit trail ───────────────────────────────────────────────────────

const AuditTab: React.FC = () => {
  // verifyIntegrity
  const [viJson, setViJson] = useState("");
  const [viResult, setViResult] = useState<{ valid: boolean; brokenAt?: string; verifiedCount: number } | null>(null);
  const [viErr, setViErr] = useState<string | null>(null);

  // export
  const [exFormat, setExFormat] = useState<"json" | "csv" | "xml">("json");
  const [exJur, setExJur] = useState<Jurisdiction>("US");
  const [exFrom, setExFrom] = useState("");
  const [exTo, setExTo] = useState("");
  const [exResult, setExResult] = useState<unknown | null>(null);
  const [exErr, setExErr] = useState<string | null>(null);

  // record
  const [recType, setRecType] = useState("");
  const [recDetails, setRecDetails] = useState("{}");
  const [recJur, setRecJur] = useState("");
  const [recCorr, setRecCorr] = useState("");
  const [recTotp, setRecTotp] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [recResult, setRecResult] = useState<unknown | null>(null);

  const verify = async () => {
    setViErr(null);
    setViResult(null);
    let events: unknown[];
    try {
      const parsed: unknown = JSON.parse(viJson);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      events = parsed;
    } catch {
      setViErr("Events must be a JSON array of audit event objects.");
      return;
    }
    try {
      setViResult(await api.complianceV2.audit.verifyIntegrity.query({ events }));
    } catch (e) {
      setViErr(errorMessage(e, "Chain integrity verification failed."));
    }
  };

  const runExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExErr(null);
    setExResult(null);
    try {
      setExResult(
        await api.complianceV2.audit.export.query({
          format: exFormat,
          jurisdiction: exJur,
          dateRange: { from: exFrom, to: exTo },
        }),
      );
    } catch (err2) {
      setExErr(errorMessage(err2, "Audit export failed."));
    }
  };

  const recordEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecErr(null);
    setRecResult(null);
    let details: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(recDetails);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      details = parsed as Record<string, unknown>;
    } catch {
      setRecErr("Details must be a JSON object.");
      return;
    }
    setRecBusy(true);
    try {
      setRecResult(
        await api.complianceV2.audit.record.mutate({
          type: recType,
          details,
          jurisdiction: recJur || undefined,
          correlationId: recCorr || undefined,
          totpCode: recTotp || undefined,
        }),
      );
      setRecTotp("");
    } catch (err2) {
      setRecErr(errorMessage(err2, "Audit event recording was rejected by the server."));
    } finally {
      setRecBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card title="Verify hash-chain integrity (audit.verifyIntegrity)">
        <ErrBanner msg={viErr} onDismiss={() => setViErr(null)} />
        <Field label="Audit events (JSON array)" hint="Paste the event chain exactly as exported; the server verifies previousHash/chainHash links.">
          <textarea value={viJson} onChange={(e) => setViJson(e.target.value)} className={`${inputCls} font-mono text-xs min-h-[100px]`} />
        </Field>
        <button type="button" onClick={() => void verify()} disabled={!viJson.trim()} className={`${btnSecondaryCls} mt-3`}>
          Verify chain
        </button>
        {viResult && (
          <div className="mt-3 text-sm space-y-1">
            <Badge tone={viResult.valid ? "ok" : "bad"}>{viResult.valid ? "Chain valid" : "Chain broken"}</Badge>
            <p><span className="text-slate-500">Events verified:</span> {viResult.verifiedCount}</p>
            {viResult.brokenAt && <p><span className="text-slate-500">Broken at event:</span> <code className="text-xs">{viResult.brokenAt}</code></p>}
          </div>
        )}
      </Card>

      <Card title="Export audit trail (audit.export)">
        <ErrBanner msg={exErr} onDismiss={() => setExErr(null)} />
        <form onSubmit={(e) => void runExport(e)} className="grid md:grid-cols-4 gap-3 mt-3">
          <Field label="Format">
            <select value={exFormat} onChange={(e) => setExFormat(e.target.value as "json" | "csv" | "xml")} className={inputCls}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="xml">XML</option>
            </select>
          </Field>
          <Field label="Jurisdiction">
            <select value={exJur} onChange={(e) => setExJur(e.target.value as Jurisdiction)} className={inputCls}>
              {JURISDICTIONS.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input required type="date" value={exFrom} onChange={(e) => setExFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="To">
            <input required type="date" value={exTo} onChange={(e) => setExTo(e.target.value)} className={inputCls} />
          </Field>
          <div className="md:col-span-4">
            <button type="submit" className={btnSecondaryCls}>Generate export</button>
          </div>
        </form>
        {exResult !== null && (
          <div className="mt-3">
            <JsonView data={exResult} />
          </div>
        )}
      </Card>

      <Card title="Record audit event (audit.record — mutation, TOTP step-up)">
        <ErrBanner msg={recErr} onDismiss={() => setRecErr(null)} />
        <form onSubmit={(e) => void recordEvent(e)} className="grid md:grid-cols-2 gap-3 mt-3">
          <Field label="Event type">
            <input required value={recType} onChange={(e) => setRecType(e.target.value)} className={inputCls} placeholder="e.g. compliance.manual_review" />
          </Field>
          <Field label="Jurisdiction (optional)">
            <input value={recJur} onChange={(e) => setRecJur(e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
          </Field>
          <Field label="Correlation ID (optional)">
            <input value={recCorr} onChange={(e) => setRecCorr(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Details (JSON object)">
            <textarea required value={recDetails} onChange={(e) => setRecDetails(e.target.value)} className={`${inputCls} font-mono text-xs min-h-[60px]`} />
          </Field>
          <div className="flex items-end gap-4">
            <TotpField value={recTotp} onChange={setRecTotp} />
            <button type="submit" disabled={recBusy} className={btnPrimaryCls}>
              {recBusy ? "Recording…" : "Record event"}
            </button>
          </div>
        </form>
        {recResult !== null && (
          <div className="mt-3">
            <JsonView data={recResult} />
          </div>
        )}
      </Card>
    </div>
  );
};

// ── Tab: KYC tier limits ───────────────────────────────────────────────────

const KycTab: React.FC = () => {
  const [tiers, setTiers] = useState<TierLimits[] | null>(null);
  const [tiersErr, setTiersErr] = useState<string | null>(null);

  const [limitTier, setLimitTier] = useState(1);
  const [limitDetail, setLimitDetail] = useState<TierLimits | null>(null);
  const [limitErr, setLimitErr] = useState<string | null>(null);

  const [chkTier, setChkTier] = useState(1);
  const [chkAmount, setChkAmount] = useState("");
  const [chkDaily, setChkDaily] = useState("");
  const [chkMonthly, setChkMonthly] = useState("");
  const [chkResult, setChkResult] = useState<{ allowed: boolean; reason?: string } | null>(null);
  const [chkErr, setChkErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setTiers(await api.complianceV2.kyc.getAllTiers.query());
      } catch (e) {
        setTiersErr(errorMessage(e, "KYC tier catalogue could not be loaded."));
      }
    })();
  }, []);

  const loadTier = async () => {
    setLimitErr(null);
    setLimitDetail(null);
    try {
      setLimitDetail(await api.complianceV2.kyc.getTierLimits.query({ tier: limitTier }));
    } catch (e) {
      setLimitErr(errorMessage(e, "Tier limits could not be loaded."));
    }
  };

  const runCheck = async () => {
    setChkErr(null);
    setChkResult(null);
    try {
      setChkResult(
        await api.complianceV2.kyc.checkLimit.query({
          tier: chkTier,
          amount: Number(chkAmount),
          dailyTotal: Number(chkDaily),
          monthlyTotal: Number(chkMonthly),
        }),
      );
    } catch (e) {
      setChkErr(errorMessage(e, "Limit check failed."));
    }
  };

  return (
    <div className="space-y-5">
      <Card title="All tiers (kyc.getAllTiers)">
        <ErrBanner msg={tiersErr} onDismiss={() => setTiersErr(null)} />
        {tiers === null ? (
          tiersErr ? null : <Spinner label="Loading tiers…" />
        ) : tiers.length === 0 ? (
          <Empty>No KYC tiers are configured.</Empty>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Tier</th>
                  <th className="py-1">Daily limit</th>
                  <th className="py-1">Monthly limit</th>
                  <th className="py-1">Single tx limit</th>
                  <th className="py-1">Max balance</th>
                  <th className="py-1">Features</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.tier} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium text-slate-900">{t.tier}</td>
                    <td className="py-1.5">{t.currency} {t.dailyLimit.toLocaleString()}</td>
                    <td className="py-1.5">{t.currency} {t.monthlyLimit.toLocaleString()}</td>
                    <td className="py-1.5">{t.currency} {t.singleTransactionLimit.toLocaleString()}</td>
                    <td className="py-1.5">{t.currency} {t.maxBalance.toLocaleString()}</td>
                    <td className="py-1.5 text-xs text-slate-500">{t.features.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Tier detail (kyc.getTierLimits)">
          <div className="flex gap-2">
            <select value={limitTier} onChange={(e) => setLimitTier(Number(e.target.value))} className={inputCls}>
              {[0, 1, 2, 3].map((t) => (
                <option key={t} value={t}>Tier {t}</option>
              ))}
            </select>
            <button type="button" onClick={() => void loadTier()} className={btnSecondaryCls}>Load</button>
          </div>
          {limitErr && <p className="text-sm text-red-600 mt-2">{limitErr}</p>}
          {limitDetail && (
            <div className="mt-3 text-sm space-y-1">
              <p><span className="text-slate-500">Daily:</span> {limitDetail.currency} {limitDetail.dailyLimit.toLocaleString()}</p>
              <p><span className="text-slate-500">Monthly:</span> {limitDetail.currency} {limitDetail.monthlyLimit.toLocaleString()}</p>
              <p><span className="text-slate-500">Single transaction:</span> {limitDetail.currency} {limitDetail.singleTransactionLimit.toLocaleString()}</p>
              <p><span className="text-slate-500">Max balance:</span> {limitDetail.currency} {limitDetail.maxBalance.toLocaleString()}</p>
              <p><span className="text-slate-500">Features:</span> {limitDetail.features.join(", ")}</p>
            </div>
          )}
        </Card>

        <Card title="Limit check (kyc.checkLimit)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tier">
              <select value={chkTier} onChange={(e) => setChkTier(Number(e.target.value))} className={inputCls}>
                {[0, 1, 2, 3].map((t) => (
                  <option key={t} value={t}>Tier {t}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount">
              <input type="number" min="0" step="any" value={chkAmount} onChange={(e) => setChkAmount(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Current daily total">
              <input type="number" min="0" step="any" value={chkDaily} onChange={(e) => setChkDaily(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Current monthly total">
              <input type="number" min="0" step="any" value={chkMonthly} onChange={(e) => setChkMonthly(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <button type="button" onClick={() => void runCheck()} disabled={!chkAmount || !chkDaily || !chkMonthly} className={`${btnSecondaryCls} mt-3`}>
            Check limit
          </button>
          {chkErr && <p className="text-sm text-red-600 mt-2">{chkErr}</p>}
          {chkResult && (
            <div className="mt-3">
              <Badge tone={chkResult.allowed ? "ok" : "bad"}>{chkResult.allowed ? "Within limits" : "Limit exceeded"}</Badge>
              {chkResult.reason && <p className="text-sm text-slate-600 mt-2">{chkResult.reason}</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

// ── Tab: Travel Rule (IVMS101 — complianceV2.travelRule) ───────────────────

const TravelRuleTab: React.FC = () => {
  const [thresholds, setThresholds] = useState<
    Array<{ country: string; currency: string; threshold: number; regulator: string; notes: string }> | null
  >(null);
  const [thrErr, setThrErr] = useState<string | null>(null);

  // checkThreshold
  const [chkAmount, setChkAmount] = useState("");
  const [chkCurrency, setChkCurrency] = useState("USD");
  const [chkFrom, setChkFrom] = useState("");
  const [chkTo, setChkTo] = useState("");
  const [chkResult, setChkResult] = useState<{ required: boolean; reason: string; threshold: unknown } | null>(null);
  const [chkErr, setChkErr] = useState<string | null>(null);

  // resolveVASP
  const [vaspWallet, setVaspWallet] = useState("");
  const [vaspChain, setVaspChain] = useState("");
  const [vaspResult, setVaspResult] = useState<unknown | null>(null);
  const [vaspResolved, setVaspResolved] = useState(false);
  const [vaspErr, setVaspErr] = useState<string | null>(null);

  // submit
  const [sub, setSub] = useState({
    oFirst: "", oLast: "", oDob: "", oNatId: "", oNatIdType: "", oCountry: "", oAccount: "",
    bFirst: "", bLast: "", bCountry: "", bAccount: "",
    asset: "", amount: "", chain: "", txHash: "",
  });
  const [subTotp, setSubTotp] = useState("");
  const [subBusy, setSubBusy] = useState(false);
  const [subErr, setSubErr] = useState<string | null>(null);
  const [subResult, setSubResult] = useState<unknown | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setThresholds(await api.complianceV2.travelRule.getThresholds.query());
      } catch (e) {
        setThrErr(errorMessage(e, "Travel rule thresholds could not be loaded."));
      }
    })();
  }, []);

  const runCheck = async () => {
    setChkErr(null);
    setChkResult(null);
    try {
      setChkResult(
        await api.complianceV2.travelRule.checkThreshold.query({
          amount: Number(chkAmount),
          currency: chkCurrency,
          originatorCountry: chkFrom.toUpperCase(),
          beneficiaryCountry: chkTo.toUpperCase(),
        }),
      );
    } catch (e) {
      setChkErr(errorMessage(e, "Threshold check failed."));
    }
  };

  const resolveVasp = async () => {
    setVaspErr(null);
    setVaspResult(null);
    setVaspResolved(false);
    try {
      const res = await api.complianceV2.travelRule.resolveVASP.query({ walletAddress: vaspWallet, chain: vaspChain });
      setVaspResult(res);
      setVaspResolved(true);
    } catch (e) {
      setVaspErr(errorMessage(e, "VASP resolution failed."));
    }
  };

  const submitIvms = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubBusy(true);
    setSubErr(null);
    setSubResult(null);
    try {
      setSubResult(
        await api.complianceV2.travelRule.submit.mutate({
          originator: {
            firstName: sub.oFirst,
            lastName: sub.oLast,
            dateOfBirth: sub.oDob || undefined,
            nationalId: sub.oNatId || undefined,
            nationalIdType: sub.oNatIdType || undefined,
            country: sub.oCountry.toUpperCase(),
            accountNumber: sub.oAccount,
          },
          beneficiary: {
            firstName: sub.bFirst,
            lastName: sub.bLast,
            country: sub.bCountry.toUpperCase(),
            accountNumber: sub.bAccount,
          },
          asset: sub.asset,
          amount: sub.amount,
          chain: sub.chain,
          txHash: sub.txHash || undefined,
          totpCode: subTotp || undefined,
        }),
      );
      setSubTotp("");
    } catch (err2) {
      setSubErr(errorMessage(err2, "Travel rule submission was rejected by the server."));
    } finally {
      setSubBusy(false);
    }
  };

  const setSubField = (k: keyof typeof sub) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSub({ ...sub, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <Card title="Jurisdiction thresholds (complianceV2.travelRule.getThresholds)">
        <ErrBanner msg={thrErr} onDismiss={() => setThrErr(null)} />
        {thresholds === null ? (
          thrErr ? null : <Spinner label="Loading thresholds…" />
        ) : thresholds.length === 0 ? (
          <Empty>No travel rule thresholds are configured.</Empty>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Country</th>
                  <th className="py-1">Threshold</th>
                  <th className="py-1">Regulator</th>
                  <th className="py-1">Notes</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((t) => (
                  <tr key={t.country} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium text-slate-900">{t.country}</td>
                    <td className="py-1.5">{t.currency} {t.threshold.toLocaleString()}</td>
                    <td className="py-1.5">{t.regulator}</td>
                    <td className="py-1.5 text-xs text-slate-500">{t.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Threshold check (travelRule.checkThreshold)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <input type="number" min="0" step="any" value={chkAmount} onChange={(e) => setChkAmount(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Currency">
              <input value={chkCurrency} onChange={(e) => setChkCurrency(e.target.value.toUpperCase())} className={inputCls} maxLength={3} />
            </Field>
            <Field label="Originator country (ISO)">
              <input value={chkFrom} onChange={(e) => setChkFrom(e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
            </Field>
            <Field label="Beneficiary country (ISO)">
              <input value={chkTo} onChange={(e) => setChkTo(e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
            </Field>
          </div>
          <button type="button" onClick={() => void runCheck()} disabled={!chkAmount || !chkFrom || !chkTo} className={`${btnSecondaryCls} mt-3`}>
            Check
          </button>
          {chkErr && <p className="text-sm text-red-600 mt-2">{chkErr}</p>}
          {chkResult && (
            <div className="mt-3">
              <Badge tone={chkResult.required ? "warn" : "ok"}>
                {chkResult.required ? "Travel rule applies" : "Below threshold — travel rule not required"}
              </Badge>
              <p className="text-sm text-slate-600 mt-2">{chkResult.reason}</p>
            </div>
          )}
        </Card>

        <Card title="Counterparty VASP resolution (travelRule.resolveVASP)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Wallet address">
              <input value={vaspWallet} onChange={(e) => setVaspWallet(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Chain">
              <input value={vaspChain} onChange={(e) => setVaspChain(e.target.value)} className={inputCls} placeholder="e.g. bitcoin" />
            </Field>
          </div>
          <button type="button" onClick={() => void resolveVasp()} disabled={!vaspWallet || !vaspChain} className={`${btnSecondaryCls} mt-3`}>
            Resolve
          </button>
          {vaspErr && <p className="text-sm text-red-600 mt-2">{vaspErr}</p>}
          {vaspResolved &&
            (vaspResult === null ? (
              <p className="text-sm text-slate-500 mt-3">No counterparty VASP could be resolved for this address/chain.</p>
            ) : (
              <div className="mt-3">
                <JsonView data={vaspResult} />
              </div>
            ))}
        </Card>
      </div>

      <Card title="Submit IVMS101 travel rule transfer (travelRule.submit — mutation, TOTP step-up)">
        <ErrBanner msg={subErr} onDismiss={() => setSubErr(null)} />
        <form onSubmit={(e) => void submitIvms(e)} className="mt-3 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Originator</p>
          <div className="grid md:grid-cols-4 gap-3">
            <Field label="First name"><input required value={sub.oFirst} onChange={setSubField("oFirst")} className={inputCls} /></Field>
            <Field label="Last name"><input required value={sub.oLast} onChange={setSubField("oLast")} className={inputCls} /></Field>
            <Field label="Date of birth (optional)"><input type="date" value={sub.oDob} onChange={setSubField("oDob")} className={inputCls} /></Field>
            <Field label="Country (ISO)"><input required value={sub.oCountry} onChange={setSubField("oCountry")} className={inputCls} maxLength={2} /></Field>
            <Field label="Account number"><input required value={sub.oAccount} onChange={setSubField("oAccount")} className={inputCls} /></Field>
            <Field label="National ID (optional)"><input value={sub.oNatId} onChange={setSubField("oNatId")} className={inputCls} /></Field>
            <Field label="National ID type (optional)"><input value={sub.oNatIdType} onChange={setSubField("oNatIdType")} className={inputCls} /></Field>
          </div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Beneficiary</p>
          <div className="grid md:grid-cols-4 gap-3">
            <Field label="First name"><input required value={sub.bFirst} onChange={setSubField("bFirst")} className={inputCls} /></Field>
            <Field label="Last name"><input required value={sub.bLast} onChange={setSubField("bLast")} className={inputCls} /></Field>
            <Field label="Country (ISO)"><input required value={sub.bCountry} onChange={setSubField("bCountry")} className={inputCls} maxLength={2} /></Field>
            <Field label="Account number"><input required value={sub.bAccount} onChange={setSubField("bAccount")} className={inputCls} /></Field>
          </div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Transfer</p>
          <div className="grid md:grid-cols-4 gap-3">
            <Field label="Asset"><input required value={sub.asset} onChange={setSubField("asset")} className={inputCls} placeholder="BTC" /></Field>
            <Field label="Amount"><input required value={sub.amount} onChange={setSubField("amount")} className={inputCls} placeholder="0.5" /></Field>
            <Field label="Chain"><input required value={sub.chain} onChange={setSubField("chain")} className={inputCls} placeholder="bitcoin" /></Field>
            <Field label="Tx hash (optional)"><input value={sub.txHash} onChange={setSubField("txHash")} className={inputCls} /></Field>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <TotpField value={subTotp} onChange={setSubTotp} />
            <button type="submit" disabled={subBusy} className={btnPrimaryCls}>
              {subBusy ? "Submitting…" : "Submit travel rule transfer"}
            </button>
          </div>
        </form>
        {subResult !== null && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1">Submission result:</p>
            <JsonView data={subResult} />
          </div>
        )}
      </Card>
    </div>
  );
};

// ── Tab: Travel rule records (travelRule.adminList — adminProcedure) ───────

const RecordsTab: React.FC = () => {
  const [records, setRecords] = useState<TravelRuleAdminRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<TravelRuleAdminStatus | "">("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.travelRule.adminList.query({
        status: status || undefined,
        search: search.trim() || undefined,
        limit: LIMIT,
        offset,
      });
      setRecords(res.records);
      setTotal(res.total);
    } catch (e) {
      setErr(errorMessage(e, "Travel rule records could not be loaded. The admin API may be unavailable."));
      setRecords([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [status, search, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <ErrBanner msg={err} onDismiss={() => setErr(null)} />
      <Card>
        <div className="flex flex-wrap gap-3">
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as TravelRuleAdminStatus | "");
                setOffset(0);
              }}
              className={inputCls}
            >
              <option value="">All statuses</option>
              {(["submitted", "verified", "rejected", "pending"] as const).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Beneficiary name search">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              className={inputCls}
              placeholder="Filter by beneficiary name"
            />
          </Field>
        </div>
      </Card>
      {loading ? (
        <Spinner label="Loading travel rule records…" />
      ) : records.length === 0 ? (
        <Empty>No travel rule records match the current filters.</Empty>
      ) : (
        <div className="space-y-3">
          {records.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    #{r.id} · {r.beneficiary_name ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    user {r.user_name ?? r.userId} ({r.user_email ?? "—"}) · bank {r.beneficiary_bank ?? "—"}{" "}
                    {r.beneficiary_bank_country ? `(${r.beneficiary_bank_country})` : ""} · submitted {fmtDate(r.submitted_at ?? r.created_at)}
                  </p>
                  {r.purpose && <p className="text-xs text-slate-500 mt-1">Purpose: {r.purpose}</p>}
                </div>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Showing {offset + 1}–{offset + records.length} of {total}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className={btnSecondaryCls}>
                Previous
              </button>
              <button type="button" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} className={btnSecondaryCls}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Console shell ──────────────────────────────────────────────────────────

const ComplianceConsole: React.FC = () => {
  const [tab, setTab] = useState<TabKey>("queue");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Console"
        subtitle="Regulatory reporting queue, CTR/SAR filings, screening, data residency, audit trail, KYC tier limits and FATF travel rule records (complianceV2 + travelRule.adminList)."
      />
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white"
                : "px-4 py-2 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "queue" && <QueueTab />}
      {tab === "filings" && <FilingsTab />}
      {tab === "screening" && <ScreeningTab />}
      {tab === "residency" && <ResidencyTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "kyc" && <KycTab />}
      {tab === "travelRule" && <TravelRuleTab />}
      {tab === "records" && <RecordsTab />}
    </div>
  );
};

export default ComplianceConsole;
