/**
 * All Remaining Pages - Consolidated implementation
 * 
 * This file contains all remaining page implementations:
 * - TransactionsPage
 * - TransactionDetailsPage
 * - BeneficiariesPage
 * - SendMoneyPage
 * - ProfilePage
 * - SettingsPage
 * - NotificationsPage
 * - HelpPage
 * 
 * Each page is exported individually and can be moved to separate files if needed.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout';
import { useTransactions, useBeneficiaries, useAuth, useUser } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Loading } from '@/components/ui/Loading';
import { Table } from '@/components/ui/Table';
import { Pagination } from '@/components/ui/Pagination';
import { TransactionFilter, TransactionStatus, FeeBreakdown } from '@/components/transaction';
import { BeneficiaryForm, ProfileForm, PasswordForm } from '@/components/forms';
import {
  Search,
  Filter,
  Download,
  Plus,
  Send,
  ArrowLeft,
  Edit,
  Trash2,
  Star,
  Bell,
  Shield,
  HelpCircle,
  Check,
  X,
} from 'lucide-react';

// ============================================================================
// TRANSACTIONS PAGE
// ============================================================================

export function TransactionsPage() {
  const { transactions, isLoading, error, fetchTransactions } = useTransactions();
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    fetchTransactions(filters);
  }, [filters]);

  const filteredTransactions = transactions.filter(t =>
    t.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.recipient?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Transactions</h1>
          <Button onClick={() => window.print()}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}

        <Card className="p-6">
          <div className="flex items-center space-x-4 mb-6">
            <div className="flex-1">
              <Input
                placeholder="Search transactions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                icon={Search}
              />
            </div>
            <TransactionFilter onFilterChange={setFilters} />
          </div>

          {isLoading ? (
            <Loading />
          ) : (
            <>
              <Table
                columns={[
                  { key: 'reference', label: 'Reference' },
                  { key: 'date', label: 'Date' },
                  { key: 'recipient', label: 'Recipient' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'status', label: 'Status', render: (row) => <TransactionStatus status={row.status} /> },
                ]}
                data={paginatedTransactions}
                onRowClick={(row) => window.location.href = `/transactions/${row.id}`}
              />
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(filteredTransactions.length / pageSize)}
                pageSize={pageSize}
                totalItems={filteredTransactions.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ============================================================================
// TRANSACTION DETAILS PAGE
// ============================================================================

export function TransactionDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { transactions, getTransactionById } = useTransactions();
  const [transaction, setTransaction] = useState(null);

  useEffect(() => {
    const txn = getTransactionById(id);
    setTransaction(txn);
  }, [id]);

  if (!transaction) {
    return (
      <DashboardLayout>
        <Loading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">Transaction Details</h1>
            <TransactionStatus status={transaction.status} size="lg" />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="text-sm text-gray-600">Reference</label>
              <p className="font-medium">{transaction.reference}</p>
            </div>
            <div>
              <label className="text-sm text-gray-600">Date</label>
              <p className="font-medium">{new Date(transaction.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <label className="text-sm text-gray-600">Recipient</label>
              <p className="font-medium">{transaction.recipient}</p>
            </div>
            <div>
              <label className="text-sm text-gray-600">Amount</label>
              <p className="font-medium text-lg">₦{transaction.amount.toLocaleString()}</p>
            </div>
          </div>

          <div className="mt-6">
            <FeeBreakdown
              items={[
                { label: 'Amount', amount: transaction.amount },
                { label: 'Fee', amount: transaction.fee || 0 },
                { label: 'Total', amount: transaction.amount + (transaction.fee || 0), isTotal: true },
              ]}
            />
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ============================================================================
// BENEFICIARIES PAGE
// ============================================================================

export function BeneficiariesPage() {
  const { beneficiaries, isLoading, error, createBeneficiary, updateBeneficiary, deleteBeneficiary } = useBeneficiaries();
  const [showForm, setShowForm] = useState(false);
  const [editingBeneficiary, setEditingBeneficiary] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredBeneficiaries = beneficiaries.filter(b =>
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.accountNumber.includes(searchTerm)
  );

  const handleSubmit = async (data) => {
    if (editingBeneficiary) {
      await updateBeneficiary(editingBeneficiary.id, data);
    } else {
      await createBeneficiary(data);
    }
    setShowForm(false);
    setEditingBeneficiary(null);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Beneficiaries</h1>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Beneficiary
          </Button>
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}

        <Card className="p-6">
          <Input
            placeholder="Search beneficiaries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon={Search}
            className="mb-6"
          />

          {isLoading ? (
            <Loading />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBeneficiaries.map((beneficiary) => (
                <Card key={beneficiary.id} className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{beneficiary.name}</h3>
                      <p className="text-sm text-gray-600">{beneficiary.bankName}</p>
                      <p className="text-sm text-gray-600">{beneficiary.accountNumber}</p>
                    </div>
                    {beneficiary.isFavorite && (
                      <Star className="w-5 h-5 text-yellow-500 fill-current" />
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      setEditingBeneficiary(beneficiary);
                      setShowForm(true);
                    }}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => deleteBeneficiary(beneficiary.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Link to={`/send-money?beneficiary=${beneficiary.id}`}>
                      <Button size="sm">
                        <Send className="w-4 h-4 mr-1" />
                        Send
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>

        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="p-6 max-w-2xl w-full mx-4">
              <h2 className="text-xl font-bold mb-4">
                {editingBeneficiary ? 'Edit' : 'Add'} Beneficiary
              </h2>
              <BeneficiaryForm
                initialData={editingBeneficiary}
                onSubmit={handleSubmit}
                onCancel={() => {
                  setShowForm(false);
                  setEditingBeneficiary(null);
                }}
              />
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ============================================================================
// SEND MONEY PAGE
// ============================================================================

export function SendMoneyPage() {
  const navigate = useNavigate();
  const { beneficiaries } = useBeneficiaries();
  const { createTransaction } = useTransactions();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    beneficiaryId: '',
    amount: '',
    description: '',
  });

  const handleSubmit = async () => {
    await createTransaction(formData);
    navigate('/transactions');
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Send Money</h1>

        <Card className="p-6">
          {/* Step indicator */}
          <div className="flex items-center justify-between mb-8">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step >= s ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}>
                  {s}
                </div>
                {s < 3 && <div className="w-24 h-1 bg-gray-200 mx-2" />}
              </div>
            ))}
          </div>

          {/* Step 1: Select Beneficiary */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Select Beneficiary</h2>
              <div className="grid gap-3">
                {beneficiaries.map((b) => (
                  <Card
                    key={b.id}
                    className={`p-4 cursor-pointer ${
                      formData.beneficiaryId === b.id ? 'border-blue-600' : ''
                    }`}
                    onClick={() => setFormData({ ...formData, beneficiaryId: b.id })}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{b.name}</p>
                        <p className="text-sm text-gray-600">{b.bankName} - {b.accountNumber}</p>
                      </div>
                      {formData.beneficiaryId === b.id && (
                        <Check className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
              <Button onClick={() => setStep(2)} disabled={!formData.beneficiaryId} className="w-full">
                Continue
              </Button>
            </div>
          )}

          {/* Step 2: Enter Amount */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Enter Amount</h2>
              <Input
                type="number"
                placeholder="Amount"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              />
              <Input
                placeholder="Description (optional)"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
              <div className="flex space-x-3">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                  Back
                </Button>
                <Button onClick={() => setStep(3)} disabled={!formData.amount} className="flex-1">
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Review & Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Review & Confirm</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600">Beneficiary</label>
                  <p className="font-medium">
                    {beneficiaries.find(b => b.id === formData.beneficiaryId)?.name}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Amount</label>
                  <p className="font-medium text-lg">₦{parseFloat(formData.amount).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex space-x-3">
                <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                  Back
                </Button>
                <Button onClick={handleSubmit} className="flex-1">
                  Confirm & Send
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ============================================================================
// PROFILE PAGE
// ============================================================================

export function ProfilePage() {
  const { user, updateProfile } = useUser();
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = async (data) => {
    await updateProfile(data);
    setIsEditing(false);
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Profile</h1>
          <Button onClick={() => setIsEditing(!isEditing)}>
            {isEditing ? 'Cancel' : 'Edit Profile'}
          </Button>
        </div>

        <Card className="p-6">
          <ProfileForm
            initialData={user}
            onSubmit={handleSubmit}
            readOnly={!isEditing}
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ============================================================================
// SETTINGS PAGE
// ============================================================================

export function SettingsPage() {
  const { changePassword } = useAuth();

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Security</h2>
          <PasswordForm onSubmit={changePassword} />
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Notifications</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-gray-600">Receive transaction alerts via email</p>
              </div>
              <input type="checkbox" className="toggle" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">SMS Notifications</p>
                <p className="text-sm text-gray-600">Receive transaction alerts via SMS</p>
              </div>
              <input type="checkbox" className="toggle" />
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ============================================================================
// NOTIFICATIONS PAGE
// ============================================================================

export function NotificationsPage() {
  const [notifications, setNotifications] = useState([
    { id: 1, title: 'Transaction Completed', message: 'Your transfer was successful', time: '5m ago', unread: true },
    { id: 2, title: 'KYC Update', message: 'Please update your documents', time: '1h ago', unread: true },
    { id: 3, title: 'New Beneficiary', message: 'John Doe was added', time: '2h ago', unread: false },
  ]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Notifications</h1>
          <Button variant="outline">Mark all as read</Button>
        </div>

        <Card>
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`p-4 border-b last:border-b-0 ${
                notification.unread ? 'bg-blue-50/50' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium">{notification.title}</p>
                  <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{notification.time}</p>
                </div>
                {notification.unread && (
                  <div className="w-2 h-2 bg-blue-600 rounded-full mt-1" />
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ============================================================================
// HELP PAGE
// ============================================================================

export function HelpPage() {
  const faqs = [
    { q: 'How do I send money?', a: 'Click on "Send Money" and follow the steps to select a beneficiary and enter the amount.' },
    { q: 'What are the transaction fees?', a: 'Fees vary based on the amount. Check the fee breakdown before confirming.' },
    { q: 'How long do transactions take?', a: 'Most transactions are completed within minutes.' },
  ];

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Help & Support</h1>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div key={index}>
                <p className="font-medium">{faq.q}</p>
                <p className="text-sm text-gray-600 mt-1">{faq.a}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Contact Support</h2>
          <p className="text-gray-600 mb-4">Can't find what you're looking for? Contact our support team.</p>
          <Button>
            <HelpCircle className="w-4 h-4 mr-2" />
            Contact Support
          </Button>
        </Card>
      </div>
    </DashboardLayout>
  );
}

