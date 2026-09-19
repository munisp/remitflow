/**
 * W13-MERCHANT (SPEC-wave13 §4.6) — Merchant onboarding page.
 *
 * Apply form (business + directors + terms acceptance) and an honest status
 * view driven by merchantOnboarding.myStatus. No "verified" claims: statuses
 * are the raw server values (pending_kyb / active / suspended / rejected),
 * and sanctions-screening provider errors are surfaced as "pending manual
 * review", never as a pass.
 *
 * Visual standard: low-saturation warm palette (stone/amber), ample whitespace.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  merchantApiErrMsg,
  merchantOnboardingApi,
  type MerchantApplyResult,
  type MerchantDirectorInput,
  type MerchantMyStatus,
} from "../api";

const TERMS_VERSION = "merchant-terms-v1";

const inputCls =
  "w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-50";
const btnPrimaryCls =
  "px-5 py-2.5 bg-amber-700 text-white rounded-xl text-sm font-medium hover:bg-amber-800 transition-colors disabled:opacity-40";
const btnSecondaryCls =
  "px-4 py-2 bg-white border border-stone-200 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-40";

function statusBadgeCls(status: string): string {
  switch (status) {
    case "active":
    case "approved":
      return "bg-emerald-50 text-emerald-700";
    case "rejected":
    case "suspended":
      return "bg-red-50 text-red-600";
    case "pending_kyb":
    case "pending":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-stone-100 text-stone-600";
  }
}

function verdictLabel(v: string | null): string {
  switch (v) {
    case "clear":
      return "Screening clear";
    case "match":
      return "Screening match";
    case "review":
      return "Screening needs review";
    case "error":
      return "Screening unavailable (provider error)";
    default:
      return "Not screened";
  }
}

const emptyDirector = (): MerchantDirectorInput => ({
  fullName: "",
  isUbo: false,
  ownershipPct: undefined,
  idDocUrl: undefined,
});

const MerchantOnboarding: React.FC = () => {
  const [status, setStatus] = useState<MerchantMyStatus | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [expectedMonthlyVolume, setExpectedMonthlyVolume] = useState("");
  const [website, setWebsite] = useState("");
  const [directors, setDirectors] = useState<MerchantDirectorInput[]>([emptyDirector()]);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<MerchantApplyResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      setStatus(await merchantOnboardingApi.myStatus.query());
    } catch (e) {
      setLoadErr(merchantApiErrMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateDirector = (idx: number, patch: Partial<MerchantDirectorInput>) => {
    setDirectors((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const submit = async () => {
    setBusy(true);
    setSubmitErr(null);
    setSubmitResult(null);
    try {
      const volume = Number(expectedMonthlyVolume);
      const res = await merchantOnboardingApi.apply.mutate({
        businessName: businessName.trim(),
        country: country.trim(),
        registrationNumber: registrationNumber.trim(),
        businessType: businessType.trim(),
        expectedMonthlyVolume: volume,
        website: website.trim() || undefined,
        directors: directors.map((d) => ({
          fullName: d.fullName.trim(),
          isUbo: d.isUbo,
          ownershipPct: d.ownershipPct,
          idDocUrl: d.idDocUrl?.trim() || undefined,
        })),
        termsVersion: TERMS_VERSION,
        termsAccepted: true,
      });
      setSubmitResult(res);
      await refresh();
    } catch (e) {
      setSubmitErr(merchantApiErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const formValid =
    businessName.trim().length >= 2 &&
    country.trim().length === 2 &&
    registrationNumber.trim().length >= 2 &&
    businessType.trim().length >= 2 &&
    Number(expectedMonthlyVolume) > 0 &&
    directors.length >= 1 &&
    directors.every((d) => d.fullName.trim().length >= 2) &&
    termsAccepted;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">Merchant onboarding</h1>
        <p className="text-stone-500 mt-2 text-sm leading-relaxed">
          Apply for a merchant account. Your business and directors are screened
          against sanctions lists, and an administrator reviews every
          application. Approval is never automatic.
        </p>
      </header>

      {loading && <p className="text-sm text-stone-400">Loading your merchant status…</p>}
      {loadErr && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadErr}
        </div>
      )}

      {status?.applied && (
        <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900">
              {status.merchant.businessName}
            </h2>
            <span
              className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${statusBadgeCls(status.merchant.status)}`}
            >
              {status.merchant.status}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-stone-400 text-xs">Country</dt>
              <dd className="text-stone-700">{status.merchant.country ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Risk rating</dt>
              <dd className="text-stone-700">{status.merchant.riskRating}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">KYB review</dt>
              <dd className="text-stone-700">{status.review?.status ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Terms accepted</dt>
              <dd className="text-stone-700">{status.merchant.termsVersion ?? "—"}</dd>
            </div>
          </dl>
          {status.review?.rejectionReason && (
            <p className="text-sm text-red-600">
              Rejection reason: {status.review.rejectionReason}
            </p>
          )}
          {status.directors.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-stone-400 mb-2">Directors</h3>
              <ul className="space-y-2">
                {status.directors.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between text-sm text-stone-700 bg-stone-50 rounded-xl px-4 py-2.5"
                  >
                    <span>
                      {d.fullName}
                      {d.isUbo && <span className="text-stone-400"> · UBO</span>}
                    </span>
                    <span className="text-xs text-stone-500">{verdictLabel(d.screeningVerdict)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {submitResult && !submitResult.alreadyApplied && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            submitResult.status === "rejected"
              ? "border-red-100 bg-red-50 text-red-700"
              : "border-amber-100 bg-amber-50 text-amber-800"
          }`}
        >
          {submitResult.message ?? `Application ${submitResult.status}.`}
        </div>
      )}
      {submitErr && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitErr}
        </div>
      )}

      {!status?.applied && (
        <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-6">
          <h2 className="text-base font-semibold text-stone-900">Business details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Business name</label>
              <input className={inputCls} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">
                Country (2-letter code)
              </label>
              <input
                className={inputCls}
                maxLength={2}
                placeholder="NG"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">
                Registration number
              </label>
              <input
                className={inputCls}
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Business type</label>
              <input
                className={inputCls}
                placeholder="e.g. Retail, SaaS"
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">
                Expected monthly volume (USD)
              </label>
              <input
                className={inputCls}
                inputMode="decimal"
                value={expectedMonthlyVolume}
                onChange={(e) => setExpectedMonthlyVolume(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">
                Website (optional)
              </label>
              <input
                className={inputCls}
                placeholder="https://…"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-stone-900">Directors</h2>
              <button
                type="button"
                className={btnSecondaryCls}
                disabled={directors.length >= 10}
                onClick={() => setDirectors((prev) => [...prev, emptyDirector()])}
              >
                Add director
              </button>
            </div>
            {directors.map((d, idx) => (
              <div key={idx} className="rounded-2xl border border-stone-100 bg-stone-50 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-400">Director {idx + 1}</span>
                  {directors.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-stone-400 hover:text-red-500"
                      onClick={() => setDirectors((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">Full name</label>
                    <input
                      className={inputCls}
                      value={d.fullName}
                      onChange={(e) => updateDirector(idx, { fullName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">
                      Ownership % (optional)
                    </label>
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={d.ownershipPct ?? ""}
                      onChange={(e) =>
                        updateDirector(idx, {
                          ownershipPct: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">
                      ID document URL (optional)
                    </label>
                    <input
                      className={inputCls}
                      placeholder="https://…"
                      value={d.idDocUrl ?? ""}
                      onChange={(e) =>
                        updateDirector(idx, { idDocUrl: e.target.value || undefined })
                      }
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input
                    type="checkbox"
                    checked={d.isUbo}
                    onChange={(e) => updateDirector(idx, { isUbo: e.target.checked })}
                  />
                  Ultimate beneficial owner (UBO)
                </label>
              </div>
            ))}
          </div>

          <label className="flex items-start gap-3 text-sm text-stone-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            <span>
              I accept the merchant terms ({TERMS_VERSION}) and confirm the information above is
              accurate.
            </span>
          </label>

          <button type="button" className={btnPrimaryCls} disabled={!formValid || busy} onClick={submit}>
            {busy ? "Submitting…" : "Submit application"}
          </button>
        </section>
      )}
    </div>
  );
};

export default MerchantOnboarding;
