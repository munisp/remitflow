/**
 * SendMoney - World-class money transfer experience
 * Features: FX transparency, rate locking, offline support, real API integration
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  bankService,
  exchangeRateService,
  transactionService,
  type Bank,
} from "../services/api";
import {
  AccountCurrency,
  AccountStatus,
  AccountType,
  accountService,
  type Account,
} from "../services/accountService";
import { useAuthStore } from "../stores/authStore";
import {
  useIsOnline,
  useOfflineStore,
  usePendingCount,
} from "../stores/offlineStore";

// Types
interface ExchangeRate {
  from: string;
  to: string;
  rate: number;
  inverseRate: number;
  lastUpdated: string;
  provider: string;
  validUntil: string;
}

interface RateLock {
  id: string;
  from: string;
  to: string;
  rate: number;
  amount: number;
  lockedAt: string;
  expiresAt: string;
}

interface FeeBreakdown {
  transferFee: number;
  exchangeMargin: number;
  networkFee: number;
  totalFees: number;
  feePercentage: number;
}

interface DeliveryEstimate {
  method: string;
  estimatedTime: string;
  minHours: number;
  maxHours: number;
  available: boolean;
}

interface FormData {
  recipient: string;
  recipientType: "phone" | "email" | "bank";
  recipientName: string;
  amount: string;
  currency: AccountCurrency;
  destinationCurrency: AccountCurrency;
  destination: string;
  pin: string;
  note: string;
  deliveryMethod: string;
  bankCode?: string;
}

// Constants
const SUPPORTED_CURRENCIES = {
  source: [
    AccountCurrency.GBP,
    AccountCurrency.USD,
    AccountCurrency.EUR,
    AccountCurrency.NGN,
    AccountCurrency.GHS,
    AccountCurrency.JPY,
    AccountCurrency.AUD,
  ],
  destination: [
    AccountCurrency.NGN,
    AccountCurrency.GHS,
    AccountCurrency.USD,
    AccountCurrency.GBP,
    AccountCurrency.EUR,
    AccountCurrency.JPY,
    AccountCurrency.AUD,
  ],
};

const CURRENCY_FLAGS: Record<string, string> = {
  GBP: "🇬🇧",
  USD: "🇺🇸",
  EUR: "🇪🇺",
  NGN: "🇳🇬",
  GHS: "🇬🇭",
  JPY: "🇯🇵",
  AUD: "🇦🇺",
  KES: "🇰🇪",
  ZAR: "🇿🇦",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  NGN: "₦",
  GHS: "₵",
  JPY: "¥",
  AUD: "A$",
  KES: "KSh",
  ZAR: "R",
};

const FEE_STRUCTURE: Record<
  string,
  { fixed: number; percentage: number; margin: number }
> = {
  "GBP-NGN": { fixed: 0.99, percentage: 0.5, margin: 0.3 },
  "USD-NGN": { fixed: 2.99, percentage: 0.5, margin: 0.4 },
  "EUR-NGN": { fixed: 1.99, percentage: 0.5, margin: 0.35 },
  "NGN-GHS": { fixed: 100, percentage: 1.0, margin: 0.5 },
  "NGN-KES": { fixed: 150, percentage: 1.0, margin: 0.5 },
  default: { fixed: 50, percentage: 1.5, margin: 0.5 },
};

const DELIVERY_METHODS: Record<string, DeliveryEstimate[]> = {
  NGN: [
    {
      method: "bank_transfer",
      estimatedTime: "Instant - 30 mins",
      minHours: 0,
      maxHours: 0.5,
      available: true,
    },
    {
      method: "mobile_money",
      estimatedTime: "Instant",
      minHours: 0,
      maxHours: 0.1,
      available: true,
    },
    {
      method: "cash_pickup",
      estimatedTime: "1 - 4 hours",
      minHours: 1,
      maxHours: 4,
      available: true,
    },
  ],
  GHS: [
    {
      method: "bank_transfer",
      estimatedTime: "1 - 2 hours",
      minHours: 1,
      maxHours: 2,
      available: true,
    },
    {
      method: "mobile_money",
      estimatedTime: "Instant - 30 mins",
      minHours: 0,
      maxHours: 0.5,
      available: true,
    },
    {
      method: "cash_pickup",
      estimatedTime: "2 - 6 hours",
      minHours: 2,
      maxHours: 6,
      available: true,
    },
  ],
  KES: [
    {
      method: "bank_transfer",
      estimatedTime: "1 - 3 hours",
      minHours: 1,
      maxHours: 3,
      available: true,
    },
    {
      method: "mobile_money",
      estimatedTime: "Instant",
      minHours: 0,
      maxHours: 0.1,
      available: true,
    },
    {
      method: "cash_pickup",
      estimatedTime: "4 - 8 hours",
      minHours: 4,
      maxHours: 8,
      available: false,
    },
  ],
  default: [
    {
      method: "bank_transfer",
      estimatedTime: "1 - 2 business days",
      minHours: 24,
      maxHours: 48,
      available: true,
    },
  ],
};

const BPMGD_BANK: Bank = {
  logo: "",
  tenant_id: "bpmgd",
  created_at: "",
  status: "active",
  updated_at: "",
  code: 999999,
  ledger_id: "",
  deleted_at: null,
  name: "bpmgd",
};

const ensureBpmgdBank = (bankList: Bank[]): Bank[] => {
  const exists = bankList.some(
    (bank) =>
      bank.name?.toLowerCase() === "bpmgd" ||
      bank.tenant_id?.toLowerCase() === "bpmgd",
  );

  if (exists) return bankList;
  return [...bankList, BPMGD_BANK];
};

const SendMoney: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOnline = useIsOnline();
  const pendingCount = usePendingCount();
  const { addPendingTransaction, cacheData, getCachedData } = useOfflineStore();

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({
    recipient: "",
    recipientType: "phone",
    recipientName: "",
    amount: "",
    currency: AccountCurrency.GBP,
    destinationCurrency: AccountCurrency.NGN,
    destination: "",
    pin: "",
    note: "",
    deliveryMethod: "bank_transfer",
  });

  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [sourceAccounts, setSourceAccounts] = useState<Account[]>([]);
  const [isLoadingSourceAccounts, setIsLoadingSourceAccounts] = useState(false);
  const [sourceAccountLoadError, setSourceAccountLoadError] = useState<
    string | null
  >(null);
  const [selectedSourceAccountId, setSelectedSourceAccountId] = useState("");

  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [rateLock, setRateLock] = useState<RateLock | null>(null);
  const [rateRefreshCountdown, setRateRefreshCountdown] = useState(30);
  const [showRateHistory, setShowRateHistory] = useState(false);
  const [rateHistory, setRateHistory] = useState<
    { date: string; rate: number }[]
  >([]);
  const [isRecipientValidated, setIsRecipientValidated] = useState(false);

  // Load bank directory for bank transfers
  useEffect(() => {
    const loadBanks = async () => {
      setIsLoadingBanks(true);
      setBankLoadError(null);
      try {
        const res = await bankService.getBanks();
        setBanks(ensureBpmgdBank(res.data.banks || []));
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Failed to load banks", error);
        }
        setBankLoadError("Failed to load banks");
        setBanks(ensureBpmgdBank([]));
      } finally {
        setIsLoadingBanks(false);
      }
    };

    loadBanks();
  }, []);

  // Load user's source accounts for transfer selection
  useEffect(() => {
    const loadSourceAccounts = async () => {
      setIsLoadingSourceAccounts(true);
      setSourceAccountLoadError(null);
      try {
        const accounts = await accountService.getAccounts();
        const eligible = accounts.filter(
          (acc) =>
            acc.status === AccountStatus.ACTIVE &&
            [
              AccountType.PRIMARY,
              AccountType.SAVINGS,
              AccountType.CURRENT,
              AccountType.MINT,
            ].includes(acc.account_type),
        );

        setSourceAccounts(eligible);

        if (eligible.length > 0) {
          const preferred =
            eligible.find((acc) => acc.account_type === AccountType.PRIMARY) ||
            eligible[0];

          setSelectedSourceAccountId(preferred.account_number);
          setFormData((prev) => ({
            ...prev,
            currency: preferred.account_currency,
          }));
        } else {
          setSourceAccountLoadError("No active source accounts available.");
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Failed to load source accounts", error);
        }
        setSourceAccountLoadError("Failed to load source accounts");
      } finally {
        setIsLoadingSourceAccounts(false);
      }
    };

    loadSourceAccounts();
  }, []);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateWarning, setRateWarning] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isValidatingRecipient, setIsValidatingRecipient] = useState(false);
  const [lastValidatedRecipient, setLastValidatedRecipient] = useState<{
    accountNumber: string;
    bankCode: string;
  } | null>(null);

  const deliveryEstimates = useMemo(() => {
    return (
      DELIVERY_METHODS[formData.destinationCurrency] || DELIVERY_METHODS.default
    );
  }, [formData.destinationCurrency]);

  const feeBreakdown = useMemo((): FeeBreakdown | null => {
    const amount = parseFloat(formData.amount) || 0;
    if (amount <= 0) return null;
    const corridor = `${formData.currency}-${formData.destinationCurrency}`;
    const fees = FEE_STRUCTURE[corridor] || FEE_STRUCTURE.default;
    const transferFee = fees.fixed + (amount * fees.percentage) / 100;
    const exchangeMargin = (amount * fees.margin) / 100;
    const networkFee = formData.deliveryMethod === "cash_pickup" ? 2.0 : 0;
    const totalFees = transferFee + networkFee;
    return {
      transferFee: parseFloat(transferFee.toFixed(2)),
      exchangeMargin: parseFloat(exchangeMargin.toFixed(2)),
      networkFee: parseFloat(networkFee.toFixed(2)),
      totalFees: parseFloat(totalFees.toFixed(2)),
      feePercentage: parseFloat(((totalFees / amount) * 100).toFixed(2)),
    };
  }, [
    formData.amount,
    formData.currency,
    formData.destinationCurrency,
    formData.deliveryMethod,
  ]);

  const receivedAmount = useMemo(() => {
    const amount = parseFloat(formData.amount) || 0;
    const rate = rateLock?.rate || exchangeRate?.rate || 0;
    // Without a live or cached rate there is no honest estimate to show.
    if (rate <= 0) return null;
    return (amount / rate).toFixed(2);
  }, [formData.amount, rateLock, exchangeRate]);

  const selectedSourceAccount = useMemo(
    () =>
      sourceAccounts.find(
        (account) => account.account_number === selectedSourceAccountId,
      ) || null,
    [sourceAccounts, selectedSourceAccountId],
  );

  const fetchExchangeRate = useCallback(async () => {
    if (rateLock) return;
    setIsLoadingRate(true);
    setError(null);
    setRateWarning(null);
    const cacheKey = `rate_${formData.currency}_${formData.destinationCurrency}`;

    try {
      const res = await exchangeRateService.getRate(
        formData.currency,
        formData.destinationCurrency,
      );
      const data = res.data as unknown as ExchangeRate;
      setExchangeRate(data);
      cacheData(cacheKey, data, 5);
      setRateRefreshCountdown(30);
    } catch {
      const cached = getCachedData<ExchangeRate>(cacheKey);
      if (cached) {
        setExchangeRate(cached);
        setRateWarning(
          isOnline
            ? "Live rates are unavailable. Showing the most recent cached rate."
            : "You are offline. Showing the most recent cached rate.",
        );
      } else {
        // No fabricated fallback rate: surface the real unavailability and
        // let the UI block rate-dependent actions until a live quote loads.
        setExchangeRate(null);
        setRateWarning(
          isOnline
            ? "Live exchange rate unavailable. Please retry in a moment."
            : "You are offline. No cached rate is available for this currency pair.",
        );
      }
    } finally {
      setIsLoadingRate(false);
      setRateRefreshCountdown(30);
    }
  }, [
    formData.currency,
    formData.destinationCurrency,
    rateLock,
    isOnline,
    getCachedData,
    cacheData,
  ]);

  const fetchRateHistory = useCallback(async () => {
    try {
      const res = await exchangeRateService.getHistory(
        formData.currency,
        formData.destinationCurrency,
        7,
      );
      const data = res.data as { date: string; rate: number }[];
      setRateHistory(data.map((h) => ({ date: h.date, rate: h.rate })));
    } catch {
      // Do not fabricate rate history with random data — show empty state
      setRateHistory([]);
    }
  }, [formData.currency, formData.destinationCurrency]);

  const handleLockRate = async () => {
    if (!exchangeRate) return;
    try {
      const res = await exchangeRateService.lockRate(
        formData.currency,
        formData.destinationCurrency,
        parseFloat(formData.amount) || 0,
      );
      setRateLock(res.data as unknown as RateLock);
    } catch (err) {
      // A rate lock is a financial guarantee — never fabricate one locally.
      setError(
        err instanceof Error
          ? `Unable to lock this rate: ${err.message}`
          : "Unable to lock this rate. Please try again.",
      );
    }
  };

  const handleUnlockRate = async () => {
    if (rateLock) {
      try {
        await exchangeRateService.unlockRate(rateLock.id);
      } catch {
        // Best-effort: server-side locks expire on their own.
      }
    }
    setRateLock(null);
    fetchExchangeRate();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      // If recipient hasn't been validated yet, validate them first
      if (!isRecipientValidated) {
        // For bank transfers, validate the recipient account against the selected bank
        if (formData.recipientType === "bank") {
          if (!formData.bankCode) {
            setError("Please select a bank for the recipient account.");
            return;
          }

          if (!isOnline) {
            setError(
              "Please connect to the internet to validate the recipient bank account.",
            );
            return;
          }

          const selectedBank = banks.find(
            (b) => String(b.code) === String(formData.bankCode),
          );

          if (!selectedBank) {
            setError(
              "Selected bank is invalid. Please choose a different bank.",
            );
            return;
          }

          try {
            setIsValidatingRecipient(true);
            setError(null);
            const account = await accountService.validateRecipientAccount(
              formData.recipient,
              // Backend expects x-tenant-id to be the name of the bank
              selectedBank.name,
            );

            setFormData((prev) => ({
              ...prev,
              // Always use the verified account name from the core banking endpoint
              recipientName: account.name,
              // Capture the recipient's actual account currency (not user-selected)
              destinationCurrency: account.account_currency,
            }));

            // Mark validation complete but don't advance yet—let user review on this step
            setIsRecipientValidated(true);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not validate recipient account. Please check the account number and try again.",
            );
          } finally {
            setIsValidatingRecipient(false);
          }
        } else {
          // For phone/email recipients, set destination currency to sender currency by default
          // (since we don't validate them, we can't know their actual currency)
          setFormData((prev) => ({
            ...prev,
            destinationCurrency: prev.currency,
          }));
          setIsRecipientValidated(true);
        }
        return;
      }

      // Recipient already validated; now advance to step 2 (amount)
      setStep(2);
      setIsRecipientValidated(false);
      return;
    }

    if (step === 2) {
      setStep(3);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const senderName =
      `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
      user?.email ||
      "Sender";

    // Use user-selected source account first, then fallback to primary account
    let sourceAccountId: string | undefined = selectedSourceAccountId;
    if (!sourceAccountId) {
      try {
        const primaryAccount = await accountService.getPrimaryAccount(
          formData.currency,
        );
        if (primaryAccount?.account_number) {
          sourceAccountId = primaryAccount.account_number;
        }
      } catch {
        // Lookup failed — handled by the guard below.
      }
    }

    if (!sourceAccountId) {
      // Never fall back to a hardcoded or unrelated account identifier for
      // a money movement — require a real core-banking source account.
      setError(
        "No source account is available for this currency. Please add or activate an account before sending money.",
      );
      setIsSubmitting(false);
      setFormData((prev) => ({ ...prev, pin: "" }));
      return;
    }

    const transferData = {
      recipientType: formData.recipientType,
      recipient: formData.recipient,
      recipientName: formData.recipientName,
      amount: parseFloat(formData.amount),
      currency: formData.currency,
      destinationCurrency: formData.destinationCurrency,
      note: formData.note,
      deliveryMethod: formData.deliveryMethod,
      rateLockId: rateLock?.id,
      // Guaranteed present by the guard above.
      sourceAccountId,
      senderName,
      switchName: "mojaloop",
      destination: formData.destination,
      pin: formData.pin,
    };

    try {
      if (!isOnline) {
        const txnId = addPendingTransaction({
          type: "transfer",
          data: transferData,
        });
        setSuccessMessage(
          `Transfer queued for processing. Reference: ${txnId}`,
        );
        setTimeout(() => navigate("/transactions"), 2000);
        return;
      }

      const res = await transactionService.transfer(transferData);
      setSuccessMessage(
        `Transfer initiated successfully! Reference: ${res.data?.reference || "N/A"}`,
      );
      setTimeout(() => navigate("/transactions"), 2000);
    } catch (err) {
      if (!isOnline || (err instanceof Error && err.name === "AbortError")) {
        const txnId = addPendingTransaction({
          type: "transfer",
          data: transferData,
        });
        setSuccessMessage(
          `You're offline. Transfer queued. Reference: ${txnId}`,
        );
        setTimeout(() => navigate("/transactions"), 2000);
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to process transfer",
        );
      }
    } finally {
      setIsSubmitting(false);
      setFormData((prev) => ({ ...prev, pin: "" }));
    }
  };

  useEffect(() => {
    fetchExchangeRate();
  }, [fetchExchangeRate]);
  useEffect(() => {
    if (showRateHistory) fetchRateHistory();
  }, [showRateHistory, fetchRateHistory]);

  useEffect(() => {
    if (rateLock) return;
    const interval = setInterval(() => {
      setRateRefreshCountdown((prev) => {
        if (prev <= 1) {
          fetchExchangeRate();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLock, fetchExchangeRate]);

  useEffect(() => {
    if (!rateLock) return;
    const interval = setInterval(() => {
      const expiresAt = new Date(rateLock.expiresAt).getTime();
      const remaining = Math.max(
        0,
        Math.floor((expiresAt - Date.now()) / 1000),
      );
      if (remaining <= 0) {
        setRateLock(null);
        fetchExchangeRate();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLock, fetchExchangeRate]);

  // Automatically validate bank recipient when account number and bank are set
  useEffect(() => {
    if (formData.recipientType !== "bank") return;
    if (!formData.bankCode || formData.recipient.length < 5) return;
    if (!isOnline) return;

    const current = {
      accountNumber: formData.recipient,
      bankCode: formData.bankCode,
    };

    if (
      lastValidatedRecipient &&
      lastValidatedRecipient.accountNumber === current.accountNumber &&
      lastValidatedRecipient.bankCode === current.bankCode
    ) {
      return;
    }

    let cancelled = false;

    const runValidation = async () => {
      const selectedBank = banks.find(
        (b) => String(b.code) === String(formData.bankCode),
      );

      if (!selectedBank) return;

      try {
        setIsValidatingRecipient(true);
        setError(null);
        const account = await accountService.validateRecipientAccount(
          current.accountNumber,
          selectedBank.name,
        );

        if (cancelled) return;

        setFormData((prev) => ({
          ...prev,
          recipientName: account.name,
        }));
        setLastValidatedRecipient(current);
      } catch (err) {
        if (cancelled) return;

        setError(
          err instanceof Error
            ? err.message
            : "Could not validate recipient account. Please check the account number and try again.",
        );
        setLastValidatedRecipient(null);
        setFormData((prev) => ({
          ...prev,
          recipientName: "",
        }));
      } finally {
        if (!cancelled) {
          setIsValidatingRecipient(false);
        }
      }
    };

    const timeoutId = setTimeout(() => {
      void runValidation();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    formData.recipientType,
    formData.recipient,
    formData.bankCode,
    isOnline,
    banks,
    lastValidatedRecipient,
  ]);

  // Auto-fill destination with bank name when on step 3 with bank transfer
  useEffect(() => {
    if (step !== 3 || formData.recipientType !== "bank") return;

    const selectedBank = banks.find(
      (b) => String(b.code) === String(formData.bankCode),
    );
    if (selectedBank && formData.destination !== selectedBank.name) {
      setFormData((prev) => ({
        ...prev,
        destination: selectedBank.name,
      }));
    }
  }, [step, formData.recipientType, formData.bankCode, banks]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Reset recipient validation if user changes recipient details
    if (["recipient", "recipientType", "bankCode"].includes(name)) {
      setIsRecipientValidated(false);
    }

    if ((name === "currency" || name === "destinationCurrency") && rateLock)
      handleUnlockRate();
  };

  const handleSourceAccountChange = (accountNumber: string) => {
    setSelectedSourceAccountId(accountNumber);
    const selectedAccount = sourceAccounts.find(
      (account) => account.account_number === accountNumber,
    );

    if (selectedAccount) {
      setFormData((prev) => ({
        ...prev,
        currency: selectedAccount.account_currency,
      }));
      if (rateLock) {
        void handleUnlockRate();
      }
    }
  };

  const formatTimeRemaining = (expiresAt: string) => {
    const remaining = Math.max(
      0,
      Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
    );
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getDeliveryMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      bank_transfer: "Bank Transfer",
      mobile_money: "Mobile Money",
      cash_pickup: "Cash Pickup",
    };
    return labels[method] || method;
  };

  const getDeliveryMethodIcon = (method: string) => {
    const icons: Record<string, string> = {
      bank_transfer: "🏦",
      mobile_money: "📱",
      cash_pickup: "💵",
    };
    return icons[method] || "💳";
  };

  const isStepValid = (stepNum: number): boolean => {
    switch (stepNum) {
      case 1:
        if (formData.recipientType === "bank") {
          // For bank transfers, only require a plausible account number and bank selection;
          // the recipient name will be fetched from the validation endpoint.
          return formData.recipient.length >= 5 && !!formData.bankCode;
        }
        return (
          formData.recipientName.length >= 2 && formData.recipient.length >= 5
        );
      case 2:
        return (
          parseFloat(formData.amount) > 0 &&
          !!exchangeRate &&
          !!selectedSourceAccountId
        );
      case 3:
        return (
          formData.destination.trim().length >= 2 &&
          /^\d{4,6}$/.test(formData.pin)
        );
      default:
        return false;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Send Money</h1>
        {!isOnline && (
          <div className="flex items-center px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm">
            <span className="w-2 h-2 bg-amber-500 rounded-full mr-2 animate-pulse" />
            Offline Mode
          </div>
        )}
      </div>

      {pendingCount > 0 && (
        <div className="bg-indigo-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center mr-3">
              <span className="text-indigo-600 font-semibold">
                {pendingCount}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-blue-900">
                Pending Transactions
              </p>
              <p className="text-xs text-indigo-700">
                Will sync when you're back online
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate("/transactions?filter=pending")}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            View
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        {["Recipient", "Amount", "Confirm"].map((label, i) => (
          <div key={label} className="flex items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                step > i + 1
                  ? "bg-emerald-500 text-white"
                  : step === i + 1
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "bg-slate-200 text-slate-600"
              }`}
            >
              {step > i + 1 ? (
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`ml-2 text-sm hidden sm:block ${step === i + 1 ? "text-indigo-600 font-medium" : "text-slate-500"}`}
            >
              {label}
            </span>
            {i < 2 && (
              <div
                className={`w-8 sm:w-16 h-0.5 mx-2 sm:mx-4 ${step > i + 1 ? "bg-emerald-500" : "bg-slate-200"}`}
              />
            )}
          </div>
        ))}
      </div>

      {rateWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start mt-4">
          <svg
            className="w-5 h-5 text-amber-500 mr-3 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M4.93 19h14.14L12 5 4.93 19z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800">{rateWarning}</p>
            <button
              onClick={() => setRateWarning(null)}
              className="text-xs text-amber-700 hover:text-amber-900 mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start">
          <svg
            className="w-5 h-5 text-red-500 mr-3 mt-0.5"
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
          <div>
            <p className="text-sm font-medium text-red-800">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-xs text-red-600 hover:text-red-800 mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start">
          <svg
            className="w-5 h-5 text-emerald-500 mr-3 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm font-medium text-emerald-700">
            {successMessage}
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6"
      >
        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Who are you sending to?
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {(["phone", "email", "bank"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      recipientType: type,
                      // For bank transfers, always use name from validation
                      ...(type === "bank" ? { recipientName: "" } : {}),
                    }))
                  }
                  className={`p-4 rounded-xl border-2 transition-all ${formData.recipientType === type ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-200"}`}
                >
                  <div className="text-2xl mb-2">
                    {type === "phone" ? "📱" : type === "email" ? "📧" : "🏦"}
                  </div>
                  <div
                    className={`text-sm font-medium ${formData.recipientType === type ? "text-indigo-700" : "text-slate-700"}`}
                  >
                    {type === "phone"
                      ? "Phone"
                      : type === "email"
                        ? "Email"
                        : "Bank"}
                  </div>
                </button>
              ))}
            </div>
            {formData.recipientType !== "bank" ? (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Recipient Name
                </label>
                <input
                  type="text"
                  name="recipientName"
                  value={formData.recipientName}
                  onChange={handleChange}
                  placeholder="Enter recipient's full name"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 focus:outline-none transition-all"
                  required
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Recipient Name
                </label>
                <div className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-700">
                  {formData.recipientName ||
                    "Will be filled automatically after validating the account number"}
                </div>
                {isValidatingRecipient && (
                  <div className="mt-1 text-xs text-slate-500 flex items-center">
                    <span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2" />
                    Validating account...
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {formData.recipientType === "phone"
                  ? "Phone Number"
                  : formData.recipientType === "email"
                    ? "Email Address"
                    : "Account Number"}
              </label>
              <input
                type={formData.recipientType === "email" ? "email" : "text"}
                name="recipient"
                value={formData.recipient}
                onChange={handleChange}
                placeholder={
                  formData.recipientType === "phone"
                    ? "+234 XXX XXX XXXX"
                    : formData.recipientType === "email"
                      ? "recipient@email.com"
                      : "0123456789"
                }
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 focus:outline-none transition-all"
                required
              />
            </div>
            {formData.recipientType === "bank" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Bank
                </label>
                <select
                  name="bankCode"
                  value={formData.bankCode || ""}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 focus:outline-none transition-all"
                  required
                >
                  <option value="">
                    {isLoadingBanks
                      ? "Loading banks..."
                      : bankLoadError
                        ? "Failed to load banks"
                        : "Select a bank"}
                  </option>
                  {banks.map((bank) => (
                    <option key={bank.code} value={String(bank.code)}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Send From Account
              </label>
              <select
                value={selectedSourceAccountId}
                onChange={(e) => handleSourceAccountChange(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 focus:outline-none transition-all"
                required
              >
                <option value="">
                  {isLoadingSourceAccounts
                    ? "Loading source accounts..."
                    : sourceAccountLoadError
                      ? sourceAccountLoadError
                      : "Select source account"}
                </option>
                {sourceAccounts.map((account) => (
                  <option
                    key={account.account_number}
                    value={account.account_number}
                  >
                    {account.name} • {account.account_number} •{" "}
                    {account.account_currency}
                  </option>
                ))}
              </select>
              {selectedSourceAccount && (
                <p className="text-xs text-slate-500 mt-1">
                  Source currency: {selectedSourceAccount.account_currency}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Transfer request currency follows the selected source account.
              </p>
            </div>
            {isRecipientValidated && (
              <div className="bg-green-50 rounded-xl p-3 border border-green-200 flex items-center text-sm text-green-700">
                <svg
                  className="w-5 h-5 mr-2 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Recipient account validated</span>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Recipient receives
              </label>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-sm text-slate-700 flex items-center">
                <span className="text-2xl mr-3">
                  {CURRENCY_FLAGS[formData.destinationCurrency]}
                </span>
                <span className="font-semibold">
                  {formData.destinationCurrency}
                </span>
                <span className="ml-auto text-xs text-slate-500">
                  Recipient's account currency
                </span>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-900">
              How much are you sending?
            </h2>
            {selectedSourceAccount && (
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-sm text-slate-700">
                Sending from: {selectedSourceAccount.name} •{" "}
                {selectedSourceAccount.account_number} •{" "}
                {selectedSourceAccount.account_currency}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  You send
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-medium">
                    {CURRENCY_SYMBOLS[formData.currency]}
                  </span>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleChange}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full pl-10 pr-20 py-4 text-xl font-semibold border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 bg-slate-100 border-0 rounded-md px-2 py-1 text-sm font-medium text-slate-700">
                    {CURRENCY_FLAGS[formData.currency]} {formData.currency}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  They receive
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-medium">
                    {CURRENCY_SYMBOLS[formData.destinationCurrency]}
                  </span>
                  <input
                    type="text"
                    value={receivedAmount ?? ""}
                    placeholder={receivedAmount === null ? "Rate unavailable" : undefined}
                    readOnly
                    className="w-full pl-10 pr-20 py-4 text-xl font-semibold bg-slate-50 border border-slate-200 rounded-xl"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-600">
                    {CURRENCY_FLAGS[formData.destinationCurrency]}{" "}
                    {formData.destinationCurrency}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <span className="text-sm font-medium text-slate-700">
                    Exchange Rate
                  </span>
                  {isLoadingRate && (
                    <div className="ml-2 w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  {rateLock ? (
                    <div className="flex items-center px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm">
                      <svg
                        className="w-4 h-4 mr-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                      Locked for {formatTimeRemaining(rateLock.expiresAt)}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Refreshes in {rateRefreshCountdown}s
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    1 {formData.destinationCurrency} ={" "}
                    {exchangeRate?.rate.toFixed(4) || "---"} {formData.currency}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Mid-market rate:{" "}
                    {exchangeRate?.rate
                      ? (exchangeRate.rate * 1.003).toFixed(4)
                      : "---"}
                  </div>
                </div>
                <div className="flex space-x-2">
                  {rateLock ? (
                    <button
                      type="button"
                      onClick={handleUnlockRate}
                      className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-xl hover:bg-red-100"
                    >
                      Unlock
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleLockRate}
                      disabled={!exchangeRate || isLoadingRate}
                      className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-100 rounded-xl hover:bg-blue-200 disabled:opacity-50"
                    >
                      Lock Rate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowRateHistory(!showRateHistory)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white rounded-xl hover:bg-slate-50 border border-slate-200"
                  >
                    {showRateHistory ? "Hide" : "History"}
                  </button>
                </div>
              </div>
              {showRateHistory && rateHistory.length > 0 && (
                <div className="mt-4 pt-4 border-t border-blue-200">
                  <div className="text-sm font-medium text-slate-700 mb-2">
                    7-Day Rate History
                  </div>
                  <div className="flex items-end space-x-1 h-16">
                    {rateHistory.map((h, i) => {
                      const max = Math.max(...rateHistory.map((r) => r.rate));
                      const min = Math.min(...rateHistory.map((r) => r.rate));
                      const height = ((h.rate - min) / (max - min || 1)) * 100;
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-blue-400 rounded-t hover:bg-indigo-500"
                          style={{ height: `${Math.max(20, height)}%` }}
                          title={`${h.date}: ${h.rate.toFixed(4)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {feeBreakdown && (
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <div className="text-sm font-medium text-slate-700 mb-3">
                  Fee Breakdown
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Transfer fee</span>
                    <span className="font-medium">
                      {CURRENCY_SYMBOLS[formData.currency]}
                      {feeBreakdown.transferFee.toFixed(2)}
                    </span>
                  </div>
                  {feeBreakdown.networkFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Cash pickup fee</span>
                      <span className="font-medium">
                        {CURRENCY_SYMBOLS[formData.currency]}
                        {feeBreakdown.networkFee.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Exchange margin (included)</span>
                    <span>
                      {CURRENCY_SYMBOLS[formData.currency]}
                      {feeBreakdown.exchangeMargin.toFixed(2)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between">
                    <span className="font-medium text-slate-900">
                      Total fees
                    </span>
                    <span className="font-bold text-slate-900">
                      {CURRENCY_SYMBOLS[formData.currency]}
                      {feeBreakdown.totalFees.toFixed(2)}{" "}
                      <span className="text-xs text-slate-500">
                        ({feeBreakdown.feePercentage}%)
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Delivery Method
              </label>
              <div className="space-y-2">
                {deliveryEstimates.map((estimate) => (
                  <label
                    key={estimate.method}
                    className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      formData.deliveryMethod === estimate.method
                        ? "border-indigo-500 bg-indigo-50"
                        : estimate.available
                          ? "border-slate-200 hover:border-slate-200"
                          : "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <input
                      type="radio"
                      name="deliveryMethod"
                      value={estimate.method}
                      checked={formData.deliveryMethod === estimate.method}
                      onChange={handleChange}
                      disabled={!estimate.available}
                      className="sr-only"
                    />
                    <span className="text-2xl mr-4">
                      {getDeliveryMethodIcon(estimate.method)}
                    </span>
                    <div className="flex-1">
                      <div className="font-medium text-slate-900">
                        {getDeliveryMethodLabel(estimate.method)}
                      </div>
                      <div className="text-sm text-slate-500">
                        {estimate.estimatedTime}
                      </div>
                    </div>
                    {formData.deliveryMethod === estimate.method && (
                      <svg
                        className="w-5 h-5 text-indigo-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    {!estimate.available && (
                      <span className="text-xs text-slate-400">
                        Unavailable
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Note (optional)
              </label>
              <textarea
                name="note"
                value={formData.note}
                onChange={handleChange}
                placeholder="Add a message for the recipient"
                rows={2}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Confirm Transfer
            </h2>
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white">
              <div className="text-center mb-6">
                <div className="text-sm opacity-80 mb-1">You're sending</div>
                <div className="text-4xl font-bold">
                  {CURRENCY_SYMBOLS[formData.currency]}
                  {parseFloat(formData.amount).toLocaleString()}
                </div>
                <div className="text-sm opacity-80 mt-1">
                  {formData.currency}
                </div>
              </div>
              <div className="flex items-center justify-center mb-6">
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
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
                      d="M19 14l-7 7m0 0l-7-7m7 7V3"
                    />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm opacity-80 mb-1">
                  {formData.recipientName} receives
                </div>
                <div className="text-4xl font-bold">
                  {receivedAmount !== null ? (
                    <>
                      {CURRENCY_SYMBOLS[formData.destinationCurrency]}
                      {parseFloat(receivedAmount).toLocaleString()}
                    </>
                  ) : (
                    <span className="text-lg font-medium">Rate unavailable</span>
                  )}
                </div>
                <div className="text-sm opacity-80 mt-1">
                  {formData.destinationCurrency}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-600">Recipient</span>
                <span className="font-medium text-slate-900">
                  {formData.recipientName}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-600">
                  {formData.recipientType === "phone"
                    ? "Phone"
                    : formData.recipientType === "email"
                      ? "Email"
                      : "Account"}
                </span>
                <span className="font-medium text-slate-900">
                  {formData.recipient}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-600">Exchange Rate</span>
                <span className="font-medium text-slate-900">
                  {(rateLock?.rate || exchangeRate?.rate) ? (
                    <>
                      1 {formData.destinationCurrency} ={" "}
                      {(rateLock?.rate || exchangeRate?.rate || 0).toFixed(4)}{" "}
                      {formData.currency}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                  {rateLock && (
                    <span className="ml-1 text-emerald-600 text-xs">
                      (Locked)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-600">Source Account</span>
                <span className="font-medium text-slate-900 text-right max-w-[220px]">
                  {selectedSourceAccount?.account_number || "N/A"} (
                  {selectedSourceAccount?.account_currency || formData.currency}
                  )
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-600">Delivery Method</span>
                <span className="font-medium text-slate-900">
                  {getDeliveryMethodLabel(formData.deliveryMethod)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-600">Estimated Delivery</span>
                <span className="font-medium text-slate-900">
                  {
                    deliveryEstimates.find(
                      (e) => e.method === formData.deliveryMethod,
                    )?.estimatedTime
                  }
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-600">Total Fees</span>
                <span className="font-medium text-slate-900">
                  {CURRENCY_SYMBOLS[formData.currency]}
                  {feeBreakdown?.totalFees.toFixed(2) || "0.00"}
                </span>
              </div>
              {formData.note && (
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">Note</span>
                  <span className="font-medium text-slate-900 text-right max-w-[200px]">
                    {formData.note}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Destination
                </label>
                {formData.recipientType === "bank" ? (
                  <div className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-700">
                    {formData.destination || "Bank name will appear here"}
                  </div>
                ) : (
                  <input
                    type="text"
                    name="destination"
                    value={formData.destination}
                    onChange={handleChange}
                    placeholder="Enter destination"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Transaction PIN
                </label>
                <input
                  type="password"
                  name="pin"
                  value={formData.pin}
                  onChange={handleChange}
                  placeholder="Enter 4-6 digit PIN"
                  inputMode="numeric"
                  // pattern="\\d{4,6}"
                  maxLength={6}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
            </div>

            <div className="bg-indigo-50 rounded-xl p-4 flex justify-between items-center">
              <span className="text-lg font-medium text-slate-900">
                Total to Pay
              </span>
              <span className="text-2xl font-bold text-indigo-600">
                {CURRENCY_SYMBOLS[formData.currency]}
                {(
                  parseFloat(formData.amount) + (feeBreakdown?.totalFees || 0)
                ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>

            {!isOnline && (
              <div className="bg-amber-50 border border-yellow-200 rounded-xl p-4 flex items-start">
                <svg
                  className="w-5 h-5 text-amber-500 mr-3 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-700">
                    You're currently offline
                  </p>
                  <p className="text-xs text-yellow-700 mt-1">
                    This transfer will be queued and processed automatically
                    when you're back online.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-6 py-3 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-6 py-3 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={
              !isStepValid(step) || isSubmitting || isValidatingRecipient
            }
            className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Processing...
              </>
            ) : step === 3 ? (
              <>
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
                Send {CURRENCY_SYMBOLS[formData.currency]}
                {parseFloat(formData.amount || "0").toLocaleString()}
              </>
            ) : (
              "Continue"
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SendMoney;
