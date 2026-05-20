import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { useAuth } from '../contexts/AuthContext';

export default function ComplianceFormMAuditScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  const { data, isLoading, refetch } = (trpc as any)?.['smeTrade']?.['listFormMDocumentsAdmin']?.useQuery?.() ?? {
    data: null,
    isLoading: false,
    refetch: () => {},
  };

  const updateStatus = (trpc as any)?.['smeTrade']?.['updateFormMStatus']?.useMutation?.() ?? { mutate: () => {} };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch?.();
    setRefreshing(false);
  };

  const allItems: any[] = Array.isArray(data) ? data : (data ? [data] : []);
  const items = statusFilter === 'all' ? allItems : allItems.filter((i: any) => i?.status === statusFilter);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return '#10b981';
      case 'rejected': return '#ef4444';
      case 'pending': return '#f59e0b';
      default: return '#6366f1';
    }
  };

  const filters = ['all', 'pending', 'approved', 'rejected'];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Form M Compliance Audit</Text>
        <Text style={styles.subtitle}>CBN Trade Finance — Admin Review</Text>
        {user && <Text style={styles.userBadge}>Compliance Officer: {user.name ?? user.email}</Text>}
      </View>

      {/* Status Filter Tabs */}
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, statusFilter === f && styles.filterTabActive]}
            onPress={() => setStatusFilter(f)}
          >
            <Text style={[styles.filterText, statusFilter === f && styles.filterTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Summary Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{allItems.length}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>
            {allItems.filter((i: any) => i?.status === 'pending').length}
          </Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#10b981' }]}>
            {allItems.filter((i: any) => i?.status === 'approved').length}
          </Text>
          <Text style={styles.statLabel}>Approved</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>
            {allItems.filter((i: any) => i?.status === 'rejected').length}
          </Text>
          <Text style={styles.statLabel}>Rejected</Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" size="large" style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>No records found</Text>
          <Text style={styles.emptySubtext}>
            {statusFilter === 'all' ? 'No Form M documents submitted yet' : `No ${statusFilter} documents`}
          </Text>
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

            {item?.importerName && <Text style={styles.detail}>Importer: {item.importerName}</Text>}
            {item?.exporterName && <Text style={styles.detail}>Exporter: {item.exporterName}</Text>}
            {item?.amountUsd != null && (
              <Text style={styles.amount}>${Number(item.amountUsd).toLocaleString()} USD</Text>
            )}
            {item?.cbnReference && <Text style={styles.ref}>CBN Ref: {item.cbnReference}</Text>}
            {item?.validationSource && (
              <Text style={styles.source}>Source: {item.validationSource}</Text>
            )}
            {item?.createdAt && (
              <Text style={styles.date}>Submitted: {new Date(item.createdAt).toLocaleDateString()}</Text>
            )}

            {/* Admin Actions */}
            {item?.status === 'pending' && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => updateStatus?.mutate?.({ id: item.id, status: 'approved' })}
                >
                  <Text style={styles.actionBtnText}>✓ Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => updateStatus?.mutate?.({ id: item.id, status: 'rejected' })}
                >
                  <Text style={styles.actionBtnText}>✗ Reject</Text>
                </TouchableOpacity>
              </View>
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
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16, gap: 8 },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
  },
  filterTabActive: { backgroundColor: '#6366f1' },
  filterText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16, gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
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
  source: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  date: { fontSize: 12, color: '#64748b', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  approveBtn: { backgroundColor: '#10b981' },
  rejectBtn: { backgroundColor: '#ef4444' },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#64748b', textAlign: 'center', paddingHorizontal: 32 },
});
