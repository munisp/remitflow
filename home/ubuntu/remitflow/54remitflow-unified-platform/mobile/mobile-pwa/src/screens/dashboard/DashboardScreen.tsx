import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import ApiClient from '../../services/ApiClient';

interface DashboardStats {
  totalTransactions: number;
  totalAmount: number;
  activeAgents: number;
  securityAlerts: number;
}

interface RecentTransaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  description: string;
  created_at: string;
}

const MOCK_STATS: DashboardStats = {
  totalTransactions: 234567,
  totalAmount: 15750000,
  activeAgents: 1247,
  securityAlerts: 12,
};

const MOCK_TRANSACTIONS: RecentTransaction[] = [
  { id: 'TXN-001', type: 'deposit', amount: 50000, status: 'completed', description: 'Cash deposit - John Doe', created_at: new Date().toISOString() },
  { id: 'TXN-002', type: 'withdrawal', amount: 25000, status: 'processing', description: 'ATM withdrawal - Jane Smith', created_at: new Date().toISOString() },
  { id: 'TXN-003', type: 'transfer', amount: 15000, status: 'completed', description: 'Bank transfer - Mike Johnson', created_at: new Date().toISOString() },
  { id: 'TXN-004', type: 'bills', amount: 8500, status: 'completed', description: 'Electricity bill payment', created_at: new Date().toISOString() },
];

interface DashboardScreenProps {
  onNavigate?: (screen: string) => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<DashboardStats>(MOCK_STATS);
  const [recentTx, setRecentTx] = useState<RecentTransaction[]>(MOCK_TRANSACTIONS);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadDashboard = async () => {
    try {
      const res = await ApiClient.get<{ stats: DashboardStats; transactions: RecentTransaction[] }>('/api/dashboard');
      if (res.data.stats) setStats(res.data.stats);
      if (res.data.transactions) setRecentTx(res.data.transactions);
    } catch {
      setStats(MOCK_STATS);
      setRecentTx(MOCK_TRANSACTIONS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadDashboard(); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  const formatCurrency = (amount: number) => `\u20A6${amount.toLocaleString()}`;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'deposit': return { symbol: '\u2191', color: '#10B981', bg: '#ECFDF5' };
      case 'withdrawal': return { symbol: '\u2193', color: '#EF4444', bg: '#FEF2F2' };
      case 'transfer': return { symbol: '\u2192', color: '#6366F1', bg: '#EEF2FF' };
      default: return { symbol: '\u26A1', color: '#F59E0B', bg: '#FFFBEB' };
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366F1" />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerSection}>
        <View>
          <Text style={styles.greeting}>Good morning</Text>
          <Text style={styles.headerTitle}>Dashboard</Text>
        </View>
        <TouchableOpacity style={styles.notifBtn}>
          <Text style={styles.notifIcon}>{'\uD83D\uDD14'}</Text>
          {stats.securityAlerts > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>{stats.securityAlerts}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.balanceCard}>
        <View style={styles.balanceCardInner}>
          <Text style={styles.balanceLabel}>Total Volume</Text>
          <Text style={styles.balanceAmount}>{formatCurrency(stats.totalAmount)}</Text>
          <View style={styles.balanceStats}>
            <View style={styles.balanceStat}>
              <Text style={styles.balanceStatValue}>{stats.totalTransactions.toLocaleString()}</Text>
              <Text style={styles.balanceStatLabel}>Transactions</Text>
            </View>
            <View style={styles.balanceStatDivider} />
            <View style={styles.balanceStat}>
              <Text style={styles.balanceStatValue}>{stats.activeAgents.toLocaleString()}</Text>
              <Text style={styles.balanceStatLabel}>Active Agents</Text>
            </View>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        {[
          { icon: '\u2191', label: 'Deposit', color: '#10B981', bg: '#ECFDF5', screen: 'transactions' },
          { icon: '\u2193', label: 'Withdraw', color: '#F59E0B', bg: '#FFFBEB', screen: 'transactions' },
          { icon: '\u2192', label: 'Transfer', color: '#6366F1', bg: '#EEF2FF', screen: 'transactions' },
          { icon: '\u2699', label: 'Settings', color: '#8B5CF6', bg: '#F5F3FF', screen: 'settings' },
        ].map((action, i) => (
          <TouchableOpacity
            key={i}
            style={styles.actionCard}
            onPress={() => onNavigate?.(action.screen)}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: action.bg }]}>
              <Text style={[styles.actionIconText, { color: action.color }]}>{action.icon}</Text>
            </View>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <TouchableOpacity onPress={() => onNavigate?.('transactions')}>
          <Text style={styles.seeAll}>See All</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.txList}>
        {recentTx.map(tx => {
          const icon = getTypeIcon(tx.type);
          return (
            <View key={tx.id} style={styles.txCard}>
              <View style={[styles.txIcon, { backgroundColor: icon.bg }]}>
                <Text style={[styles.txIconText, { color: icon.color }]}>{icon.symbol}</Text>
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txDesc} numberOfLines={1}>{tx.description}</Text>
                <Text style={styles.txDate}>{new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: tx.type === 'deposit' ? '#10B981' : '#1E293B' }]}>
                  {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
                </Text>
                <View style={[styles.txStatusBadge, { backgroundColor: tx.status === 'completed' ? '#ECFDF5' : '#FFFBEB' }]}>
                  <Text style={[styles.txStatusText, { color: tx.status === 'completed' ? '#059669' : '#D97706' }]}>
                    {tx.status}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  contentContainer: { padding: 20, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  loadingText: { fontSize: 14, color: '#94A3B8', marginTop: 12 },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  greeting: { fontSize: 14, color: '#94A3B8', marginBottom: 2 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  notifBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  notifIcon: { fontSize: 20 },
  notifBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#EF4444', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  notifBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  balanceCard: { borderRadius: 24, overflow: 'hidden', marginBottom: 28, shadowColor: '#6366F1', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  balanceCardInner: { padding: 28, backgroundColor: '#4F46E5' },
  balanceLabel: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  balanceAmount: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1, marginBottom: 20 },
  balanceStats: { flexDirection: 'row', alignItems: 'center' },
  balanceStat: { flex: 1, alignItems: 'center' },
  balanceStatDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)' },
  balanceStatValue: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  balanceStatLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginBottom: 14, letterSpacing: -0.3 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  seeAll: { fontSize: 14, fontWeight: '600', color: '#6366F1' },
  actionsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  actionCard: { alignItems: 'center', width: '22%' },
  actionIconWrap: { width: 56, height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  actionIconText: { fontSize: 22, fontWeight: '700' },
  actionLabel: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  txList: { gap: 10 },
  txCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  txIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  txIconText: { fontSize: 18, fontWeight: '700' },
  txInfo: { flex: 1 },
  txDesc: { fontSize: 14, fontWeight: '600', color: '#1E293B', marginBottom: 3 },
  txDate: { fontSize: 12, color: '#94A3B8' },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  txStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  txStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
});

export default DashboardScreen;
