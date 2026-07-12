import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

const OnboardingCompletion: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const verificationUrl = (
    location.state as { verificationUrl?: string } | null
  )?.verificationUrl;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 p-8">
        <div className="w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 mx-auto flex items-center justify-center mb-6">
          <svg
            className="w-10 h-10 text-emerald-600"
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
        </div>

        <h1 className="text-3xl font-bold text-slate-900 text-center">
          Account Created!
        </h1>
        <p className="text-slate-600 text-center mt-2">
          Complete the next steps to get started.
        </p>

        <div className="mt-8 p-5 rounded-xl bg-amber-500 text-white">
          <h2 className="text-lg font-semibold">
            1. Complete KYC Verification
          </h2>
          <p className="text-sm text-amber-50 mt-1">
            Verify your identity to unlock higher transaction limits.
          </p>
          {verificationUrl ? (
            <a
              href={verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-4 px-4 py-2 rounded-lg bg-white text-amber-700 font-semibold"
            >
              Start KYC Verification
            </a>
          ) : (
            <p className="text-sm text-amber-100 mt-3">
              You can complete KYC anytime after login from the KYC page.
            </p>
          )}
        </div>

        <div className="mt-4 p-5 rounded-xl border border-violet-200 bg-violet-50">
          <h2 className="text-lg font-semibold text-slate-900">
            2. Set Transaction PIN
          </h2>
          <p className="text-sm text-slate-700 mt-1">
            After login, set your PIN from Settings &gt; Security.
          </p>
        </div>

        <button
          onClick={() => navigate("/login")}
          className="w-full mt-8 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl"
        >
          Go to Login
        </button>
      </div>
    </div>
  );
};

export default OnboardingCompletion;
