import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Percent, DollarSign, Users, TrendingUp, Settings, Calculator } from 'lucide-react';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import { commissionApi } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const mockCommissionRules = [
  { id: 1, tier: 'Master Agent', transactionType: 'Cash In', rate: 0.5, minAmount: 0, maxAmount: 1000000, status: 'active' },
  { id: 2, tier: 'Master Agent', transactionType: 'Cash Out', rate: 0.4, minAmount: 0, maxAmount: 1000000, status: 'active' },
  { id: 3, tier: 'Super Agent', transactionType: 'Cash In', rate: 0.4, minAmount: 0, maxAmount: 500000, status: 'active' },
  { id: 4, tier: 'Super Agent', transactionType: 'Cash Out', rate: 0.3, minAmount: 0, maxAmount: 500000, status: 'active' },
  { id: 5, tier: 'Agent', transactionType: 'Cash In', rate: 0.3, minAmount: 0, maxAmount: 200000, status: 'active' },
  { id: 6, tier: 'Agent', transactionType: 'Cash Out', rate: 0.25, minAmount: 0, maxAmount: 200000, status: 'active' },
];

const mockSettlements = [
  { id: 'SET001', agent: 'John Doe', tier: 'Master Agent', amount: 125000, transactions: 250, period: 'Jan 2024', status: 'paid' },
  { id: 'SET002', agent: 'Jane Smith', tier: 'Super Agent', amount: 89000, transactions: 178, period: 'Jan 2024', status: 'paid' },
  { id: 'SET003', agent: 'Mike Johnson', tier: 'Agent', amount: 45000, transactions: 150, period: 'Jan 2024', status: 'pending' },
  { id: 'SET004', agent: 'Sarah Williams', tier: 'Sub Agent', amount: 32000, transactions: 128, period: 'Jan 2024', status: 'pending' },
];

const mockChartData = [
  { tier: 'Master', commission: 450000 },
  { tier: 'Super', commission: 320000 },
  { tier: 'Senior', commission: 180000 },
  { tier: 'Agent', commission: 95000 },
  { tier: 'Sub', commission: 45000 },
];

const ruleColumns = [
  { key: 'tier', label: 'Tier' },
  { key: 'transactionType', label: 'Transaction Type' },
  { key: 'rate', label: 'Rate', render: (v) => `${v}%` },
  { key: 'minAmount', label: 'Min Amount', render: (v) => `₦${v.toLocaleString()}` },
  { key: 'maxAmount', label: 'Max Amount', render: (v) => `₦${v.toLocaleString()}` },
  { 
    key: 'status', 
    label: 'Status',
    render: (value) => (
      <span className={`badge ${value === 'active' ? 'badge-success' : 'badge-warning'}`}>
        {value}
      </span>
    )
  },
];

const settlementColumns = [
  { key: 'id', label: 'Settlement ID' },
  { key: 'agent', label: 'Agent' },
  { key: 'tier', label: 'Tier' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'amount', label: 'Amount', render: (v) => `₦${v.toLocaleString()}` },
  { key: 'period', label: 'Period' },
  { 
    key: 'status', 
    label: 'Status',
    render: (value) => (
      <span className={`badge ${value === 'paid' ? 'badge-success' : 'badge-warning'}`}>
        {value}
      </span>
    )
  },
];

export default function CommissionManagement() {
  const [activeTab, setActiveTab] = useState('rules');

  const { data: rules = mockCommissionRules } = useQuery({
    queryKey: ['commission-rules'],
    queryFn: () => commissionApi.rules(),
    placeholderData: mockCommissionRules,
  });

  const { data: settlements = mockSettlements } = useQuery({
    queryKey: ['commission-settlements'],
    queryFn: () => commissionApi.settlements(),
    placeholderData: mockSettlements,
  });

  const stats = {
    totalCommissions: settlements.reduce((sum, s) => sum + s.amount, 0),
    pendingSettlements: settlements.filter(s => s.status === 'pending').length,
    activeRules: rules.filter(r => r.status === 'active').length,
    totalAgents: new Set(settlements.map(s => s.agent)).size,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commission Management</h1>
          <p className="text-gray-500">Configure commission rules and manage settlements</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2">
          <Calculator size={18} />
          Calculate Commissions
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Commissions" value={`₦${(stats.totalCommissions/1000).toFixed(0)}K`} icon={DollarSign} color="primary" />
        <StatCard title="Pending Settlements" value={stats.pendingSettlements} icon={Percent} color="warning" />
        <StatCard title="Active Rules" value={stats.activeRules} icon={Settings} color="success" />
        <StatCard title="Agents" value={stats.totalAgents} icon={Users} color="primary" />
      </div>

      {/* Commission by Tier Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Commission by Tier</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mockChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="tier" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(v) => `₦${v/1000}K`} />
              <Tooltip formatter={(v) => `₦${v.toLocaleString()}`} />
              <Bar dataKey="commission" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-gray-200">
        <button
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'rules' 
              ? 'border-primary-600 text-primary-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('rules')}
        >
          Commission Rules
        </button>
        <button
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'settlements' 
              ? 'border-primary-600 text-primary-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('settlements')}
        >
          Settlements
        </button>
      </div>

      {/* Content */}
      {activeTab === 'rules' ? (
        <DataTable columns={ruleColumns} data={rules} />
      ) : (
        <DataTable columns={settlementColumns} data={settlements} />
      )}
    </div>
  );
}
