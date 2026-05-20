import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { useAuth } from '../contexts/AuthContext';

const QUICK_ACTIONS = [
  { label: 'Send Money', icon: '💸', screen: 'Send' },
  { label: 'FX Alerts', icon: '🔔', screen: 'FXAlerts' },
  { label: 'Payment Rails', icon: '🛤️', screen: 'PaymentRails' },
  { label: 'Revenue Share', icon: '💰', screen: 'RevenueShare' },
];

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { data: transactions, isLoading, refetch } = trpc.transactions.list.useQuery({ limit: 5 });
  const { data: wallets } = trpc.wallet.list.useQuery();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const totalBalance = wallets?.reduce((sum, w) => sum + Number(w.balance ?? 0), 0) ?? 0;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good day, {user?.name?.split(' ')[0] ?? 'User'} 👋</Text>
          <Text style={styles.headerSub}>RemitFlow Dashboard</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={styles.notifBtn}>
          <Text style={styles.notifIcon}>🔔</Text>
        </TouchableOpacity>
      </View>

      {/* Balance Card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Total Portfolio Value</Text>
        <Text style={styles.balanceAmount}>${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
        <Text style={styles.balanceSub}>{wallets?.length ?? 0} active wallets</Text>
        <View style={styles.balanceActions}>
          <TouchableOpacity style={styles.balanceBtn} onPress={() => navigation.navigate('Send')}>
            <Text style={styles.balanceBtnText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.balanceBtn, styles.balanceBtnOutline]} onPress={() => navigation.navigate('Wallet')}>
            <Text style={[styles.balanceBtnText, { color: '#6366f1' }]}>Wallet</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.quickActions}>
        {QUICK_ACTIONS.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.quickAction}
            onPress={() => navigation.navigate(action.screen)}
          >
            <Text style={styles.quickActionIcon}>{action.icon}</Text>
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Transactions */}
      <Text style={styles.sectionTitle}>Recent Transactions</Text>
      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginVertical: 20 }} />
      ) : (
        <View style={styles.txList}>
          {(transactions?.items ?? []).slice(0, 5).map((tx) => (
            <View key={tx.id} style={styles.txItem}>
              <View style={styles.txIcon}>
                <Text style={styles.txIconText}>
                  {tx.type === 'send' ? '↗' : tx.type === 'receive' ? '↙' : '⇄'}
                </Text>
              </View>
              <View style={styles.txDetails}>
                <Text style={styles.txTitle}>{tx.description ?? `${tx.type} transfer`}</Text>
                <Text style={styles.txDate}>{new Date(tx.createdAt).toLocaleDateString()}</Text>
              </View>
              <Text style={[styles.txAmount, { color: tx.type === 'receive' ? '#10b981' : '#f59e0b' }]}>
                {tx.type === 'receive' ? '+' : '-'}{tx.currency} {Number(tx.amount).toLocaleString()}
              </Text>
            </View>
          ))}
          {(!transactions?.items || transactions.items.length === 0) && (
            <Text style={styles.emptyText}>No transactions yet</Text>
          )}
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 56 },
  greeting: { fontSize: 22, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  notifBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  notifIcon: { fontSize: 18 },
  balanceCard: { margin: 16, borderRadius: 20, backgroundColor: '#6366f1', padding: 24 },
  balanceLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 4 },
  balanceAmount: { color: '#fff', fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  balanceSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4, marginBottom: 20 },
  balanceActions: { flexDirection: 'row', gap: 12 },
  balanceBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, padding: 12, alignItems: 'center' },
  balanceBtnOutline: { backgroundColor: '#fff' },
  balanceBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#fff', marginHorizontal: 16, marginBottom: 12, marginTop: 8 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  quickAction: { width: '47%', backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#2d2d4e' },
  quickActionIcon: { fontSize: 28, marginBottom: 8 },
  quickActionLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  txList: { marginHorizontal: 16, backgroundColor: '#1a1a2e', borderRadius: 16, overflow: 'hidden' },
  txItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  txIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2d2d4e', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  txIconText: { fontSize: 16, color: '#6366f1', fontWeight: '700' },
  txDetails: { flex: 1 },
  txTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  txDate: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '700' },
  emptyText: { color: '#6b7280', textAlign: 'center', padding: 24 },
});
