import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';

const API_BASE = process.env.API_URL || 'http://localhost:3001';

export default function SmeDashboardScreen() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/api/trpc/sme-dashboard`);
      const json = await res.json();
      setData(json.result?.data ?? json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#6366f1" /></View>;
  if (error) return (
    <View style={styles.center}>
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={loadData}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}>
      <Text style={styles.title}>SME Dashboard</Text>
      {data && Object.entries(data).map(([key, value]) => (
        <View key={key} style={styles.row}>
          <Text style={styles.label}>{key}</Text>
          <Text style={styles.value}>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</Text>
        </View>
      ))}
      {!data && <Text style={styles.emptyText}>No data available</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
  title: { fontSize: 24, fontWeight: '700', color: '#111827', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  label: { fontSize: 14, color: '#6b7280' },
  value: { fontSize: 14, fontWeight: '500', color: '#111827', maxWidth: '60%', textAlign: 'right' },
  errorText: { fontSize: 16, color: '#ef4444', marginBottom: 16 },
  retryBtn: { backgroundColor: '#6366f1', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyText: { fontSize: 16, color: '#9ca3af', textAlign: 'center', marginTop: 48 },
});
