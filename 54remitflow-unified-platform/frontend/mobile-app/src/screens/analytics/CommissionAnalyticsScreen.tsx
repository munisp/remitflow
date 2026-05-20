import React, { useState, useEffect } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { ApiService } from '../../services/ApiService';

export const CommissionAnalyticsScreen = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const res = await ApiService.get('/api/v1/commissions/analytics');
      setData(res.data);
    } catch (e) {
      console.error('Failed to load commission analytics:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#667eea" /></View>;

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}>
      <View style={styles.card}><Text style={styles.title}>Total Commission</Text><Text style={styles.value}>{data?.total_commission ? `$${data.total_commission.toFixed(2)}` : 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>This Month</Text><Text style={styles.value}>{data?.this_month ? `$${data.this_month.toFixed(2)}` : 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>Pending Payout</Text><Text style={styles.value}>{data?.pending_payout ? `$${data.pending_payout.toFixed(2)}` : 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>Total Transactions</Text><Text style={styles.value}>{data?.total_transactions ?? 'N/A'}</Text></View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 10, marginBottom: 15, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  title: { fontSize: 14, color: '#666', marginBottom: 10 },
  value: { fontSize: 24, fontWeight: 'bold', color: '#1a1a2e' },
});
