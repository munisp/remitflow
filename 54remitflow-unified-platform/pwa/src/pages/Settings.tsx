import React, { useState, useEffect, useCallback } from 'react';
import { settingsService } from '../services/api';

const Settings: React.FC = () => {
  const [notifications, setNotifications] = useState({
    email: true, push: true, sms: false, transactions: true, marketing: false,
  });
  const [saveMessage, setSaveMessage] = useState('');

  const fetchPreferences = useCallback(async () => {
    try {
      const res = await settingsService.getPreferences();
      const prefs = res.data;
      if (prefs) {
        setNotifications({
          email: prefs.transactionNotifications ?? true,
          push: prefs.transactionNotifications ?? true,
          sms: false,
          transactions: prefs.transactionNotifications ?? true,
          marketing: prefs.marketingEmails ?? false,
        });
      }
    } catch { /* use defaults */ }
  }, []);

  useEffect(() => { fetchPreferences(); }, [fetchPreferences]);

  const handleToggle = async (key: string, value: boolean) => {
    const prev = { ...notifications };
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    try {
      await settingsService.updatePreferences({
        transactionNotifications: updated.transactions,
        marketingEmails: updated.marketing,
      });
      setSaveMessage('Saved');
      setTimeout(() => setSaveMessage(''), 2000);
    } catch {
      setNotifications(prev);
      setSaveMessage('Failed to save');
      setTimeout(() => setSaveMessage(''), 2000);
    }
  };

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 mt-0.5 ${checked ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
    </button>
  );

  const inputClass = "w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div><h1 className="text-2xl font-bold text-slate-900">Settings</h1><p className="text-slate-500 mt-1">Manage your preferences</p></div>
        {saveMessage && <span className={`text-sm font-medium ${saveMessage === 'Saved' ? 'text-emerald-600' : 'text-red-500'}`}>{saveMessage}</span>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Security</h2>
        <div className="space-y-3">
          {[{ title: 'Change Password', desc: 'Update your account password', action: 'Change' },{ title: 'Transaction PIN', desc: 'Set or change your 4-digit PIN', action: 'Update' }].map((item) => (
            <div key={item.title} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div><p className="text-sm font-semibold text-slate-900">{item.title}</p><p className="text-xs text-slate-500 mt-0.5">{item.desc}</p></div>
              <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">{item.action}</button>
            </div>
          ))}
          {[{ title: 'Two-Factor Authentication', desc: 'Add extra security layer', key: 'twoFactor' },{ title: 'Biometric Login', desc: 'Use fingerprint or face ID', key: 'biometric' }].map((item) => (
            <div key={item.key} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div><p className="text-sm font-semibold text-slate-900">{item.title}</p><p className="text-xs text-slate-500 mt-0.5">{item.desc}</p></div>
              <Toggle checked={item.key === 'twoFactor'} onChange={() => {}} />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Notifications</h2>
        <div className="space-y-3">
          {[
            { key: 'email', label: 'Email Notifications', desc: 'Receive updates via email' },
            { key: 'push', label: 'Push Notifications', desc: 'Receive push notifications' },
            { key: 'sms', label: 'SMS Notifications', desc: 'Receive SMS alerts' },
            { key: 'transactions', label: 'Transaction Alerts', desc: 'Get notified for every transaction' },
            { key: 'marketing', label: 'Marketing', desc: 'Receive promotional offers' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div><p className="text-sm font-semibold text-slate-900">{item.label}</p><p className="text-xs text-slate-500 mt-0.5">{item.desc}</p></div>
              <Toggle checked={notifications[item.key as keyof typeof notifications]} onChange={(v) => handleToggle(item.key, v)} />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Preferences</h2>
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-slate-700 mb-2">Default Currency</label>
            <select className={inputClass}><option value="NGN">Nigerian Naira (NGN)</option><option value="USD">US Dollar (USD)</option><option value="GBP">British Pound (GBP)</option><option value="EUR">Euro (EUR)</option></select></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-2">Language</label>
            <select className={inputClass}><option value="en">English</option><option value="fr">French</option><option value="yo">Yoruba</option><option value="ig">Igbo</option><option value="ha">Hausa</option></select></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-2">Time Zone</label>
            <select className={inputClass}><option value="WAT">West Africa Time (WAT)</option><option value="GMT">Greenwich Mean Time (GMT)</option><option value="EST">Eastern Standard Time (EST)</option></select></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Account</h2>
        <div className="space-y-3">
          <button className="w-full p-4 text-left bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
            <p className="text-sm font-semibold text-slate-900">Download My Data</p><p className="text-xs text-slate-500 mt-0.5">Get a copy of your account data</p>
          </button>
          <button className="w-full p-4 text-left bg-red-50 rounded-xl hover:bg-red-100 transition-colors">
            <p className="text-sm font-semibold text-red-600">Delete Account</p><p className="text-xs text-red-500 mt-0.5">Permanently delete your account and data</p>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
