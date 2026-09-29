/**
 * KYC camera-capture flow (wave-15 SPEC §7).
 *
 * Orchestrates the three steps against the kycCapture.* server contract:
 *   1. DocumentCaptureStep  — quality-gated live capture, 3-frame burst upload
 *   2. SelfieChallengeStep  — server-ordered challenge prompts, MediaPipe
 *                             blendshape/pose detection (lazy-loaded WASM)
 *   3. VerdictStep          — finalize + visibility-gated status polling
 *
 * The session (sessionId + nonce + ordered challenge) is created once via
 * kycCapture.startSession and threaded through every submission. NFC is N/A on
 * web — nfcSupported is reported honestly and submitNfcData is never called.
 *
 * Any hard failure (camera denied, detector unloadable, session expired)
 * offers a graceful fallback to the existing file-upload path on /kyc.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  kycCaptureApi,
  detectNfcSupport,
  errorMessage,
  type CaptureDocType,
  type StartSessionResponse,
} from "./api";
import DocumentCaptureStep from "./DocumentCaptureStep";
import SelfieChallengeStep from "./SelfieChallengeStep";
import VerdictStep from "./VerdictStep";

const DOC_TYPE_OPTIONS: { id: CaptureDocType; label: string }[] = [
  { id: "passport", label: "Passport" },
  { id: "national_id", label: "National ID" },
  { id: "drivers_license", label: "Driver's License" },
];

type Step = "docType" | "document" | "challenge" | "verdict";

const CaptureFlow: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("docType");
  const [docType, setDocType] = useState<CaptureDocType>("national_id");
  const [session, setSession] = useState<StartSessionResponse | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [startingSession, setStartingSession] = useState(false);

  const startSession = useCallback(async (type: CaptureDocType) => {
    setStartingSession(true);
    setSessionError(null);
    try {
      const res = await kycCaptureApi.kycCapture.startSession.mutate({
        docType: type,
        nfcSupported: detectNfcSupport(),
      });
      setSession(res);
      setStep("document");
    } catch (err) {
      setSessionError(
        errorMessage(
          err,
          "Could not start a capture session. The camera verification service may be unavailable — you can use the upload path instead.",
        ),
      );
    } finally {
      setStartingSession(false);
    }
  }, []);

  const goBackToKyc = useCallback(() => navigate("/kyc"), [navigate]);

  // Guard: an expired session can't be recovered mid-flow — restart honestly.
  useEffect(() => {
    if (!session?.expiresAt) return;
    const expiry = Date.parse(session.expiresAt);
    if (Number.isNaN(expiry)) return;
    const remaining = expiry - Date.now();
    if (remaining <= 0) {
      setSession(null);
      setStep("docType");
      setSessionError("The previous capture session expired. Please start again.");
      return;
    }
    const timer = setTimeout(() => {
      setSession(null);
      setStep("docType");
      setSessionError("The capture session expired. Please start again.");
    }, remaining);
    return () => clearTimeout(timer);
  }, [session]);

  const stepIndex =
    step === "docType" ? 0 : step === "document" ? 1 : step === "challenge" ? 2 : 3;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <button
          onClick={goBackToKyc}
          className="text-sm text-slate-500 hover:text-slate-700 mb-2 inline-flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to verification options
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Verify with camera</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Scan your ID and complete a short selfie challenge. On-device checks
          assess capture quality; the verification decision is made by our
          secure pipeline.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {["Document type", "Document scan", "Selfie challenge", "Result"].map(
          (label, i) => (
            <React.Fragment key={label}>
              {i > 0 && <div className={`w-8 h-1 rounded-full ${i <= stepIndex ? "bg-indigo-500" : "bg-slate-200"}`} />}
              <div
                title={label}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                  i < stepIndex
                    ? "bg-emerald-500 text-white"
                    : i === stepIndex
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {i < stepIndex ? "✓" : i + 1}
              </div>
            </React.Fragment>
          ),
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        {step === "docType" && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Which document will you use?
            </h2>
            <div className="space-y-2">
              {DOC_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex items-center gap-3 p-4 border-2 rounded-2xl cursor-pointer transition-all ${
                    docType === opt.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-slate-100 hover:border-indigo-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="docType"
                    checked={docType === opt.id}
                    onChange={() => setDocType(opt.id)}
                    className="accent-indigo-600"
                  />
                  <span className="font-medium text-slate-800">{opt.label}</span>
                </label>
              ))}
            </div>
            {sessionError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 space-y-2">
                <p>{sessionError}</p>
                <button
                  onClick={goBackToKyc}
                  className="text-red-800 font-semibold underline underline-offset-2"
                >
                  Use the upload path instead
                </button>
              </div>
            )}
            <button
              onClick={() => void startSession(docType)}
              disabled={startingSession}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 disabled:opacity-50"
            >
              {startingSession ? "Starting secure session…" : "Start camera verification"}
            </button>
            <p className="text-center text-sm text-slate-500">
              No camera?{" "}
              <button
                onClick={goBackToKyc}
                className="text-indigo-600 font-medium underline underline-offset-2"
              >
                Upload photos instead
              </button>
            </p>
          </div>
        )}

        {step === "document" && session && (
          <DocumentCaptureStep
            sessionId={session.sessionId}
            nonce={session.nonce}
            docType={docType}
            onComplete={() => setStep("challenge")}
            onUseUploadInstead={goBackToKyc}
          />
        )}

        {step === "challenge" && session && (
          <SelfieChallengeStep
            sessionId={session.sessionId}
            nonce={session.nonce}
            challenge={session.challenge}
            onComplete={() => setStep("verdict")}
            onUseUploadInstead={goBackToKyc}
          />
        )}

        {step === "verdict" && session && (
          <VerdictStep
            sessionId={session.sessionId}
            nonce={session.nonce}
            onBackToKyc={goBackToKyc}
          />
        )}
      </div>
    </div>
  );
};

export default CaptureFlow;
