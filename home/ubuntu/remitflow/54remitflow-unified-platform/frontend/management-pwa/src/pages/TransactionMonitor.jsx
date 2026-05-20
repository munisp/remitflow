import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, ArrowUpRight, ArrowDownRight, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import { transactionApi } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const mockTransactions = [
  { id: 'TXN001', type: 'Cash In', amount: 50000, status: 'completed', agent: 'John Doe', customer: 'Customer A', timestamp: '2024-01-15 14:30:00' },
  { id: 'TXN002', type: 'Cash Out', amount: 25000, status: 'completed', agent: 'Jane Smith', customer: 'Customer B', timestamp: '2024-01-15 14:25:00' },
  { id: 'TXN003', type: 'Transfer', amount: 100000, status: 'pending', agent: 'Mike Johnson', customer: 'Customer C', timestamp: '2024-01-15 14:20:00' },
  { id: 'TXN004', type: 'Bill Payment', amount: 15000, status: 'completed', agent: 'Sarah Williams', customer: 'Customer D', timestamp: '2024-01-15 14:15:00' },
  { id: 'TXN005', type: 'Airtime', amount: 5000, status: 'failed', agent: 'David Brown', customer: 'Customer E', timestamp: '2024-01-15 14:10:00' },
];

const mockChartData = [
  { time: '00:00', volume: 120000 },
  { time: '04:00', volume: 80000 },
  { time: '08:00', volume: 250000 },
  { time: '12:00', volume: 380000 },
  { time: '16:00', volume: 420000 },
  { time: '20:00', volume: 280000 },
];

const columns = [
  { key: 'id', label: 'Transaction ID' },
  { 
    key: 'type', 
    label: 'Type',
    render: (value) => (
      <div className="flex items-center gap-2">
        {value === 'Cash In' ? <ArrowDownRight size={16} className="text-success-600" /> :
         value === 'Cash Out' ? <ArrowUpRight size={16} className="text-danger-600" /> :
         <CreditCard size={16} className="text-primary-600" />}
        {value}
      </div>
    )
  },
  { key: 'amount', label: 'Amount', render: (v) => `₦${v.toLocaleString()}` },
  { 
    key: 'status', 
    label: 'Status',
    render: (value) => (
      <span className={`badge ${
        value === 'completed' ? 'badge-success' :
        value === 'pending' ? 'badge-warning' :
        'badge-danger'
      }`}>
        {value}
      </span>
    )
  },
  { key: 'agent', label: 'Agent' },
  { key: 'customer', label: 'Customer' },
  { key: 'timestamp', label: 'Time' },
];

export default function TransactionMonitor() {
  const [filter, setFilter] = useState('all');

  const { data: transactions = mockTransactions } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => transactionApi.list(),
    placeholderData: mockTransactions,
  });

  const filteredTransactions = filter === 'all' 
    ? transactions 
    : transactions.filter(t => t.status === filter);

  const stats = {
    total: transactions.length,
    completed: transactions.filter(t => t.status === 'completed').length,
    pending: transactions.filter(t => t.status === 'pending').length,
    failed: transactions.filter(t => t.status === 'failed').length,
    volume: transactions.reduce((sum, t) => sum + t.amount, 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transaction Monitor</h1>
          <p className="text-gray-500">Real-time transaction monitoring and analytics</p>
        </div>
        <div className="flex items-center gap-2">
          {['all', 'completed', 'pending', 'failed'].map((status) => (
            <button
              key={status}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === status 
                  ? 'bg-primary-600 text-white' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => setFilter(status)}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard title="Total Transactions" value={stats.total} icon={CreditCard} color="primary" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle} color="success" />
        <StatCard title="Pending" value={stats.pending} icon={Clock} color="warning" />
        <StatCard title="Failed" value={stats.failed} icon={AlertTriangle} color="danger" />
        <StatCard title="Total Volume" value={`₦${(stats.volume/1000).toFixed(0)}K`} icon={CreditCard} color="primary" />
      </div>

      {/* Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction Volume (24h)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(v) => `₦${v/1000}K`} />
              <Tooltip formatter={(v) => `₦${v.toLocaleString()}`} />
              <Line type="monotone" dataKey="volume" stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Transaction Table */}
      <DataTable columns={columns} data={filteredTransactions} />
    </div>
  );
}
