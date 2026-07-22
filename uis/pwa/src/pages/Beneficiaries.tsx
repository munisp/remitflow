import React, { useEffect, useMemo, useState } from 'react';
import { SearchBar } from '../components/SearchBar';
import { beneficiaryService } from '../services/api';

type Beneficiary = {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  phoneNumber?: string;
  email?: string;
  isFavorite: boolean;
};

const emptyForm = { name: '', accountNumber: '', bankName: '', bankCode: '', phoneNumber: '', email: '' };

export default function Beneficiaries() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadBeneficiaries = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await beneficiaryService.getAll();
      setBeneficiaries(response.data as Beneficiary[]);
    } catch {
      setBeneficiaries([]);
      setError('Unable to load beneficiaries from the backend.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadBeneficiaries(); }, []);

  const filteredBeneficiaries = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return beneficiaries;
    return beneficiaries.filter((beneficiary) => [beneficiary.name, beneficiary.accountNumber, beneficiary.bankName].some((value) => value.toLowerCase().includes(query)));
  }, [beneficiaries, searchText]);

  const toggleFavorite = async (beneficiary: Beneficiary) => {
    setError('');
    try {
      await beneficiaryService.toggleFavorite(beneficiary.id, !beneficiary.isFavorite);
      await loadBeneficiaries();
    } catch {
      setError('The backend did not accept the favorite update.');
    }
  };

  const deleteBeneficiary = async (beneficiary: Beneficiary) => {
    if (!window.confirm(`Delete ${beneficiary.name}?`)) return;
    setError('');
    try {
      await beneficiaryService.delete(beneficiary.id);
      await loadBeneficiaries();
    } catch {
      setError('The backend did not accept the deletion.');
    }
  };

  const addBeneficiary = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      await beneficiaryService.create({
        name: formData.name,
        accountNumber: formData.accountNumber,
        bankName: formData.bankName,
        bankCode: formData.bankCode,
        phoneNumber: formData.phoneNumber || undefined,
        email: formData.email || undefined,
      });
      setFormData(emptyForm);
      setShowAddModal(false);
      await loadBeneficiaries();
    } catch {
      setError('The backend did not accept the beneficiary creation request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-900">Beneficiaries</h1><p className="text-slate-500">Manage backend-issued beneficiary records.</p></div><button onClick={() => setShowAddModal(true)} className="btn-primary">Add Beneficiary</button></div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
      <SearchBar placeholder="Search beneficiaries..." index="beneficiaries" onSearch={setSearchText} className="w-full" />
      {filteredBeneficiaries.length === 0 ? <div className="rounded-2xl bg-white p-12 text-center text-slate-500">No backend-issued beneficiaries are available.</div> : <div className="space-y-3">{filteredBeneficiaries.map((beneficiary) => <div key={beneficiary.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm"><div><p className="font-semibold text-slate-900">{beneficiary.name}</p><p className="mt-1 text-sm text-slate-600">{beneficiary.bankName} · {beneficiary.accountNumber}</p>{beneficiary.phoneNumber && <p className="mt-1 text-xs text-slate-500">{beneficiary.phoneNumber}</p>}</div><div className="flex items-center gap-2"><button onClick={() => void toggleFavorite(beneficiary)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">{beneficiary.isFavorite ? 'Unfavorite' : 'Favorite'}</button><button onClick={() => void deleteBeneficiary(beneficiary)} className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-700">Delete</button></div></div>)}</div>}
      {showAddModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={addBeneficiary} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-bold text-slate-900">Add Beneficiary</h2><button type="button" onClick={() => setShowAddModal(false)} className="text-slate-500">Close</button></div><label className="block text-sm font-medium text-slate-700">Full Name<input required value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} className="input-field mt-1" placeholder="Enter full name" /></label><label className="block text-sm font-medium text-slate-700">Account Number<input required value={formData.accountNumber} onChange={(event) => setFormData({ ...formData, accountNumber: event.target.value })} className="input-field mt-1" placeholder="Enter account number" /></label><label className="block text-sm font-medium text-slate-700">Bank Name<input required value={formData.bankName} onChange={(event) => setFormData({ ...formData, bankName: event.target.value })} className="input-field mt-1" placeholder="Enter bank name" /></label><label className="block text-sm font-medium text-slate-700">Bank Code<input required value={formData.bankCode} onChange={(event) => setFormData({ ...formData, bankCode: event.target.value })} className="input-field mt-1" placeholder="Enter bank code" /></label><label className="block text-sm font-medium text-slate-700">Phone Number<input value={formData.phoneNumber} onChange={(event) => setFormData({ ...formData, phoneNumber: event.target.value })} className="input-field mt-1" placeholder="Enter phone number" /></label><label className="block text-sm font-medium text-slate-700">Email<input type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} className="input-field mt-1" placeholder="name@example.com" /></label><button type="submit" disabled={isSubmitting} className="btn-primary w-full">{isSubmitting ? 'Submitting…' : 'Create Beneficiary'}</button></form></div>}
    </div>
  );
}
