import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { onboardingService } from "../services/onboardingService";

const OnboardingAddress: React.FC = () => {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleContinue = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!address || !city || !state) {
      setError("Street address, city, and state are required.");
      return;
    }

    setSubmitting(true);
    try {
      const { verificationUrl } =
        await onboardingService.createCustomerFromOnboarding({
          address,
          city,
          state,
          postalCode: postalCode || undefined,
        });
      navigate("/onboarding/completion", { state: { verificationUrl } });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create customer account.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-100 p-8">
        <button
          onClick={() => navigate("/onboarding/bvn")}
          className="text-sm text-indigo-600 font-semibold mb-6"
        >
          ← Back
        </button>

        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Address Verification
        </h1>
        <p className="text-slate-600 mb-6">
          Provide your current residential address.
        </p>

        {error && (
          <div className="mb-5 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleContinue} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Street Address
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              City
            </label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              State
            </label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Postal Code (Optional)
            </label>
            <input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl disabled:opacity-60"
          >
            {submitting ? "Creating Account..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default OnboardingAddress;
