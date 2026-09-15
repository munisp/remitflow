import React, { useCallback, useEffect, useState } from "react";
import {
  asList,
  bdc,
  errMsg,
  fmtDateTime,
  fmtMoney,
  type RegulatoryReturn,
} from "./api";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  EndpointPending,
  ErrorNote,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

const RETURN_TYPES = ["fifx", "fina", "carp", "trms", "extranet"] as const;

const BdcMlroConsole: React.FC = () => {
  // ── SoF declaration review ──
  const [sofId, setSofId] = useState("");
  const [sofReason, setSofReason] = useState("");
  const [sofTotp, setSofTotp] = useState("");
  const [sofMsg, setSofMsg] = useState<string | null>(null);
  const [sofErr, setSofErr] = useState<string | null>(null);

  // ── screening ──
  const [screenCustomerId, setScreenCustomerId] = useState("");
  const [screenResult, setScreenResult] = useState<unknown>(null);
  const [screenErr, setScreenErr] = useState<string | null>(null);
  const [screenLoading, setScreenLoading] = useState(false);

  // ── CTR check ──
  const [ctrAmount, setCtrAmount] = useState("");
  const [ctrResult, setCtrResult] = useState<{ requiresCtr: boolean; threshold: string | number } | null>(null);
  const [ctrErr, setCtrErr] = useState<string | null>(null);

  // ── STR filing ──
  const [strTxId, setStrTxId] = useState("");
  const [strReason, setStrReason] = useState("");
  const [strRisk, setStrRisk] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [strNarrative, setStrNarrative] = useState("");
  const [strOfficer, setStrOfficer] = useState("");
  const [strTotp, setStrTotp] = useState("");
  const [strResult, setStrResult] = useState<unknown>(null);
  const [strErr, setStrErr] = useState<string | null>(null);

  // ── regulatory returns ──
  const [retType, setRetType] = useState<(typeof RETURN_TYPES)[number]>("fifx");
  const [retStart, setRetStart] = useState("");
  const [retEnd, setRetEnd] = useState("");
  const [buildMsg, setBuildMsg] = useState<string | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const [returns, setReturns] = useState<RegulatoryReturn[]>([]);
  const [returnsErr, setReturnsErr] = useState<string | null>(null);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsFilter, setReturnsFilter] = useState("");
  const [retTotp, setRetTotp] = useState<Record<number, string>>({});
  const [retMsg, setRetMsg] = useState<Record<number, string>>({});

  const reviewSof = async (decision: "approved" | "rejected") => {
    setSofMsg(null);
    setSofErr(null);
    try {
      const res = await bdc.compliance.reviewSofDeclaration.mutate({
        declarationId: Number(sofId),
        decision,
        // Server schema: reason is REQUIRED (min 5 chars) for both decisions.
        reason: sofReason,
        totpCode: sofTotp,
      });
      setSofMsg(`Declaration #${res.id} ${decision}.`);
      setSofTotp("");
    } catch (e) {
      setSofErr(errMsg(e));
    }
  };

  const runScreening = async () => {
    setScreenLoading(true);
    setScreenResult(null);
    setScreenErr(null);
    try {
      const res = await bdc.compliance.screenCustomer.mutate({
        customerId: Number(screenCustomerId),
      });
      setScreenResult(res);
    } catch (e) {
      // Fail-closed: screening outage blocks the operation server-side.
      setScreenErr(errMsg(e));
    } finally {
      setScreenLoading(false);
    }
  };

  const runCtrCheck = async () => {
    setCtrResult(null);
    setCtrErr(null);
    try {
      // Server schema: { amount (major-unit string), currency } — currency is
      // required; this card is USD-threshold specific.
      const res = await bdc.compliance.ctrCheck.query({ amount: ctrAmount, currency: "USD" });
      setCtrResult(res);
    } catch (e) {
      setCtrErr(errMsg(e));
    }
  };

  const fileStr = async () => {
    setStrResult(null);
    setStrErr(null);
    try {
      const res = await bdc.compliance.fileStr.mutate({
        transactionId: Number(strTxId),
        suspicionReason: strReason,
        riskLevel: strRisk,
        narrative: strNarrative,
        filingOfficer: strOfficer,
        totpCode: strTotp,
      });
      setStrResult(res);
      setStrTotp("");
    } catch (e) {
      // Honest failure: goaml outage → UNAVAILABLE, draft retained server-side.
      setStrErr(errMsg(e));
    }
  };

  const loadReturns = useCallback(async () => {
    setReturnsLoading(true);
    setReturnsErr(null);
    try {
      const res = await bdc.reporting.listReturns.query(
        returnsFilter
          ? { status: returnsFilter as "draft" | "staged" | "submitted" | "acknowledged" | "quarantined" | "failed" }
          : {},
      );
      setReturns(asList(res as RegulatoryReturn[] | { items: RegulatoryReturn[] }));
    } catch (e) {
      setReturnsErr(errMsg(e));
      setReturns([]);
    } finally {
      setReturnsLoading(false);
    }
  }, [returnsFilter]);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  const buildReturn = async () => {
    setBuildMsg(null);
    setBuildErr(null);
    try {
      const r = await bdc.reporting.buildReturn.mutate({
        returnType: retType,
        periodStart: retStart,
        periodEnd: retEnd,
      });
      setBuildMsg(`Return #${r.id} staged (${r.returnType} ${r.periodStart} → ${r.periodEnd}).`);
      await loadReturns();
    } catch (e) {
      setBuildErr(errMsg(e));
    }
  };

  const submitReturn = async (returnId: number) => {
    const code = retTotp[returnId] ?? "";
    setRetMsg((m) => ({ ...m, [returnId]: "" }));
    try {
      await bdc.reporting.submitReturn.mutate({ returnId, totpCode: code });
      setRetMsg((m) => ({ ...m, [returnId]: "Submitted — awaiting regulator ack." }));
      await loadReturns();
    } catch (e) {
      setRetMsg((m) => ({ ...m, [returnId]: errMsg(e) }));
    }
  };

  const retryReturn = async (returnId: number) => {
    setRetMsg((m) => ({ ...m, [returnId]: "" }));
    try {
      await bdc.reporting.retryQuarantined.mutate({ returnId });
      setRetMsg((m) => ({ ...m, [returnId]: "Re-staged with new idempotency suffix." }));
      await loadReturns();
    } catch (e) {
      setRetMsg((m) => ({ ...m, [returnId]: errMsg(e) }));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC MLRO Console"
        subtitle="SoF declarations, screening, CTR flags, STR filing and regulatory returns"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="SoF declaration review (bdc.compliance.reviewSofDeclaration + TOTP)">
          <div className="space-y-3">
            <EndpointPending
              procedure="bdc.compliance.listSofDeclarations"
              note="SPEC §3.8 defines submit + review only — no queue-listing procedure. Review declarations by ID below; tellers see the declarationId in the pending buy-ticket response."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Declaration ID">
                <input className={inputCls} inputMode="numeric" value={sofId} onChange={(e) => setSofId(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Reason (required, min 5 chars)">
                <input className={inputCls} value={sofReason} onChange={(e) => setSofReason(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <TotpField value={sofTotp} onChange={setSofTotp} label="MLRO TOTP" />
              <button
                className={btnPrimaryCls}
                disabled={!sofId || sofReason.trim().length < 5 || sofTotp.length !== 6}
                onClick={() => reviewSof("approved")}
              >
                Approve
              </button>
              <button
                className={btnSecondaryCls}
                disabled={!sofId || sofReason.trim().length < 5 || sofTotp.length !== 6}
                onClick={() => reviewSof("rejected")}
              >
                Reject
              </button>
            </div>
            {sofMsg && <SuccessNote>{sofMsg}</SuccessNote>}
            {sofErr && <ErrorNote error={sofErr} />}
          </div>
        </Card>

        <Card title="Customer screening (bdc.compliance.screenCustomer)">
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="w-48">
                <Field label="BDC customer ID">
                  <input className={inputCls} inputMode="numeric" value={screenCustomerId} onChange={(e) => setScreenCustomerId(e.target.value.replace(/\D/g, ""))} />
                </Field>
              </div>
              <button className={btnPrimaryCls} disabled={!screenCustomerId || screenLoading} onClick={runScreening}>
                {screenLoading ? "Screening..." : "Run screening"}
              </button>
            </div>
            {screenErr && <ErrorNote error={screenErr} />}
            {screenResult != null && <JsonView data={screenResult} />}
            <p className="text-xs text-slate-400">
              Fail-closed: a screening outage blocks the operation — the server
              never proceeds on a failed screening call.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="CTR flag check (bdc.compliance.ctrCheck — pre-post)">
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="w-56">
                <Field label="Amount (USD, 2dp)">
                  <input className={inputCls} inputMode="decimal" value={ctrAmount} onChange={(e) => setCtrAmount(e.target.value)} placeholder="e.g. 12000.00" />
                </Field>
              </div>
              <button className={btnSecondaryCls} disabled={!ctrAmount} onClick={runCtrCheck}>
                Check CTR
              </button>
            </div>
            {ctrErr && <ErrorNote error={ctrErr} />}
            {ctrResult && (
              <div className="flex items-center gap-2">
                <Badge tone={ctrResult.requiresCtr ? "bad" : "ok"}>
                  {ctrResult.requiresCtr ? "CTR REQUIRED" : "no CTR required"}
                </Badge>
                <p className="text-xs text-slate-500">
                  threshold {fmtMoney(ctrResult.threshold, "USD")}
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card title="File STR (bdc.compliance.fileStr + TOTP)">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Transaction ID">
                <input className={inputCls} inputMode="numeric" value={strTxId} onChange={(e) => setStrTxId(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Suspicion reason (min 10 chars)">
                <input className={inputCls} value={strReason} onChange={(e) => setStrReason(e.target.value)} />
              </Field>
              <Field label="Risk level">
                <select className={inputCls} value={strRisk} onChange={(e) => setStrRisk(e.target.value as typeof strRisk)}>
                  {(["low", "medium", "high", "critical"] as const).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Filing officer">
                <input className={inputCls} value={strOfficer} onChange={(e) => setStrOfficer(e.target.value)} placeholder="Officer full name" />
              </Field>
            </div>
            <Field label="Narrative (min 50 chars)">
              <textarea
                className={inputCls}
                rows={3}
                value={strNarrative}
                onChange={(e) => setStrNarrative(e.target.value)}
                placeholder="Full goaml narrative: parties, amounts, dates, grounds for suspicion"
              />
            </Field>
            <div className="flex items-end gap-3">
              <TotpField value={strTotp} onChange={setStrTotp} label="MLRO TOTP" />
              <button
                className={btnPrimaryCls}
                disabled={
                  !strTxId ||
                  strReason.trim().length < 10 ||
                  strNarrative.trim().length < 50 ||
                  strOfficer.trim().length < 2 ||
                  strTotp.length !== 6
                }
                onClick={fileStr}
              >
                Draft & file STR
              </button>
            </div>
            {strErr && <ErrorNote error={strErr} />}
            {strResult != null && (
              <>
                <SuccessNote>STR submitted to the goaml pipeline (or retained as draft if the service reported UNAVAILABLE).</SuccessNote>
                <JsonView data={strResult} />
              </>
            )}
          </div>
        </Card>
      </div>

      <Card title="Regulatory returns (bdc.reporting.buildReturn / submitReturn / retryQuarantined)">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Return type">
              <select className={inputCls} value={retType} onChange={(e) => setRetType(e.target.value as (typeof RETURN_TYPES)[number])}>
                {RETURN_TYPES.map((t) => (
                  <option key={t} value={t}>{t.toUpperCase()}</option>
                ))}
              </select>
            </Field>
            <Field label="Period start">
              <input className={inputCls} type="date" value={retStart} onChange={(e) => setRetStart(e.target.value)} />
            </Field>
            <Field label="Period end">
              <input className={inputCls} type="date" value={retEnd} onChange={(e) => setRetEnd(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <button className={btnPrimaryCls} disabled={!retStart || !retEnd} onClick={buildReturn}>
                Build & stage
              </button>
            </div>
          </div>
          {buildMsg && <SuccessNote>{buildMsg}</SuccessNote>}
          {buildErr && <ErrorNote error={buildErr} />}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <div className="w-48">
              <Field label="Status filter">
                <select className={inputCls} value={returnsFilter} onChange={(e) => setReturnsFilter(e.target.value)}>
                  <option value="">all</option>
                  {["draft", "staged", "submitted", "acknowledged", "quarantined", "failed"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <button className={btnSecondaryCls} onClick={loadReturns}>Refresh list</button>
          </div>
          {returnsErr && <ErrorNote error={returnsErr} />}
          {returnsLoading ? (
            <Spinner label="Loading returns..." />
          ) : returns.length === 0 ? (
            <p className="text-sm text-slate-400">No returns found.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {returns.map((r) => (
                <div key={r.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{r.id} · {r.returnType.toUpperCase()} · {r.periodStart} → {r.periodEnd}
                      </p>
                      <p className="text-xs text-slate-400">
                        {r.submittedAt ? `submitted ${fmtDateTime(r.submittedAt)} · ` : ""}
                        {r.ackRef ? `ack ${r.ackRef} at ${fmtDateTime(r.ackAt)}` : "no ack ref yet"}
                        {r.errorDetail ? ` · error: ${r.errorDetail}` : ""}
                      </p>
                    </div>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {r.status === "staged" && (
                      <>
                        <TotpField
                          value={retTotp[r.id] ?? ""}
                          onChange={(c) => setRetTotp((m) => ({ ...m, [r.id]: c }))}
                          label="MLRO TOTP"
                        />
                        <button
                          className={btnPrimaryCls}
                          disabled={(retTotp[r.id] ?? "").length !== 6}
                          onClick={() => submitReturn(r.id)}
                        >
                          Submit to regulator
                        </button>
                      </>
                    )}
                    {r.status === "quarantined" && (
                      <button className={btnSecondaryCls} onClick={() => retryReturn(r.id)}>
                        Retry (re-stage)
                      </button>
                    )}
                  </div>
                  {retMsg[r.id] && <p className="text-xs text-slate-500">{retMsg[r.id]}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default BdcMlroConsole;
