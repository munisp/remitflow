import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOfflineStore, useIsOnline, usePendingCount } from '../stores/offlineStore';
import { airtimeService } from '../services/api';

interface RecentPurchase {
  id: string;
  provider?: string;
  type?: string;
  phone?: string;
  amount: number;
  planName?: string;
  createdAt?: string;
  description?: string;
  reference?: string;
}

const NETWORK_COLORS: Record<string, { color: string; text: string }> = {
  mtn: { color: 'from-yellow-400 to-yellow-500', text: 'text-yellow-900' },
  glo: { color: 'from-green-500 to-green-600', text: 'text-white' },
  airtel: { color: 'from-red-500 to-red-600', text: 'text-white' },
  '9mobile': { color: 'from-green-700 to-green-800', text: 'text-white' },
};

const Airtime: React.FC = () => {
  const navigate = useNavigate();
  const isOnline = useIsOnline();
  const pendingCount = usePendingCount();
  const { addPendingTransaction } = useOfflineStore();

  const [activeTab, setActiveTab] = useState<'airtime' | 'data'>('airtime');
  const [selectedNetwork, setSelectedNetwork] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedBundle, setSelectedBundle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [isLoadingBundles, setIsLoadingBundles] = useState(false);

  const networks = [
    { id: 'mtn', name: 'MTN', color: 'from-yellow-400 to-yellow-500', text: 'text-yellow-900' },
    { id: 'glo', name: 'Glo', color: 'from-green-500 to-green-600', text: 'text-white' },
    { id: 'airtel', name: 'Airtel', color: 'from-red-500 to-red-600', text: 'text-white' },
    { id: '9mobile', name: '9mobile', color: 'from-green-700 to-green-800', text: 'text-white' },
  ];
  const quickAmounts = [100, 200, 500, 1000, 2000, 5000];
  const [dataBundles, setDataBundles] = useState<Array<{ id: string; name: string; validity: string; price: number }>>([]);

  const fetchDataBundles = useCallback(async (networkId: string) => {
    if (!networkId) return;
    setIsLoadingBundles(true);
    try {
      const res = await airtimeService.getDataPlans(networkId);
      const data = res.data.map((plan) => ({
        id: plan.id,
        name: plan.name || plan.data,
        validity: plan.validity,
        price: Number(plan.amount),
      }));
      setDataBundles(data);
      setSelectedBundle('');
    } catch {
      setDataBundles([]);
      setError('Data plans are unavailable for this network.');
    } finally {
      setIsLoadingBundles(false);
    }
  }, []);

  const fetchRecentPurchases = useCallback(async () => {
    setIsLoadingRecent(true);
    try {
      const res = await airtimeService.getHistory();
      const data = res.data as RecentPurchase[] | { transactions?: RecentPurchase[]; items?: RecentPurchase[] };
      let purchases: RecentPurchase[] = [];
      if (Array.isArray(data)) {
        purchases = data;
      } else if (data && typeof data === 'object') {
        const d = data as { transactions?: RecentPurchase[]; items?: RecentPurchase[] };
        purchases = d.transactions || d.items || [];
      }
      setRecentPurchases(purchases.slice(0, 5));
    } catch {
      setRecentPurchases([]);
    } finally {
      setIsLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentPurchases();
  }, [fetchRecentPurchases]);

  useEffect(() => {
    if (selectedNetwork && activeTab === 'data') {
      fetchDataBundles(selectedNetwork);
    }
  }, [selectedNetwork, activeTab, fetchDataBundles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const purchaseData = {
      phone: phoneNumber, provider: selectedNetwork, type: activeTab,
      amount: activeTab === 'airtime' ? parseFloat(amount) : dataBundles.find(b => b.id === selectedBundle)?.price || 0,
      planId: activeTab === 'data' ? selectedBundle : undefined,
    };
    try {
      if (!isOnline) {
        const txnId = addPendingTransaction({ type: 'airtime', data: purchaseData });
        setSuccessMessage(`Purchase queued. Reference: ${txnId}`);
        setTimeout(() => navigate('/transactions'), 2000);
        return;
      }
      const res = await airtimeService.purchase(purchaseData);
      setSuccessMessage(`${activeTab === 'airtime' ? 'Airtime' : 'Data'} purchase successful! Ref: ${(res.data as { id?: string })?.id || 'N/A'}`);
      fetchRecentPurchases();
      setTimeout(() => navigate('/transactions'), 2000);
    } catch (err) {
      if (!isOnline || (err instanceof Error && err.name === 'AbortError')) {
        const txnId = addPendingTransaction({ type: 'airtime', data: purchaseData });
        setSuccessMessage(`Offline. Purchase queued. Ref: ${txnId}`);
        setTimeout(() => navigate('/transactions'), 2000);
      } else { setError(err instanceof Error ? err.message : 'Failed to process purchase'); }
    } finally { setIsSubmitting(false); }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Airtime & Data</h1>
          <p className="text-slate-500 mt-1">Top up your phone instantly</p>
        </div>
        {!isOnline && (
          <div className="flex items-center px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mr-2 animate-pulse" />Offline
          </div>
        )}
      </div>

      {pendingCount > 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center"><span className="text-indigo-600 font-semibold text-sm">{pendingCount}</span></div>
            <div><p className="text-sm font-medium text-indigo-900">Pending</p><p className="text-xs text-indigo-600">Will sync when online</p></div>
          </div>
          <button onClick={() => navigate('/transactions?filter=pending')} className="text-sm text-indigo-600 hover:text-indigo-500 font-medium">View</button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <div><p className="text-sm font-medium text-red-800">{error}</p><button onClick={() => setError(null)} className="text-xs text-red-600 hover:text-red-500 mt-1">Dismiss</button></div>
        </div>
      )}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="text-sm font-medium text-emerald-800">{successMessage}</p>
        </div>
      )}

      <div className="flex bg-slate-100 rounded-xl p-1">
        {(['airtime', 'data'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === tab ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>
            Buy {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">Select Network</label>
          <div className="grid grid-cols-4 gap-3">
            {networks.map((n) => (
              <button key={n.id} type="button" onClick={() => setSelectedNetwork(n.id)}
                className={`p-4 rounded-2xl border-2 transition-all duration-200 ${selectedNetwork === n.id ? 'border-indigo-400 ring-2 ring-indigo-100 scale-105' : 'border-slate-100 hover:border-slate-200'}`}>
                <div className={`w-10 h-10 bg-gradient-to-br ${n.color} rounded-xl mx-auto mb-2 flex items-center justify-center`}>
                  <span className={`text-xs font-bold ${n.text}`}>{n.name[0]}</span>
                </div>
                <p className="text-xs font-semibold text-slate-700 text-center">{n.name}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Phone Number</label>
          <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="e.g. 08012345678"
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all" required />
        </div>

        {activeTab === 'airtime' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">Amount</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {quickAmounts.map((amt) => (
                <button key={amt} type="button" onClick={() => setAmount(amt.toString())}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${amount === amt.toString() ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
                  \u20a6{amt.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="flex">
              <span className="flex items-center px-4 bg-slate-50 border border-r-0 border-slate-200 rounded-l-xl text-sm text-slate-500 font-medium">NGN</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount" min="50"
                className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-r-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all" required />
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">Select Data Bundle</label>
            <div className="grid grid-cols-2 gap-3">
              {dataBundles.map((bundle) => (
                <button key={bundle.id} type="button" onClick={() => setSelectedBundle(bundle.id)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all duration-200 ${selectedBundle === bundle.id ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-100 hover:border-slate-200'}`}>
                  <p className="font-bold text-lg text-slate-900">{bundle.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{bundle.validity}</p>
                  <p className="text-indigo-600 font-semibold mt-1.5">\u20a6{bundle.price.toLocaleString()}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 bg-slate-50 rounded-xl space-y-2">
          <div className="flex justify-between text-sm"><span className="text-slate-500">{activeTab === 'airtime' ? 'Airtime Amount' : 'Data Bundle'}</span>
            <span className="font-medium text-slate-900">{activeTab === 'airtime' ? `\u20a6${parseFloat(amount || '0').toLocaleString()}` : dataBundles.find(b => b.id === selectedBundle)?.name || '-'}</span>
          </div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Service Fee</span><span className="font-medium text-slate-900">\u20a60.00</span></div>
          <div className="pt-2 border-t border-slate-200 flex justify-between"><span className="font-semibold text-slate-900">Total</span>
            <span className="font-bold text-indigo-600">\u20a6{activeTab === 'airtime' ? parseFloat(amount || '0').toLocaleString() : (dataBundles.find(b => b.id === selectedBundle)?.price || 0).toLocaleString()}</span>
          </div>
        </div>

        <button type="submit" disabled={isSubmitting || !selectedNetwork || !phoneNumber || (activeTab === 'airtime' ? !amount : !selectedBundle)}
          className="w-full py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:shadow-none disabled:translate-y-0">
          {isSubmitting ? 'Processing...' : (activeTab === 'airtime' ? 'Buy Airtime' : 'Buy Data')}
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Recent Purchases</h2>
        {isLoadingRecent ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recentPurchases.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No recent purchases</p>
        ) : (
          <div className="space-y-2">
            {recentPurchases.map((purchase) => {
              const providerKey = (purchase.provider || '').toLowerCase();
              const netColors = NETWORK_COLORS[providerKey] || { color: 'from-slate-400 to-slate-500', text: 'text-white' };
              const initial = (purchase.provider || 'N').charAt(0).toUpperCase();
              return (
                <div key={purchase.id} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 bg-gradient-to-br ${netColors.color} rounded-xl flex items-center justify-center`}>
                      <span className={`text-xs font-bold ${netColors.text}`}>{initial}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {purchase.provider?.toUpperCase()} {purchase.type === 'data' ? `Data${purchase.planName ? ` – ${purchase.planName}` : ''}` : 'Airtime'}
                      </p>
                      <p className="text-xs text-slate-400">{purchase.phone || purchase.description || '—'}</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">₦{purchase.amount.toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Airtime;
