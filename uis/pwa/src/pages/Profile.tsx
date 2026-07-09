import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { profileService, type LinkedAccount } from '../services/api';

const Profile: React.FC = () => {
  const { user } = useAuthStore();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    phone: user?.phone || '+234 801 234 5678',
    dateOfBirth: 'January 15, 1990',
    address: '123 Main Street',
    city: 'Victoria Island',
    state: 'Lagos',
    country: 'Nigeria',
  });
  const [linkedAccounts, setLinkedAccounts] = useState([
    { id: '1', bank: 'GTBank', acct: '****4532', color: 'from-orange-400 to-orange-500' },
    { id: '2', bank: 'Access Bank', acct: '****8901', color: 'from-indigo-400 to-indigo-500' },
  ]);
  const stats = { transactions: '156', totalSent: '2.5M', totalReceived: '1.8M', beneficiaries: '12' };

  const fetchProfile = useCallback(async () => {
    try {
      const res = await profileService.getProfile();
      const data = res.data;
      if (data) {
        setProfile(prev => ({
          firstName: data.firstName || prev.firstName,
          lastName: data.lastName || prev.lastName,
          email: data.email || prev.email,
          phone: data.phone || prev.phone,
          dateOfBirth: data.dateOfBirth || prev.dateOfBirth,
          address: data.address || prev.address,
          city: data.city || prev.city,
          state: data.state || prev.state,
          country: data.country || prev.country,
        }));
      }
      const accountsRes = await profileService.getLinkedAccounts();
      const accounts: LinkedAccount[] = accountsRes.data;
      if (accounts.length > 0) {
        setLinkedAccounts(accounts.map((a: LinkedAccount, i: number) => ({
          id: a.id,
          bank: a.bankName,
          acct: `****${a.accountNumber.slice(-4)}`,
          color: i % 2 === 0 ? 'from-orange-400 to-orange-500' : 'from-indigo-400 to-indigo-500',
        })));
      }
    } catch { /* use defaults */ }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await profileService.updateProfile({
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        country: profile.country,
      });
      setEditing(false);
    } catch { /* show error */ }
    finally { setSaving(false); }
  };

  const handleUnlinkAccount = async (id: string) => {
    setLinkedAccounts(prev => prev.filter(a => a.id !== id));
    try { await profileService.unlinkAccount(id); } catch { /* optimistic */ }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">My Profile</h1><p className="text-slate-500 mt-1">Manage your personal information</p></div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
        <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto shadow-lg shadow-indigo-200">
          {profile.firstName?.[0]}{profile.lastName?.[0]}
        </div>
        <h2 className="text-xl font-bold text-slate-900 mt-4">{profile.firstName} {profile.lastName}</h2>
        <p className="text-slate-500 text-sm">{profile.email}</p>
        <div className="flex justify-center gap-2 mt-3">
          <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${user?.kycStatus === 'verified' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {user?.kycStatus === 'verified' ? 'Verified' : 'Pending Verification'}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold text-slate-900">Personal Information</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="text-indigo-600 text-sm font-semibold hover:text-indigo-500">Edit</button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="text-slate-500 text-sm font-medium">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="text-indigo-600 text-sm font-semibold">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3.5 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">First Name</p>
              {editing ? <input value={profile.firstName} onChange={(e) => setProfile({...profile, firstName: e.target.value})} className="text-sm font-semibold text-slate-900 bg-transparent w-full outline-none" /> : <p className="text-sm font-semibold text-slate-900">{profile.firstName || 'John'}</p>}
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Last Name</p>
              {editing ? <input value={profile.lastName} onChange={(e) => setProfile({...profile, lastName: e.target.value})} className="text-sm font-semibold text-slate-900 bg-transparent w-full outline-none" /> : <p className="text-sm font-semibold text-slate-900">{profile.lastName || 'Doe'}</p>}
            </div>
          </div>
          <div className="p-3.5 bg-slate-50 rounded-xl"><p className="text-xs text-slate-400 mb-1">Email Address</p><p className="text-sm font-semibold text-slate-900">{profile.email || 'john.doe@example.com'}</p></div>
          <div className="p-3.5 bg-slate-50 rounded-xl">
            <p className="text-xs text-slate-400 mb-1">Phone Number</p>
            {editing ? <input value={profile.phone} onChange={(e) => setProfile({...profile, phone: e.target.value})} className="text-sm font-semibold text-slate-900 bg-transparent w-full outline-none" /> : <p className="text-sm font-semibold text-slate-900">{profile.phone}</p>}
          </div>
          <div className="p-3.5 bg-slate-50 rounded-xl"><p className="text-xs text-slate-400 mb-1">Date of Birth</p><p className="text-sm font-semibold text-slate-900">{profile.dateOfBirth}</p></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold text-slate-900">Address</h2>
          <button onClick={() => setEditing(true)} className="text-indigo-600 text-sm font-semibold hover:text-indigo-500">Edit</button>
        </div>
        <div className="p-3.5 bg-slate-50 rounded-xl space-y-1">
          <p className="text-sm font-semibold text-slate-900">{profile.address}</p>
          <p className="text-sm text-slate-600">{profile.city}</p>
          <p className="text-sm text-slate-600">{profile.state}, {profile.country}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Linked Accounts</h2>
        <div className="space-y-2">
          {linkedAccounts.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 bg-gradient-to-br ${item.color} rounded-xl flex items-center justify-center`}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg>
                </div>
                <div><p className="text-sm font-semibold text-slate-900">{item.bank}</p><p className="text-xs text-slate-400 font-mono">{item.acct}</p></div>
              </div>
              <button onClick={() => handleUnlinkAccount(item.id)} className="text-red-500 text-xs font-semibold hover:text-red-400">Remove</button>
            </div>
          ))}
          <button className="w-full p-3.5 border-2 border-dashed border-slate-200 rounded-xl text-indigo-600 text-sm font-semibold hover:border-indigo-300 hover:bg-indigo-50/30 transition-all">+ Link New Account</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Account Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[{ value: stats.transactions, label: 'Transactions', color: 'text-indigo-600 bg-indigo-50' },{ value: stats.totalSent, label: 'Total Sent', color: 'text-emerald-600 bg-emerald-50' },{ value: stats.totalReceived, label: 'Total Received', color: 'text-violet-600 bg-violet-50' },{ value: stats.beneficiaries, label: 'Beneficiaries', color: 'text-amber-600 bg-amber-50' }].map((stat) => (
            <div key={stat.label} className={`text-center p-4 rounded-xl ${stat.color.split(' ')[1]}`}>
              <p className={`text-xl font-bold ${stat.color.split(' ')[0]}`}>{stat.value}</p>
              <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Profile;
