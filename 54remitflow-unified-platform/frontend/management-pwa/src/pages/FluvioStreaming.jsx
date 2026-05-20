import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, Activity, Database, Zap, ArrowRight, CheckCircle } from 'lucide-react';
import StatCard from '../components/StatCard';
import { fluvioApi } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const mockStreamData = [
  { time: '00:00', messages: 12000, throughput: 450 },
  { time: '04:00', messages: 8000, throughput: 320 },
  { time: '08:00', messages: 25000, throughput: 980 },
  { time: '12:00', messages: 38000, throughput: 1450 },
  { time: '16:00', messages: 42000, throughput: 1680 },
  { time: '20:00', messages: 28000, throughput: 1120 },
];

const mockTopics = [
  { name: 'pos-transactions', partitions: 3, messages: 125000, consumers: 5, status: 'active' },
  { name: 'pos-payment-events', partitions: 3, messages: 89000, consumers: 3, status: 'active' },
  { name: 'pos-device-events', partitions: 2, messages: 45000, consumers: 2, status: 'active' },
  { name: 'pos-fraud-alerts', partitions: 1, messages: 1200, consumers: 4, status: 'active' },
  { name: 'pos-analytics', partitions: 2, messages: 67000, consumers: 2, status: 'active' },
  { name: 'pos-commands', partitions: 1, messages: 3500, consumers: 8, status: 'active' },
];

const mockConsumers = [
  { id: 'consumer-001', group: 'analytics-processor', topic: 'pos-transactions', lag: 120, status: 'active' },
  { id: 'consumer-002', group: 'fraud-detector', topic: 'pos-transactions', lag: 45, status: 'active' },
  { id: 'consumer-003', group: 'notification-service', topic: 'pos-payment-events', lag: 0, status: 'active' },
  { id: 'consumer-004', group: 'audit-logger', topic: 'pos-transactions', lag: 890, status: 'lagging' },
];

export default function FluvioStreaming() {
  const { data: status } = useQuery({
    queryKey: ['fluvio-status'],
    queryFn: () => fluvioApi.status(),
    placeholderData: {
      cluster: 'healthy',
      totalTopics: 6,
      totalMessages: 330700,
      throughput: 1680,
      consumers: 17,
    },
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fluvio Streaming</h1>
          <p className="text-gray-500">Real-time event streaming for POS and platform events</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1 text-success-600">
            <CheckCircle size={16} />
            Cluster healthy
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard title="Cluster Status" value="Healthy" icon={Radio} color="success" />
        <StatCard title="Topics" value={status?.totalTopics} icon={Database} color="primary" />
        <StatCard title="Total Messages" value={`${(status?.totalMessages / 1000).toFixed(0)}K`} icon={Activity} color="primary" />
        <StatCard title="Throughput" value={`${status?.throughput}/s`} icon={Zap} color="success" />
        <StatCard title="Consumers" value={status?.consumers} icon={ArrowRight} color="primary" />
      </div>

      {/* Throughput Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Message Throughput (24h)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mockStreamData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip />
              <Area type="monotone" dataKey="throughput" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Topics */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Topics</h3>
          <div className="space-y-3">
            {mockTopics.map((topic) => (
              <div key={topic.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{topic.name}</p>
                  <p className="text-xs text-gray-500">{topic.partitions} partitions | {topic.consumers} consumers</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{(topic.messages / 1000).toFixed(0)}K</p>
                  <p className="text-xs text-gray-500">messages</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Consumers */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Consumer Groups</h3>
          <div className="space-y-3">
            {mockConsumers.map((consumer) => (
              <div key={consumer.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{consumer.group}</p>
                  <p className="text-xs text-gray-500">{consumer.topic}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className={`font-medium ${consumer.lag > 500 ? 'text-danger-600' : 'text-gray-900'}`}>
                      {consumer.lag}
                    </p>
                    <p className="text-xs text-gray-500">lag</p>
                  </div>
                  <span className={`badge ${consumer.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                    {consumer.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
