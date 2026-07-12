import React, { useCallback, useEffect, useState } from "react";
import {
  AccountCurrency,
  accountService,
  AccountType,
  type Account,
} from "../services/accountService";

const VirtualAccount: React.FC = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copied, setCopied] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCurrency, setSelectedCurrency] = useState<
    AccountCurrency | ""
  >("");
  const [accountName, setAccountName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supportedCurrencies = accountService.getSupportedCurrencies();
  const existingCurrencies = new Set(
    accounts.map((acc) => acc.account_currency),
  );

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const userAccounts = await accountService.getAccounts();
      setAccounts(
        userAccounts.filter(
          (acc) =>
            acc.status === "active" && acc.account_type !== AccountType.SAVINGS,
        ),
      );
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
      setAccounts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleCreate = async () => {
    if (!selectedCurrency) {
      setError("Please select a currency");
      return;
    }

    // Check if user already has an account in this currency
    const hasExisting = accounts.some(
      (acc) => acc.account_currency === selectedCurrency,
    );
    if (hasExisting) {
      setError(`You already have a ${selectedCurrency} account`);
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // Get user's name from storage or use default
      const userName =
        accountName.trim() ||
        localStorage.getItem("username") ||
        "Account Holder";

      const newAccount = await accountService.createAccount({
        name: userName,
        account_type: AccountType.SAVINGS,
        account_currency: selectedCurrency as AccountCurrency,
      });

      setAccounts((prev) => [...prev, newAccount]);
      setShowCreateModal(false);
      setSelectedCurrency("");
      setAccountName("");
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to create account");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(""), 2000);
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Virtual Accounts
          </h1>
          <p className="text-slate-500 mt-1">Receive funds via bank transfer</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 text-sm"
        >
          + Create Account
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.length === 0 ? (
          <div className="col-span-full bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                />
              </svg>
            </div>
            <p className="text-slate-600 font-medium mb-2">No accounts yet</p>
            <p className="text-sm text-slate-400">
              Create your first multi-currency account
            </p>
          </div>
        ) : (
          accounts.map((account) => {
            const currencyInfo = accountService.getCurrencyInfo(
              account.account_currency,
            );
            return (
              <div
                key={account.id}
                className="bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-100 p-5 hover:shadow-lg transition-all duration-200"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-3xl">{currencyInfo?.flag}</span>
                    <div>
                      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                        {account.account_currency} Account
                      </p>
                      <p className="text-lg font-mono font-bold text-slate-900 mt-0.5">
                        {account.account_number}
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 capitalize">
                    {account.status}
                  </span>
                </div>

                <div className="mb-4 p-3 bg-white/50 rounded-xl">
                  <p className="text-xs text-slate-500 mb-1">Balance</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {currencyInfo?.symbol}
                    {parseFloat(account.balance).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>

                <p className="text-sm text-slate-500 mb-4">{account.name}</p>
                <p className="text-xs text-slate-400 mb-4">
                  <span className="font-medium capitalize">
                    {account.account_type}
                  </span>{" "}
                  • Created{" "}
                  {new Date(account.created_at || "").toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", year: "numeric" },
                  )}
                </p>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(account.account_number)}
                    className="flex-1 py-2.5 bg-white text-sm font-medium text-slate-700 rounded-xl hover:bg-slate-50 transition-colors border border-slate-200"
                  >
                    {copied === account.account_number
                      ? "✓ Copied!"
                      : "Copy Number"}
                  </button>
                  <button
                    onClick={() =>
                      handleCopy(
                        `${account.name}\n${account.account_number}\n${currencyInfo?.name}`,
                      )
                    }
                    className="flex-1 py-2.5 bg-white text-sm font-medium text-slate-700 rounded-xl hover:bg-slate-50 transition-colors border border-slate-200"
                  >
                    Copy Details
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Currency Coverage */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">
          Available Currencies
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {supportedCurrencies.map((currency) => {
            const hasAccount = existingCurrencies.has(currency.code);
            return (
              <div
                key={currency.code}
                className={`p-3 rounded-xl border-2 transition-all ${
                  hasAccount
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{currency.flag}</span>
                  <span className="font-bold text-slate-900">
                    {currency.code}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{currency.name}</p>
                {hasAccount && (
                  <span className="inline-block mt-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium rounded">
                    ✓ Active
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">
          How It Works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              step: 1,
              title: "Create Account",
              desc: "Choose your currency and create account instantly",
            },
            {
              step: 2,
              title: "Share Details",
              desc: "Share your account number to receive funds",
            },
            {
              step: 3,
              title: "Track Balance",
              desc: "Monitor all your multi-currency accounts",
            },
          ].map((s) => (
            <div key={s.step} className="text-center p-4">
              <div className="w-11 h-11 bg-indigo-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                <span className="text-indigo-600 font-bold">{s.step}</span>
              </div>
              <h3 className="font-semibold text-sm text-slate-900 mb-1">
                {s.title}
              </h3>
              <p className="text-xs text-slate-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg font-bold text-slate-900 mb-4">
              Create Multi-Currency Account
            </h2>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select Currency <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {supportedCurrencies.map((currency) => {
                    const hasAccount = existingCurrencies.has(currency.code);
                    return (
                      <button
                        key={currency.code}
                        type="button"
                        onClick={() => {
                          if (!hasAccount) {
                            setSelectedCurrency(currency.code);
                            setError(null);
                          }
                        }}
                        disabled={hasAccount}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          selectedCurrency === currency.code
                            ? "border-indigo-500 bg-indigo-50"
                            : hasAccount
                              ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
                              : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{currency.flag}</span>
                          <span className="font-bold text-slate-900">
                            {currency.code}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          {currency.name}
                        </p>
                        {hasAccount && (
                          <span className="inline-block mt-1 text-xs text-slate-400">
                            Already exists
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Account Name (Optional)
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none"
                  placeholder="e.g., Savings Account"
                />
              </div>

              <div className="p-3.5 bg-blue-50 border border-blue-100 rounded-xl">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> You can create one account per
                  currency. All accounts are linked to your profile.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setSelectedCurrency("");
                  setAccountName("");
                  setError(null);
                }}
                className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !selectedCurrency}
                className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  "Create Account"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VirtualAccount;
