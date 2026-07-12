import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onboardingService } from "../services/onboardingService";

const OnboardingBvn: React.FC = () => {
  const [bvn, setBvn] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);
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
    setIsVerifying(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setResult(onboardingService.verifyBvnLocally(value));
    setIsVerifying(false);
  };

  const handleContinue = () => {
    if (bvn.trim()) {
      onboardingService.setBvn(bvn);
    } else {
      onboardingService.setBvn("");
    }
    navigate("/onboarding/address", { state: { accountType } });
  };

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
          CBN requires BVN for complete profile verification.
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
        {result && (
          <p
            className={`text-sm mt-2 ${result.valid ? "text-emerald-600" : "text-red-600"}`}
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
            Skip
          </button>
          <button
            onClick={handleContinue}
            disabled={Boolean(bvn) && (!result || !result.valid)}
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
