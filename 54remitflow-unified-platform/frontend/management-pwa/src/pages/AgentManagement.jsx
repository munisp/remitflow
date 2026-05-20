import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Plus, Search, Filter, MoreVertical, Eye, Edit, Trash2 } from 'lucide-react';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import { agentApi } from '../services/api';

const mockAgents = [
  { id: 1, name: 'John Doe', email: 'john@example.com', tier: 'Master Agent', status: 'active', transactions: 1250, volume: 2500000, region: 'Lagos' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com', tier: 'Super Agent', status: 'active', transactions: 890, volume: 1800000, region: 'Abuja' },
  { id: 3, name: 'Mike Johnson', email: 'mike@example.com', tier: 'Agent', status: 'pending', transactions: 450, volume: 950000, region: 'Kano' },
  { id: 4, name: 'Sarah Williams', email: 'sarah@example.com', tier: 'Sub Agent', status: 'active', transactions: 320, volume: 640000, region: 'Port Harcourt' },
  { id: 5, name: 'David Brown', email: 'david@example.com', tier: 'Trainee', status: 'inactive', transactions: 120, volume: 240000, region: 'Ibadan' },
];

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { 
    key: 'tier', 
    label: 'Tier',
    render: (value) => (
      <span className={`badge ${
        value === 'Master Agent' ? 'bg-purple-100 text-purple-700' :
        value === 'Super Agent' ? 'bg-blue-100 text-blue-700' :
        value === 'Agent' ? 'bg-green-100 text-green-700' :
        value === 'Sub Agent' ? 'bg-yellow-100 text-yellow-700' :
        'bg-gray-100 text-gray-700'
      }`}>
        {value}
      </span>
    )
  },
  { 
    key: 'status', 
    label: 'Status',
    render: (value) => (
      <span className={`badge ${
        value === 'active' ? 'badge-success' :
        value === 'pending' ? 'badge-warning' :
        'badge-danger'
      }`}>
        {value}
      </span>
    )
  },
  { key: 'transactions', label: 'Transactions', render: (v) => v.toLocaleString() },
  { key: 'volume', label: 'Volume', render: (v) => `₦${(v/1000000).toFixed(2)}M` },
  { key: 'region', label: 'Region' },
];

export default function AgentManagement() {
  const [showModal, setShowModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);

  const { data: agents = mockAgents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentApi.list(),
    placeholderData: mockAgents,
  });

  const stats = {
    total: agents.length,
    active: agents.filter(a => a.status === 'active').length,
    pending: agents.filter(a => a.status === 'pending').length,
    totalVolume: agents.reduce((sum, a) => sum + a.volume, 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent Management</h1>
          <p className="text-gray-500">Manage agents across all tiers</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2" onClick={() => setShowModal(true)}>
          <Plus size={18} />
          Add Agent
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Agents" value={stats.total} icon={Users} color="primary" />
        <StatCard title="Active Agents" value={stats.active} icon={Users} color="success" />
        <StatCard title="Pending Approval" value={stats.pending} icon={Users} color="warning" />
        <StatCard title="Total Volume" value={`₦${(stats.totalVolume/1000000).toFixed(1)}M`} icon={Users} color="primary" />
      </div>

      {/* Agent Table */}
      <DataTable
        columns={columns}
        data={agents}
        onRowClick={(agent) => setSelectedAgent(agent)}
        actions={(row) => (
          <div className="flex items-center gap-2">
            <button className="p-1 hover:bg-gray-100 rounded" title="View">
              <Eye size={16} className="text-gray-500" />
            </button>
            <button className="p-1 hover:bg-gray-100 rounded" title="Edit">
              <Edit size={16} className="text-gray-500" />
            </button>
            <button className="p-1 hover:bg-gray-100 rounded" title="Delete">
              <Trash2 size={16} className="text-danger-500" />
            </button>
          </div>
        )}
      />
    </div>
  );
}
