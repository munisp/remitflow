import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { onboardingService } from "../services/onboardingService";

const OnboardingAccountType: React.FC = () => {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleContinue = () => {
    if (!selectedType) {
      return;
    }

    onboardingService.setAccountType(selectedType);
    navigate("/onboarding/bvn", { state: { accountType: selectedType } });
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 p-8">
        <button
          onClick={() => navigate("/onboarding/start")}
          className="text-sm text-indigo-600 font-semibold mb-6"
        >
          ← Back
        </button>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Select Account Type
        </h1>
        <p className="text-slate-600 mb-8">
          Choose the type of account that best fits your needs.
        </p>

        <div className="space-y-4">
          <button
            onClick={() => setSelectedType("individual")}
            className={`w-full text-left p-5 rounded-xl border-2 ${selectedType === "individual" ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"}`}
          >
            <h2 className="text-lg font-semibold text-slate-900">
              Individual Account
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              For personal banking needs
            </p>
          </button>

          <button
            onClick={() => setSelectedType("business")}
            className={`w-full text-left p-5 rounded-xl border-2 ${selectedType === "business" ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"}`}
          >
            <h2 className="text-lg font-semibold text-slate-900">
              Business Account
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              For companies and organizations
            </p>
          </button>
        </div>

        <button
          onClick={handleContinue}
          disabled={!selectedType}
          className="w-full mt-8 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
};

export default OnboardingAccountType;
