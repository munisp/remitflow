import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Server, Database, Radio, Shield, Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import StatCard from '../components/StatCard';
import { healthApi } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const mockServices = [
  { name: 'API Gateway', status: 'healthy', uptime: '99.99%', latency: '12ms', lastCheck: '10s ago' },
  { name: 'TigerBeetle Zig', status: 'healthy', uptime: '99.95%', latency: '8ms', lastCheck: '10s ago' },
  { name: 'TigerBeetle Go Edge', status: 'healthy', uptime: '99.90%', latency: '15ms', lastCheck: '10s ago' },
  { name: 'Fluvio Streaming', status: 'healthy', uptime: '99.98%', latency: '5ms', lastCheck: '10s ago' },
  { name: 'Redis Cache', status: 'healthy', uptime: '99.99%', latency: '2ms', lastCheck: '10s ago' },
  { name: 'PostgreSQL', status: 'healthy', uptime: '99.99%', latency: '10ms', lastCheck: '10s ago' },
  { name: 'Kafka', status: 'warning', uptime: '99.85%', latency: '25ms', lastCheck: '10s ago' },
  { name: 'MQTT Broker', status: 'healthy', uptime: '99.92%', latency: '8ms', lastCheck: '10s ago' },
  { name: 'Keycloak Auth', status: 'healthy', uptime: '99.97%', latency: '45ms', lastCheck: '10s ago' },
  { name: 'Payment Gateway', status: 'healthy', uptime: '99.95%', latency: '120ms', lastCheck: '10s ago' },
];

const mockMetricsData = [
  { time: '00:00', cpu: 35, memory: 62, requests: 1200 },
  { time: '04:00', cpu: 28, memory: 58, requests: 800 },
  { time: '08:00', cpu: 55, memory: 72, requests: 2500 },
  { time: '12:00', cpu: 72, memory: 78, requests: 3800 },
  { time: '16:00', cpu: 68, memory: 75, requests: 4200 },
  { time: '20:00', cpu: 45, memory: 68, requests: 2800 },
];

const getStatusIcon = (status) => {
  switch (status) {
    case 'healthy':
      return <CheckCircle size={16} className="text-success-600" />;
    case 'warning':
      return <AlertTriangle size={16} className="text-warning-600" />;
    case 'error':
      return <XCircle size={16} className="text-danger-600" />;
    default:
      return <Clock size={16} className="text-gray-400" />;
  }
};

export default function SystemHealth() {
  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => healthApi.status(),
    placeholderData: {
      overall: 'healthy',
      uptime: '99.95%',
      activeServices: 10,
      alerts: 1,
      avgLatency: '25ms',
    },
    refetchInterval: 10000,
  });

  const healthyCount = mockServices.filter(s => s.status === 'healthy').length;
  const warningCount = mockServices.filter(s => s.status === 'warning').length;
  const errorCount = mockServices.filter(s => s.status === 'error').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
          <p className="text-gray-500">Monitor platform infrastructure and services</p>
        </div>
        <div className="flex items-center gap-2">
          {health?.overall === 'healthy' ? (
            <span className="flex items-center gap-2 px-3 py-1.5 bg-success-50 text-success-700 rounded-lg text-sm font-medium">
              <CheckCircle size={16} />
              All Systems Operational
            </span>
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 bg-warning-50 text-warning-700 rounded-lg text-sm font-medium">
              <AlertTriangle size={16} />
              Degraded Performance
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard title="Overall Status" value={health?.overall === 'healthy' ? 'Healthy' : 'Warning'} icon={Activity} color={health?.overall === 'healthy' ? 'success' : 'warning'} />
        <StatCard title="Uptime" value={health?.uptime} icon={Clock} color="success" />
        <StatCard title="Healthy Services" value={healthyCount} icon={CheckCircle} color="success" />
        <StatCard title="Warnings" value={warningCount} icon={AlertTriangle} color="warning" />
        <StatCard title="Avg Latency" value={health?.avgLatency} icon={Activity} color="primary" />
      </div>

      {/* Metrics Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">System Metrics (24h)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockMetricsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="cpu" stroke="#ef4444" strokeWidth={2} dot={false} name="CPU %" />
              <Line type="monotone" dataKey="memory" stroke="#3b82f6" strokeWidth={2} dot={false} name="Memory %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Services Grid */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Service Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockServices.map((service) => (
            <div 
              key={service.name} 
              className={`p-4 rounded-lg border ${
                service.status === 'healthy' ? 'border-success-200 bg-success-50/50' :
                service.status === 'warning' ? 'border-warning-200 bg-warning-50/50' :
                'border-danger-200 bg-danger-50/50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(service.status)}
                  <span className="font-medium text-gray-900">{service.name}</span>
                </div>
                <span className={`badge ${
                  service.status === 'healthy' ? 'badge-success' :
                  service.status === 'warning' ? 'badge-warning' :
                  'badge-danger'
                }`}>
                  {service.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-gray-500">Uptime</p>
                  <p className="font-medium">{service.uptime}</p>
                </div>
                <div>
                  <p className="text-gray-500">Latency</p>
                  <p className="font-medium">{service.latency}</p>
                </div>
                <div>
                  <p className="text-gray-500">Last Check</p>
                  <p className="font-medium">{service.lastCheck}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
