import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOfflineStore, useIsOnline } from '../stores/offlineStore';
import { billPaymentService } from '../services/api';

interface RecentBillPayment {
  id: string;
  provider?: string;
  category?: string;
  amount: number;
  createdAt?: string;
  date?: string;
  description?: string;
  reference?: string;
}

interface BillerItem {
  id: string;
  name: string;
}

const BillPayment: React.FC = () => {
  const navigate = useNavigate();
  const isOnline = useIsOnline();
  const { addPendingTransaction } = useOfflineStore();

  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [isValidatingCustomer, setIsValidatingCustomer] = useState(false);
  const [recentPayments, setRecentPayments] = useState<RecentBillPayment[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [dynamicProviders, setDynamicProviders] = useState<Record<string, BillerItem[]>>({});
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);

  const categories = [
    { id: 'electricity', name: 'Electricity', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { id: 'water', name: 'Water', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707' },
    { id: 'internet', name: 'Internet', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9' },
    { id: 'cable', name: 'Cable TV', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
    { id: 'education', name: 'Education', icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z' },
    { id: 'insurance', name: 'Insurance', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  ];

  const catColors: Record<string, string> = {
    electricity: 'bg-amber-50 text-amber-600', water: 'bg-blue-50 text-blue-600',
    internet: 'bg-violet-50 text-violet-600', cable: 'bg-rose-50 text-rose-600',
    education: 'bg-emerald-50 text-emerald-600', insurance: 'bg-indigo-50 text-indigo-600',
  };

  // Fallback static providers if API is unavailable
  const staticProviders: Record<string, BillerItem[]> = {
    electricity: [{ id: 'ikedc', name: 'IKEDC (Ikeja Electric)' }, { id: 'ekedc', name: 'EKEDC (Eko Electric)' }, { id: 'aedc', name: 'AEDC (Abuja Electric)' }, { id: 'phedc', name: 'PHEDC (Port Harcourt)' }],
    water: [{ id: 'lagos-water', name: 'Lagos Water Corporation' }, { id: 'fcta-water', name: 'FCTA Water Board' }],
    internet: [{ id: 'spectranet', name: 'Spectranet' }, { id: 'smile', name: 'Smile' }, { id: 'swift', name: 'Swift Networks' }],
    cable: [{ id: 'dstv', name: 'DSTV' }, { id: 'gotv', name: 'GOtv' }, { id: 'startimes', name: 'StarTimes' }],
    education: [{ id: 'waec', name: 'WAEC' }, { id: 'jamb', name: 'JAMB' }, { id: 'neco', name: 'NECO' }],
    insurance: [{ id: 'aiico', name: 'AIICO Insurance' }, { id: 'leadway', name: 'Leadway Assurance' }],
  };

  const getProviders = (category: string): BillerItem[] => {
    return dynamicProviders[category] || staticProviders[category] || [];
  };

  // Fetch billers for the selected category from the API
  const fetchBillers = useCallback(async (category: string) => {
    if (!category) return;
    setIsLoadingProviders(true);
    try {
      const res = await billPaymentService.getBillers(category);
      const data = res.data as BillerItem[];
      if (Array.isArray(data) && data.length > 0) {
        setDynamicProviders(prev => ({ ...prev, [category]: data }));
      }
    } catch {
      // Fall back to static providers
    } finally {
      setIsLoadingProviders(false);
    }
  }, []);

  // Validate customer account number on blur
  const validateCustomer = useCallback(async (accountNumber: string) => {
    if (!accountNumber.trim() || !selectedProvider) return;
    setIsValidatingCustomer(true);
    setCustomerName(null);
    try {
      const res = await billPaymentService.validateCustomer(selectedProvider, accountNumber.trim());
      const data = res.data as { name?: string; customerName?: string } | null;
      if (data?.name || data?.customerName) {
        setCustomerName(data.name || data.customerName || null);
      }
    } catch {
      // Validation failed silently — user can still proceed
    } finally {
      setIsValidatingCustomer(false);
    }
  }, [selectedProvider]);

  // Fetch recent bill payments from API
  const fetchRecentPayments = useCallback(async () => {
    setIsLoadingRecent(true);
    try {
      const res = await billPaymentService.getHistory();
      const data = res.data as RecentBillPayment[] | { transactions?: RecentBillPayment[]; items?: RecentBillPayment[] };
      let payments: RecentBillPayment[] = [];
      if (Array.isArray(data)) {
        payments = data;
      } else if (data && typeof data === 'object') {
        const d = data as { transactions?: RecentBillPayment[]; items?: RecentBillPayment[] };
        payments = d.transactions || d.items || [];
      }
      setRecentPayments(payments.slice(0, 5));
    } catch {
      setRecentPayments([]);
    } finally {
      setIsLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentPayments();
  }, [fetchRecentPayments]);

  useEffect(() => {
    if (selectedCategory) {
      fetchBillers(selectedCategory);
    }
  }, [selectedCategory, fetchBillers]);

  // Reset customer name when provider changes
  useEffect(() => {
    setCustomerName(null);
  }, [selectedProvider]);

  const handleMeterNumberBlur = () => {
    if (meterNumber.trim() && selectedProvider) {
      validateCustomer(meterNumber);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    // No hidden fee — amount is exactly what user enters
    const paymentData = { category: selectedCategory, provider: selectedProvider, accountNumber: meterNumber, amount: parseFloat(amount) };
    try {
      if (!isOnline) {
        const txnId = addPendingTransaction({ type: 'bill_payment', data: paymentData });
        setSuccessMessage(`Payment queued. Ref: ${txnId}`);
        setTimeout(() => navigate('/transactions'), 2000);
        return;
      }
      const res = await billPaymentService.pay({ category: selectedCategory, billerId: selectedProvider, customerId: meterNumber, amount: parseFloat(amount) });
      setSuccessMessage(`Payment successful! Ref: ${(res.data as { id?: string })?.id || 'N/A'}`);
      fetchRecentPayments();
      setTimeout(() => navigate('/transactions'), 2000);
    } catch (err) {
      if (!isOnline || (err instanceof Error && err.name === 'AbortError')) {
        const txnId = addPendingTransaction({ type: 'bill_payment', data: paymentData });
        setSuccessMessage(`Offline. Queued. Ref: ${txnId}`);
        setTimeout(() => navigate('/transactions'), 2000);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to process payment');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = "w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bill Payment</h1>
          <p className="text-slate-500 mt-1">Pay your bills seamlessly</p>
        </div>
        {!isOnline && (
          <div className="flex items-center px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mr-2 animate-pulse" />Offline
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-red-800">{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-red-600 mt-1">Dismiss</button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-emerald-800">{successMessage}</p>
        </div>
      )}

      {/* Category Selection */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Select Category</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {categories.map((cat) => (
            <button key={cat.id} type="button" onClick={() => { setSelectedCategory(cat.id); setSelectedProvider(''); setMeterNumber(''); setCustomerName(null); }}
              className={`p-4 rounded-2xl border-2 text-center transition-all duration-200 ${selectedCategory === cat.id ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-100 hover:border-slate-200'}`}>
              <div className={`w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center ${catColors[cat.id] || 'bg-slate-50 text-slate-600'}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d={cat.icon} />
                </svg>
              </div>
              <p className="text-xs font-semibold text-slate-700">{cat.name}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Provider Selection */}
      {selectedCategory && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Select Provider</h2>
          {isLoadingProviders ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-sm text-slate-500">Loading providers...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {getProviders(selectedCategory).map((p) => (
                <button key={p.id} type="button" onClick={() => setSelectedProvider(p.id)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all duration-200 ${selectedProvider === p.id ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-100 hover:border-slate-200'}`}>
                  <p className="font-medium text-sm text-slate-900">{p.name}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payment Details Form */}
      {selectedProvider && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Payment Details</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {selectedCategory === 'electricity' ? 'Meter Number' : selectedCategory === 'cable' ? 'Smart Card Number' : selectedCategory === 'internet' ? 'Account ID' : 'Account Number'}
            </label>
            <input
              type="text"
              value={meterNumber}
              onChange={(e) => setMeterNumber(e.target.value)}
              onBlur={handleMeterNumberBlur}
              placeholder="Enter your account/meter number"
              className={inputClass}
              required
            />
          </div>

          {isValidatingCustomer && (
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-500">Validating account...</span>
            </div>
          )}

          {customerName && !isValidatingCustomer && (
            <div className="p-3.5 bg-emerald-50 rounded-xl">
              <p className="text-sm text-emerald-800"><strong>Account Name:</strong> {customerName}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Amount</label>
            <div className="flex">
              <span className="flex items-center px-4 bg-slate-50 border border-r-0 border-slate-200 rounded-l-xl text-sm text-slate-500 font-medium">NGN</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
                min="100"
                className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-r-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all"
                required
              />
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Bill Amount</span>
              <span className="font-medium text-slate-900">₦{parseFloat(amount || '0').toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Service Fee</span>
              <span className="font-medium text-slate-900">₦0.00</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="font-bold text-indigo-600">₦{parseFloat(amount || '0').toLocaleString()}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !meterNumber.trim() || !amount}
            className="w-full py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:shadow-none disabled:translate-y-0">
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing...
              </span>
            ) : 'Pay Bill'}
          </button>
        </form>
      )}

      {/* Recent Payments */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Recent Payments</h2>
        {isLoadingRecent ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recentPayments.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No recent payments</p>
        ) : (
          <div className="space-y-2">
            {recentPayments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-slate-50 transition-colors">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{payment.provider || payment.description || 'Bill Payment'}</p>
                  <p className="text-xs text-slate-400">
                    {payment.category ? `${payment.category.charAt(0).toUpperCase() + payment.category.slice(1)} – ` : ''}
                    {payment.date || (payment.createdAt ? new Date(payment.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')}
                  </p>
                </div>
                <p className="text-sm font-bold text-slate-900 tabular-nums">₦{payment.amount.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BillPayment;
