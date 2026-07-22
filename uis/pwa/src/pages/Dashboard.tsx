import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { exchangeRateService, type ExchangeRate } from "../services/api";
import { accountService } from "../services/accountService";
import { transactionServiceCore, type Transaction as CoreTransaction } from "../services/transactionService";
import { useAuthStore } from "../stores/authStore";

interface DashboardTx {
  id: string | number;
  type: string;
  name: string;
  amount: number;
  currency: string;
  date: string;
  icon: string;
}

interface DashboardRate {
  pair: string;
  rate: string;
  change: string;
  up: boolean;
}

const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [balanceCurrency, setBalanceCurrency] = useState("NGN");
  const [accountCount, setAccountCount] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<DashboardTx[]>(
    [],
  );
  const [rates, setRates] = useState<DashboardRate[]>([]);
  const [loading, setLoading] = useState(true);

  const quickActions = [
    {
      name: "Send",
      href: "/send",
      icon: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8",
      color: "from-indigo-500 to-indigo-600",
    },
    {
      name: "Receive",
      href: "/receive",
      icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
      color: "from-emerald-500 to-emerald-600",
    },
    {
      name: "Airtime",
      href: "/airtime",
      icon: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z",
      color: "from-violet-500 to-violet-600",
    },
    // {
    //   name: "Bills",
    //   href: "/bills",
    //   icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    //   color: "from-amber-500 to-orange-500",
    // },
  ];

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    let gotBalance = false;
    let gotTx = false;
    let gotRates = false;

    try {
      // Fetch data in parallel from core banking account service
      const [primaryAccountRes, accountsRes, rateRes] =
        await Promise.allSettled([
          accountService.getAccountByKeycloakId(),
          accountService.getAccounts(),
          exchangeRateService.getRates("NGN"),
        ]);

      // Process primary account and all accounts from core banking
      let accounts: any[] = [];
      let primaryAccountNumber: string | null = null;

      if (accountsRes.status === "fulfilled") {
        accounts = accountsRes.value || [];
      }

      // If we have a primary account from keycloak ID, ensure it's included
      if (primaryAccountRes.status === "fulfilled" && primaryAccountRes.value) {
        const primaryAccount = primaryAccountRes.value;
        primaryAccountNumber = primaryAccount.account_number;
        // Check if it's already in accounts list
        if (!accounts.find((acc) => acc.id === primaryAccount.id)) {
          accounts.unshift(primaryAccount);
        }
      }

      // If no primary account but we have accounts, use the first one's account number
      if (!primaryAccountNumber && accounts.length > 0) {
        primaryAccountNumber = accounts[0].account_number;
      }

      // Fetch transactions using account number from ledger service
      let txRes: PromiseSettledResult<any> | null = null;
      if (primaryAccountNumber) {
        txRes = await Promise.allSettled([
          transactionServiceCore.getTransactions(primaryAccountNumber, {
            limit: 3,
          }),
        ]).then((results) => results[0]);
      }

      if (accounts.length > 0) {
        setAccountCount(
          accounts.filter((acc: any) => acc.status === "active").length,
        );

        // Build the conversion map exclusively from the live FX service.
        const exchangeRates: Record<string, number> = { NGN: 1 };

        if (rateRes.status === "fulfilled") {
          const rateResponse = rateRes.value;
          const liveRates = rateResponse?.data || [];
          liveRates.forEach((rate: { from: string; to: string; rate: number }) => {
            // Backend returns NGN base and quote as foreign; we want NGN value per 1 unit of account currency.
            // If account currency is NGN, keep 1; if account currency is foreign (to), use raw.rate as NGN per 1 foreign.
            if (rate.from === "NGN") {
              exchangeRates[rate.to] = rate.rate;
            }
          });
        }

        const total = accounts
          .filter((acc: any) => acc.status === "active")
          .reduce((sum: number, acc: any) => {
            const balance = parseFloat(acc.balance) || 0;
            const rate = exchangeRates[acc.account_currency];
            // Do not value foreign-currency balances using an invented rate.
            return rate === undefined ? sum : sum + balance * rate;
          }, 0);

        setTotalBalance(total);
        setBalanceCurrency("NGN");
        gotBalance = true;
      }

      if (txRes && txRes.status === "fulfilled") {
        const txData = txRes.value;
        const txList: CoreTransaction[] = txData.transactions || [];
        if (txList.length > 0 && primaryAccountNumber) {
          setRecentTransactions(
            txList.slice(0, 3).map((tx: CoreTransaction) => {
              // Determine if this is a debit or credit based on account number
              const isDebit = tx.payer_account_number === primaryAccountNumber;
              const otherParty = isDebit
                ? tx.payee_name || tx.payee_account_number || "Unknown"
                : tx.payer_name || tx.payer_account_number || "Unknown";

              return {
                id: tx.id,
                type: isDebit ? "sent" : "received",
                name: otherParty,
                amount: parseFloat(tx.amount),
                currency: tx.currency || "NGN",
                date: new Date(tx.created_at).toLocaleDateString(),
                icon: isDebit
                  ? "M5 10l7-7m0 0l7 7m-7-7v18"
                  : "M19 14l-7 7m0 0l-7-7m7 7V3",
              };
            }),
          );
          gotTx = true;
        }
      }

      if (rateRes.status === "fulfilled") {
        const rateData: ExchangeRate[] = rateRes.value.data;
        if (rateData.length > 0) {
          setRates(
            rateData.slice(0, 4).map((r: ExchangeRate) => ({
              pair: `${r.from}/${r.to}`,
              rate: r.rate.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
              change: "+0.0%",
              up: true,
            })),
          );
          gotRates = true;
        }
      }
    } catch (error) {
      console.error("Dashboard data fetch error:", error);
    } finally {
      if (!gotBalance) {
        setTotalBalance(0);
        setAccountCount(0);
      }
      if (!gotTx) setRecentTransactions([]);
      if (!gotRates) setRates([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome back, {user?.firstName || "User"}
        </h1>
        <p className="text-slate-500 mt-1">Here's your account overview</p>
      </div>

      <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <p className="text-indigo-200 text-sm font-medium">Total Balance</p>
          <h2 className="text-3xl font-bold mt-1 tracking-tight">
            {loading ? (
              <span className="animate-pulse bg-white/20 rounded h-8 w-48 inline-block" />
            ) : (
              `₦${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            )}
          </h2>
          <p className="text-indigo-200 text-xs mt-2">
            {loading
              ? "..."
              : `${accountCount} active ${accountCount === 1 ? "account" : "accounts"}`}
          </p>
          <div className="mt-5 flex gap-3">
            <Link
              to="/wallet"
              className="text-sm bg-white/15 backdrop-blur-sm px-5 py-2.5 rounded-xl hover:bg-white/25 transition-colors font-medium"
            >
              View Accounts
            </Link>
            <Link
              to="/send"
              className="text-sm bg-white px-5 py-2.5 rounded-xl text-indigo-700 hover:bg-indigo-50 transition-colors font-semibold"
            >
              Send Money
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {quickActions.map((action) => (
          <Link
            key={action.name}
            to={action.href}
            className="flex flex-col items-center gap-2.5 p-4 bg-white rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 active:scale-95 group"
          >
            <div
              className={`w-11 h-11 rounded-xl bg-gradient-to-br ${action.color} flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow`}
            >
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={action.icon} />
              </svg>
            </div>
            <span className="text-xs font-medium text-slate-700">
              {action.name}
            </span>
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-900">
            Exchange Rates
          </h3>
          <Link
            to="/exchange-rates"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            View all
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {rates.map((r) => (
            <div key={r.pair} className="p-3.5 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-500 font-medium">{r.pair}</p>
              <p className="text-lg font-bold text-slate-900 mt-0.5">
                {r.rate}
              </p>
              <span
                className={`text-xs font-medium ${r.up ? "text-emerald-600" : "text-red-500"}`}
              >
                {r.change}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-900">
            Recent Transactions
          </h3>
          <Link
            to="/transactions"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            View all
          </Link>
        </div>
        <div className="space-y-2">
          {recentTransactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between p-3.5 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${tx.type === "received" ? "bg-emerald-50 text-emerald-600" : tx.type === "airtime" ? "bg-violet-50 text-violet-600" : "bg-indigo-50 text-indigo-600"}`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={tx.icon} />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {tx.name}
                  </p>
                  <p className="text-xs text-slate-500">{tx.date}</p>
                </div>
              </div>
              <p
                className={`text-sm font-bold tabular-nums ${tx.type === "received" ? "text-emerald-600" : "text-slate-900"}`}
              >
                {tx.type === "received" ? "+" : "-"}
                {tx.currency} {tx.amount.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
