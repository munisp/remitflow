import React, { useEffect, useMemo, useState } from 'react';
import { SearchBar } from '../components/SearchBar';
import { auditLogService, type AuditLog } from '../services/api';

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const loadLogs = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await auditLogService.getAll();
      setLogs(response.data.logs);
    } catch {
      setLogs([]);
      setError('Unable to load audit logs from the backend.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadLogs(); }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((log) => [log.action, log.resource, log.details, log.ipAddress].some((value) => value.toLowerCase().includes(query)));
  }, [logs, search]);

  const exportLogs = (format: 'csv' | 'json') => {
    const content = format === 'json'
      ? JSON.stringify(filtered, null, 2)
      : [['ID', 'Action', 'Resource', 'Details', 'IP Address', 'User Agent', 'Created At'].join(','), ...filtered.map((log) => [log.id, log.action, log.resource, `"${log.details.replace(/"/g, '""')}"`, log.ipAddress, `"${log.userAgent.replace(/"/g, '""')}"`, log.createdAt].join(','))].join('\n');
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `audit-logs.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1><p className="text-slate-500">Backend-issued administrative and account audit events.</p></div><div className="flex gap-2"><button onClick={() => exportLogs('csv')} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">Export CSV</button><button onClick={() => exportLogs('json')} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">Export JSON</button></div></div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
      <SearchBar placeholder="Search audit logs..." index="audit_logs" onSearch={setSearch} className="w-full" />
      {filtered.length === 0 ? <div className="rounded-2xl bg-white p-12 text-center text-slate-500">No backend-issued audit logs are available.</div> : <div className="space-y-3">{filtered.map((log) => <article key={log.id} className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-900">{log.action}</p><p className="mt-1 text-sm text-slate-600">{log.resource}</p></div><time className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</time></div><p className="mt-3 text-sm text-slate-700">{log.details}</p><div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500"><span>IP: {log.ipAddress}</span><span>User agent: {log.userAgent}</span></div></article>)}</div>}
    </div>
  );
}
