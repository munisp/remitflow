import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator,
} from 'react-native';
import { trpc } from '../services/trpc';

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  pending: '#f59e0b',
  failed: '#ef4444',
  processing: '#6366f1',
};

export default function TransactionHistoryScreen() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = trpc.transactions.list.useQuery({ limit: 20, page, search });

  const transactions = data?.items ?? [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Transaction History</Text>

      <TextInput
        style={styles.search}
        value={search}
        onChangeText={(v) => { setSearch(v); setPage(1); }}
        placeholder="Search transactions..."
        placeholderTextColor="#6b7280"
      />

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.txItem}>
              <View style={[styles.txDot, { backgroundColor: STATUS_COLORS[item.status] ?? '#6b7280' }]} />
              <View style={styles.txDetails}>
                <Text style={styles.txTitle}>{item.description ?? `${item.type} transfer`}</Text>
                <Text style={styles.txMeta}>
                  {item.status} · {new Date(item.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: item.type === 'receive' ? '#10b981' : '#e2e8f0' }]}>
                  {item.type === 'receive' ? '+' : '-'}{item.currency} {Number(item.amount).toLocaleString()}
                </Text>
                <Text style={styles.txRef}>{item.reference?.slice(0, 8)}...</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No transactions found</Text>}
          onRefresh={refetch}
          refreshing={isLoading}
        />
      )}

      <View style={styles.pagination}>
        <TouchableOpacity
          style={[styles.pageBtn, page === 1 && styles.pageBtnDisabled]}
          onPress={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          <Text style={styles.pageBtnText}>← Prev</Text>
        </TouchableOpacity>
        <Text style={styles.pageNum}>Page {page}</Text>
        <TouchableOpacity
          style={[styles.pageBtn, !data?.hasMore && styles.pageBtnDisabled]}
          onPress={() => setPage((p) => p + 1)}
          disabled={!data?.hasMore}
        >
          <Text style={styles.pageBtnText}>Next →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 16, marginTop: 48 },
  search: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2d2d4e', marginBottom: 16 },
  txItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 8 },
  txDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  txDetails: { flex: 1 },
  txTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  txMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontSize: 14, fontWeight: '700' },
  txRef: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40 },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  pageBtn: { backgroundColor: '#1a1a2e', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { color: '#6366f1', fontWeight: '600' },
  pageNum: { color: '#9ca3af', fontSize: 14 },
});
