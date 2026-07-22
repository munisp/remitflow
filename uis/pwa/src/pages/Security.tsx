import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { securityService } from '../services/api';

interface LoginSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  ipAddress: string;
  lastActive: string;
  isCurrent: boolean;
}

interface SecurityEvent {
  id: string;
  type: 'login' | 'password_change' | 'pin_change' | '2fa_enabled' | '2fa_disabled' | 'device_added';
  description: string;
  timestamp: string;
  ipAddress: string;
  location: string;
}

interface SecuritySettings {
  twoFactorEnabled: boolean;
  biometricEnabled: boolean;
  pinEnabled: boolean;
  loginNotifications: boolean;
  transactionPin: boolean;
}


export default function Security() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'activity'>('overview');
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [settings, setSettings] = useState<SecuritySettings>({
    twoFactorEnabled: false,
    biometricEnabled: false,
    pinEnabled: true,
    loginNotifications: true,
    transactionPin: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showSetupPin, setShowSetupPin] = useState(false);
  const [showSetup2FA, setShowSetup2FA] = useState(false);

  // Password change form
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // PIN setup form
  const [pinForm, setPinForm] = useState({
    pin: '',
    confirmPin: '',
  });

  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Two-factor authentication enrollment state
  const [twoFAData, setTwoFAData] = useState<{ qrCode: string; secret: string } | null>(null);
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFABusy, setTwoFABusy] = useState(false);
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disable2FACode, setDisable2FACode] = useState('');

  useEffect(() => {
    loadSecurityData();
  }, []);

  const loadSecurityData = async () => {
    setIsLoading(true);
    setErrorMessage('');
    const [historyResult, settingsResult] = await Promise.allSettled([
      securityService.getLoginHistory(),
      securityService.getSettings(),
    ]);

    if (historyResult.status === 'fulfilled') {
      const history = historyResult.value.data;
      setSessions(history.map((entry) => ({
        id: entry.id,
        device: entry.device,
        browser: 'Not reported by the identity provider',
        location: entry.location,
        ipAddress: entry.ipAddress,
        lastActive: entry.timestamp,
        isCurrent: false,
      })));
      setEvents(history.map((entry) => ({
        id: entry.id,
        type: 'login' as const,
        description: entry.success ? 'Successful sign-in' : 'Failed sign-in',
        timestamp: entry.timestamp,
        ipAddress: entry.ipAddress,
        location: entry.location,
      })));
    } else {
      setSessions([]);
      setEvents([]);
      setErrorMessage('Unable to load security activity from the backend.');
    }

    if (settingsResult.status === 'fulfilled') {
      const backendSettings = settingsResult.value.data;
      setSettings({
        twoFactorEnabled: backendSettings.twoFactorEnabled,
        biometricEnabled: backendSettings.biometricEnabled,
        pinEnabled: backendSettings.transactionPin,
        loginNotifications: backendSettings.loginNotifications,
        transactionPin: backendSettings.transactionPin,
      });
    } else {
      setErrorMessage((current) => current || 'Unable to load security settings from the backend.');
    }
    setIsLoading(false);
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await securityService.revokeDevice(sessionId);
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      setSuccessMessage('Session revoked successfully');
    } catch {
      setErrorMessage('Failed to revoke session');
    }
  };

  const revokeAllSessions = async () => {
    try {
      await securityService.revokeDevice('all');
      setSessions((prev) => prev.filter((session) => session.isCurrent));
      setSuccessMessage('All other sessions revoked');
    } catch {
      setErrorMessage('Failed to revoke sessions');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters');
      return;
    }

    try {
      await securityService.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setSuccessMessage('Password changed successfully');
      setShowChangePassword(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch {
      setErrorMessage('Password change was not accepted by the backend.');
    }
  };

  const handleSetupPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinForm.pin !== pinForm.confirmPin) {
      setErrorMessage('PINs do not match');
      return;
    }
    if (pinForm.pin.length !== 4 && pinForm.pin.length !== 6) {
      setErrorMessage('PIN must be 4 or 6 digits');
      return;
    }

    try {
      await securityService.changePin('', pinForm.pin);
      setSuccessMessage('PIN set up successfully');
      setShowSetupPin(false);
      setPinForm({ pin: '', confirmPin: '' });
      setSettings((prev) => ({ ...prev, pinEnabled: true }));
    } catch {
      setErrorMessage('PIN setup was not accepted by the backend.');
    }
  };

  const toggle2FA = async () => {
    if (settings.twoFactorEnabled) {
      setDisable2FACode('');
      setShowDisable2FA(true);
    } else {
      setTwoFAData(null);
      setTwoFACode('');
      setShowSetup2FA(true);
      setTwoFABusy(true);
      try {
        const response = await securityService.enableTwoFactor();
        setTwoFAData(response.data);
      } catch {
        setErrorMessage('Failed to start two-factor setup. Please try again.');
        setShowSetup2FA(false);
      } finally {
        setTwoFABusy(false);
      }
    }
  };

  const handleVerify2FA = async () => {
    if (twoFACode.length !== 6) {
      setErrorMessage('Enter the 6-digit code from your authenticator app');
      return;
    }
    setTwoFABusy(true);
    try {
      const result = await securityService.verifyTwoFactor(twoFACode);
      if (result.data.verified) {
        setSettings((prev) => ({ ...prev, twoFactorEnabled: true }));
        setShowSetup2FA(false);
        setTwoFAData(null);
        setTwoFACode('');
        setSuccessMessage('Two-factor authentication enabled');
      } else {
        setErrorMessage('Incorrect code. Please try again.');
      }
    } catch {
      setErrorMessage('Failed to verify code. Please try again.');
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleDisable2FA = async () => {
    if (disable2FACode.length !== 6) {
      setErrorMessage('Enter the 6-digit code from your authenticator app');
      return;
    }
    setTwoFABusy(true);
    try {
      await securityService.disableTwoFactor(disable2FACode);
      setSettings((prev) => ({ ...prev, twoFactorEnabled: false }));
      setShowDisable2FA(false);
      setDisable2FACode('');
      setSuccessMessage('Two-factor authentication disabled');
    } catch {
      setErrorMessage('Incorrect code. Please try again.');
    } finally {
      setTwoFABusy(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getEventIcon = (type: SecurityEvent['type']) => {
    switch (type) {
      case 'login':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
        );
      case 'password_change':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        );
      case '2fa_enabled':
      case '2fa_disabled':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('security.title')}</h1>
        <p className="text-slate-500">{t('security.subtitle')}</p>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-emerald-700">{successMessage}</p>
          <button onClick={() => setSuccessMessage('')} className="ml-auto text-emerald-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <p className="text-red-700">{errorMessage}</p>
          <button onClick={() => setErrorMessage('')} className="ml-auto text-red-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
        {(['overview', 'sessions', 'activity'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 px-4 rounded-xl font-medium transition-colors ${
              activeTab === tab
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Security Score */}
          <div className="bg-gradient-to-r from-indigo-500 to-violet-600 rounded-2xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-primary-100">Security Score</p>
                <p className="text-4xl font-bold mt-1">
                  {(settings.twoFactorEnabled ? 25 : 0) +
                    (settings.pinEnabled ? 25 : 0) +
                    (settings.loginNotifications ? 25 : 0) +
                    25}%
                </p>
                <p className="text-primary-100 mt-2">
                  {settings.twoFactorEnabled && settings.pinEnabled ? 'Excellent' : 'Good - Enable 2FA for better security'}
                </p>
              </div>
              <div className="w-20 h-20 rounded-full border-4 border-white/30 flex items-center justify-center">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Security Options */}
          <div className="bg-white rounded-2xl shadow-sm divide-y">
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-50"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="font-medium text-slate-900">Change Password</p>
                  <p className="text-sm text-slate-500">Update your account password</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Two-Factor Authentication</p>
                  <p className="text-sm text-slate-500">Add an extra layer of security</p>
                </div>
              </div>
              <button
                onClick={toggle2FA}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.twoFactorEnabled ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    settings.twoFactorEnabled ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
            </div>

            <button
              onClick={() => setShowSetupPin(true)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-50"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="font-medium text-slate-900">Transaction PIN</p>
                  <p className="text-sm text-slate-500">
                    {settings.pinEnabled ? 'Change your PIN' : 'Set up a PIN for transactions'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {settings.pinEnabled && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">Enabled</span>
                )}
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>

            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Login Notifications</p>
                  <p className="text-sm text-slate-500">Get notified of new logins</p>
                </div>
              </div>
              <button
                onClick={() => setSettings((prev) => ({ ...prev, loginNotifications: !prev.loginNotifications }))}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.loginNotifications ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    settings.loginNotifications ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sessions Tab */}
      {activeTab === 'sessions' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Active Sessions</h2>
            {sessions.filter((s) => !s.isCurrent).length > 0 && (
              <button
                onClick={revokeAllSessions}
                className="text-red-600 hover:text-red-700 text-sm font-medium"
              >
                Sign out all other sessions
              </button>
            )}
          </div>
          <div className="space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                      <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">{session.device}</p>
                        {session.isCurrent && (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">{session.browser}</p>
                      <p className="text-sm text-slate-400">
                        {session.location} • {session.ipAddress}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Last active: {formatTime(session.lastActive)}
                      </p>
                    </div>
                  </div>
                  {!session.isCurrent && (
                    <button
                      onClick={() => revokeSession(session.id)}
                      className="text-red-600 hover:text-red-700 text-sm font-medium"
                    >
                      Sign out
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Tab */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Security Activity</h2>
            <Link to="/login-history" className="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
              View full IP login history
            </Link>
          </div>
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="bg-white rounded-xl p-4 shadow-sm flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                  {getEventIcon(event.type)}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{event.description}</p>
                  <p className="text-sm text-slate-500">
                    {event.location} • {event.ipAddress}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{formatTime(event.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Change Password</h2>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                <input
                  type="password"
                  required
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="input-field"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowChangePassword(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1">
                  Change Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Setup PIN Modal */}
      {showSetupPin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-4">
              {settings.pinEnabled ? 'Change PIN' : 'Set Up PIN'}
            </h2>
            <form onSubmit={handleSetupPin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Enter PIN (4-6 digits)</label>
                <input
                  type="password"
                  required
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  value={pinForm.pin}
                  onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value.replace(/\D/g, '') })}
                  className="input-field text-center text-2xl tracking-widest"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm PIN</label>
                <input
                  type="password"
                  required
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  value={pinForm.confirmPin}
                  onChange={(e) => setPinForm({ ...pinForm, confirmPin: e.target.value.replace(/\D/g, '') })}
                  className="input-field text-center text-2xl tracking-widest"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowSetupPin(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1">
                  {settings.pinEnabled ? 'Change PIN' : 'Set PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Setup 2FA Modal */}
      {showSetup2FA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-4">{t('security.twoFactorAuth')}</h2>
            <div className="space-y-4">
              <p className="text-slate-500">
                {t('security.scanQrCode')}
              </p>
              <div className="bg-slate-100 rounded-xl p-8 flex items-center justify-center">
                {twoFAData?.qrCode ? (
                  <img
                    src={twoFAData.qrCode}
                    alt="Two-factor authentication QR code"
                    className="w-40 h-40 bg-white rounded-xl"
                  />
                ) : (
                  <div className="w-40 h-40 bg-white rounded-xl flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                  </div>
                )}
              </div>
              {twoFAData?.secret && (
                <p className="text-xs text-slate-400 text-center break-all">
                  Can&apos;t scan? Enter this code manually: <span className="font-mono">{twoFAData.secret}</span>
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('security.verificationCode')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, ''))}
                  className="input-field text-center text-2xl tracking-widest"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowSetup2FA(false);
                    setTwoFAData(null);
                    setTwoFACode('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleVerify2FA}
                  disabled={twoFABusy || !twoFAData || twoFACode.length !== 6}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {twoFABusy ? 'Verifying...' : 'Enable 2FA'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disable 2FA Modal */}
      {showDisable2FA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Disable Two-Factor Authentication</h2>
            <div className="space-y-4">
              <p className="text-slate-500">
                Enter a code from your authenticator app to confirm disabling two-factor authentication.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={disable2FACode}
                  onChange={(e) => setDisable2FACode(e.target.value.replace(/\D/g, ''))}
                  className="input-field text-center text-2xl tracking-widest"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowDisable2FA(false);
                    setDisable2FACode('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDisable2FA}
                  disabled={twoFABusy || disable2FACode.length !== 6}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {twoFABusy ? 'Disabling...' : 'Disable 2FA'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
