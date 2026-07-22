import React, { useEffect, useState } from 'react';
import { accountHealthService, type AccountHealth as AccountHealthResponse, type HealthRecommendation } from '../services/api';

const statusClass = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === 'healthy' || normalized === 'excellent' || normalized === 'good') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'warning' || normalized === 'fair') return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
};

export default function AccountHealth() {
  const [health, setHealth] = useState<AccountHealthResponse | null>(null);
  const [recommendations, setRecommendations] = useState<HealthRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      const [healthResult, recommendationsResult] = await Promise.allSettled([
        accountHealthService.getHealth(),
        accountHealthService.getRecommendations(),
      ]);
      if (healthResult.status === 'fulfilled') {
        setHealth(healthResult.value.data);
      } else {
        setHealth(null);
        setError('Unable to load account health from the backend.');
      }
      if (recommendationsResult.status === 'fulfilled') {
        setRecommendations(recommendationsResult.value.data);
      } else {
        setRecommendations([]);
        setError((current) => current || 'Unable to load account-health recommendations from the backend.');
      }
      setIsLoading(false);
    };
    void load();
  }, []);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" /></div>;
  }

  if (!health) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold text-slate-900">Account Health</h1><p className="text-slate-500">Monitor live account health signals.</p></div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">{error || 'Account health is unavailable.'}</div>
      </div>
    );
  }

  const percentage = health.maxScore > 0 ? Math.round((health.score / health.maxScore) * 100) : 0;
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Account Health</h1><p className="text-slate-500">Live backend-issued account health signals and recommendations.</p></div>
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-700">{error}</div>}
      <section className="bg-gradient-to-r from-indigo-500 to-violet-600 rounded-2xl p-6 text-white">
        <p className="text-indigo-100">Overall Health Score</p>
        <p className="text-5xl font-bold mt-2">{percentage}%</p>
        <p className="text-indigo-100 mt-2 capitalize">{health.level.replace('_', ' ')}</p>
      </section>
      <section className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Health Categories</h2>
        {health.categories.length === 0 ? <p className="text-sm text-slate-500">The backend has not reported account-health categories.</p> : (
          <div className="space-y-4">
            {health.categories.map((category) => {
              const categoryPercent = category.maxScore > 0 ? Math.round((category.score / category.maxScore) * 100) : 0;
              return <div key={category.name} className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-4"><p className="font-medium text-slate-900">{category.name}</p><span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusClass(category.status)}`}>{category.status}</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(100, Math.max(0, categoryPercent))}%` }} /></div>
                <p className="mt-2 text-xs text-slate-500">{category.score} of {category.maxScore}</p>
              </div>;
            })}
          </div>
        )}
      </section>
      <section className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Recommendations</h2>
        {recommendations.length === 0 ? <p className="text-sm text-slate-500">No backend-issued recommendations are currently available.</p> : (
          <div className="space-y-3">{recommendations.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-4"><p className="font-medium text-slate-900">{item.title}</p><p className="mt-1 text-sm text-slate-600">{item.description}</p>{item.actionUrl && <a href={item.actionUrl} className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">Review recommendation</a>}</div>)}</div>
        )}
      </section>
    </div>
  );
}
