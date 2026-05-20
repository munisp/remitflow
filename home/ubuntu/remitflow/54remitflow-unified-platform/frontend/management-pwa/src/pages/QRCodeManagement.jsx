import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QrCode, Plus, Download, Eye, Clock, CheckCircle } from 'lucide-react';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import { qrApi } from '../services/api';

const mockQRCodes = [
  { id: 'QR001', type: 'Payment', merchant: 'Store A', amount: 5000, status: 'active', scans: 45, created: '2024-01-15', expires: '2024-02-15' },
  { id: 'QR002', type: 'Product', merchant: 'Store B', amount: null, status: 'active', scans: 120, created: '2024-01-14', expires: '2024-07-14' },
  { id: 'QR003', type: 'Payment', merchant: 'Store C', amount: 10000, status: 'expired', scans: 23, created: '2024-01-01', expires: '2024-01-10' },
  { id: 'QR004', type: 'Dynamic', merchant: 'Store D', amount: null, status: 'active', scans: 89, created: '2024-01-12', expires: '2024-04-12' },
  { id: 'QR005', type: 'Payment', merchant: 'Store E', amount: 25000, status: 'used', scans: 1, created: '2024-01-15', expires: '2024-01-16' },
];

const columns = [
  { key: 'id', label: 'QR ID' },
  { 
    key: 'type', 
    label: 'Type',
    render: (value) => (
      <span className={`badge ${
        value === 'Payment' ? 'bg-blue-100 text-blue-700' :
        value === 'Product' ? 'bg-green-100 text-green-700' :
        'bg-purple-100 text-purple-700'
      }`}>
        {value}
      </span>
    )
  },
  { key: 'merchant', label: 'Merchant' },
  { key: 'amount', label: 'Amount', render: (v) => v ? `₦${v.toLocaleString()}` : '-' },
  { 
    key: 'status', 
    label: 'Status',
    render: (value) => (
      <span className={`badge ${
        value === 'active' ? 'badge-success' :
        value === 'expired' ? 'badge-danger' :
        'badge-warning'
      }`}>
        {value}
      </span>
    )
  },
  { key: 'scans', label: 'Scans' },
  { key: 'created', label: 'Created' },
  { key: 'expires', label: 'Expires' },
];

export default function QRCodeManagement() {
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const { data: qrCodes = mockQRCodes } = useQuery({
    queryKey: ['qr-codes'],
    queryFn: () => qrApi.list(),
    placeholderData: mockQRCodes,
  });

  const stats = {
    total: qrCodes.length,
    active: qrCodes.filter(q => q.status === 'active').length,
    totalScans: qrCodes.reduce((sum, q) => sum + q.scans, 0),
    expired: qrCodes.filter(q => q.status === 'expired').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">QR Code Management</h1>
          <p className="text-gray-500">Generate and manage QR codes for payments and products</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2" onClick={() => setShowGenerateModal(true)}>
          <Plus size={18} />
          Generate QR Code
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total QR Codes" value={stats.total} icon={QrCode} color="primary" />
        <StatCard title="Active" value={stats.active} icon={CheckCircle} color="success" />
        <StatCard title="Total Scans" value={stats.totalScans} icon={Eye} color="primary" />
        <StatCard title="Expired" value={stats.expired} icon={Clock} color="danger" />
      </div>

      {/* QR Code Table */}
      <DataTable 
        columns={columns} 
        data={qrCodes}
        actions={(row) => (
          <div className="flex items-center gap-2">
            <button className="p-1 hover:bg-gray-100 rounded" title="View">
              <Eye size={16} className="text-gray-500" />
            </button>
            <button className="p-1 hover:bg-gray-100 rounded" title="Download">
              <Download size={16} className="text-gray-500" />
            </button>
          </div>
        )}
      />
    </div>
  );
}
