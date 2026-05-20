import React, { useState, useEffect } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { ApiService } from '../../services/ApiService';

export const ReconciliationDashboardScreen = ({ navigation }: any) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const res = await ApiService.get('/api/v1/reconciliation/summary');
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#667eea" /></View>;

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}>
      <View style={styles.card}><Text style={styles.title}>Total Reconciled</Text><Text style={styles.value}>{data?.total_reconciled ?? 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>Discrepancies</Text><Text style={[styles.value, data?.discrepancies > 0 && styles.warning]}>{data?.discrepancies ?? 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>Pending Review</Text><Text style={styles.value}>{data?.pending_review ?? 'N/A'}</Text></View>
      <TouchableOpacity style={styles.btn} onPress={() => navigation?.navigate('ReconciliationDetail')}>
        <Text style={styles.btnText}>View Details</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 10, marginBottom: 15 },
  title: { fontSize: 14, color: '#666', marginBottom: 8 },
  value: { fontSize: 24, fontWeight: 'bold', color: '#1a1a2e' },
  warning: { color: '#ef4444' },
  btn: { backgroundColor: '#667eea', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
