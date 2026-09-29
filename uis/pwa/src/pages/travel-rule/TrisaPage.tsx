/**
 * W17-C3 — TRISA travel rule page (/travel-rule/trisa, ProtectedRoute).
 *
 * Consumes the mounted `trisa` router (server/routers/trisaCompliance.ts,
 * verified against audit/routers.json — all protectedProcedure; pendingReview
 * and approve additionally enforce the admin role server-side):
 *   - vaspDirectory : searchable directory of known counterparty VASPs
 *   - sendVASP      : dispatch a TRISA travel rule envelope (TOTP step-up)
 *   - myRecords     : the caller's TRISA transfer records
 *   - pendingReview : admin review queue (server fails closed for non-admins)
 *   - approve       : admin approval of a pending record (TOTP step-up)
 *
 * Honesty: trisa.myRecords / pendingReview return server-side sample rows
 * when the DB table is unavailable (documented in ./api.ts). This page renders
 * exactly what the server returns; errors surface verbatim in a dismissible
 * red banner and empty lists render an honest empty state.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  fmtDate,
  travelRuleApi as api,
  type TrisaRecord,
  type TrisaVaspInfo,
} from "./api";
import TotpField from "../bdc/TotpField";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  Field,
  inputCls,
  JsonView,
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

const recName = (r: TrisaRecord, k: "originator" | "beneficiary") =>
  (k === "originator" ? r.originator_name ?? r.originatorName : r.beneficiary_name ?? r.beneficiaryName) ?? "—";

const recTxId = (r: TrisaRecord) => r.transaction_id ?? r.transactionId ?? "—";
const recVasp = (r: TrisaRecord) => r.vasp_name ?? r.vaspName ?? "—";
const recCreated = (r: TrisaRecord) => r.created_at ?? r.createdAt;

const TrisaPage: React.FC = () => {
  // ── VASP directory ──
  const [dirQuery, setDirQuery] = useState("");
  const [vasps, setVasps] = useState<TrisaVaspInfo[] | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [dirBusy, setDirBusy] = useState(false);

  // ── sendVASP ──
  const [send, setSend] = useState({
    transactionId: "",
    originatorName: "",
    originatorAccount: "",
    originatorAddress: "",
    originatorDob: "",
    originatorNationalId: "",
    beneficiaryName: "",
    beneficiaryAccount: "",
    beneficiaryAddress: "",
    amount: "",
    currency: "USD",
    vaspDid: "",
    vaspName: "",
    vaspJurisdiction: "",
  });
  const [sendTotp, setSendTotp] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ message: string; status?: string; envelope?: unknown } | null>(null);

  // ── myRecords ──
  const [myRecords, setMyRecords] = useState<TrisaRecord[]>([]);
  const [myPage, setMyPage] = useState(1);
  const [myLoading, setMyLoading] = useState(true);
  const [myErr, setMyErr] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  // ── pendingReview / approve (admin-only server-side) ──
  const [pending, setPending] = useState<TrisaRecord[] | null>(null);
  const [pendingErr, setPendingErr] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [approveNotes, setApproveNotes] = useState<Record<string, string>>({});
  const [approveTotp, setApproveTotp] = useState("");
  const [approveBusyId, setApproveBusyId] = useState<string | null>(null);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [approveMsg, setApproveMsg] = useState<string | null>(null);

  const searchDirectory = async (q: string) => {
    setDirBusy(true);
    setDirErr(null);
    try {
      const res = await api.trisa.vaspDirectory.query({ query: q });
      setVasps(res.vasps);
    } catch (e) {
      setDirErr(errorMessage(e, "VASP directory lookup failed."));
      setVasps(null);
    } finally {
      setDirBusy(false);
    }
  };

  useEffect(() => {
    // Seed the browser with a broad match — the directory matches on DID,
    // name and jurisdiction substrings; "did" matches every known VASP.
    void searchDirectory("did");
  }, []);

  const loadMyRecords = useCallback(async () => {
    setMyLoading(true);
    setMyErr(null);
    try {
      const res = await api.trisa.myRecords.query({ page: myPage, limit: PAGE_SIZE });
      setMyRecords(res.records);
    } catch (e) {
      setMyErr(errorMessage(e, "Your TRISA records could not be loaded."));
      setMyRecords([]);
    } finally {
      setMyLoading(false);
    }
  }, [myPage]);

  useEffect(() => {
    void loadMyRecords();
  }, [loadMyRecords]);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    setPendingErr(null);
    try {
      const res = await api.trisa.pendingReview.query();
      setPending(res.records);
    } catch (e) {
      // Server enforces admin role — fail closed with the verbatim error.
      setPendingErr(errorMessage(e, "The pending review queue could not be loaded (admin role required)."));
      setPending(null);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const sendEnvelope = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendBusy(true);
    setSendErr(null);
    setSendResult(null);
    try {
      const res = await api.trisa.sendVASP.mutate({
        transactionId: send.transactionId,
        originatorName: send.originatorName,
        originatorAccount: send.originatorAccount,
        originatorAddress: send.originatorAddress || undefined,
        originatorDob: send.originatorDob || undefined,
        originatorNationalId: send.originatorNationalId || undefined,
        beneficiaryName: send.beneficiaryName,
        beneficiaryAccount: send.beneficiaryAccount,
        beneficiaryAddress: send.beneficiaryAddress || undefined,
        amount: Number(send.amount),
        currency: send.currency.toUpperCase(),
        vaspDid: send.vaspDid,
        vaspName: send.vaspName,
        vaspJurisdiction: send.vaspJurisdiction.toUpperCase(),
        totpCode: sendTotp || undefined,
      });
      setSendResult({ message: res.message, status: res.status, envelope: res.envelope });
      setSendTotp("");
      await loadMyRecords();
    } catch (err2) {
      setSendErr(errorMessage(err2, "TRISA dispatch was rejected by the server."));
    } finally {
      setSendBusy(false);
    }
  };

  const approveRecord = async (recordId: string) => {
    setApproveBusyId(recordId);
    setApproveErr(null);
    setApproveMsg(null);
    try {
      const res = await api.trisa.approve.mutate({
        recordId,
        notes: approveNotes[recordId]?.trim() || undefined,
        totpCode: approveTotp || undefined,
      });
      setApproveMsg(`Record ${res.recordId} approved (status: ${res.status}).`);
      setApproveTotp("");
      await loadPending();
    } catch (e) {
      setApproveErr(errorMessage(e, `Approval of record ${recordId} was rejected by the server.`));
    } finally {
      setApproveBusyId(null);
    }
  };

  const pickVasp = (v: TrisaVaspInfo) =>
    setSend((s) => ({ ...s, vaspDid: v.did, vaspName: v.name, vaspJurisdiction: v.jurisdiction }));

  const setF = (k: keyof typeof send) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSend({ ...send, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <PageHeader
        title="TRISA Travel Rule"
        subtitle="Send FATF travel rule envelopes to counterparty VASPs over the TRISA protocol and review your transfer records."
      />

      {/* VASP directory */}
      <Card title="VASP directory">
        <ErrBanner msg={dirErr} onDismiss={() => setDirErr(null)} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dirQuery.trim()) void searchDirectory(dirQuery.trim());
          }}
          className="flex gap-2 mt-1"
        >
          <input
            value={dirQuery}
            onChange={(e) => setDirQuery(e.target.value)}
            className={inputCls}
            placeholder="Search by DID, name or jurisdiction (e.g. coinbase, NG)"
          />
          <button type="submit" disabled={dirBusy || !dirQuery.trim()} className={btnSecondaryCls}>
            {dirBusy ? "Searching…" : "Search"}
          </button>
        </form>
        {vasps !== null &&
          (vasps.length === 0 ? (
            <p className="text-sm text-slate-500 mt-3">No VASPs match that query.</p>
          ) : (
            <div className="space-y-2 mt-3">
              {vasps.map((v) => (
                <div key={v.did} className="rounded-xl border border-slate-100 p-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{v.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      <code>{v.did}</code> · {v.jurisdiction} · {v.endpoint}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={v.trisa ? "ok" : "neutral"}>{v.trisa ? "TRISA-enabled" : "manual review"}</Badge>
                    <button type="button" onClick={() => pickVasp(v)} className={btnSecondaryCls}>
                      Use in form
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </Card>

      {/* sendVASP */}
      <Card title="Send travel rule envelope (trisa.sendVASP — TOTP step-up)">
        <ErrBanner msg={sendErr} onDismiss={() => setSendErr(null)} />
        {sendResult && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 mb-3">
            {sendResult.message}
            {sendResult.status && <span className="block mt-1 text-xs">Status: {sendResult.status}</span>}
          </div>
        )}
        <form onSubmit={(e) => void sendEnvelope(e)} className="mt-3 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Transaction ID">
              <input required value={send.transactionId} onChange={setF("transactionId")} className={inputCls} />
            </Field>
            <Field label="Amount (USD-equivalent)">
              <input required type="number" min="0" step="any" value={send.amount} onChange={setF("amount")} className={inputCls} />
            </Field>
            <Field label="Currency">
              <input required minLength={3} maxLength={3} value={send.currency} onChange={setF("currency")} className={inputCls} />
            </Field>
          </div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Originator</p>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Name"><input required maxLength={140} value={send.originatorName} onChange={setF("originatorName")} className={inputCls} /></Field>
            <Field label="Account"><input required maxLength={34} value={send.originatorAccount} onChange={setF("originatorAccount")} className={inputCls} /></Field>
            <Field label="Address (optional)"><input maxLength={200} value={send.originatorAddress} onChange={setF("originatorAddress")} className={inputCls} /></Field>
            <Field label="Date of birth (optional)"><input type="date" value={send.originatorDob} onChange={setF("originatorDob")} className={inputCls} /></Field>
            <Field label="National ID (optional)"><input maxLength={50} value={send.originatorNationalId} onChange={setF("originatorNationalId")} className={inputCls} /></Field>
          </div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Beneficiary</p>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Name"><input required maxLength={140} value={send.beneficiaryName} onChange={setF("beneficiaryName")} className={inputCls} /></Field>
            <Field label="Account"><input required maxLength={34} value={send.beneficiaryAccount} onChange={setF("beneficiaryAccount")} className={inputCls} /></Field>
            <Field label="Address (optional)"><input maxLength={200} value={send.beneficiaryAddress} onChange={setF("beneficiaryAddress")} className={inputCls} /></Field>
          </div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Counterparty VASP</p>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="VASP DID"><input required value={send.vaspDid} onChange={setF("vaspDid")} className={inputCls} placeholder="did:trisa:…" /></Field>
            <Field label="VASP name"><input required maxLength={200} value={send.vaspName} onChange={setF("vaspName")} className={inputCls} /></Field>
            <Field label="VASP jurisdiction (ISO)"><input required minLength={2} maxLength={2} value={send.vaspJurisdiction} onChange={setF("vaspJurisdiction")} className={inputCls} /></Field>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <TotpField value={sendTotp} onChange={setSendTotp} />
            <button type="submit" disabled={sendBusy} className={btnPrimaryCls}>
              {sendBusy ? "Sending…" : "Send envelope"}
            </button>
          </div>
        </form>
        {sendResult?.envelope !== undefined && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1">Dispatched TRISA envelope:</p>
            <JsonView data={sendResult.envelope} />
          </div>
        )}
      </Card>

      {/* myRecords */}
      <Card title="Your TRISA records">
        <ErrBanner msg={myErr} onDismiss={() => setMyErr(null)} />
        {myLoading ? (
          <Spinner label="Loading your TRISA records…" />
        ) : myRecords.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">No TRISA transfer records found for your account.</p>
        ) : (
          <div className="space-y-2 mt-2">
            {myRecords.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-100 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {recName(r, "originator")} → {recName(r, "beneficiary")}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {recTxId(r)} · {r.amount.toLocaleString()} {r.currency} · {recVasp(r)} · {fmtDate(recCreated(r))}
                  </p>
                </div>
                <Badge tone={statusTone(r.status)}>{r.status.replace(/_/g, " ")}</Badge>
              </div>
            ))}
            <div className="flex items-center justify-end gap-2 text-sm">
              <button type="button" disabled={myPage <= 1} onClick={() => setMyPage((p) => Math.max(1, p - 1))} className={btnSecondaryCls}>
                Previous
              </button>
              <span className="text-slate-500">Page {myPage}</span>
              <button type="button" disabled={myRecords.length < PAGE_SIZE} onClick={() => setMyPage((p) => p + 1)} className={btnSecondaryCls}>
                Next
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* pendingReview + approve — admin only (server-enforced) */}
      <Card title="Pending review queue (trisa.pendingReview — admin only)">
        <ErrBanner msg={pendingErr} onDismiss={() => setPendingErr(null)} />
        <ErrBanner msg={approveErr} onDismiss={() => setApproveErr(null)} />
        {approveMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 mb-3">
            {approveMsg}
          </div>
        )}
        {pending === null && !pendingLoading && !pendingErr && (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void loadPending()} className={btnSecondaryCls}>
              Load pending queue
            </button>
            <p className="text-xs text-slate-400">The server enforces the admin role; non-admin calls fail closed.</p>
          </div>
        )}
        {pendingLoading && <Spinner label="Loading pending queue…" />}
        {pending !== null &&
          (pending.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No TRISA records are pending review.</p>
          ) : (
            <div className="space-y-3 mt-2">
              <div className="flex items-center gap-4">
                <TotpField value={approveTotp} onChange={setApproveTotp} label="TOTP step-up (approve)" />
              </div>
              {pending.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-100 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        {recName(r, "originator")} → {recName(r, "beneficiary")}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {recTxId(r)} · {r.amount.toLocaleString()} {r.currency} · {recVasp(r)} · {fmtDate(recCreated(r))}
                      </p>
                    </div>
                    <Badge tone={statusTone(r.status)}>{r.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={approveNotes[r.id] ?? ""}
                      onChange={(e) => setApproveNotes({ ...approveNotes, [r.id]: e.target.value })}
                      className={inputCls}
                      placeholder="Review notes (optional, max 500 chars)"
                      maxLength={500}
                    />
                    <button
                      type="button"
                      disabled={approveBusyId === r.id}
                      onClick={() => void approveRecord(r.id)}
                      className={btnPrimaryCls}
                    >
                      {approveBusyId === r.id ? "Approving…" : "Approve"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </Card>
    </div>
  );
};

export default TrisaPage;
