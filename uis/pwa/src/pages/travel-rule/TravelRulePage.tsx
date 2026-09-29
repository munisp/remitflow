/**
 * W17-C3 — User-facing FATF travel rule page (/travel-rule, ProtectedRoute).
 *
 * Consumes the mounted `travelRule` router (server/routers/productionFeatures.ts,
 * verified against audit/routers.json):
 *   - requirements : threshold checker — whether a transfer triggers FATF R.16
 *   - submit       : travel rule information form (TOTP step-up — filing mutation)
 *   - myRecords    : the caller's submitted travel rule records
 *
 * The admin-only `travelRule.adminList` queue lives in
 * pages/admin/compliance (AdminRoute-gated), not here.
 *
 * Fail-closed: errors surface verbatim in a dismissible red banner; empty
 * record lists render an honest empty state — nothing is fabricated.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  fmtDate,
  travelRuleApi as api,
  type TravelRuleRecord,
  type TravelRuleRequirements,
} from "./api";
import TotpField from "../bdc/TotpField";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  Field,
  inputCls,
  PageHeader,
  Spinner,
  statusTone,
} from "../bdc/ui";

const ErrBanner: React.FC<{ msg: string | null; onDismiss: () => void }> = ({ msg, onDismiss }) =>
  msg ? (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 flex items-start justify-between gap-4">
      <span className="text-sm whitespace-pre-wrap">{msg}</span>
      <button type="button" onClick={onDismiss} className="text-red-500 text-xs font-medium shrink-0">
        Dismiss
      </button>
    </div>
  ) : null;

const TravelRulePage: React.FC = () => {
  // ── requirements checker ──
  const [amount, setAmount] = useState("");
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [toCountry, setToCountry] = useState("");
  const [reqResult, setReqResult] = useState<TravelRuleRequirements | null>(null);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);

  // ── submit form ──
  const [form, setForm] = useState({
    transactionId: "",
    beneficiaryFullName: "",
    beneficiaryAddress: "",
    beneficiaryAccountNumber: "",
    beneficiaryBankName: "",
    beneficiaryBankCountry: "",
    purposeOfTransfer: "",
    sourceOfFunds: "",
  });
  const [totp, setTotp] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // ── myRecords ──
  const [records, setRecords] = useState<TravelRuleRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const LIMIT = 20;

  const loadRecords = useCallback(async () => {
    setListLoading(true);
    setListErr(null);
    try {
      const res = await api.travelRule.myRecords.query({ limit: LIMIT, offset });
      setRecords(res.records);
      setTotal(res.total);
    } catch (e) {
      setListErr(errorMessage(e, "Your travel rule records could not be loaded."));
      setRecords([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const checkRequirements = async () => {
    setReqBusy(true);
    setReqErr(null);
    setReqResult(null);
    try {
      setReqResult(
        await api.travelRule.requirements.query({
          amount: Number(amount),
          fromCurrency: fromCurrency.toUpperCase(),
          toCurrency: toCurrency.toUpperCase(),
          toCountry: toCountry.toUpperCase(),
        }),
      );
    } catch (e) {
      setReqErr(errorMessage(e, "Travel rule requirement check failed."));
    } finally {
      setReqBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitBusy(true);
    setSubmitErr(null);
    setSubmitMsg(null);
    try {
      const res = await api.travelRule.submit.mutate({
        transactionId: form.transactionId ? Number(form.transactionId) : undefined,
        beneficiaryFullName: form.beneficiaryFullName,
        beneficiaryAddress: form.beneficiaryAddress,
        beneficiaryAccountNumber: form.beneficiaryAccountNumber,
        beneficiaryBankName: form.beneficiaryBankName,
        beneficiaryBankCountry: form.beneficiaryBankCountry.toUpperCase(),
        purposeOfTransfer: form.purposeOfTransfer,
        sourceOfFunds: form.sourceOfFunds || undefined,
        totpCode: totp || undefined,
      });
      setSubmitMsg(res.message || `Travel rule information submitted (status: ${res.status}).`);
      setTotp("");
      await loadRecords();
    } catch (err2) {
      setSubmitErr(errorMessage(err2, "Travel rule submission was rejected by the server."));
    } finally {
      setSubmitBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Travel Rule (FATF R.16)"
        subtitle="Check whether a transfer triggers travel rule information requirements, submit beneficiary/originator information, and review your submissions."
      />

      {/* requirements viewer */}
      <Card title="Requirement checker">
        <ErrBanner msg={reqErr} onDismiss={() => setReqErr(null)} />
        <div className="grid md:grid-cols-4 gap-3 mt-3">
          <Field label="Amount">
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
          <Field label="From currency">
            <input value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value.toUpperCase())} className={inputCls} maxLength={3} />
          </Field>
          <Field label="To currency">
            <input value={toCurrency} onChange={(e) => setToCurrency(e.target.value.toUpperCase())} className={inputCls} maxLength={3} />
          </Field>
          <Field label="Destination country (ISO)">
            <input value={toCountry} onChange={(e) => setToCountry(e.target.value.toUpperCase())} className={inputCls} maxLength={2} placeholder="NG" />
          </Field>
        </div>
        <button
          type="button"
          onClick={() => void checkRequirements()}
          disabled={reqBusy || !amount || !toCountry}
          className={`${btnSecondaryCls} mt-3`}
        >
          {reqBusy ? "Checking…" : "Check requirements"}
        </button>
        {reqResult && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={reqResult.required ? "warn" : "ok"}>
                {reqResult.required ? "Travel rule information required" : "Travel rule not required"}
              </Badge>
              {reqResult.isHighRisk && <Badge tone="bad">High-risk destination</Badge>}
            </div>
            <p className="text-sm text-slate-600">
              {reqResult.reason ?? `Transfer is below the $${reqResult.threshold.toLocaleString()} FATF threshold.`}
            </p>
            <p className="text-xs text-slate-500">{reqResult.regulatoryBasis}</p>
            {reqResult.requiredFields.length > 0 && (
              <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
                {reqResult.requiredFields.map((f) => (
                  <li key={f.field}>{f.label}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* submit form */}
      <Card title="Submit travel rule information (TOTP step-up required)">
        <ErrBanner msg={submitErr} onDismiss={() => setSubmitErr(null)} />
        {submitMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 mb-3">
            {submitMsg}
          </div>
        )}
        <form onSubmit={(e) => void submit(e)} className="grid md:grid-cols-3 gap-3 mt-3">
          <Field label="Transaction ID (optional)">
            <input type="number" min="1" value={form.transactionId} onChange={set("transactionId")} className={inputCls} />
          </Field>
          <Field label="Beneficiary full legal name">
            <input required minLength={2} value={form.beneficiaryFullName} onChange={set("beneficiaryFullName")} className={inputCls} />
          </Field>
          <Field label="Beneficiary account number">
            <input required minLength={4} value={form.beneficiaryAccountNumber} onChange={set("beneficiaryAccountNumber")} className={inputCls} />
          </Field>
          <Field label="Beneficiary physical address">
            <input required minLength={5} value={form.beneficiaryAddress} onChange={set("beneficiaryAddress")} className={inputCls} />
          </Field>
          <Field label="Beneficiary bank name">
            <input required minLength={2} value={form.beneficiaryBankName} onChange={set("beneficiaryBankName")} className={inputCls} />
          </Field>
          <Field label="Beneficiary bank country (ISO)">
            <input required minLength={2} maxLength={2} value={form.beneficiaryBankCountry} onChange={set("beneficiaryBankCountry")} className={inputCls} placeholder="NG" />
          </Field>
          <Field label="Purpose of transfer">
            <input required minLength={3} value={form.purposeOfTransfer} onChange={set("purposeOfTransfer")} className={inputCls} />
          </Field>
          <Field label="Source of funds (high-risk destinations)">
            <input value={form.sourceOfFunds} onChange={set("sourceOfFunds")} className={inputCls} />
          </Field>
          <div className="flex items-end gap-4">
            <TotpField value={totp} onChange={setTotp} />
            <button type="submit" disabled={submitBusy} className={btnPrimaryCls}>
              {submitBusy ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </Card>

      {/* myRecords */}
      <Card title={`Your travel rule records (${total})`}>
        <ErrBanner msg={listErr} onDismiss={() => setListErr(null)} />
        {listLoading ? (
          <Spinner label="Loading your records…" />
        ) : records.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            You have not submitted any travel rule records yet.
          </p>
        ) : (
          <div className="space-y-3 mt-2">
            {records.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-100 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{r.beneficiary_name ?? "—"}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {r.beneficiary_bank ?? "—"} {r.beneficiary_bank_country ? `(${r.beneficiary_bank_country})` : ""} ·
                    submitted {fmtDate(r.submitted_at ?? r.created_at)}
                  </p>
                  {r.purpose && <p className="text-xs text-slate-500 mt-1">Purpose: {r.purpose}</p>}
                </div>
                <Badge tone={statusTone(r.status ?? "")}>{r.status ?? "unknown"}</Badge>
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
      </Card>
    </div>
  );
};

export default TravelRulePage;
