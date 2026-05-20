import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { useAuth } from '../contexts/AuthContext';

export default function FormMHistoryScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data, isLoading, refetch } = (trpc as any)?.['smeTrade']?.['listFormMHistory']?.useQuery?.() ?? {
    data: null,
    isLoading: false,
    refetch: () => {},
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch?.();
    setRefreshing(false);
  };

  const items: any[] = Array.isArray(data) ? data : (data ? [data] : []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return '#10b981';
      case 'rejected': return '#ef4444';
      case 'pending': return '#f59e0b';
      default: return '#6366f1';
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Form M History</Text>
        <Text style={styles.subtitle}>CBN Trade Finance Documents</Text>
        {user && <Text style={styles.userBadge}>SME: {user.name ?? user.email}</Text>}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" size="large" style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📄</Text>
          <Text style={styles.emptyText}>No Form M submissions yet</Text>
          <Text style={styles.emptySubtext}>Your CBN Form M applications will appear here</Text>
        </View>
      ) : (
        items.map((item: any, idx: number) => (
          <View key={item?.id ?? idx} style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>{item?.formMNumber ?? `FM-${item?.id ?? idx + 1}`}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item?.status) + '22' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item?.status) }]}>
                  {(item?.status ?? 'pending').toUpperCase()}
                </Text>
              </View>
            </View>

            {item?.importerName && (
              <Text style={styles.detail}>Importer: {item.importerName}</Text>
            )}
            {item?.exporterName && (
              <Text style={styles.detail}>Exporter: {item.exporterName}</Text>
            )}
            {item?.amountUsd != null && (
              <Text style={styles.amount}>${Number(item.amountUsd).toLocaleString()} USD</Text>
            )}
            {item?.cbnReference && (
              <Text style={styles.ref}>CBN Ref: {item.cbnReference}</Text>
            )}
            {item?.validUntil && (
              <Text style={styles.date}>
                Valid until: {new Date(item.validUntil).toLocaleDateString()}
              </Text>
            )}
            {item?.createdAt && (
              <Text style={styles.date}>
                Submitted: {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            )}
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
  subtitle: { fontSize: 14, color: '#94a3b8', marginBottom: 4 },
  userBadge: { fontSize: 12, color: '#6366f1', marginTop: 4 },
  card: {
    backgroundColor: '#1e293b',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#fff', flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700' },
  detail: { fontSize: 13, color: '#94a3b8', marginBottom: 2 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#10b981', marginTop: 6 },
  ref: { fontSize: 12, color: '#6366f1', marginTop: 4 },
  date: { fontSize: 12, color: '#64748b', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#64748b', textAlign: 'center', paddingHorizontal: 32 },
});
