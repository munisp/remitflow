import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { exchangeRateService, type ExchangeRate } from '../services/api';

interface RateData {
  from: string;
  to: string;
  rate: number;
  change: number;
  flag: string;
  name: string;
}

const ExchangeRates: React.FC = () => {
  const [baseCurrency, setBaseCurrency] = useState('NGN');
  const [amount, setAmount] = useState('1000');
  const [targetCurrency, setTargetCurrency] = useState('USD');
  const [rates, setRates] = useState<RateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertPair, setAlertPair] = useState('USD/NGN');
  const [alertTarget, setAlertTarget] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const flagMap: Record<string, string> = { USD: '\u{1F1FA}\u{1F1F8}', GBP: '\u{1F1EC}\u{1F1E7}', EUR: '\u{1F1EA}\u{1F1FA}', GHS: '\u{1F1EC}\u{1F1ED}', KES: '\u{1F1F0}\u{1F1EA}', ZAR: '\u{1F1FF}\u{1F1E6}', XOF: '\u{1F1F8}\u{1F1F3}', XAF: '\u{1F1E8}\u{1F1F2}' };
  const nameMap: Record<string, string> = { USD: 'US Dollar', GBP: 'British Pound', EUR: 'Euro', GHS: 'Ghanaian Cedi', KES: 'Kenyan Shilling', ZAR: 'South African Rand', XOF: 'West African CFA', XAF: 'Central African CFA' };

  const fallbackRates: RateData[] = [
    { from: 'NGN', to: 'USD', rate: 0.000645, change: 0.5, flag: '\u{1F1FA}\u{1F1F8}', name: 'US Dollar' },
    { from: 'NGN', to: 'GBP', rate: 0.000505, change: -0.3, flag: '\u{1F1EC}\u{1F1E7}', name: 'British Pound' },
    { from: 'NGN', to: 'EUR', rate: 0.000588, change: 0.2, flag: '\u{1F1EA}\u{1F1FA}', name: 'Euro' },
    { from: 'NGN', to: 'GHS', rate: 0.008, change: 1.2, flag: '\u{1F1EC}\u{1F1ED}', name: 'Ghanaian Cedi' },
    { from: 'NGN', to: 'KES', rate: 0.091, change: -0.1, flag: '\u{1F1F0}\u{1F1EA}', name: 'Kenyan Shilling' },
    { from: 'NGN', to: 'ZAR', rate: 0.012, change: 0.8, flag: '\u{1F1FF}\u{1F1E6}', name: 'South African Rand' },
  ];

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await exchangeRateService.getRates('NGN');
      const data: ExchangeRate[] = res.data;
      if (data.length > 0) {
        setRates(data.map((r: ExchangeRate) => ({
          from: r.from,
          to: r.to,
          rate: r.rate,
          change: 0,
          flag: flagMap[r.to] || '',
          name: nameMap[r.to] || r.to,
        })));
      } else {
        setRates(fallbackRates);
      }
    } catch {
      setRates(fallbackRates);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  const getRate = (from: string, to: string): number => {
    if (from === to) return 1;
    const rate = rates.find(r => r.from === from && r.to === to);
    if (rate) return rate.rate;
    const inverseRate = rates.find(r => r.from === to && r.to === from);
    if (inverseRate) return 1 / inverseRate.rate;
    return 0;
  };

  const handleSetAlert = async () => {
    if (!alertTarget) return;
    try {
      const [from, to] = alertPair.split('/');
      await exchangeRateService.lockRate(from, to, parseFloat(alertTarget));
      setAlertMessage('Alert set successfully!');
      setTimeout(() => setAlertMessage(''), 3000);
    } catch {
      setAlertMessage('Failed to set alert. Try again.');
      setTimeout(() => setAlertMessage(''), 3000);
    }
  };

  const convertedAmount = parseFloat(amount || '0') * getRate(baseCurrency, targetCurrency);
  const selectClass = "px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Exchange Rates</h1>
        <p className="text-slate-500 mt-1">Real-time currency conversion</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Currency Converter</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">You have</label>
            <div className="flex">
              <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className={`${selectClass} rounded-r-none w-24 border-r-0`}>
                {['NGN','USD','GBP','EUR'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-r-xl text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none" />
            </div>
          </div>
          <div className="flex justify-center">
            <button onClick={() => { const t = baseCurrency; setBaseCurrency(targetCurrency); setTargetCurrency(t); }}
              className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 hover:bg-indigo-100 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">You get</label>
            <div className="flex">
              <select value={targetCurrency} onChange={(e) => setTargetCurrency(e.target.value)} className={`${selectClass} rounded-r-none w-24 border-r-0`}>
                {['USD','GBP','EUR','GHS','KES','ZAR'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="text" value={convertedAmount.toFixed(2)} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-r-xl text-slate-900 font-semibold" readOnly />
            </div>
          </div>
        </div>
        <div className="mt-4 p-3 bg-indigo-50 rounded-xl text-sm">
          <span className="text-slate-600">Rate: </span>
          <span className="font-semibold text-slate-900">1 {baseCurrency} = {getRate(baseCurrency, targetCurrency).toFixed(6)} {targetCurrency}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold text-slate-900">Live Rates (NGN Base)</h2>
          <span className="text-xs text-slate-400 bg-slate-50 px-3 py-1 rounded-full">{loading ? 'Loading...' : 'Updated just now'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Currency</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Rate</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">24h</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.to} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{rate.flag}</span>
                      <div>
                        <p className="font-semibold text-sm text-slate-900">{rate.to}</p>
                        <p className="text-xs text-slate-500">{rate.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-sm font-semibold text-slate-900">{rate.rate > 0 ? (1 / rate.rate).toFixed(2) : '0.00'}</td>
                  <td className="py-3.5 px-4 text-right">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${rate.change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      {rate.change >= 0 ? '+' : ''}{rate.change}%
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <Link to={`/send?currency=${rate.to}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">Exchange</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-2">Rate Alerts</h2>
        <p className="text-sm text-slate-500 mb-4">Get notified when rates reach your target</p>
        <div className="flex flex-col md:flex-row gap-3">
          <select value={alertPair} onChange={(e) => setAlertPair(e.target.value)} className={`${selectClass} md:w-32`}>
            <option>USD/NGN</option><option>GBP/NGN</option><option>EUR/NGN</option>
          </select>
          <input type="number" value={alertTarget} onChange={(e) => setAlertTarget(e.target.value)} value="Target rate" className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none" />
          <button onClick={handleSetAlert} className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">Set Alert</button>
        </div>
        {alertMessage && <p className={`mt-3 text-sm font-medium ${alertMessage.includes('success') ? 'text-emerald-600' : 'text-red-500'}`}>{alertMessage}</p>}
      </div>
    </div>
  );
};

export default ExchangeRates;
