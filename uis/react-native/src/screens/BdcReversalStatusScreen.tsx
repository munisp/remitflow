import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

/**
 * wave12 (SPEC §6.2): read-only customer-facing view of BDC transaction
 * reversals. Backend: server/routers/bdc/reversals.ts
 *   - bdc.reversals.listReversals ({status?, cursor?, limit?} → {items, nextCursor})
 *   - bdc.reversals.getReversal   ({reversalId} → full row)
 * Renders honest status badges including `failed` + failureReason. No
 * fabrication: unknown/missing fields render as '—'.
 */

const STATUS_FILTERS = ['requested', 'approved', 'posted', 'failed', 'rejected'] as const;

const STATUS_COLORS: Record<string, string> = {
  requested: '#f59e0b',
  approved: '#38bdf8',
  posted: '#10b981',
  failed: '#ef4444',
  rejected: '#64748b',
};

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function BdcReversalStatusScreen() {
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number] | null>(null);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listInput = useMemo(
    () => ({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 25,
    }),
    [statusFilter, cursor],
  );

  const { data, isLoading, error, refetch } = trpc.bdc.reversals.listReversals.useQuery(listInput, {
    retry: 2,
    staleTime: 15_000,
  });

  const detail = trpc.bdc.reversals.getReversal.useQuery(
    { reversalId: selectedId ?? 0 },
    { enabled: selectedId !== null, retry: 1 },
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const items = data?.items ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Reversal Status</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.chip, statusFilter === null && styles.chipActive]}
            onPress={() => { setStatusFilter(null); setCursor(undefined); }}
          >
            <Text style={[styles.chipText, statusFilter === null && styles.chipTextActive]}>all</Text>
          </TouchableOpacity>
          {STATUS_FILTERS.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.chip, statusFilter === s && styles.chipActive]}
              onPress={() => { setStatusFilter(statusFilter === s ? null : s); setCursor(undefined); }}
            >
              <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Failed to load reversals.</Text>
            <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>↩️</Text>
            <Text style={styles.emptyText}>
              {statusFilter
                ? `No ${statusFilter} reversals.`
                : 'No reversals affect your transactions.'}
            </Text>
          </View>
        ) : (
          <>
            {items.map((item: any) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.card, selectedId === item.id && styles.cardSelected]}
                onPress={() => setSelectedId(selectedId === item.id ? null : item.id)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Reversal #{item.id}</Text>
                  <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] ?? '#64748b' }]}>
                    <Text style={styles.badgeText}>{item.status}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  Transaction #{fmt(item.txnId)} · {fmt(item.reversalType)}
                </Text>
                <Text style={styles.meta} numberOfLines={2}>Reason: {fmt(item.reason)}</Text>
                {item.status === 'failed' && (
                  <Text style={styles.failureText}>
                    Failure reason: {fmt(item.failureReason)}
                  </Text>
                )}
                <Text style={styles.meta}>Requested {fmtDate(item.createdAt)}</Text>
              </TouchableOpacity>
            ))}

            {data?.nextCursor != null && (
              <TouchableOpacity
                style={styles.loadMoreButton}
                onPress={() => setCursor(data.nextCursor as number)}
              >
                <Text style={styles.loadMoreText}>Load older</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── detail view (getReversal) ───────────────────────────── */}
        {selectedId !== null && (
          <View style={styles.detailCard}>
            <Text style={styles.sectionTitle}>Reversal #{selectedId} detail</Text>
            {detail.isLoading ? (
              <ActivityIndicator color="#6366f1" style={{ marginVertical: 16 }} />
            ) : detail.error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Failed to load reversal detail.</Text>
                <TouchableOpacity onPress={() => detail.refetch()} style={styles.retryButton}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : detail.data ? (
              (() => {
                const r: any = detail.data;
                const rows: Array<[string, string]> = [
                  ['Status', fmt(r.status)],
                  ['Type', fmt(r.reversalType)],
                  ['Transaction', `#${fmt(r.txnId)}`],
                  ['Reason', fmt(r.reason)],
                  ['Rail reference', fmt(r.railReference)],
                  ['Failure reason', fmt(r.failureReason)],
                  ['Approved by', r.approvedBy ? `user #${r.approvedBy}` : '—'],
                  ['Created', fmtDate(r.createdAt)],
                  ['Updated', fmtDate(r.updatedAt)],
                ];
                return rows.map(([k, v]) => (
                  <View key={k} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{k}</Text>
                    <Text style={styles.detailValue}>{v}</Text>
                  </View>
                ));
              })()
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  title: { fontSize: 16, fontWeight: '700', color: '#f1f5f9', flex: 1, textAlign: 'center' },
  back: { color: '#6366f1', fontSize: 14, width: 50 },
  filterBar: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', marginRight: 8 },
  chipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipText: { fontSize: 12, color: '#94a3b8' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  content: { flex: 1, padding: 12 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardSelected: { borderColor: '#6366f1' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  badge: { borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  meta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  failureText: { fontSize: 12, color: '#ef4444', marginTop: 4 },
  loadMoreButton: { alignItems: 'center', paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#334155', marginBottom: 10 },
  loadMoreText: { color: '#6366f1', fontWeight: '600' },
  detailCard: { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginTop: 4, marginBottom: 24, borderWidth: 1, borderColor: '#6366f1' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#f1f5f9', marginBottom: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  detailLabel: { fontSize: 12, color: '#64748b', flex: 1 },
  detailValue: { fontSize: 12, color: '#f1f5f9', flex: 2, textAlign: 'right' },
  errorContainer: { alignItems: 'center', marginTop: 24 },
  errorText: { color: '#ef4444', fontSize: 14, marginBottom: 12 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyText: { color: '#64748b', fontSize: 14, textAlign: 'center' },
});
