/**
 * Step 3 — verdict.
 *
 * Calls kycCapture.finalize once, then polls kycCapture.getSession until a
 * terminal status (verified | failed | manual_review). Polling follows the
 * wave-14 visibility-gated pattern (see pages/TransferTracking.tsx): ticks
 * are skipped while the tab is hidden, one refresh fires on visibilitychange
 * back to visible, and polling stops at a terminal state.
 *
 * Copy is deliberately honest: manual_review means a human reviews the
 * submission — we do not invent SLA numbers.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { kycCaptureApi, errorMessage, type CaptureVerdictStatus } from "./api";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 10 * 60_000; // stop polling after 10 min; user can refresh

type VerdictState =
  | { phase: "finalizing" }
  | { phase: "polling" }
  | { phase: "terminal"; status: CaptureVerdictStatus; verdict?: string }
  | { phase: "error"; message: string };

interface Props {
  sessionId: string;
  nonce: string;
  onBackToKyc: () => void;
}

const VerdictStep: React.FC<Props> = ({ sessionId, nonce, onBackToKyc }) => {
  const [state, setState] = useState<VerdictState>({ phase: "finalizing" });
  const startedAtRef = useRef(Date.now());
  const stateRef = useRef(state);
  stateRef.current = state;

  const poll = useCallback(async () => {
    if (stateRef.current.phase === "terminal") return;
    if (Date.now() - startedAtRef.current > MAX_POLL_MS) {
      // Honest timeout: we don't know the outcome — say so and stop polling.
      setState({
        phase: "terminal",
        status: "manual_review",
        verdict:
          "The result is taking longer than expected. Your submission is in the review queue — you will be notified when a decision is reached.",
      });
      return;
    }
    try {
      const res = await kycCaptureApi.kycCapture.getSession.query({ sessionId });
      if (
        res.status === "verified" ||
        res.status === "failed" ||
        res.status === "manual_review"
      ) {
        setState({ phase: "terminal", status: res.status, verdict: res.verdict });
      }
      // pending/processing/expired non-terminal for our purposes; "expired"
      // surfaces as failed on finalize, but if seen here treat honestly:
      else if (res.status === "expired") {
        setState({
          phase: "terminal",
          status: "failed",
          verdict: res.verdict ?? "The verification session expired before a decision was reached.",
        });
      }
    } catch {
      // Transient poll failure — keep polling; finalize error is the hard stop.
    }
  }, [sessionId]);

  // Finalize once, then visibility-gated polling (pattern from TransferTracking).
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const finalize = async () => {
      try {
        const res = await kycCaptureApi.kycCapture.finalize.mutate({ sessionId, nonce });
        if (cancelled) return;
        setState({ phase: "terminal", status: res.status, verdict: res.verdict });
      } catch (err) {
        if (cancelled) return;
        const message = errorMessage(err, "Could not finalize the verification session.");
        // finalize may be rejected while the pipeline is still running — fall
        // back to polling rather than declaring failure prematurely.
        if (/pending|processing|running|not.?ready/i.test(message)) {
          setState({ phase: "polling" });
        } else {
          setState({ phase: "error", message });
        }
      }
    };

    void finalize().then(() => {
      if (cancelled) return;
      interval = setInterval(() => {
        if (document.visibilityState === "visible") void poll();
      }, POLL_INTERVAL_MS);
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionId, nonce, poll]);

  if (state.phase === "finalizing" || state.phase === "polling") {
    return (
      <div className="space-y-4 text-center py-8">
        <div className="w-10 h-10 mx-auto border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        <h2 className="text-lg font-semibold text-slate-900">
          Verifying your submission
        </h2>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          Our verification pipeline is checking your document and selfie
          challenge. This usually takes a moment — you can leave this page and
          the result will be waiting in your verification status.
        </p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="space-y-4">
        <div className="p-5 rounded-xl bg-red-50 border border-red-100">
          <p className="font-semibold text-red-800 mb-1">Verification unavailable</p>
          <p className="text-sm text-red-700">{state.message}</p>
        </div>
        <button
          onClick={onBackToKyc}
          className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200"
        >
          Back to verification options
        </button>
      </div>
    );
  }

  const { status, verdict } = state;

  if (status === "verified") {
    return (
      <div className="space-y-4 text-center py-6">
        <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Verification complete</h2>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          {verdict ?? "Your identity has been verified. Your account tier will be updated to reflect this."}
        </p>
        <button
          onClick={onBackToKyc}
          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200"
        >
          Back to KYC status
        </button>
      </div>
    );
  }

  if (status === "manual_review") {
    return (
      <div className="space-y-4 text-center py-6">
        <div className="w-16 h-16 mx-auto bg-amber-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Under review</h2>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          {verdict ??
            "Your submission needs a closer look. Our team will review it and you will be notified when a decision is reached — no further action is needed from you right now."}
        </p>
        <button
          onClick={onBackToKyc}
          className="px-6 py-3 bg-white border-2 border-indigo-200 text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
        >
          Back to KYC status
        </button>
      </div>
    );
  }

  // failed
  return (
    <div className="space-y-4 text-center py-6">
      <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
        <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-slate-900">Verification unsuccessful</h2>
      <p className="text-sm text-slate-500 max-w-sm mx-auto">
        {verdict ??
          "The verification pipeline could not confirm this submission. You can try again with better lighting and a valid document, or upload photos for manual review."}
      </p>
      <button
        onClick={onBackToKyc}
        className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200"
      >
        Back to verification options
      </button>
    </div>
  );
};

export default VerdictStep;
