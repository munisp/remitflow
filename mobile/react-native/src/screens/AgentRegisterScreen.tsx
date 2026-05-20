import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function AgentRegisterScreen() {
  const navigation = useNavigation();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = trpc.agent.listAgents.useQuery(undefined, {
    retry: 2,
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const items = (data as any[]) ?? [];
  const filtered = search
    ? items.filter((item: any) =>
        JSON.stringify(item).toLowerCase().includes(search.toLowerCase())
      )
    : items;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Agent Network</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Failed to load Agent Network.</Text>
            <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>{search ? 'No results found.' : 'No Agent Network yet.'}</Text>
          </View>
        ) : (
          filtered.map((item: any, idx: number) => (
            <View key={item.id ?? idx} style={styles.card}>
              {Object.entries(item)
                .filter(([k]) => !['__typename', 'createdAt', 'updatedAt'].includes(k))
                .slice(0, 6)
                .map(([k, v]) => (
                  <View key={k} style={styles.row}>
                    <Text style={styles.label}>{k.replace(/([A-Z])/g, ' $1').trim()}</Text>
                    <Text style={styles.value} numberOfLines={1}>
                      {v === null || v === undefined ? '—' : String(v)}
                    </Text>
                  </View>
                ))}
            </View>
          ))
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
  searchContainer: { padding: 12, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  searchInput: { backgroundColor: '#0f172a', borderRadius: 8, padding: 10, color: '#f1f5f9', fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  content: { flex: 1, padding: 12 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 12, color: '#64748b', flex: 1, textTransform: 'capitalize' },
  value: { fontSize: 12, color: '#f1f5f9', flex: 2, textAlign: 'right' },
  errorContainer: { alignItems: 'center', marginTop: 60 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 12 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#64748b', fontSize: 15, textAlign: 'center' },
});
