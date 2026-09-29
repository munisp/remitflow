/**
 * W16-C7 (SPEC-wave16, pwa-invest-b) — /invest/real-estate
 *
 * Fractional real-estate investment surface backed by the mounted `realEstate`
 * router (server/routers/investment.ts:638):
 *   - listListings / getListing  — browse (public)
 *   - invest                     — TOTP step-up + tier-2 KYC + guarded wallet
 *                                  debit + share decrement (all server-side,
 *                                  fail-closed; this UI only surfaces them)
 *   - getMyInvestments           — holdings
 *   - roiCalculator              — server-computed projection (on demand)
 *
 * Admin-only `realEstate.confirmCustody` is intentionally NOT exposed here.
 * Honesty: holdings in `pending_acquisition` are labeled as such — funds were
 * debited but asset custody/acquisition is not confirmed (server W7/B8 note).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  btnPrimaryCls,
  btnSecondaryCls,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtPct,
  holdingStatusLabel,
  inputCls,
  investErrMsg,
  realEstateApi,
  statusBadgeCls,
  type RealEstateHolding,
  type RealEstateListing,
  type RealEstateRoiProjection,
} from "./api-b";

type Tab = "browse" | "holdings";

const PROPERTY_TYPE_SUGGESTIONS = ["residential", "commercial", "land", "mixed_use"];

const RealEstate: React.FC = () => {
  const [tab, setTab] = useState<Tab>("browse");

  // ── Browse state ──────────────────────────────────────────────────────────
  const [listings, setListings] = useState<RealEstateListing[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  // ── Detail / invest state ─────────────────────────────────────────────────
  const [selected, setSelected] = useState<RealEstateListing | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [sharesCount, setSharesCount] = useState("1");
  const [holdYears, setHoldYears] = useState("5");
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [projection, setProjection] = useState<RealEstateRoiProjection | null>(null);
  const [projectionErr, setProjectionErr] = useState<string | null>(null);
  const [projectionBusy, setProjectionBusy] = useState(false);

  // ── Holdings state ────────────────────────────────────────────────────────
  const [holdings, setHoldings] = useState<RealEstateHolding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsErr, setHoldingsErr] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    setListLoading(true);
    setListErr(null);
    try {
      const res = await realEstateApi.listListings.query({
        search: search.trim() || undefined,
        propertyType: propertyType.trim() || undefined,
        status: statusFilter || undefined,
        limit: 50,
      });
      setListings(res);
    } catch (e) {
      setListErr(investErrMsg(e));
    } finally {
      setListLoading(false);
    }
  }, [search, propertyType, statusFilter]);

  const loadHoldings = useCallback(async () => {
    setHoldingsLoading(true);
    setHoldingsErr(null);
    try {
      setHoldings(await realEstateApi.getMyInvestments.query());
    } catch (e) {
      setHoldingsErr(investErrMsg(e));
    } finally {
      setHoldingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  useEffect(() => {
    if (tab === "holdings") void loadHoldings();
  }, [tab, loadHoldings]);

  const openDetail = async (id: number) => {
    setDetailErr(null);
    setActionErr(null);
    setActionMsg(null);
    setProjection(null);
    setProjectionErr(null);
    setSharesCount("1");
    setTotpCode("");
    try {
      setSelected(await realEstateApi.getListing.query({ id }));
    } catch (e) {
      setDetailErr(investErrMsg(e));
    }
  };

  const shares = Math.max(0, Math.floor(Number(sharesCount) || 0));
  const pricePerShare = selected ? Number(selected.pricePerShareUsd) : 0;
  const localTotal = shares > 0 && Number.isFinite(pricePerShare) ? shares * pricePerShare : 0;

  const runProjection = async () => {
    if (!selected || shares < 1) return;
    setProjectionBusy(true);
    setProjectionErr(null);
    try {
      const years = Math.min(30, Math.max(1, Math.floor(Number(holdYears) || 5)));
      setProjection(
        await realEstateApi.roiCalculator.query({
          listingId: selected.id,
          sharesCount: shares,
          holdYears: years,
        }),
      );
    } catch (e) {
      setProjection(null);
      setProjectionErr(investErrMsg(e));
    } finally {
      setProjectionBusy(false);
    }
  };

  const invest = async () => {
    if (!selected || shares < 1) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await realEstateApi.invest.mutate({
        listingId: selected.id,
        sharesCount: shares,
        totpCode: totpCode.trim() || undefined,
      });
      // Server honesty note (W7/B8): funds debited + shares reserved, but the
      // ownership record is pending acquisition — surface it verbatim.
      setActionMsg(
        `Investment #${res.id} recorded (${res.sharesOwned} shares, ${fmtMoney(
          res.totalInvestedUsd,
        )}). ${res.note}`,
      );
      setTotpCode("");
      await Promise.all([loadListings(), loadHoldings()]);
      // Refresh listing detail (availableShares changed).
      setSelected(await realEstateApi.getListing.query({ id: selected.id }));
    } catch (e) {
      setActionErr(investErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <header>
        <p className="text-xs text-stone-400 mb-1">
          <Link to="/invest" className="hover:text-amber-700">
            Investments
          </Link>{" "}
          / Real estate
        </p>
        <h1 className="text-2xl font-bold text-stone-900">Fractional real estate</h1>
        <p className="text-stone-500 mt-2 text-sm leading-relaxed">
          Browse fractional property listings and invest from your USD wallet.
          Investing requires tier-2 verification and a 2FA code; ownership records
          stay <em>pending acquisition</em> until asset custody is confirmed by the
          platform.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {(
          [
            { value: "browse", label: "Browse listings" },
            { value: "holdings", label: "My holdings" },
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

      {tab === "browse" && (
        <>
          <section className="bg-white rounded-2xl border border-stone-100 p-5 grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Search</label>
              <input
                className={inputCls}
                placeholder="Title or location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">
                Property type
              </label>
              <input
                className={inputCls}
                list="re-property-types"
                placeholder="Any"
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
              />
              <datalist id="re-property-types">
                {PROPERTY_TYPE_SUGGESTIONS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Status</label>
              <select
                className={inputCls}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="open">Open</option>
                <option value="funded">Funded</option>
                <option value="">Any</option>
              </select>
            </div>
          </section>

          {listLoading && <p className="text-sm text-stone-400">Loading listings…</p>}
          {listErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {listErr}
            </div>
          )}
          {!listLoading && !listErr && listings.length === 0 && (
            <p className="text-sm text-stone-400">No listings match these filters.</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {listings.map((l) => {
              const soldPct =
                l.totalShares > 0
                  ? Math.round(((l.totalShares - l.availableShares) / l.totalShares) * 100)
                  : 0;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void openDetail(l.id)}
                  className={`text-left bg-white rounded-2xl border p-6 space-y-3 transition-colors hover:border-amber-300 ${
                    selected?.id === l.id ? "border-amber-400" : "border-stone-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold text-stone-900">{l.title}</h2>
                    <div className="flex items-center gap-2 shrink-0">
                      {l.isFeatured && (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          featured
                        </span>
                      )}
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(l.status)}`}
                      >
                        {l.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-stone-500">
                    {l.location}, {l.city}, {l.state} · {l.propertyType}
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-stone-400">Price / share</p>
                      <p className="text-stone-800 font-medium">{fmtMoney(l.pricePerShareUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-stone-400">Expected return</p>
                      <p className="text-stone-800 font-medium">
                        {fmtPct(l.expectedAnnualReturnPct)} / yr
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-stone-400">Shares left</p>
                      <p className="text-stone-800 font-medium">
                        {l.availableShares} / {l.totalShares}
                      </p>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className="h-full bg-amber-600"
                      style={{ width: `${Math.min(100, soldPct)}%` }}
                    />
                  </div>
                  <p className="text-xs text-stone-400">{soldPct}% subscribed</p>
                </button>
              );
            })}
          </div>
        </>
      )}

      {tab === "holdings" && (
        <section className="space-y-4">
          {holdingsLoading && <p className="text-sm text-stone-400">Loading holdings…</p>}
          {holdingsErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {holdingsErr}
            </div>
          )}
          {!holdingsLoading && !holdingsErr && holdings.length === 0 && (
            <p className="text-sm text-stone-400">You have no real-estate holdings yet.</p>
          )}
          {holdings.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                    <th className="px-5 py-3 font-medium">Property</th>
                    <th className="px-5 py-3 font-medium">Shares</th>
                    <th className="px-5 py-3 font-medium">Invested</th>
                    <th className="px-5 py-3 font-medium">Ownership</th>
                    <th className="px-5 py-3 font-medium">Returns paid</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Invested at</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr key={h.id} className="border-b border-stone-50">
                      <td className="px-5 py-3 text-stone-800">
                        {h.title}
                        <span className="block text-xs text-stone-400">
                          {h.city}, {h.state} · {h.propertyType} · listing {h.listingStatus}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-stone-600">{h.sharesOwned}</td>
                      <td className="px-5 py-3 text-stone-600">{fmtMoney(h.totalInvestedUsd)}</td>
                      <td className="px-5 py-3 text-stone-600">{fmtPct(h.ownershipPct)}</td>
                      <td className="px-5 py-3 text-stone-600">{fmtMoney(h.returnsPaidUsd)}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(h.status)}`}
                        >
                          {holdingStatusLabel(h.status)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-stone-500">{fmtDate(h.investedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-stone-400 leading-relaxed">
            Holdings marked “pending acquisition” have been paid for and shares are
            reserved, but asset custody/acquisition has not been confirmed yet — they
            are not active ownership records.
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
            <h2 className="text-base font-semibold text-stone-900">{selected.title}</h2>
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
              <dt className="text-stone-400 text-xs">Total value</dt>
              <dd className="text-stone-700">{fmtMoney(selected.totalValueUsd)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Min. investment</dt>
              <dd className="text-stone-700">{fmtMoney(selected.minimumInvestmentUsd)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Rental yield</dt>
              <dd className="text-stone-700">{fmtPct(selected.rentalYieldPct)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Appreciation</dt>
              <dd className="text-stone-700">{fmtPct(selected.appreciationPct)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Developer</dt>
              <dd className="text-stone-700">{selected.developerName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Available shares</dt>
              <dd className="text-stone-700">
                {selected.availableShares} of {selected.totalShares}
              </dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Listed</dt>
              <dd className="text-stone-700">{fmtDateTime(selected.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Status</dt>
              <dd>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(selected.status)}`}
                >
                  {selected.status}
                </span>
              </dd>
            </div>
          </dl>

          {selected.status === "open" ? (
            <div className="border-t border-stone-100 pt-5 space-y-5">
              <h3 className="text-sm font-semibold text-stone-900">Invest</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Shares (max {selected.availableShares})
                  </label>
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={sharesCount}
                    onChange={(e) => setSharesCount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Projection horizon (years)
                  </label>
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={holdYears}
                    onChange={(e) => setHoldYears(e.target.value)}
                  />
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

              <p className="text-sm text-stone-600">
                Total (computed locally):{" "}
                <span className="font-semibold text-stone-900">{fmtMoney(localTotal)}</span>{" "}
                — debited from your USD wallet. Tier-2 verification and 2FA are enforced
                by the server.
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={btnSecondaryCls}
                  disabled={projectionBusy || shares < 1}
                  onClick={() => void runProjection()}
                >
                  {projectionBusy ? "Calculating…" : "Calculate projection"}
                </button>
                <button
                  type="button"
                  className={btnPrimaryCls}
                  disabled={busy || shares < 1 || shares > selected.availableShares}
                  onClick={() => void invest()}
                >
                  {busy ? "Processing…" : `Invest ${fmtMoney(localTotal)}`}
                </button>
              </div>

              {projectionErr && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {projectionErr}
                </div>
              )}
              {projection && (
                <div className="rounded-xl border border-stone-100 bg-stone-50 px-5 py-4">
                  <p className="text-xs text-stone-400 mb-2">
                    Server-computed projection over {projection.holdYears} year(s) at{" "}
                    {projection.annualReturnPct}% expected annual return — an estimate,
                    not a guarantee.
                  </p>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                    <div>
                      <dt className="text-stone-400 text-xs">Projected total return</dt>
                      <dd className="text-stone-800 font-medium">
                        {fmtMoney(projection.projectedTotalReturnUsd)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-stone-400 text-xs">Rental income</dt>
                      <dd className="text-stone-800">{fmtMoney(projection.rentalIncomeUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400 text-xs">Capital gain</dt>
                      <dd className="text-stone-800">{fmtMoney(projection.capitalGainUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400 text-xs">Value at exit</dt>
                      <dd className="text-stone-800">
                        {fmtMoney(projection.totalValueAtExitUsd)}
                      </dd>
                    </div>
                  </dl>
                </div>
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
              This listing is not open for investment (status: {selected.status}).
            </p>
          )}
        </section>
      )}
    </div>
  );
};

export default RealEstate;
