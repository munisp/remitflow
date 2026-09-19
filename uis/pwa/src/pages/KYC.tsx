import React, { useCallback, useEffect, useState } from "react";
import { trpcClient } from "../services/trpc";

// ── W13-C1: typed structural accessors over the vanilla tRPC client ──────────
// The PWA-local AppRouter contract (types/appRouter.ts) does not yet declare
// these routers; access them structurally (same pattern as pages/bdc/api.ts).
// Shapes mirror the server procs:
//   kyc.status / kyc.uploadDocument  — inline `kyc` router in server/routers.ts
//   bvnNin.verifyBVN                 — server/routers/kycProductionGate.ts
//   profile.update                   — inline `profile` router in server/routers.ts

interface KycDocumentItem {
  id: number;
  docType: string;
  status: string;
  rejectionReason?: string | null;
  createdAt?: string | Date;
}

interface KycTierInfo {
  id: string;
  name: string;
  limit: number;
  requirements: string[];
  status: string;
}

interface KycStatusResponse {
  currentTier: string;
  limits: { daily: number; monthly: number; perTx: number; label: string };
  tiers: KycTierInfo[];
  documents: KycDocumentItem[];
  pendingCount: number;
  approvedCount: number;
}

interface BvnVerifyResponse {
  verified: boolean;
  match_score: number;
  verification_id: string;
  error?: string;
}

const api = trpcClient as unknown as {
  kyc: {
    status: { query: () => Promise<KycStatusResponse> };
    uploadDocument: {
      mutate: (input: {
        type: string;
        fileBase64: string;
        fileName: string;
        mimeType: string;
      }) => Promise<{ success: boolean; url: string }>;
    };
  };
  bvnNin: {
    verifyBVN: {
      mutate: (input: {
        bvn: string;
        firstName: string;
        lastName: string;
        dateOfBirth: string;
        phoneNumber?: string;
      }) => Promise<BvnVerifyResponse>;
    };
  };
  profile: {
    update: {
      mutate: (input: {
        name?: string;
        dateOfBirth?: string;
      }) => Promise<{ success: boolean; updatedFields: string[] }>;
    };
  };
};

/** Read a File as a base64 payload (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

// Upload targets restricted to values backed by the server's kyc_doc_type
// pgEnum — anything else would fail the DB insert.
const ID_DOC_TYPES = [
  { id: "passport", label: "Passport" },
  { id: "national_id", label: "National ID / NIN slip" },
  { id: "drivers_license", label: "Driver's License" },
] as const;

const ADDRESS_DOC_TYPE = "utility_bill";
const SELFIE_DOC_TYPE = "selfie";

const KYC: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [status, setStatus] = useState<KycStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bvn, setBvn] = useState("");
  const [bvnVerifying, setBvnVerifying] = useState(false);
  const [bvnResult, setBvnResult] = useState<{
    kind: "verified" | "rejected" | "unavailable";
    message: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
  });

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.kyc.status.query();
      setStatus(res);
    } catch (err) {
      // Honest failure — never fall back to fabricated profile data.
      setStatus(null);
      setLoadError(
        err instanceof Error
          ? err.message
          : "Could not load your verification status.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const documents = status?.documents ?? [];
  const docsByType = (type: string) =>
    documents.filter((d) => d.docType === type);
  const hasApproved = (types: string[]) =>
    documents.some((d) => types.includes(d.docType) && d.status === "approved");
  const hasPending = (types: string[]) =>
    documents.some((d) => types.includes(d.docType) && (d.status === "pending" || d.status === "under_review"));

  const handleBvnVerify = async () => {
    setActionError(null);
    setBvnResult(null);
    if (bvn.length !== 11) {
      setBvnResult({ kind: "rejected", message: "BVN must be 11 digits." });
      return;
    }
    if (!formData.firstName || !formData.lastName || !formData.dateOfBirth) {
      setBvnResult({
        kind: "rejected",
        message:
          "Fill in your first name, last name, and date of birth below first — they are cross-checked against the BVN registry.",
      });
      return;
    }
    setBvnVerifying(true);
    try {
      const res = await api.bvnNin.verifyBVN.mutate({
        bvn,
        firstName: formData.firstName,
        lastName: formData.lastName,
        dateOfBirth: formData.dateOfBirth,
      });
      if (res.verified) {
        setBvnResult({
          kind: "verified",
          message: "BVN verified successfully against the registry.",
        });
      } else {
        setBvnResult({
          kind: "rejected",
          message: `BVN verification failed${res.error ? `: ${res.error}` : " — the details did not match the registry"}. Check your details and try again.`,
        });
      }
    } catch (err) {
      setBvnResult({
        kind: "unavailable",
        message:
          err instanceof Error
            ? `Verification service unavailable: ${err.message}`
            : "Verification service unavailable. Please try again later.",
      });
    } finally {
      setBvnVerifying(false);
    }
  };

  const handleSaveProfile = async () => {
    setActionError(null);
    setNotice(null);
    if (!formData.firstName || !formData.lastName) {
      setActionError("First and last name are required.");
      return;
    }
    setSubmitting(true);
    try {
      await api.profile.update.mutate({
        name: `${formData.firstName} ${formData.lastName}`.trim(),
        ...(formData.dateOfBirth ? { dateOfBirth: formData.dateOfBirth } : {}),
      });
      setNotice("Personal details saved.");
      setCurrentStep(2);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not save your details.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (type: string, file: File) => {
    setActionError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await api.kyc.uploadDocument.mutate({
        type,
        fileBase64,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
      });
      setNotice(
        "Document uploaded and queued for review. Verification is completed by our compliance team — you will be notified of the outcome.",
      );
      await fetchStatus();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Document upload failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const stepDefs = [
    { id: 1, name: "Personal Info" },
    { id: 2, name: "ID Verification" },
    { id: 3, name: "Address Proof" },
    { id: 4, name: "Selfie" },
  ];

  const stepStatus = (id: number) =>
    currentStep > id ? "completed" : currentStep === id ? "current" : "pending";

  const inputClass =
    "w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all";

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="p-5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
          <p className="font-semibold mb-1">
            Verification status unavailable
          </p>
          <p>{loadError}</p>
          <button
            onClick={() => void fetchStatus()}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const currentTier = status?.currentTier ?? "tier0";
  const limits = status?.limits;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">KYC Verification</h1>
        <p className="text-slate-500 mt-1">
          Complete verification to unlock full features
        </p>
      </div>

      {/* Current tier + real limits from kyc.status */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Current tier</p>
          <p className="text-lg font-bold text-slate-900">
            {limits?.label ?? currentTier}
          </p>
        </div>
        {limits && (
          <div className="text-right text-sm text-slate-600">
            <p>Per transaction: ${limits.perTx.toLocaleString()}</p>
            <p>Daily: ${limits.daily.toLocaleString()}</p>
            <p>Monthly: ${limits.monthly.toLocaleString()}</p>
          </div>
        )}
      </div>

      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
          {actionError}
        </div>
      )}
      {notice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between">
          {stepDefs.map((step, i) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${stepStatus(step.id) === "completed" ? "bg-emerald-500 text-white" : stepStatus(step.id) === "current" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}
              >
                {stepStatus(step.id) === "completed" ? (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  step.id
                )}
              </div>
              {i < stepDefs.length - 1 && (
                <div
                  className={`w-10 md:w-20 h-1 mx-2 rounded-full transition-all duration-300 ${stepStatus(step.id) === "completed" ? "bg-emerald-500" : "bg-slate-100"}`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        {currentStep === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Personal Information
            </h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                BVN (Bank Verification Number)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={bvn}
                  onChange={(e) => setBvn(e.target.value.replace(/\D/g, ""))}
                  className={inputClass}
                  placeholder="Enter 11-digit BVN"
                  maxLength={11}
                />
                <button
                  onClick={handleBvnVerify}
                  disabled={bvn.length !== 11 || bvnVerifying}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  {bvnVerifying ? "Verifying..." : "Verify"}
                </button>
              </div>
              {bvnResult && (
                <p
                  className={`text-sm mt-2 ${
                    bvnResult.kind === "verified"
                      ? "text-emerald-600"
                      : bvnResult.kind === "rejected"
                        ? "text-red-600"
                        : "text-amber-600"
                  }`}
                >
                  {bvnResult.message}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  First Name
                </label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, firstName: e.target.value }))
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, lastName: e.target.value }))
                  }
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Date of Birth
              </label>
              <input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, dateOfBirth: e.target.value }))
                }
                className={inputClass}
              />
            </div>
            <button
              onClick={handleSaveProfile}
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save & Continue"}
            </button>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              ID Verification
            </h2>
            <p className="text-sm text-slate-500">
              Upload a valid government-issued ID
            </p>
            <div className="grid grid-cols-2 gap-3">
              {ID_DOC_TYPES.map((type) => (
                <label
                  key={type.id}
                  className="p-4 border-2 border-slate-100 rounded-2xl text-center hover:border-indigo-400 hover:bg-indigo-50 transition-all duration-200 cursor-pointer"
                >
                  <p className="font-semibold text-sm text-slate-700">
                    {type.label}
                  </p>
                  {hasPending([type.id]) && (
                    <p className="text-xs text-amber-600 mt-1">
                      Pending review
                    </p>
                  )}
                  {hasApproved([type.id]) && (
                    <p className="text-xs text-emerald-600 mt-1">Approved</p>
                  )}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf"
                    disabled={submitting}
                    onChange={(e) => {
                      if (e.target.files?.[0])
                        void handleFileUpload(type.id, e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Proof of Address
            </h2>
            <p className="text-sm text-slate-500">
              Upload a utility bill or bank statement (not older than 3 months)
            </p>
            <label className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-all duration-200 cursor-pointer block">
              <div className="w-14 h-14 bg-violet-50 rounded-2xl mx-auto mb-3 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-violet-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">
                Upload proof of address
              </p>
              <p className="text-xs text-slate-400">PDF, JPG, PNG up to 10MB</p>
              {hasPending([ADDRESS_DOC_TYPE, "proof_of_address"]) && (
                <p className="text-xs text-amber-600 mt-2">Pending review</p>
              )}
              {hasApproved([ADDRESS_DOC_TYPE, "proof_of_address"]) && (
                <p className="text-xs text-emerald-600 mt-2">Approved</p>
              )}
              <input
                type="file"
                className="hidden"
                accept="image/*,.pdf"
                disabled={submitting}
                onChange={(e) => {
                  if (e.target.files?.[0])
                    void handleFileUpload(ADDRESS_DOC_TYPE, e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Selfie Verification
            </h2>
            <p className="text-sm text-slate-500">
              Take a clear selfie for liveness verification
            </p>
            <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center hover:border-indigo-300 transition-all duration-200">
              <div className="w-20 h-20 bg-indigo-50 rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-indigo-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-4">
                Position your face in the frame
              </p>
              {hasPending([SELFIE_DOC_TYPE]) && (
                <p className="text-xs text-amber-600 mb-3">Pending review</p>
              )}
              {hasApproved([SELFIE_DOC_TYPE]) && (
                <p className="text-xs text-emerald-600 mb-3">Approved</p>
              )}
              <label className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl transition-all cursor-pointer inline-block">
                Take Selfie
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  capture="user"
                  disabled={submitting}
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      void handleFileUpload(SELFIE_DOC_TYPE, e.target.files[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-6 pt-4 border-t border-slate-100">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="px-5 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setCurrentStep(Math.min(4, currentStep + 1))}
            disabled={submitting || currentStep === 4}
            className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>

      {/* Honest review status — no self-serve tier upgrades exist; documents
          are reviewed by an admin (kyc approve path) before any tier change. */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">
          Verification Status
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">
            No documents submitted yet. Upload documents above to begin
            verification.
          </p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`flex items-center justify-between p-3.5 rounded-xl ${doc.status === "approved" ? "bg-emerald-50" : doc.status === "rejected" ? "bg-red-50" : "bg-amber-50"}`}
              >
                <span className="text-sm font-medium text-slate-900 capitalize">
                  {doc.docType.replace(/_/g, " ")}
                </span>
                <span
                  className={`text-xs font-semibold ${doc.status === "approved" ? "text-emerald-600" : doc.status === "rejected" ? "text-red-600" : "text-amber-600"}`}
                >
                  {doc.status === "approved"
                    ? "Approved"
                    : doc.status === "rejected"
                      ? `Rejected${doc.rejectionReason ? `: ${doc.rejectionReason}` : ""}`
                      : "Pending review"}
                </span>
              </div>
            ))}
            <p className="text-xs text-slate-500 pt-2">
              Documents are reviewed by our compliance team. Your tier is
              upgraded only after approval.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default KYC;
