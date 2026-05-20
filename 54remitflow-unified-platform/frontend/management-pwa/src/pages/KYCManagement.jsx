import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck, Clock, CheckCircle, XCircle, Eye, FileText, Camera } from 'lucide-react';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import { kycApi } from '../services/api';

const EMPTY_APPLICATIONS = [];

const columns = [
  { key: 'id', label: 'Application ID' },
  { key: 'name', label: 'Applicant Name' },
  { key: 'type', label: 'Agent Type' },
  { key: 'documentType', label: 'Document Type' },
  { key: 'submittedAt', label: 'Submitted' },
  { 
    key: 'riskScore', 
    label: 'Risk Score',
    render: (value) => (
      <span className={`font-medium ${
        value < 20 ? 'text-success-600' :
        value < 50 ? 'text-warning-600' :
        'text-danger-600'
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
        value === 'approved' ? 'badge-success' :
        value === 'pending' ? 'badge-warning' :
        'badge-danger'
      }`}>
        {value}
      </span>
    )
  },
];

export default function KYCManagement() {
  const [filter, setFilter] = useState('pending');
  const [selectedApplication, setSelectedApplication] = useState(null);
  const queryClient = useQueryClient();

  const { data: applications = EMPTY_APPLICATIONS } = useQuery({
    queryKey: ['kyc-applications'],
    queryFn: () => kycApi.list(),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => kycApi.approve(id),
    onSuccess: () => queryClient.invalidateQueries(['kyc-applications']),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => kycApi.reject(id, reason),
    onSuccess: () => queryClient.invalidateQueries(['kyc-applications']),
  });

  const filteredApplications = filter === 'all' 
    ? applications 
    : applications.filter(a => a.status === filter);

  const stats = {
    total: applications.length,
    pending: applications.filter(a => a.status === 'pending').length,
    approved: applications.filter(a => a.status === 'approved').length,
    rejected: applications.filter(a => a.status === 'rejected').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">KYC Management</h1>
          <p className="text-gray-500">Review and manage KYC applications</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Applications" value={stats.total} icon={FileText} color="primary" />
        <StatCard title="Pending Review" value={stats.pending} icon={Clock} color="warning" />
        <StatCard title="Approved" value={stats.approved} icon={CheckCircle} color="success" />
        <StatCard title="Rejected" value={stats.rejected} icon={XCircle} color="danger" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {['pending', 'approved', 'rejected', 'all'].map((status) => (
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

      {/* Applications Table */}
      <DataTable 
        columns={columns} 
        data={filteredApplications}
        actions={(row) => (
          <div className="flex items-center gap-2">
            <button 
              className="p-1 hover:bg-gray-100 rounded" 
              title="View Details"
              onClick={() => setSelectedApplication(row)}
            >
              <Eye size={16} className="text-gray-500" />
            </button>
            {row.status === 'pending' && (
              <>
                <button 
                  className="p-1 hover:bg-success-50 rounded" 
                  title="Approve"
                  onClick={() => approveMutation.mutate(row.id)}
                >
                  <CheckCircle size={16} className="text-success-600" />
                </button>
                <button 
                  className="p-1 hover:bg-danger-50 rounded" 
                  title="Reject"
                  onClick={() => rejectMutation.mutate({ id: row.id, reason: 'Document verification failed' })}
                >
                  <XCircle size={16} className="text-danger-600" />
                </button>
              </>
            )}
          </div>
        )}
      />

      {/* Application Detail Modal */}
      {selectedApplication && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedApplication(null)}>
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">KYC Application Details</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Application ID</p>
                  <p className="font-medium">{selectedApplication.id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`badge ${
                    selectedApplication.status === 'approved' ? 'badge-success' :
                    selectedApplication.status === 'pending' ? 'badge-warning' :
                    'badge-danger'
                  }`}>
                    {selectedApplication.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Applicant</p>
                  <p className="font-medium">{selectedApplication.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Agent Type</p>
                  <p className="font-medium">{selectedApplication.type}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Document Type</p>
                  <p className="font-medium">{selectedApplication.documentType}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Risk Score</p>
                  <p className={`font-medium ${
                    selectedApplication.riskScore < 20 ? 'text-success-600' :
                    selectedApplication.riskScore < 50 ? 'text-warning-600' :
                    'text-danger-600'
                  }`}>
                    {selectedApplication.riskScore}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <button className="btn btn-secondary" onClick={() => setSelectedApplication(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
