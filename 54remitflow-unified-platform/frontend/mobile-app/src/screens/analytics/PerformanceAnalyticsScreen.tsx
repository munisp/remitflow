import React, { useState, useEffect } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { ApiService } from '../../services/ApiService';

export const PerformanceAnalyticsScreen = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const res = await ApiService.get('/api/v1/analytics/performance');
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#667eea" /></View>;

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}>
      <View style={styles.card}><Text style={styles.title}>Success Rate</Text><Text style={styles.value}>{data?.success_rate ? `${data.success_rate}%` : 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>Avg Processing Time</Text><Text style={styles.value}>{data?.avg_processing_time ? `${data.avg_processing_time}s` : 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>Failed Transactions</Text><Text style={[styles.value, data?.failed_count > 0 && styles.warning]}>{data?.failed_count ?? 'N/A'}</Text></View>
      <View style={styles.card}><Text style={styles.title}>Uptime</Text><Text style={styles.value}>{data?.uptime ? `${data.uptime}%` : 'N/A'}</Text></View>
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
});
