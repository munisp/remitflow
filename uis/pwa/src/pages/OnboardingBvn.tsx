import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onboardingService } from "../services/onboardingService";
import { trpcClient } from "../services/trpc";

// W13-C1: the PWA-local AppRouter contract (types/appRouter.ts) does not
// declare the bvnNin router yet; access it via a typed structural accessor
// (same pattern as pages/bdc/api.ts). Response mirrors the Go BVN/NIN
// service payload returned by bvnNin.verifyBVN (kycProductionGate.ts).
interface BvnVerifyResponse {
  verified: boolean;
  match_score: number;
  verification_id: string;
  error?: string;
}
const bvnNinApi = (
  trpcClient as unknown as {
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
  }
).bvnNin;

type VerifyState =
  | { kind: "verified"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "unavailable"; message: string };

const OnboardingBvn: React.FC = () => {
  const [bvn, setBvn] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<VerifyState | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const accountType =
    (location.state as { accountType?: string } | null)?.accountType ||
    onboardingService.getAccountType();

  const verify = async (value: string) => {
    if (value.length !== 11) {
      setResult(null);
      return;
    }

    // Client-side format check first — this alone is NOT verification.
    const format = onboardingService.checkBvnFormat(value);
    if (!format.valid) {
      setResult({ kind: "rejected", message: format.message });
      return;
    }

    // Real verification via the bvnNin tRPC router (proxies to the Go
    // BVN/NIN service, fail-closed). The onboarding flow runs pre-login, so
    // an UNAUTHORIZED response lands in the honest "unavailable" state:
    // the user may continue, but the account stays at Tier 0 until BVN is
    // verified post-login from the KYC page.
    const profile = onboardingService.getOnboardingData();
    setIsVerifying(true);
    setResult(null);
    try {
      const res = await bvnNinApi.verifyBVN.mutate({
        bvn: value,
        firstName: profile?.firstName ?? "",
        lastName: profile?.lastName ?? "",
        // Date of birth is not collected during registration; the Go service
        // treats an empty value per its own matching policy (fail-closed).
        dateOfBirth: "",
        ...(profile?.phoneNumber ? { phoneNumber: profile.phoneNumber } : {}),
      });
      if (res.verified) {
        setResult({
          kind: "verified",
          message: "BVN verified successfully against the registry.",
        });
      } else {
        setResult({
          kind: "rejected",
          message: `BVN verification failed${res.error ? `: ${res.error}` : " — the details did not match the registry"}. Please check and try again, or skip and verify later.`,
        });
      }
    } catch (err) {
      setResult({
        kind: "unavailable",
        message:
          "Verification service unavailable — you can continue, but your account stays at Tier 0 until your BVN is verified from the KYC page after login.",
      });
      console.warn("[onboarding] BVN verification unavailable:", err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleContinue = () => {
    // Only carry a BVN forward when it actually verified; a rejected or
    // unverified BVN must not be submitted as if it were validated.
    if (bvn.trim() && result?.kind === "verified") {
      onboardingService.setBvn(bvn);
    } else {
      onboardingService.setBvn("");
    }
    navigate("/onboarding/address", { state: { accountType } });
  };

  const continueDisabled =
    isVerifying || (Boolean(bvn) && result?.kind === "rejected");

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-100 p-8">
        <button
          onClick={() => navigate("/onboarding/account-type")}
          className="text-sm text-indigo-600 font-semibold mb-6"
        >
          ← Back
        </button>

        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          BVN Verification
        </h1>
        <p className="text-slate-600 mb-5">
          Provide your BVN to improve verification speed.
        </p>

        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-sm text-indigo-800 mb-6">
          CBN requires BVN for complete profile verification. Skipping keeps
          your account at Tier 0 (no transfers) until verification is
          completed.
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-2">
          Bank Verification Number (11 digits)
        </label>
        <input
          type="text"
          value={bvn}
          maxLength={11}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "");
            setBvn(value);
            void verify(value);
          }}
          className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none"
          placeholder="12345678901"
        />

        {isVerifying && (
          <p className="text-sm text-indigo-600 mt-2">Verifying...</p>
        )}
        {result && !isVerifying && (
          <p
            className={`text-sm mt-2 ${
              result.kind === "verified"
                ? "text-emerald-600"
                : result.kind === "rejected"
                  ? "text-red-600"
                  : "text-amber-600"
            }`}
          >
            {result.message}
          </p>
        )}

        <div className="mt-8 flex gap-3">
          <button
            onClick={() => {
              onboardingService.setBvn("");
              navigate("/onboarding/address", { state: { accountType } });
            }}
            className="flex-1 py-3.5 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50"
          >
            Skip (stay Tier 0)
          </button>
          <button
            onClick={handleContinue}
            disabled={continueDisabled}
            className="flex-1 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingBvn;
