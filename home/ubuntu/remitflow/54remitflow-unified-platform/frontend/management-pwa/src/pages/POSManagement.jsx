import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Wifi, WifiOff, Settings, Activity, MapPin } from 'lucide-react';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import { posApi } from '../services/api';

const mockTerminals = [
  { id: 'POS001', merchant: 'Store A', location: 'Lagos', status: 'online', lastTransaction: '2 min ago', dailyVolume: 450000, transactions: 45 },
  { id: 'POS002', merchant: 'Store B', location: 'Abuja', status: 'online', lastTransaction: '5 min ago', dailyVolume: 320000, transactions: 32 },
  { id: 'POS003', merchant: 'Store C', location: 'Kano', status: 'offline', lastTransaction: '2 hours ago', dailyVolume: 180000, transactions: 18 },
  { id: 'POS004', merchant: 'Store D', location: 'Port Harcourt', status: 'online', lastTransaction: '1 min ago', dailyVolume: 520000, transactions: 52 },
  { id: 'POS005', merchant: 'Store E', location: 'Ibadan', status: 'maintenance', lastTransaction: '1 day ago', dailyVolume: 0, transactions: 0 },
];

const columns = [
  { key: 'id', label: 'Terminal ID' },
  { key: 'merchant', label: 'Merchant' },
  { 
    key: 'location', 
    label: 'Location',
    render: (value) => (
      <div className="flex items-center gap-1">
        <MapPin size={14} className="text-gray-400" />
        {value}
      </div>
    )
  },
  { 
    key: 'status', 
    label: 'Status',
    render: (value) => (
      <div className="flex items-center gap-2">
        {value === 'online' ? <Wifi size={14} className="text-success-600" /> :
         value === 'offline' ? <WifiOff size={14} className="text-danger-600" /> :
         <Settings size={14} className="text-warning-600" />}
        <span className={`badge ${
          value === 'online' ? 'badge-success' :
          value === 'offline' ? 'badge-danger' :
          'badge-warning'
        }`}>
          {value}
        </span>
      </div>
    )
  },
  { key: 'lastTransaction', label: 'Last Transaction' },
  { key: 'transactions', label: 'Today\'s Txns' },
  { key: 'dailyVolume', label: 'Daily Volume', render: (v) => `₦${v.toLocaleString()}` },
];

export default function POSManagement() {
  const [filter, setFilter] = useState('all');

  const { data: terminals = mockTerminals } = useQuery({
    queryKey: ['pos-terminals'],
    queryFn: () => posApi.list(),
    placeholderData: mockTerminals,
  });

  const filteredTerminals = filter === 'all' 
    ? terminals 
    : terminals.filter(t => t.status === filter);

  const stats = {
    total: terminals.length,
    online: terminals.filter(t => t.status === 'online').length,
    offline: terminals.filter(t => t.status === 'offline').length,
    totalVolume: terminals.reduce((sum, t) => sum + t.dailyVolume, 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">POS Management</h1>
          <p className="text-gray-500">Monitor and manage POS terminals</p>
        </div>
        <div className="flex items-center gap-2">
          {['all', 'online', 'offline', 'maintenance'].map((status) => (
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Terminals" value={stats.total} icon={CreditCard} color="primary" />
        <StatCard title="Online" value={stats.online} icon={Wifi} color="success" />
        <StatCard title="Offline" value={stats.offline} icon={WifiOff} color="danger" />
        <StatCard title="Daily Volume" value={`₦${(stats.totalVolume/1000000).toFixed(2)}M`} icon={Activity} color="primary" />
      </div>

      {/* Terminal Table */}
      <DataTable columns={columns} data={filteredTerminals} />
    </div>
  );
}
