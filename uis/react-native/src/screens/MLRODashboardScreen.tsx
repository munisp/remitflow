import React from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { trpc } from '../services/trpc';
import { useAuth } from '../contexts/AuthContext';

export default function MLRODashboardScreen() {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);
  const { data, isLoading, refetch } = (trpc as any)?.['compliance']?.['getMLRODashboard']?.useQuery?.() ?? { data: null, isLoading: false, refetch: () => {} };
  const onRefresh = async () => { setRefreshing(true); await refetch?.(); setRefreshing(false); };
  const items: any[] = Array.isArray(data) ? data : (data ? [data] : []);
  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.header}><Text style={styles.title}>MLRODashboard</Text></View>
      {isLoading ? <ActivityIndicator size="large" color="#7c3aed" /> : (
        <View style={styles.content}>
          {items.length === 0 ? <Text style={styles.empty}>No data available</Text> : items.map((item: any, idx: number) => (
            <View key={idx} style={styles.card}>
              <Text style={styles.cardTitle}>{item?.title ?? item?.name ?? `Record ${idx + 1}`}</Text>
              <Text style={styles.cardBody}>{item?.description ?? item?.status ?? JSON.stringify(item).slice(0, 120)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { padding: 20, paddingTop: 60, backgroundColor: '#7c3aed' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1f2937', marginBottom: 4 },
  cardBody: { fontSize: 14, color: '#6b7280' },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40, fontSize: 16 },
});
