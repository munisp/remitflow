/**
 * W16-C7 (SPEC-wave16, pwa-invest-b) — /invest/startups
 *
 * Curated startup investment surface backed by the mounted `startups` router
 * (server/routers/investment.ts:918):
 *   - listDeals / getDeal  — browse curated deals (public)
 *   - commit               — invest (tier-2 KYC + TOTP step-up + guarded wallet
 *                            debit when paymentMethod=wallet — all server-side,
 *                            fail-closed; this UI only surfaces them)
 *   - getMyInvestments     — portfolio
 *   - signAgreement        — user-role audited mutation for unsigned commitments
 *
 * Admin-only `startups.confirmCustody` is intentionally NOT exposed here.
 * Honesty: wallet-funded commitments are `pending_acquisition` (custody not yet
 * confirmed); bank_transfer/card commitments are recorded as `pending` — no
 * wallet debit occurs for those methods in this flow, and the UI says so.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  btnPrimaryCls,
  fmtDate,
  fmtMoney,
  fmtPct,
  holdingStatusLabel,
  inputCls,
  investErrMsg,
  startupsApi,
  statusBadgeCls,
  type StartupDeal,
  type StartupInvestment,
} from "./api-b";

type Tab = "deals" | "portfolio";
type PaymentMethod = "wallet" | "bank_transfer" | "card";

const STAGE_SUGGESTIONS = ["idea", "pre_seed", "seed", "series_a", "series_b", "growth"];

const Startups: React.FC = () => {
  const [tab, setTab] = useState<Tab>("deals");

  // ── Deal list state ───────────────────────────────────────────────────────
  const [deals, setDeals] = useState<StartupDeal[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [stage, setStage] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  // ── Detail / commit state ─────────────────────────────────────────────────
  const [selected, setSelected] = useState<StartupDeal | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("wallet");
  const [notes, setNotes] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // ── Portfolio state ───────────────────────────────────────────────────────
  const [portfolio, setPortfolio] = useState<StartupInvestment[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioErr, setPortfolioErr] = useState<string | null>(null);
  const [signBusyId, setSignBusyId] = useState<number | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);

  const loadDeals = useCallback(async () => {
    setListLoading(true);
    setListErr(null);
    try {
      const res = await startupsApi.listDeals.query({
        search: search.trim() || undefined,
        sector: sector.trim() || undefined,
        stage: stage.trim() || undefined,
        status: statusFilter || undefined,
        limit: 50,
      });
      setDeals(res);
    } catch (e) {
      setListErr(investErrMsg(e));
    } finally {
      setListLoading(false);
    }
  }, [search, sector, stage, statusFilter]);

  const loadPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    setPortfolioErr(null);
    try {
      setPortfolio(await startupsApi.getMyInvestments.query());
    } catch (e) {
      setPortfolioErr(investErrMsg(e));
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  useEffect(() => {
    if (tab === "portfolio") void loadPortfolio();
  }, [tab, loadPortfolio]);

  const openDetail = async (id: number) => {
    setDetailErr(null);
    setActionErr(null);
    setActionMsg(null);
    setAmountUsd("");
    setNotes("");
    setTotpCode("");
    try {
      setSelected(await startupsApi.getDeal.query({ id }));
    } catch (e) {
      setDetailErr(investErrMsg(e));
    }
  };

  const amount = Number(amountUsd);
  const minTicket = selected ? Number(selected.minimumTicketUsd) : 0;
  const raisedPct = (d: StartupDeal) => {
    const target = Number(d.targetRaiseUsd);
    const raised = Number(d.raisedSoFarUsd ?? 0);
    return target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
  };

  const commit = async () => {
    if (!selected || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await startupsApi.commit.mutate({
        dealId: selected.id,
        amountUsd: amount,
        paymentMethod,
        notes: notes.trim() || undefined,
        totpCode: totpCode.trim() || undefined,
      });
      // Server honesty note (W7/B8): commitment recorded but asset custody is
      // pending — surface verbatim.
      setActionMsg(
        `Commitment #${res.id} recorded (${fmtMoney(res.amountUsd)}, ${res.instrumentType}${
          res.equityPct ? `, ~${fmtPct(res.equityPct)} equity` : ""
        }). ${res.note}`,
      );
      setTotpCode("");
      setAmountUsd("");
      setNotes("");
      await Promise.all([loadDeals(), loadPortfolio()]);
      setSelected(await startupsApi.getDeal.query({ id: selected.id }));
    } catch (e) {
      setActionErr(investErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const signAgreement = async (investmentId: number) => {
    setSignBusyId(investmentId);
    setSignErr(null);
    try {
      await startupsApi.signAgreement.mutate({ investmentId });
      await loadPortfolio();
    } catch (e) {
      setSignErr(investErrMsg(e));
    } finally {
      setSignBusyId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <header>
        <p className="text-xs text-stone-400 mb-1">
          <Link to="/invest" className="hover:text-amber-700">
            Investments
          </Link>{" "}
          / Startups
        </p>
        <h1 className="text-2xl font-bold text-stone-900">Startup investments</h1>
        <p className="text-stone-500 mt-2 text-sm leading-relaxed">
          Curated private deals. Committing with the wallet method debits your USD
          wallet (tier-2 verification and 2FA enforced server-side); commitments
          remain <em>pending acquisition</em> until asset custody is confirmed.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {(
          [
            { value: "deals", label: "Curated deals" },
            { value: "portfolio", label: "My portfolio" },
          ] as Array<{ value: Tab; label: string }>
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === t.value
                ? "bg-amber-700 text-white"
                : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "deals" && (
        <>
          <section className="bg-white rounded-2xl border border-stone-100 p-5 grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Search</label>
              <input
                className={inputCls}
                placeholder="Company or tagline…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Sector</label>
              <input
                className={inputCls}
                placeholder="Any"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Stage</label>
              <input
                className={inputCls}
                list="startup-stages"
                placeholder="Any"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              />
              <datalist id="startup-stages">
                {STAGE_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="sm:col-span-4 sm:w-56">
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Status</label>
              <select
                className={inputCls}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="open">Open</option>
                <option value="funded">Funded</option>
                <option value="closed">Closed</option>
                <option value="">Any</option>
              </select>
            </div>
          </section>

          {listLoading && <p className="text-sm text-stone-400">Loading deals…</p>}
          {listErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {listErr}
            </div>
          )}
          {!listLoading && !listErr && deals.length === 0 && (
            <p className="text-sm text-stone-400">No deals match these filters.</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {deals.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => void openDetail(d.id)}
                className={`text-left bg-white rounded-2xl border p-6 space-y-3 transition-colors hover:border-amber-300 ${
                  selected?.id === d.id ? "border-amber-400" : "border-stone-100"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-stone-900">{d.companyName}</h2>
                    <p className="text-sm text-stone-500">{d.tagline}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.isFeatured && (
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                        featured
                      </span>
                    )}
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(d.status)}`}
                    >
                      {d.status}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-stone-500">
                  {d.sector} · {d.stage} · {d.location} · {d.instrumentType}
                </p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-stone-400">Raised</p>
                    <p className="text-stone-800 font-medium">
                      {fmtMoney(d.raisedSoFarUsd ?? "0")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-400">Target</p>
                    <p className="text-stone-800 font-medium">{fmtMoney(d.targetRaiseUsd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-400">Min. ticket</p>
                    <p className="text-stone-800 font-medium">{fmtMoney(d.minimumTicketUsd)}</p>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                  <div className="h-full bg-amber-600" style={{ width: `${raisedPct(d)}%` }} />
                </div>
                <p className="text-xs text-stone-400">
                  {raisedPct(d)}% raised
                  {d.closingDate ? ` · closes ${fmtDate(d.closingDate)}` : ""}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === "portfolio" && (
        <section className="space-y-4">
          {portfolioLoading && <p className="text-sm text-stone-400">Loading portfolio…</p>}
          {portfolioErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {portfolioErr}
            </div>
          )}
          {signErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {signErr}
            </div>
          )}
          {!portfolioLoading && !portfolioErr && portfolio.length === 0 && (
            <p className="text-sm text-stone-400">You have no startup investments yet.</p>
          )}
          {portfolio.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                    <th className="px-5 py-3 font-medium">Company</th>
                    <th className="px-5 py-3 font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Instrument</th>
                    <th className="px-5 py-3 font-medium">Equity</th>
                    <th className="px-5 py-3 font-medium">Payment</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Agreement</th>
                    <th className="px-5 py-3 font-medium">Invested at</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.map((inv) => (
                    <tr key={inv.id} className="border-b border-stone-50">
                      <td className="px-5 py-3 text-stone-800">
                        {inv.companyName}
                        <span className="block text-xs text-stone-400">
                          {inv.sector} · {inv.stage} · deal {inv.dealStatus}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-stone-600">{fmtMoney(inv.amountUsd)}</td>
                      <td className="px-5 py-3 text-stone-600">{inv.instrumentType}</td>
                      <td className="px-5 py-3 text-stone-600">
                        {inv.equityPct ? fmtPct(inv.equityPct) : "—"}
                      </td>
                      <td className="px-5 py-3 text-stone-600">{inv.paymentMethod}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(inv.status)}`}
                        >
                          {holdingStatusLabel(inv.status)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {inv.agreementSigned ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                            signed
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="px-3 py-1 bg-white border border-stone-200 text-stone-700 rounded-lg text-xs font-medium hover:bg-stone-50 disabled:opacity-40"
                            disabled={signBusyId === inv.id}
                            onClick={() => void signAgreement(inv.id)}
                          >
                            {signBusyId === inv.id ? "Signing…" : "Sign agreement"}
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3 text-stone-500">{fmtDate(inv.investedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-stone-400 leading-relaxed">
            Commitments marked “pending acquisition” are recorded and (for wallet
            payments) paid for, but asset custody/acquisition has not been confirmed
            yet — they are not confirmed investments.
          </p>
        </section>
      )}

      {detailErr && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {detailErr}
        </div>
      )}

      {selected && (
        <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900">{selected.companyName}</h2>
            <button
              type="button"
              className="text-xs text-stone-400 hover:text-stone-600"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>

          <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-line">
            {selected.description}
          </p>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-stone-400 text-xs">Valuation</dt>
              <dd className="text-stone-700">{fmtMoney(selected.valuationUsd)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Equity offered</dt>
              <dd className="text-stone-700">{fmtPct(selected.equityOfferedPct)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Instrument</dt>
              <dd className="text-stone-700">{selected.instrumentType}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Min. ticket</dt>
              <dd className="text-stone-700">{fmtMoney(selected.minimumTicketUsd)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Founded</dt>
              <dd className="text-stone-700">{selected.foundedYear ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Team size</dt>
              <dd className="text-stone-700">{selected.teamSize ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Closing date</dt>
              <dd className="text-stone-700">{fmtDate(selected.closingDate)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Links</dt>
              <dd className="text-stone-700 space-x-3">
                {selected.websiteUrl && (
                  <a
                    className="text-amber-700 hover:underline"
                    href={selected.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Website
                  </a>
                )}
                {selected.pitchDeckUrl && (
                  <a
                    className="text-amber-700 hover:underline"
                    href={selected.pitchDeckUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pitch deck
                  </a>
                )}
                {!selected.websiteUrl && !selected.pitchDeckUrl && "—"}
              </dd>
            </div>
          </dl>

          {selected.highlights.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-stone-500 mb-1.5">Highlights</h3>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1">
                {selected.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          {selected.risks.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-stone-500 mb-1.5">Risks (as declared)</h3>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1">
                {selected.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {selected.metrics.length > 0 && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
              {selected.metrics.map((m, i) => (
                <div key={i}>
                  <dt className="text-stone-400 text-xs">{m.label}</dt>
                  <dd className="text-stone-800 font-medium">{m.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {selected.status === "open" ? (
            <div className="border-t border-stone-100 pt-5 space-y-5">
              <h3 className="text-sm font-semibold text-stone-900">Commit funds</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Amount (USD, min {fmtMoney(selected.minimumTicketUsd)})
                  </label>
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amountUsd}
                    onChange={(e) => setAmountUsd(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Payment method
                  </label>
                  <select
                    className={inputCls}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="wallet">USD wallet (debited now, 2FA)</option>
                    <option value="bank_transfer">Bank transfer (recorded, not debited)</option>
                    <option value="card">Card (recorded, not debited)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    2FA code (required if enrolled)
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
                  Notes (optional)
                </label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {paymentMethod !== "wallet" && (
                <p className="text-xs text-stone-500 leading-relaxed">
                  With {paymentMethod === "bank_transfer" ? "bank transfer" : "card"}, the
                  commitment is recorded as <em>pending</em> — no wallet debit occurs in
                  this flow.
                </p>
              )}

              <button
                type="button"
                className={btnPrimaryCls}
                disabled={busy || !Number.isFinite(amount) || amount < 100}
                onClick={() => void commit()}
              >
                {busy ? "Processing…" : `Commit ${Number.isFinite(amount) && amount > 0 ? fmtMoney(amount) : "funds"}`}
              </button>
              {Number.isFinite(amount) && amount > 0 && amount < minTicket && (
                <p className="text-xs text-amber-700">
                  Below this deal's minimum ticket of {fmtMoney(selected.minimumTicketUsd)} —
                  the server will reject it.
                </p>
              )}

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
            </div>
          ) : (
            <p className="text-sm text-stone-500 border-t border-stone-100 pt-5">
              This deal is not open for investment (status: {selected.status}).
            </p>
          )}
        </section>
      )}
    </div>
  );
};

export default Startups;
