import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { useAuth } from '../contexts/AuthContext';

export default function TravelRuleScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);
  const { data, isLoading, refetch } = (trpc as any)?.['compliance']?.['getTravelRule']?.useQuery?.() ?? { data: null, isLoading: false, refetch: () => {} };
  const onRefresh = async () => {
    setRefreshing(true);
    await refetch?.();
    setRefreshing(false);
  };
  const items: any[] = Array.isArray(data) ? data : (data ? [data] : []);
  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Travel Rule</Text>
        {user && <Text style={styles.subtitle}>Logged in as {user.name ?? user.email}</Text>}
      </View>
      {isLoading ? (
        <ActivityIndicator color="#6366f1" size="large" style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>No data available</Text>
          <Text style={styles.emptySubtext}>Pull down to refresh</Text>
        </View>
      ) : (
        items.slice(0, 20).map((item, idx) => (
          <View key={item?.id ?? idx} style={styles.card}>
            <Text style={styles.cardTitle}>{item?.name ?? item?.title ?? item?.id ?? `Item ${idx + 1}`}</Text>
            {item?.status && <Text style={styles.badge}>{item.status}</Text>}
            {item?.amount && <Text style={styles.amount}>${Number(item.amount).toLocaleString()}</Text>}
            {item?.createdAt && <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>}
          </View>
        ))
      )}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 24, paddingBottom: 16 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#6366f1', fontSize: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#94a3b8' },
  card: { backgroundColor: '#1e293b', marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 16 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4 },
  badge: { fontSize: 12, color: '#6366f1', backgroundColor: '#1e1b4b', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start', marginBottom: 4 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#10b981' },
  date: { fontSize: 12, color: '#64748b', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#64748b' },
});
