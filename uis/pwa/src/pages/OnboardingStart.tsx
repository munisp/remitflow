import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const steps = [
  {
    number: "1",
    title: "Account Type",
    description: "Select Individual or Business",
    required: true,
  },
  {
    number: "2",
    title: "Enter BVN",
    description: "Provide your Bank Verification Number",
    required: false,
  },
  {
    number: "3",
    title: "Address Details",
    description: "Provide your address information",
    required: true,
  },
];

const OnboardingStart: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem("hasSeenOnboarding", "true");
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">
            Welcome to 54RemitFlow
          </h1>
          <p className="text-slate-600 mt-2">
            Complete your account setup to unlock all features and ensure
            compliance.
          </p>
        </div>

        <div className="space-y-3 mb-10">
          {steps.map((step) => (
            <div
              key={step.number}
              className={`p-4 rounded-xl border ${step.required ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-white ${step.required ? "bg-indigo-600" : "bg-slate-400"}`}
                >
                  {step.number}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">
                      {step.title}
                    </h3>
                    {!step.required && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                        Optional
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600">{step.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <button
            onClick={() => navigate("/onboarding/account-type")}
            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl"
          >
            Start Onboarding
          </button>
          <button
            onClick={() => navigate("/login")}
            className="w-full py-3.5 text-indigo-600 font-semibold rounded-xl border border-indigo-200 hover:bg-indigo-50"
          >
            Already have an account? Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingStart;
