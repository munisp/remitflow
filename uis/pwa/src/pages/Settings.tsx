import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { settingsService } from '../services/api';

type NotificationPreferences = {
  transactions: boolean;
  marketing: boolean;
};

const Toggle = ({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    disabled={disabled}
    aria-pressed={checked}
    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
  >
    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 mt-0.5 ${checked ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
  </button>
);

const Settings: React.FC = () => {
  const [notifications, setNotifications] = useState<NotificationPreferences>({
    transactions: false,
    marketing: false,
  });
  const [saveMessage, setSaveMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchPreferences = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await settingsService.getPreferences();
      const preferences = response.data;
      setNotifications({
        transactions: Boolean(preferences.transactionNotifications),
        marketing: Boolean(preferences.marketingEmails),
      });
    } catch {
      setSaveMessage('Unable to load notification preferences from the backend.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPreferences(); }, [fetchPreferences]);

  const handleToggle = async (key: keyof NotificationPreferences, value: boolean) => {
    const previous = notifications;
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    try {
      await settingsService.updatePreferences({
        transactionNotifications: updated.transactions,
        marketingEmails: updated.marketing,
      });
      setSaveMessage('Preferences saved.');
    } catch {
      setNotifications(previous);
      setSaveMessage('The backend did not accept the preference update.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500 mt-1">Manage backend-backed notification preferences and account security.</p>
        </div>
      </div>

      {saveMessage && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="status">
          {saveMessage}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Security</h2>
        <div className="space-y-3">
          {[
            { title: 'Change Password', description: 'Update your account password through the secured workflow.' },
            { title: 'Transaction PIN', description: 'Set or change your transaction PIN through the secured workflow.' },
            { title: 'Two-Factor Authentication', description: 'Enroll, verify, or disable two-factor authentication.' },
          ].map((item) => (
            <div key={item.title} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
              </div>
              <Link to="/security" className="shrink-0 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                Manage
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Notifications</h2>
        <div className="space-y-3">
          {[
            { key: 'transactions' as const, label: 'Transaction Alerts', description: 'Receive backend-issued transaction notifications.' },
            { key: 'marketing' as const, label: 'Marketing Messages', description: 'Receive marketing communications from the platform.' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
              </div>
              <Toggle checked={notifications[item.key]} disabled={isLoading} onChange={(value) => void handleToggle(item.key, value)} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Settings;
