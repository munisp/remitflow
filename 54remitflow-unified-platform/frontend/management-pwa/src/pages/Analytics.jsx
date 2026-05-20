import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, Users, DollarSign, Calendar, Download } from 'lucide-react';
import StatCard from '../components/StatCard';
import { analyticsApi } from '../services/api';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

const mockRevenueData = [
  { month: 'Jan', revenue: 4500000, transactions: 12500 },
  { month: 'Feb', revenue: 5200000, transactions: 14200 },
  { month: 'Mar', revenue: 4800000, transactions: 13100 },
  { month: 'Apr', revenue: 6100000, transactions: 16800 },
  { month: 'May', revenue: 5900000, transactions: 15900 },
  { month: 'Jun', revenue: 7200000, transactions: 19500 },
];

const mockTransactionTypes = [
  { name: 'Cash In', value: 35, color: '#22c55e' },
  { name: 'Cash Out', value: 28, color: '#ef4444' },
  { name: 'Transfer', value: 20, color: '#3b82f6' },
  { name: 'Bill Payment', value: 12, color: '#f59e0b' },
  { name: 'Airtime', value: 5, color: '#8b5cf6' },
];

const mockRegionData = [
  { region: 'Lagos', agents: 450, volume: 2500000 },
  { region: 'Abuja', agents: 280, volume: 1800000 },
  { region: 'Kano', agents: 180, volume: 950000 },
  { region: 'PH', agents: 150, volume: 720000 },
  { region: 'Ibadan', agents: 120, volume: 580000 },
];

export default function Analytics() {
  const [dateRange, setDateRange] = useState('6m');

  const { data: overview } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => analyticsApi.overview(),
    placeholderData: {
      totalRevenue: 33700000,
      totalTransactions: 92000,
      activeAgents: 1180,
      avgTransactionValue: 366,
      growthRate: 18.5,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-500">Platform performance and insights</p>
        </div>
        <div className="flex items-center gap-2">
          <select 
            className="input w-auto"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="1m">Last Month</option>
            <option value="3m">Last 3 Months</option>
            <option value="6m">Last 6 Months</option>
            <option value="1y">Last Year</option>
          </select>
          <button className="btn btn-secondary flex items-center gap-2">
            <Download size={18} />
            Export
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard title="Total Revenue" value={`₦${(overview?.totalRevenue / 1000000).toFixed(1)}M`} icon={DollarSign} color="primary" />
        <StatCard title="Transactions" value={`${(overview?.totalTransactions / 1000).toFixed(0)}K`} icon={BarChart3} color="success" />
        <StatCard title="Active Agents" value={overview?.activeAgents?.toLocaleString()} icon={Users} color="primary" />
        <StatCard title="Avg Transaction" value={`₦${overview?.avgTransactionValue?.toLocaleString()}`} icon={TrendingUp} color="warning" />
        <StatCard title="Growth Rate" value={`${overview?.growthRate}%`} change={overview?.growthRate} changeType="positive" icon={TrendingUp} color="success" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trend */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockRevenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(v) => `₦${v/1000000}M`} />
                <Tooltip formatter={(v) => `₦${v.toLocaleString()}`} />
                <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Transaction Types */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mockTransactionTypes}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {mockTransactionTypes.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `${v}%`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transaction Volume */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction Volume</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockRevenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip />
                <Bar dataKey="transactions" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Regional Performance */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Regional Performance</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockRegionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" stroke="#9ca3af" fontSize={12} tickFormatter={(v) => `₦${v/1000000}M`} />
                <YAxis type="category" dataKey="region" stroke="#9ca3af" fontSize={12} />
                <Tooltip formatter={(v) => `₦${v.toLocaleString()}`} />
                <Bar dataKey="volume" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
