import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CreateAccountModal from "../components/CreateAccountModal";
import {
  accountService,
  exchangeRateService,
  type Account,
} from "../services/api";

interface WalletData {
  currency: string;
  balance: number;
  flag: string;
  name: string;
  currencyName: string;
  accountNumber: string;
  accountId: number;
  accountType: string;
}

const Wallet: React.FC = () => {
  const [selectedCurrency, setSelectedCurrency] = useState("NGN");
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({
    NGN: 1,
    USD: 1550,
    GBP: 1980,
    EUR: 1700,
    GHS: 125,
    JPY: 0.01,
    AUD: 1050,
  });

  const fetchExchangeRates = useCallback(async () => {
    try {
      const rates = await exchangeRateService.getRates("NGN");
      const rateMap: Record<string, number> = { NGN: 1 };

      rates.data.forEach((rate) => {
        rateMap[rate.to] = rate.rate;
      });

      setExchangeRates(rateMap);
    } catch {
      // Use default rates if fetch fails
    }
  }, []);

  const fetchWalletData = useCallback(async () => {
    setLoading(true);

    try {
      // First, try to get primary account by keycloak ID
      const primaryAccount = await accountService.getAccountByKeycloakId();

      // Then fetch all accounts
      const accounts = await accountService.getAccounts();

      if (accounts.length > 0) {
        setWallets(
          accounts
            .filter((acc) => acc.status === "active")
            .map((acc: Account) => {
              const currencyInfo = accountService.getCurrencyInfo(
                acc.account_currency,
              );
              return {
                currency: acc.account_currency,
                balance: parseFloat(acc.balance) || 0,
                flag: currencyInfo?.flag || "",
                currencyName: currencyInfo?.name || acc.account_currency,
                name: acc?.name || acc.account_currency,
                accountNumber: acc.account_number,
                accountId: acc.id,
                accountType: acc.account_type,
              };
            }),
        );
      } else if (primaryAccount) {
        // If only primary account exists, show it
        const currencyInfo = accountService.getCurrencyInfo(
          primaryAccount.account_currency,
        );
        setWallets([
          {
            currency: primaryAccount.account_currency,
            balance: parseFloat(primaryAccount.balance) || 0,
            flag: currencyInfo?.flag || "",
            name: currencyInfo?.name || primaryAccount.account_currency,
            accountNumber: primaryAccount.account_number,
            accountId: primaryAccount.id,
            accountType: primaryAccount.account_type,
          },
        ]);
      }
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
      // Show empty state instead of fallback data
      setWallets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExchangeRates();
    fetchWalletData();
  }, [fetchExchangeRates, fetchWalletData]);

  const totalInNGN = wallets.reduce((acc, w) => {
    const rate = exchangeRates[w.currency] || 1;
    return acc + w.balance * rate;
  }, 0);

  const handleAddMoney = async () => {
    // TODO: Implement funding flow
    console.log("Add money for currency:", selectedCurrency);
  };

  const handleAccountCreated = () => {
    // Refresh wallet data after creating new account
    fetchWalletData();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Wallet</h1>
        <p className="text-slate-500 mt-1">
          Manage your multi-currency accounts
        </p>
      </div>

      <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <p className="text-indigo-200 text-sm font-medium">
            Total Balance (NGN equivalent)
          </p>
          <h2 className="text-3xl font-bold mt-1 tracking-tight">
            {loading ? (
              <span className="animate-pulse bg-white/20 rounded h-8 w-48 inline-block" />
            ) : (
              `₦${totalInNGN.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            )}
          </h2>
          <div className="mt-5 flex gap-3">
            <Link
              to="/send"
              className="text-sm bg-white px-5 py-2.5 rounded-xl text-indigo-700 hover:bg-indigo-50 transition-colors font-semibold"
            >
              Send
            </Link>
            <Link
              to="/receive"
              className="text-sm bg-white/15 backdrop-blur-sm px-5 py-2.5 rounded-xl hover:bg-white/25 transition-colors font-medium"
            >
              Receive
            </Link>
            <button
              onClick={handleAddMoney}
              className="text-sm bg-white/15 backdrop-blur-sm px-5 py-2.5 rounded-xl hover:bg-white/25 transition-colors font-medium"
            >
              Add Money
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900">
            Currency Accounts
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Account
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="p-4 bg-white rounded-2xl border border-slate-100 animate-pulse"
              >
                <div className="h-16 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : wallets.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
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
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              No Accounts Yet
            </h3>
            <p className="text-slate-500 mb-4">
              Create your first multi-currency account to get started
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-violet-700 transition-all"
            >
              Create Account
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {wallets.map((wallet) => (
              <button
                key={wallet.accountId}
                onClick={() => setSelectedCurrency(wallet.currency)}
                className={`p-4 bg-white rounded-2xl border text-left transition-all duration-200 hover:shadow-md ${
                  selectedCurrency === wallet.currency
                    ? "border-indigo-300 ring-2 ring-indigo-100 shadow-md"
                    : "border-slate-100 hover:border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{wallet.flag}</span>
                    <div>
                      <p className="font-semibold text-slate-900">
                        {wallet.currency}
                      </p>
                      <p className="text-xs text-slate-500">
                        {wallet.currencyName}
                      </p>
                      <p className="text-xs text-slate-500">{wallet.name}</p>
                    </div>
                  </div>
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg capitalize">
                    {wallet.accountType}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">
                    {wallet.balance.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">
                    {wallet.accountNumber}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {wallets.length > 0 && (
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full p-4 bg-white rounded-2xl border-2 border-dashed border-slate-200 text-indigo-600 font-medium hover:border-indigo-300 hover:bg-indigo-50 transition-all duration-200 flex items-center justify-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add Another Currency Account
        </button>
      )}

      <CreateAccountModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleAccountCreated}
      />
    </div>
  );
};

export default Wallet;
