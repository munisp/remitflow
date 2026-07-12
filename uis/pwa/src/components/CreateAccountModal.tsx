/**
 * CreateAccountModal Component
 * Modal for creating new multi-currency accounts from core banking
 */

import React, { useState } from "react";
import {
    AccountCurrency,
    accountService,
    AccountType,
    type CreateAccountRequest,
} from "../services/accountService";

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const CreateAccountModal: React.FC<CreateAccountModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateAccountRequest>({
    name: "",
    account_type: AccountType.PRIMARY,
    account_currency: AccountCurrency.NGN,
  });

  const currencies = accountService.getSupportedCurrencies();
  const accountTypes = [
    {
      value: AccountType.PRIMARY,
      label: "Primary Account",
      description: "Main transaction account",
    },
    {
      value: AccountType.SAVINGS,
      label: "Savings Account",
      description: "For saving and earning interest",
    },
    {
      value: AccountType.CURRENT,
      label: "Current Account",
      description: "For business transactions",
    },
    {
      value: AccountType.MINT,
      label: "Mint Account",
      description: "Mint platform account",
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await accountService.createAccount(formData);
      setFormData({
        name: "",
        account_type: AccountType.PRIMARY,
        account_currency: AccountCurrency.NGN,
      });
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900">
              Create New Account
            </h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors"
              disabled={loading}
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Account Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Account Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., My USD Savings"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                disabled={loading}
              />
            </div>

            {/* Currency Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Currency
              </label>
              <div className="grid grid-cols-2 gap-2">
                {currencies.map((currency) => (
                  <button
                    key={currency.code}
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        account_currency: currency.code,
                      })
                    }
                    disabled={loading}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      formData.account_currency === currency.code
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{currency.flag}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 text-sm">
                          {currency.code}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {currency.name}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Account Type */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Account Type
              </label>
              <div className="space-y-2">
                {accountTypes.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, account_type: type.value })
                    }
                    disabled={loading}
                    className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                      formData.account_type === type.value
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-semibold text-slate-900 text-sm">
                      {type.label}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {type.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Creating...
                  </>
                ) : (
                  "Create Account"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateAccountModal;
