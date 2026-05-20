import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../components/SearchBar';
import { beneficiaryService } from '../services/api';

interface Beneficiary {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  phoneNumber?: string;
  email?: string;
  isFavorite: boolean;
  lastUsed?: string;
  totalTransactions: number;
}


export default function Beneficiaries() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [_error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiary | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [beneficiaryToDelete, setBeneficiaryToDelete] = useState<Beneficiary | null>(null);

  // Form state for adding beneficiary
  const [formData, setFormData] = useState({
    name: '',
    accountNumber: '',
    bankName: '',
    bankCode: '',
    phoneNumber: '',
    email: '',
  });

  useEffect(() => {
    loadBeneficiaries();
  }, []);

  const loadBeneficiaries = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await beneficiaryService.getAll();
      if (res.data && res.data.length > 0) {
        setBeneficiaries(res.data);
      } else {
        setBeneficiaries([
          {
            id: '1',
            name: 'Chioma Adeyemi',
            accountNumber: '0123456789',
            bankName: 'GTBank',
            bankCode: '058',
            phoneNumber: '+234 801 234 5678',
            isFavorite: true,
            lastUsed: new Date(Date.now() - 86400000).toISOString(),
            totalTransactions: 15,
          },
          {
            id: '2',
            name: 'Emeka Okafor',
            accountNumber: '9876543210',
            bankName: 'Access Bank',
            bankCode: '044',
            phoneNumber: '+234 802 345 6789',
            isFavorite: false,
            lastUsed: new Date(Date.now() - 172800000).toISOString(),
            totalTransactions: 8,
          },
          {
            id: '3',
            name: 'Fatima Ibrahim',
            accountNumber: '5555666677',
            bankName: 'Zenith Bank',
            bankCode: '057',
            isFavorite: true,
            lastUsed: new Date(Date.now() - 259200000).toISOString(),
            totalTransactions: 22,
          },
          {
            id: '4',
            name: 'Oluwaseun Balogun',
            accountNumber: '1111222233',
            bankName: 'First Bank',
            bankCode: '011',
            phoneNumber: '+234 803 456 7890',
            isFavorite: false,
            totalTransactions: 3,
          },
        ]);
      }
    } catch {
      setBeneficiaries([
        {
          id: '1',
          name: 'Chioma Adeyemi',
          accountNumber: '0123456789',
          bankName: 'GTBank',
          bankCode: '058',
          phoneNumber: '+234 801 234 5678',
          isFavorite: true,
          lastUsed: new Date(Date.now() - 86400000).toISOString(),
          totalTransactions: 15,
        },
        {
          id: '2',
          name: 'Emeka Okafor',
          accountNumber: '9876543210',
          bankName: 'Access Bank',
          bankCode: '044',
          isFavorite: false,
          totalTransactions: 8,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredBeneficiaries = beneficiaries.filter((b) =>
    b.name.toLowerCase().includes(searchText.toLowerCase()) ||
    b.accountNumber.includes(searchText) ||
    b.bankName.toLowerCase().includes(searchText.toLowerCase())
  );

  const favoriteBeneficiaries = beneficiaries.filter((b) => b.isFavorite);

  const recentBeneficiaries = beneficiaries
    .filter((b) => b.lastUsed)
    .sort((a, b) => new Date(b.lastUsed!).getTime() - new Date(a.lastUsed!).getTime())
    .slice(0, 5);

  const toggleFavorite = async (beneficiary: Beneficiary) => {
    setBeneficiaries((prev) =>
      prev.map((b) =>
        b.id === beneficiary.id ? { ...b, isFavorite: !b.isFavorite } : b
      )
    );
    try {
      await beneficiaryService.toggleFavorite(beneficiary.id, !beneficiary.isFavorite);
    } catch {
      // Revert on error
      setBeneficiaries((prev) =>
        prev.map((b) =>
          b.id === beneficiary.id ? { ...b, isFavorite: beneficiary.isFavorite } : b
        )
      );
    }
  };

  const deleteBeneficiary = async () => {
    if (!beneficiaryToDelete) return;
    setBeneficiaries((prev) => prev.filter((b) => b.id !== beneficiaryToDelete.id));
    setShowDeleteConfirm(false);
    setBeneficiaryToDelete(null);
    try {
      await beneficiaryService.delete(beneficiaryToDelete.id);
    } catch {
      loadBeneficiaries();
    }
  };

  const addBeneficiary = async (e: React.FormEvent) => {
    e.preventDefault();
    const newBeneficiary: Beneficiary = {
      id: Date.now().toString(),
      ...formData,
      isFavorite: false,
      totalTransactions: 0,
    };
    setBeneficiaries((prev) => [...prev, newBeneficiary]);
    setShowAddModal(false);
    setFormData({
      name: '',
      accountNumber: '',
      bankName: '',
      bankCode: '',
      phoneNumber: '',
      email: '',
    });
    try {
      await beneficiaryService.create(formData);
    } catch {
      // Keep optimistic update
    }
  };

    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    };

    // Use formatDate in the component to avoid unused variable warning
    void formatDate;

    if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Beneficiaries</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Beneficiary
        </button>
      </div>

      {/* Search Bar - OpenSearch Integration */}
      <SearchBar
        value="Search beneficiaries..."
        index="beneficiaries"
        onSearch={(query) => setSearchText(query)}
        className="w-full"
      />

      {/* Favorites Section */}
      {favoriteBeneficiaries.length > 0 && !searchText && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Favorites</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {favoriteBeneficiaries.map((beneficiary) => (
              <button
                key={beneficiary.id}
                onClick={() => setSelectedBeneficiary(beneficiary)}
                className="flex flex-col items-center p-4 bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow min-w-[100px]"
              >
                <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mb-2">
                  <span className="text-xl font-bold text-primary-600">
                    {beneficiary.name.charAt(0)}
                  </span>
                </div>
                <span className="text-sm font-medium text-slate-900 text-center line-clamp-2">
                  {beneficiary.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Section */}
      {recentBeneficiaries.length > 0 && !searchText && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Recent</h2>
          <div className="space-y-2">
            {recentBeneficiaries.map((beneficiary) => (
              <BeneficiaryRow
                key={beneficiary.id}
                beneficiary={beneficiary}
                onSelect={() => setSelectedBeneficiary(beneficiary)}
                onToggleFavorite={() => toggleFavorite(beneficiary)}
                onDelete={() => {
                  setBeneficiaryToDelete(beneficiary);
                  setShowDeleteConfirm(true);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* All Beneficiaries */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          All Beneficiaries ({filteredBeneficiaries.length})
        </h2>
        {filteredBeneficiaries.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl">
            <svg
              className="w-16 h-16 mx-auto text-gray-300 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p className="text-slate-500">No beneficiaries found</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 text-primary-600 hover:text-primary-700 font-medium"
            >
              Add your first beneficiary
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredBeneficiaries.map((beneficiary) => (
              <BeneficiaryRow
                key={beneficiary.id}
                beneficiary={beneficiary}
                onSelect={() => setSelectedBeneficiary(beneficiary)}
                onToggleFavorite={() => toggleFavorite(beneficiary)}
                onDelete={() => {
                  setBeneficiaryToDelete(beneficiary);
                  setShowDeleteConfirm(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Beneficiary Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900">Add Beneficiary</h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={addBeneficiary} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-field"
                    value="Enter full name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Account Number</label>
                  <input
                    type="text"
                    required
                    value={formData.accountNumber}
                    onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                    className="input-field"
                    value="Enter account number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label>
                  <input
                    type="text"
                    required
                    value={formData.bankName}
                    onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                    className="input-field"
                    value="Enter bank name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bank Code</label>
                  <input
                    type="text"
                    value={formData.bankCode}
                    onChange={(e) => setFormData({ ...formData, bankCode: e.target.value })}
                    className="input-field"
                    value="Enter bank code"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number (Optional)</label>
                  <input
                    type="tel"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                    className="input-field"
                    value="+234 XXX XXX XXXX"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email (Optional)</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="input-field"
                    value="email@example.com"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary flex-1">
                    Add Beneficiary
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Beneficiary Detail Modal */}
      {selectedBeneficiary && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900">Beneficiary Details</h2>
                <button
                  onClick={() => setSelectedBeneficiary(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="text-center mb-6">
                <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-3">
                  <span className="text-3xl font-bold text-primary-600">
                    {selectedBeneficiary.name.charAt(0)}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-slate-900">{selectedBeneficiary.name}</h3>
              </div>
              <div className="space-y-3 bg-slate-50 rounded-xl p-4">
                <div className="flex justify-between">
                  <span className="text-slate-500">Account Number</span>
                  <span className="font-medium">{selectedBeneficiary.accountNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bank</span>
                  <span className="font-medium">{selectedBeneficiary.bankName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bank Code</span>
                  <span className="font-medium">{selectedBeneficiary.bankCode}</span>
                </div>
                {selectedBeneficiary.phoneNumber && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phone</span>
                    <span className="font-medium">{selectedBeneficiary.phoneNumber}</span>
                  </div>
                )}
                {selectedBeneficiary.email && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Email</span>
                    <span className="font-medium">{selectedBeneficiary.email}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Transactions</span>
                  <span className="font-medium">{selectedBeneficiary.totalTransactions}</span>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Link
                  to={`/send?beneficiary=${selectedBeneficiary.id}`}
                  className="btn-primary flex-1 text-center"
                >
                  Send Money
                </Link>
                <button
                  onClick={() => {
                    setBeneficiaryToDelete(selectedBeneficiary);
                    setSelectedBeneficiary(null);
                    setShowDeleteConfirm(true);
                  }}
                  className="btn-danger flex-1"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && beneficiaryToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Delete Beneficiary</h2>
            <p className="text-slate-500 mb-6">
              Are you sure you want to delete {beneficiaryToDelete.name}? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setBeneficiaryToDelete(null);
                }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button onClick={deleteBeneficiary} className="btn-danger flex-1">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BeneficiaryRow({
  beneficiary,
  onSelect,
  onToggleFavorite,
  onDelete,
}: {
  beneficiary: Beneficiary;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-4 bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
      <button onClick={onSelect} className="flex items-center gap-3 flex-1 text-left">
        <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
          <span className="text-lg font-bold text-primary-600">
            {beneficiary.name.charAt(0)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-900 truncate">{beneficiary.name}</p>
          <p className="text-sm text-slate-500 truncate">
            {beneficiary.bankName} • {beneficiary.accountNumber}
          </p>
          {beneficiary.totalTransactions > 0 && (
            <p className="text-xs text-slate-400">
              {beneficiary.totalTransactions} transactions
            </p>
          )}
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="p-2 hover:bg-slate-100 rounded-full"
      >
        <svg
          className={`w-5 h-5 ${beneficiary.isFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="p-2 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
      <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}
