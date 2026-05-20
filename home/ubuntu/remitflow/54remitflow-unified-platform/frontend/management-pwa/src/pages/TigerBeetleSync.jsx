import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, RefreshCw, CheckCircle, AlertTriangle, Clock, Activity, Server } from 'lucide-react';
import StatCard from '../components/StatCard';
import { tigerBeetleApi } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const mockSyncData = [
  { time: '00:00', synced: 1200, pending: 50 },
  { time: '04:00', synced: 800, pending: 30 },
  { time: '08:00', synced: 2500, pending: 120 },
  { time: '12:00', synced: 3800, pending: 80 },
  { time: '16:00', synced: 4200, pending: 45 },
  { time: '20:00', synced: 2800, pending: 60 },
];

const mockEdgeNodes = [
  { id: 'edge-001', name: 'Lagos Edge', status: 'healthy', lastSync: '30s ago', accounts: 1250, transfers: 4500 },
  { id: 'edge-002', name: 'Abuja Edge', status: 'healthy', lastSync: '45s ago', accounts: 890, transfers: 3200 },
  { id: 'edge-003', name: 'Kano Edge', status: 'syncing', lastSync: '2m ago', accounts: 650, transfers: 2100 },
  { id: 'edge-004', name: 'PH Edge', status: 'healthy', lastSync: '15s ago', accounts: 720, transfers: 2800 },
  { id: 'edge-005', name: 'Ibadan Edge', status: 'warning', lastSync: '5m ago', accounts: 480, transfers: 1500 },
];

export default function TigerBeetleSync() {
  const queryClient = useQueryClient();

  const { data: syncStatus } = useQuery({
    queryKey: ['tigerbeetle-sync-status'],
    queryFn: () => tigerBeetleApi.syncStatus(),
    placeholderData: {
      zigPrimary: 'healthy',
      totalAccounts: 3990,
      totalTransfers: 14100,
      pendingSync: 355,
      lastSyncTime: '2024-01-15T14:30:00Z',
      syncLag: 2.5,
    },
    refetchInterval: 5000,
  });

  const triggerSyncMutation = useMutation({
    mutationFn: () => tigerBeetleApi.triggerSync(),
    onSuccess: () => {
      queryClient.invalidateQueries(['tigerbeetle-sync-status']);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">TigerBeetle Sync</h1>
          <p className="text-gray-500">Monitor bidirectional sync between Zig primary and Go edge instances</p>
        </div>
        <button 
          className="btn btn-primary flex items-center gap-2"
          onClick={() => triggerSyncMutation.mutate()}
          disabled={triggerSyncMutation.isPending}
        >
          <RefreshCw size={18} className={triggerSyncMutation.isPending ? 'animate-spin' : ''} />
          Trigger Sync
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard 
          title="Zig Primary" 
          value={syncStatus?.zigPrimary === 'healthy' ? 'Healthy' : 'Warning'} 
          icon={Server} 
          color={syncStatus?.zigPrimary === 'healthy' ? 'success' : 'warning'} 
        />
        <StatCard title="Total Accounts" value={syncStatus?.totalAccounts?.toLocaleString()} icon={Database} color="primary" />
        <StatCard title="Total Transfers" value={syncStatus?.totalTransfers?.toLocaleString()} icon={Activity} color="primary" />
        <StatCard title="Pending Sync" value={syncStatus?.pendingSync} icon={Clock} color="warning" />
        <StatCard title="Sync Lag" value={`${syncStatus?.syncLag}s`} icon={Activity} color="primary" />
      </div>

      {/* Sync Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Sync Activity (24h)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockSyncData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="synced" stroke="#22c55e" strokeWidth={2} dot={false} name="Synced" />
              <Line type="monotone" dataKey="pending" stroke="#f59e0b" strokeWidth={2} dot={false} name="Pending" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Edge Nodes */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Edge Nodes</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Node</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Sync</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accounts</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transfers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mockEdgeNodes.map((node) => (
                <tr key={node.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Database size={16} className="text-primary-600" />
                      <span className="font-medium">{node.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${
                      node.status === 'healthy' ? 'badge-success' :
                      node.status === 'syncing' ? 'bg-blue-100 text-blue-700' :
                      'badge-warning'
                    }`}>
                      {node.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{node.lastSync}</td>
                  <td className="px-4 py-3 text-sm">{node.accounts.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">{node.transfers.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
