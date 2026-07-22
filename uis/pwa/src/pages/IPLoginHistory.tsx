import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { securityService, type LoginHistoryEntry } from '../services/api';

const FAILED_ATTEMPT_THRESHOLD = 3;

interface SuspiciousIp {
  ipAddress: string;
  failedAttempts: number;
  lastAttempt: string;
}

const findSuspiciousIps = (history: LoginHistoryEntry[]): SuspiciousIp[] => {
  const failuresByIp = new Map<string, LoginHistoryEntry[]>();
  for (const entry of history) {
    if (entry.success) continue;
    const existing = failuresByIp.get(entry.ipAddress) ?? [];
    existing.push(entry);
    failuresByIp.set(entry.ipAddress, existing);
  }

  return Array.from(failuresByIp.entries())
    .filter(([, entries]) => entries.length >= FAILED_ATTEMPT_THRESHOLD)
    .map(([ipAddress, entries]) => ({
      ipAddress,
      failedAttempts: entries.length,
      lastAttempt: entries.reduce((latest, e) => (e.timestamp > latest ? e.timestamp : latest), entries[0].timestamp),
    }))
    .sort((a, b) => b.failedAttempts - a.failedAttempts);
};

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function IPLoginHistory() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    securityService
      .getLoginHistory()
      .then((response) => {
        if (!cancelled) setHistory(response.data);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load login history right now.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const suspiciousIps = findSuspiciousIps(history);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('loginHistory.title')}</h1>
        <p className="text-slate-500">{t('loginHistory.subtitle')}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {suspiciousIps.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-red-700 font-semibold">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {t('loginHistory.suspiciousActivity')} ({suspiciousIps.length})
          </div>
          <div className="space-y-2">
            {suspiciousIps.map((s) => (
              <div key={s.ipAddress} className="bg-white rounded-xl p-3 flex items-center justify-between border border-red-100">
                <div>
                  <p className="font-mono text-sm text-slate-900">{s.ipAddress}</p>
                  <p className="text-xs text-slate-500">
                    {s.failedAttempts} failed attempts &middot; last attempt {formatTime(s.lastAttempt)}
                  </p>
                </div>
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                  {s.failedAttempts >= FAILED_ATTEMPT_THRESHOLD * 2 ? 'High risk' : 'Review'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{t('loginHistory.recentAttempts')}</h2>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">{t('loginHistory.noHistory')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      entry.success ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {entry.success ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      )}
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{entry.device}</p>
                    <p className="text-sm text-slate-500">
                      {entry.location} &middot; <span className="font-mono">{entry.ipAddress}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium ${entry.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {entry.success ? t('loginHistory.success') : t('loginHistory.failed')}
                  </p>
                  <p className="text-xs text-slate-400">{formatTime(entry.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
