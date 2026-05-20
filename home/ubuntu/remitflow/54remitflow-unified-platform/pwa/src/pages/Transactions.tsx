import React, { useState, useEffect, useCallback } from 'react';
import { SearchBar } from '../components/SearchBar';
import { transactionService } from '../services/api';
import { searchService, TransactionSearchResult, SearchFilters } from '../services/searchService';

interface Transaction {
  id: string;
  type: 'sent' | 'received' | 'airtime' | 'bill' | 'exchange';
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'failed';
  description: string;
  date: string;
  reference: string;
}

const mockTransactions: Transaction[] = [
  { id: '1', type: 'sent', amount: 50000, currency: 'NGN', status: 'completed', description: 'Transfer to John Doe', date: '2024-01-15 14:30', reference: 'TXN001234' },
  { id: '2', type: 'received', amount: 25000, currency: 'NGN', status: 'completed', description: 'From Jane Smith', date: '2024-01-14 10:15', reference: 'TXN001233' },
  { id: '3', type: 'airtime', amount: 2000, currency: 'NGN', status: 'completed', description: 'MTN Airtime', date: '2024-01-13 09:00', reference: 'TXN001232' },
  { id: '4', type: 'bill', amount: 15000, currency: 'NGN', status: 'completed', description: 'IKEDC Electricity', date: '2024-01-12 16:45', reference: 'TXN001231' },
  { id: '5', type: 'exchange', amount: 100, currency: 'USD', status: 'completed', description: 'USD to NGN', date: '2024-01-11 11:20', reference: 'TXN001230' },
  { id: '6', type: 'sent', amount: 75000, currency: 'NGN', status: 'pending', description: 'Transfer to Mike Johnson', date: '2024-01-10 08:30', reference: 'TXN001229' },
  { id: '7', type: 'received', amount: 100000, currency: 'NGN', status: 'completed', description: 'From Sarah Williams', date: '2024-01-09 15:00', reference: 'TXN001228' },
];

const Transactions: React.FC = () => {
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [useOpenSearch, setUseOpenSearch] = useState(true);
  const pageSize = 20;

  const mapSearchResultToTransaction = (result: TransactionSearchResult): Transaction => ({
    id: result.id,
    type: (result.type as Transaction['type']) || 'sent',
    amount: result.amount,
    currency: result.currency,
    status: (result.status as Transaction['status']) || 'completed',
    description: result.description || result.recipient || result.sender || 'Transaction',
    date: result.createdAt,
    reference: result.reference,
  });

  const searchTransactions = useCallback(async (query: string, typeFilter: string) => {
    if (!useOpenSearch) {
      try {
        const res = await transactionService.getHistory({ type: typeFilter !== 'all' ? typeFilter : undefined });
        const txList = ((res.data as unknown as { transactions?: unknown[] })?.transactions || res.data) as unknown as { id: string; type: string; amount: number; currency: string; status: string; description?: string; recipient?: string; sender?: string; createdAt: string; reference: string }[];
        if (Array.isArray(txList)) {
          const mapped = txList.map((t) => ({ id: t.id, type: (t.type as Transaction['type']) || 'sent', amount: t.amount, currency: t.currency, status: (t.status as Transaction['status']) || 'completed', description: t.description || t.recipient || 'Transaction', date: t.createdAt, reference: t.reference }));
          setTransactions(mapped); setTotal(mapped.length); return;
        }
      } catch {
        // API failed — show empty state rather than fake data
        setTransactions([]); setTotal(0); return;
      }
    }
    setIsLoading(true);
    try {
      const filters: SearchFilters = {};
      if (typeFilter !== 'all') { filters.type = typeFilter; }
      const response = await searchService.searchTransactions(query || '*', filters, { page, size: pageSize });
      const mappedTransactions = response.hits.map(hit => mapSearchResultToTransaction(hit.source));
      setTransactions(mappedTransactions);
      setTotal(response.total);
    } catch (err) {
      console.error('OpenSearch failed, falling back to local data:', err);
      setUseOpenSearch(false);
      // OpenSearch unavailable — fall back to REST API
      try {
        const res = await transactionService.getHistory({ type: typeFilter !== 'all' ? typeFilter : undefined });
        const txList = ((res.data as unknown as { transactions?: unknown[] })?.transactions || res.data) as unknown as { id: string; type: string; amount: number; currency: string; status: string; description?: string; recipient?: string; sender?: string; createdAt: string; reference: string }[];
        if (Array.isArray(txList)) {
          const mapped = txList.map((t) => ({ id: t.id, type: (t.type as Transaction['type']) || 'sent', amount: t.amount, currency: t.currency, status: (t.status as Transaction['status']) || 'completed', description: t.description || t.recipient || 'Transaction', date: t.createdAt, reference: t.reference }));
          setTransactions(mapped); setTotal(mapped.length);
        } else {
          setTransactions([]); setTotal(0);
        }
      } catch {
        setTransactions([]); setTotal(0);
      }
    } finally {
      setIsLoading(false);
    }
  }, [page, useOpenSearch]);

  useEffect(() => { searchTransactions(searchQuery, filter); }, [filter, page, searchTransactions, searchQuery]);

  const handleSearch = (query: string) => { setSearchQuery(query); setPage(1); };

  const getTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      sent: 'M5 10l7-7m0 0l7 7m-7-7v18',
      received: 'M19 14l-7 7m0 0l-7-7m7 7V3',
      airtime: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
      bill: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      exchange: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
    };
    return icons[type] || 'M12 8v4m0 4h.01';
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      sent: 'bg-indigo-50 text-indigo-600', received: 'bg-emerald-50 text-emerald-600',
      airtime: 'bg-amber-50 text-amber-600', bill: 'bg-violet-50 text-violet-600',
      exchange: 'bg-cyan-50 text-cyan-600',
    };
    return colors[type] || 'bg-slate-50 text-slate-600';
  };

  const getStatusStyle = (status: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-emerald-50 text-emerald-700', pending: 'bg-amber-50 text-amber-700', failed: 'bg-red-50 text-red-600',
    };
    return styles[status] || 'bg-slate-50 text-slate-600';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transaction History</h1>
        <p className="text-slate-500 mt-1">Track all your transactions</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {['all', 'sent', 'received', 'airtime', 'bill', 'exchange'].map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all duration-200 ${filter === f ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                {f}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <SearchBar value="Search transactions..." index="transactions" onSearch={handleSearch} className="w-full md:w-64" />
            <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">Export</button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100">
        <div className="divide-y divide-slate-50">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <span className="ml-3 text-slate-500">Searching...</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No transactions found</div>
          ) : (
            transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${getTypeColor(tx.type)}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={getTypeIcon(tx.type)} /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{tx.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-400">{tx.date}</span>
                      <span className="text-xs text-slate-300">|</span>
                      <span className="text-xs text-slate-400 font-mono">{tx.reference}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold tabular-nums ${tx.type === 'received' ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {tx.type === 'received' ? '+' : '-'}{tx.currency} {tx.amount.toLocaleString()}
                  </p>
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${getStatusStyle(tx.status)}`}>{tx.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between p-4 border-t border-slate-100">
          <p className="text-xs text-slate-400">
            Showing {transactions.length} of {total}
            {!useOpenSearch && <span className="text-amber-500 ml-2">(offline)</span>}
          </p>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <button className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Transactions;
