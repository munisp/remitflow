/**
 * W13-PARTNER — Public partner application page.
 *
 * Submits to partnerApplications.submit (public, rate-limited). On success the
 * server returns a claimToken exactly ONCE — it is displayed here with an
 * explicit "save it now" warning; it authorizes later document/SLA updates for
 * applicants without an account (replaces the old NULL-ownership bypass).
 *
 * Status check calls partnerApplications.checkStatus, which returns status +
 * timestamps only (PII stripped server-side per SPEC-wave13 §5.1).
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { errMsg, partner, type PartnerSubmitResult, type PartnerStatusResult } from "../api";

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelCls = "block text-sm font-medium text-stone-700 mb-1";

const PartnerApply: React.FC = () => {
  // ── Submit form state ──────────────────────────────────────────────────────
  const [form, setForm] = useState({
    companyName: "",
    brandName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    website: "",
    country: "NG",
    registrationNumber: "",
    businessDescription: "",
    requestedPlan: "starter" as "starter" | "growth" | "enterprise" | "white_label",
    hasAmlPolicy: false,
    hasKycProcess: false,
    isRegulated: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<PartnerSubmitResult | null>(null);

  // ── Status check state ─────────────────────────────────────────────────────
  const [statusSlug, setStatusSlug] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [status, setStatus] = useState<PartnerStatusResult | null>(null);

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await partner.partnerApplications.submit.mutate({
        companyName: form.companyName,
        brandName: form.brandName,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone || undefined,
        website: form.website || undefined,
        country: form.country,
        registrationNumber: form.registrationNumber || undefined,
        businessDescription: form.businessDescription,
        requestedPlan: form.requestedPlan,
        hasAmlPolicy: form.hasAmlPolicy,
        hasKycProcess: form.hasKycProcess,
        isRegulated: form.isRegulated,
      });
      setSubmitted(res);
      setStatusSlug(res.slug);
    } catch (err) {
      setSubmitError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onCheckStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusLoading(true);
    setStatusError(null);
    setStatus(null);
    try {
      setStatus(await partner.partnerApplications.checkStatus.query({ slug: statusSlug.trim() }));
    } catch (err) {
      setStatusError(errMsg(err));
    } finally {
      setStatusLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 py-10 px-4">
      <div className="mx-auto max-w-2xl space-y-10">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-stone-900">Become a RemitFlow Partner</h1>
          <p className="mt-2 text-sm text-stone-600">
            Submit your application for review. Approval is manual — submitting this form does not
            grant access or imply verification.
          </p>
        </header>

        {submitted ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-stone-900">Application received</h2>
            <p className="text-sm text-stone-700">{submitted.message}</p>
            <div>
              <p className={labelCls}>Tracking slug</p>
              <code className="block rounded bg-white px-3 py-2 text-sm">{submitted.slug}</code>
            </div>
            <div className="rounded-lg border border-amber-300 bg-white p-4">
              <p className="text-sm font-semibold text-amber-800">
                Save your claim token now — it is shown only once.
              </p>
              <p className="mt-1 text-xs text-stone-600">
                You need it to upload documents or sign the SLA for this application before your
                account is linked.
              </p>
              <code className="mt-2 block break-all rounded bg-stone-100 px-3 py-2 text-xs">
                {submitted.claimToken}
              </code>
            </div>
            <button
              onClick={() => setSubmitted(null)}
              className="text-sm text-amber-700 underline"
            >
              Submit another application
            </button>
          </section>
        ) : (
          <form onSubmit={onSubmit} className="rounded-xl border border-stone-200 bg-white p-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Company name *</label>
                <input className={inputCls} required minLength={2} value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Brand name *</label>
                <input className={inputCls} required minLength={2} value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Contact name *</label>
                <input className={inputCls} required minLength={2} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Contact email *</label>
                <input className={inputCls} required type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Contact phone</label>
                <input className={inputCls} value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Website</label>
                <input className={inputCls} type="url" value={form.website} onChange={(e) => set("website", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Country (ISO) *</label>
                <input className={inputCls} required minLength={2} maxLength={3} value={form.country} onChange={(e) => set("country", e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className={labelCls}>Registration number</label>
                <input className={inputCls} value={form.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Requested plan</label>
                <select className={inputCls} value={form.requestedPlan} onChange={(e) => set("requestedPlan", e.target.value as any)}>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="white_label">White label</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Business description * (min 50 chars)</label>
              <textarea className={inputCls} required minLength={50} maxLength={2000} rows={4} value={form.businessDescription} onChange={(e) => set("businessDescription", e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-stone-700">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.hasAmlPolicy} onChange={(e) => set("hasAmlPolicy", e.target.checked)} />
                Has AML policy
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.hasKycProcess} onChange={(e) => set("hasKycProcess", e.target.checked)} />
                Has KYC process
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isRegulated} onChange={(e) => set("isRegulated", e.target.checked)} />
                Regulated entity
              </label>
            </div>
            {submitError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit application"}
            </button>
          </form>
        )}

        <section className="rounded-xl border border-stone-200 bg-white p-6 space-y-4">
          <h2 className="text-lg font-semibold text-stone-900">Check application status</h2>
          <form onSubmit={onCheckStatus} className="flex gap-2">
            <input
              className={inputCls}
              placeholder="Tracking slug (e.g. acme-pay-…)"
              value={statusSlug}
              onChange={(e) => setStatusSlug(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={statusLoading}
              className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-900 disabled:opacity-50"
            >
              {statusLoading ? "…" : "Check"}
            </button>
          </form>
          {statusError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{statusError}</p>
          )}
          {status && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-stone-500">Status</dt>
                <dd className="font-semibold text-stone-900">{status.status}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Submitted</dt>
                <dd className="text-stone-900">{status.submittedAt ? new Date(status.submittedAt).toLocaleString() : "—"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Reviewed</dt>
                <dd className="text-stone-900">{status.reviewedAt ? new Date(status.reviewedAt).toLocaleString() : "—"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">SLA signed</dt>
                <dd className="text-stone-900">{status.slaSignedAt ? new Date(status.slaSignedAt).toLocaleString() : "not yet"}</dd>
              </div>
              {status.additionalInfoRequested && (
                <p className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  The review team has requested additional information. Sign in to respond.
                </p>
              )}
            </dl>
          )}
        </section>

        <p className="text-center text-sm text-stone-500">
          Already have an account? <Link to="/login" className="text-amber-700 underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default PartnerApply;
