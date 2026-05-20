import React, { useState, useEffect } from 'react';
import { FlatList, Text, View, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { ApiService } from '../../services/ApiService';

export const PaymentHistoryScreen = () => {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPayments = async () => {
    try {
      const res = await ApiService.get('/api/v1/payments/history');
      setPayments(res.data?.payments || []);
    } catch (e) {
      console.error('Failed to load payment history:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchPayments(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#667eea" /></View>;

  return (
    <FlatList
      data={payments}
      keyExtractor={(item, i) => item.id || i.toString()}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPayments(); }} />}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No payment history</Text></View>}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.amount}>{item.currency} {item.amount?.toFixed(2)}</Text>
            <View style={[styles.badge, item.status === 'completed' ? styles.success : styles.pending]}>
              <Text style={styles.badgeText}>{item.status}</Text>
            </View>
          </View>
          <Text style={styles.desc}>{item.description || item.type || 'Payment'}</Text>
          <Text style={styles.date}>{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</Text>
        </View>
      )}
    />
  );
};

const styles = StyleSheet.create({
  list: { padding: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { color: '#666', fontSize: 15 },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  amount: { fontSize: 17, fontWeight: '700', color: '#1a1a2e' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  success: { backgroundColor: '#d1fae5' },
  pending: { backgroundColor: '#fef3c7' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#374151' },
  desc: { fontSize: 13, color: '#666', marginBottom: 4 },
  date: { fontSize: 12, color: '#999' },
});
