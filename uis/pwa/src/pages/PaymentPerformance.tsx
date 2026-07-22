import React, { useEffect, useState } from 'react';
import { paymentPerformanceService, type PaymentInsight, type PaymentPerformanceMetrics } from '../services/api';

export default function PaymentPerformance() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | '1y'>('30d');
  const [metrics, setMetrics] = useState<PaymentPerformanceMetrics | null>(null);
  const [insights, setInsights] = useState<PaymentInsight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      const [metricsResult, insightsResult] = await Promise.allSettled([
        paymentPerformanceService.getMetrics({ period: timeRange }),
        paymentPerformanceService.getInsights(),
      ]);
      if (metricsResult.status === 'fulfilled') {
        setMetrics(metricsResult.value.data);
      } else {
        setMetrics(null);
        setError('Unable to load payment-performance metrics from the backend.');
      }
      if (insightsResult.status === 'fulfilled') {
        setInsights(insightsResult.value.data);
      } else {
        setInsights([]);
        setError((current) => current || 'Unable to load payment-performance insights from the backend.');
      }
      setIsLoading(false);
    };
    void load();
  }, [timeRange]);

  const formatCurrency = (amount: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount);
  if (isLoading) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-900">Payment Performance</h1><p className="text-slate-500">Live backend-issued transaction metrics and analytics.</p></div><div className="flex gap-2 bg-slate-100 p-1 rounded-xl">{(['7d', '30d', '90d', '1y'] as const).map((range) => <button key={range} onClick={() => setTimeRange(range)} className={`px-3 py-1 rounded-md text-sm font-medium ${timeRange === range ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>{range}</button>)}</div></div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
      {!metrics ? <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Payment performance is unavailable until the backend returns metrics.</div> : <>
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm"><p className="text-sm text-slate-500">Total Volume</p><p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(metrics.totalVolume, 'USD')}</p></div>
          <div className="bg-white rounded-xl p-4 shadow-sm"><p className="text-sm text-slate-500">Transactions</p><p className="text-2xl font-bold text-slate-900 mt-1">{metrics.totalCount.toLocaleString()}</p></div>
          <div className="bg-white rounded-xl p-4 shadow-sm"><p className="text-sm text-slate-500">Success Rate</p><p className="text-2xl font-bold text-slate-900 mt-1">{metrics.successRate.toFixed(1)}%</p></div>
          <div className="bg-white rounded-xl p-4 shadow-sm"><p className="text-sm text-slate-500">Average Processing Time</p><p className="text-2xl font-bold text-slate-900 mt-1">{metrics.averageProcessingTime.toFixed(2)}s</p></div>
        </section>
        <section className="bg-white rounded-2xl p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-900 mb-4">Transaction Volume</h2>{metrics.volumeByDay.length === 0 ? <p className="text-sm text-slate-500">No backend-issued volume data is available for this period.</p> : <div className="space-y-2">{metrics.volumeByDay.map((point) => <div key={point.date} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2"><span className="text-sm text-slate-600">{point.date}</span><span className="text-sm font-medium text-slate-900">{formatCurrency(point.amount, 'USD')} · {point.count} transactions</span></div>)}</div>}</section>
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="bg-white rounded-2xl p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-900 mb-4">Volume by Currency</h2>{metrics.volumeByCurrency.length === 0 ? <p className="text-sm text-slate-500">No backend-issued currency breakdown is available.</p> : <div className="space-y-3">{metrics.volumeByCurrency.map((item) => <div key={item.currency} className="flex justify-between text-sm"><span className="text-slate-600">{item.currency} · {item.count} transactions</span><span className="font-medium text-slate-900">{formatCurrency(item.amount, item.currency)}</span></div>)}</div>}</div><div className="bg-white rounded-2xl p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-900 mb-4">Insights</h2>{insights.length === 0 ? <p className="text-sm text-slate-500">No backend-issued insights are available.</p> : <div className="space-y-3">{insights.map((insight) => <div key={insight.id} className="rounded-xl bg-slate-50 p-3"><p className="font-medium text-slate-900">{insight.title}</p><p className="mt-1 text-sm text-slate-600">{insight.description}</p></div>)}</div>}</div></section>
      </>}
    </div>
  );
}
