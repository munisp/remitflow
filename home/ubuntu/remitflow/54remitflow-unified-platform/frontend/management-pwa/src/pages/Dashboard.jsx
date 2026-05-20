import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Users, 
  CreditCard, 
  DollarSign, 
  Activity,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock
} from 'lucide-react';
import StatCard from '../components/StatCard';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import api from '../services/api';

const mockTransactionData = [
  { name: '00:00', transactions: 120, volume: 45000 },
  { name: '04:00', transactions: 80, volume: 32000 },
  { name: '08:00', transactions: 250, volume: 98000 },
  { name: '12:00', transactions: 380, volume: 145000 },
  { name: '16:00', transactions: 420, volume: 168000 },
  { name: '20:00', transactions: 280, volume: 112000 },
];

const mockAgentPerformance = [
  { tier: 'Master', count: 12, volume: 2500000 },
  { tier: 'Super', count: 45, volume: 1800000 },
  { tier: 'Senior', count: 120, volume: 950000 },
  { tier: 'Agent', count: 380, volume: 450000 },
  { tier: 'Sub', count: 520, volume: 180000 },
];

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/dashboard/stats'),
    placeholderData: {
      totalAgents: 1077,
      activeTransactions: 1528,
      dailyVolume: 5850000,
      systemHealth: 98.5,
      pendingKYC: 23,
      syncStatus: 'healthy',
      alertCount: 3,
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500">Platform overview and key metrics</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1 text-success-600">
            <CheckCircle size={16} />
            All systems operational
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Agents"
          value={stats?.totalAgents?.toLocaleString() || '0'}
          change={12.5}
          changeType="positive"
          icon={Users}
          color="primary"
        />
        <StatCard
          title="Active Transactions"
          value={stats?.activeTransactions?.toLocaleString() || '0'}
          change={8.2}
          changeType="positive"
          icon={CreditCard}
          color="success"
        />
        <StatCard
          title="Daily Volume"
          value={`₦${(stats?.dailyVolume / 1000000)?.toFixed(2) || '0'}M`}
          change={15.3}
          changeType="positive"
          icon={DollarSign}
          color="warning"
        />
        <StatCard
          title="System Health"
          value={`${stats?.systemHealth || 0}%`}
          icon={Activity}
          color="success"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transaction Volume Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction Volume (24h)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockTransactionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="transactions" 
                  stroke="#2563eb" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Agent Performance Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Performance by Tier</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockAgentPerformance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="tier" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Quick Actions & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Actions */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Pending Actions</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-warning-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Clock size={20} className="text-warning-600" />
                <span className="text-sm font-medium">KYC Reviews</span>
              </div>
              <span className="badge badge-warning">{stats?.pendingKYC || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-danger-50 rounded-lg">
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="text-danger-600" />
                <span className="text-sm font-medium">Fraud Alerts</span>
              </div>
              <span className="badge badge-danger">{stats?.alertCount || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Users size={20} className="text-primary-600" />
                <span className="text-sm font-medium">Agent Approvals</span>
              </div>
              <span className="badge bg-primary-100 text-primary-700">8</span>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">System Status</h3>
          <div className="space-y-3">
            {[
              { name: 'TigerBeetle Sync', status: 'healthy' },
              { name: 'Fluvio Streaming', status: 'healthy' },
              { name: 'Payment Gateway', status: 'healthy' },
              { name: 'MQTT Bridge', status: 'warning' },
              { name: 'Redis Cache', status: 'healthy' },
            ].map((service) => (
              <div key={service.name} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{service.name}</span>
                <span className={`badge ${service.status === 'healthy' ? 'badge-success' : 'badge-warning'}`}>
                  {service.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {[
              { action: 'New agent registered', time: '2 min ago', type: 'info' },
              { action: 'Large transaction flagged', time: '5 min ago', type: 'warning' },
              { action: 'KYC approved', time: '12 min ago', type: 'success' },
              { action: 'System backup completed', time: '1 hour ago', type: 'info' },
              { action: 'Config updated', time: '2 hours ago', type: 'info' },
            ].map((activity, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 ${
                  activity.type === 'success' ? 'bg-success-500' :
                  activity.type === 'warning' ? 'bg-warning-500' : 'bg-primary-500'
                }`} />
                <div>
                  <p className="text-sm text-gray-900">{activity.action}</p>
                  <p className="text-xs text-gray-400">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
