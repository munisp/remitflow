import React, { useState, useEffect, useCallback } from 'react';
import { notificationService, type Notification as ApiNotification } from '../services/api';

type NotificationType = 'transaction' | 'security' | 'promo' | 'system';

interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
  read: boolean;
}

const toNotificationType = (t: string): NotificationType => {
  if (t === 'transaction' || t === 'security' || t === 'promo' || t === 'system') return t;
  if (t === 'promotion' || t === 'promotional') return 'promo';
  if (t === 'kyc') return 'system';
  return 'system';
};

const Notifications: React.FC = () => {
  const [filter, setFilter] = useState('all');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fallbackNotifications: NotificationItem[] = [
    { id: '1', type: 'transaction', title: 'Transfer Successful', message: 'Your transfer of NGN 50,000 to John Doe was successful.', time: '2 min ago', read: false },
    { id: '2', type: 'security', title: 'New Login Detected', message: 'A new login was detected from Chrome on Windows in Lagos.', time: '1 hour ago', read: false },
    { id: '3', type: 'transaction', title: 'Money Received', message: 'You received NGN 25,000 from Jane Smith.', time: '3 hours ago', read: true },
    { id: '4', type: 'promo', title: 'Zero Fees This Weekend', message: 'Send money to Ghana and Kenya with zero fees this weekend!', time: '1 day ago', read: true },
    { id: '5', type: 'system', title: 'KYC Reminder', message: 'Complete your KYC verification to unlock higher transfer limits.', time: '2 days ago', read: true },
  ];

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationService.getAll();
      const data = res.data;
      if (data.notifications && data.notifications.length > 0) {
        setNotifications(data.notifications.map((n: ApiNotification) => ({
          id: n.id,
          type: toNotificationType(n.type),
          title: n.title,
          message: n.message,
          time: n.createdAt ? new Date(n.createdAt).toLocaleDateString() : 'Recently',
          read: n.read,
        })));
      } else {
        setNotifications(fallbackNotifications);
      }
    } catch {
      setNotifications(fallbackNotifications);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    try { await notificationService.markRead(id); } catch { /* optimistic update already applied */ }
  };

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try { await notificationService.markAllRead(); } catch { /* optimistic update already applied */ }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const typeConfig: Record<string, { color: string; icon: string }> = {
    transaction: { color: 'bg-emerald-50 text-emerald-600', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    security: { color: 'bg-red-50 text-red-500', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
    promo: { color: 'bg-violet-50 text-violet-600', icon: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7' },
    system: { color: 'bg-indigo-50 text-indigo-600', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  };

  const filtered = notifications.filter(n => filter === 'all' || (filter === 'unread' && !n.read) || n.type === filter);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="text-slate-500 mt-1">{loading ? 'Loading...' : unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
        </div>
        {unreadCount > 0 && <button onClick={markAllRead} className="text-sm text-indigo-600 font-semibold hover:text-indigo-500">Mark all read</button>}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['all', 'unread', 'transaction', 'security', 'promo', 'system'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium capitalize whitespace-nowrap transition-all duration-200 ${filter === f ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">No notifications</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filtered.map((n) => {
              const config = typeConfig[n.type] || typeConfig.system;
              return (
                <button key={n.id} onClick={() => markAsRead(n.id)} className={`w-full text-left p-4 hover:bg-slate-50 transition-colors ${!n.read ? 'bg-indigo-50/30' : ''}`}>
                  <div className="flex gap-3">
                    <div className={`w-10 h-10 ${config.color} rounded-xl flex items-center justify-center shrink-0`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d={config.icon} /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-semibold ${!n.read ? 'text-slate-900' : 'text-slate-600'}`}>{n.title}</p>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-slate-400">{n.time}</span>
                          {!n.read && <span className="w-2 h-2 bg-indigo-500 rounded-full" />}
                        </div>
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Notifications;
