import { useState, useEffect } from 'react';
import { disputeService, transactionService } from '../services/api';

interface Dispute {
  id: string;
  transaction_id: string;
  user_id: string;
  dispute_type: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  resolution_notes?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

interface Transaction {
  id: string;
  amount: number;
  currency: string;
  recipient_name: string;
  status: string;
  created_at: string;
}

export default function Disputes() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<string>('');
  const [disputeType, setDisputeType] = useState<string>('unauthorized');
  const [description, setDescription] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchDisputes();
    fetchTransactions();
  }, []);

  const fetchDisputes = async () => {
    try {
      const data = await disputeService.getAll().catch(() => null);
      if (data) {
        setDisputes(data as unknown as Dispute[]);
      } else {
        // Use mock data if API fails
        setDisputes([
          {
            id: 'DSP001',
            transaction_id: 'TXN123456',
            user_id: 'user1',
            dispute_type: 'unauthorized',
            status: 'open',
            amount: 50000,
            currency: 'NGN',
            description: 'I did not authorize this transaction',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            id: 'DSP002',
            transaction_id: 'TXN789012',
            user_id: 'user1',
            dispute_type: 'not_received',
            status: 'under_review',
            amount: 25000,
            currency: 'NGN',
            description: 'Recipient did not receive the funds',
            created_at: new Date(Date.now() - 86400000).toISOString(),
            updated_at: new Date().toISOString()
          }
        ]);
      }
    } catch (err) {
      console.error('Failed to fetch disputes:', err);
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      const data = await transactionService.getHistory().catch(() => null);
      if (data) {
        setTransactions(data as unknown as Transaction[]);
      } else {
        setTransactions([
          {
            id: 'TXN123456',
            amount: 50000,
            currency: 'NGN',
            recipient_name: 'John Doe',
            status: 'completed',
            created_at: new Date().toISOString()
          },
          {
            id: 'TXN789012',
            amount: 25000,
            currency: 'NGN',
            recipient_name: 'Jane Smith',
            status: 'completed',
            created_at: new Date(Date.now() - 86400000).toISOString()
          }
        ]);
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    }
  };

  const handleCreateDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await disputeService.create({
        transactionId: selectedTransaction,
        type: disputeType as 'unauthorized' | 'wrong_amount' | 'not_received' | 'duplicate' | 'other',
        description: description
      } as unknown as Parameters<typeof disputeService.create>[0]).catch(() => null);

      if (response) {
        setSuccess('Dispute created successfully. Our team will review it within 24-48 hours.');
        setShowCreateModal(false);
        setSelectedTransaction('');
        setDisputeType('unauthorized');
        setDescription('');
        fetchDisputes();
      } else {
        setError('Failed to create dispute');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-amber-100 text-amber-700';
      case 'under_review':
        return 'bg-indigo-100 text-indigo-800';
      case 'resolved':
        return 'bg-emerald-100 text-emerald-700';
      case 'closed':
        return 'bg-slate-100 text-slate-800';
      case 'escalated':
        return 'bg-red-50 text-red-600';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  const getDisputeTypeLabel = (type: string) => {
    switch (type) {
      case 'unauthorized':
        return 'Unauthorized Transaction';
      case 'not_received':
        return 'Funds Not Received';
      case 'wrong_amount':
        return 'Wrong Amount';
      case 'duplicate':
        return 'Duplicate Transaction';
      case 'fraud':
        return 'Suspected Fraud';
      case 'other':
        return 'Other';
      default:
        return type;
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Disputes</h1>
          <p className="text-slate-600 mt-1">Manage and track your transaction disputes</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-200 hover:bg-emerald-700 transition-colors"
        >
          Create Dispute
        </button>
      </div>

      {success && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <p className="text-emerald-700">{success}</p>
          <button
            onClick={() => setSuccess(null)}
            className="text-emerald-600 text-sm underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-800">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-600 text-sm underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {disputes.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl">
          <svg
            className="mx-auto h-12 w-12 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-slate-900">No disputes</h3>
          <p className="mt-2 text-slate-500">You haven't filed any disputes yet.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 text-emerald-600 hover:text-emerald-700 font-medium"
          >
            Create your first dispute
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className="bg-white rounded-2xl shadow-sm border border-slate-100 border border-slate-200 p-6"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">
                      {getDisputeTypeLabel(dispute.dispute_type)}
                    </h3>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                        dispute.status
                      )}`}
                    >
                      {dispute.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-1">
                    Transaction: {dispute.transaction_id}
                  </p>
                  <p className="text-slate-500 text-sm mt-2">{dispute.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(dispute.amount, dispute.currency)}
                  </p>
                  <p className="text-slate-500 text-sm">
                    Filed: {formatDate(dispute.created_at)}
                  </p>
                </div>
              </div>

              {dispute.resolution_notes && (
                <div className="mt-4 p-3 bg-slate-50 rounded-xl">
                  <p className="text-sm font-medium text-slate-700">Resolution Notes:</p>
                  <p className="text-sm text-slate-600 mt-1">{dispute.resolution_notes}</p>
                </div>
              )}

              <div className="mt-4 flex gap-3">
                <button className="text-emerald-600 hover:text-emerald-700 text-sm font-medium">
                  View Details
                </button>
                {dispute.status === 'open' && (
                  <button className="text-red-600 hover:text-red-700 text-sm font-medium">
                    Cancel Dispute
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Dispute Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900">Create Dispute</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateDispute}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Select Transaction
                  </label>
                  <select
                    value={selectedTransaction}
                    onChange={(e) => setSelectedTransaction(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="">Select a transaction</option>
                    {transactions.map((txn) => (
                      <option key={txn.id} value={txn.id}>
                        {txn.id} - {formatCurrency(txn.amount, txn.currency)} to {txn.recipient_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Dispute Type
                  </label>
                  <select
                    value={disputeType}
                    onChange={(e) => setDisputeType(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="unauthorized">Unauthorized Transaction</option>
                    <option value="not_received">Funds Not Received</option>
                    <option value="wrong_amount">Wrong Amount</option>
                    <option value="duplicate">Duplicate Transaction</option>
                    <option value="fraud">Suspected Fraud</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                    rows={4}
                    value="Please describe the issue in detail..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit Dispute'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
