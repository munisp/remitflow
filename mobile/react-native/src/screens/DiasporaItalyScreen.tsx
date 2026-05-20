import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function DiasporaItalyScreen() {
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data, isLoading, error, refetch } = trpc.diaspora.getCorridorInfo.useQuery(undefined, {
    retry: 2,
    staleTime: 60_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const renderValue = (v: any): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
    return String(v);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Italy Corridor</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Failed to load Italy Corridor.</Text>
            <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !data ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No data available.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {Object.entries(data as Record<string, any>).map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Text style={styles.label}>{k.replace(/([A-Z])/g, ' $1').trim()}</Text>
                <Text style={styles.value} numberOfLines={2}>{renderValue(v)}</Text>
              </View>
            ))}
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
  content: { flex: 1, padding: 12 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 16, margin: 12, borderWidth: 1, borderColor: '#334155' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  label: { fontSize: 13, color: '#64748b', flex: 1, textTransform: 'capitalize' },
  value: { fontSize: 13, color: '#f1f5f9', flex: 2, textAlign: 'right' },
  errorContainer: { alignItems: 'center', marginTop: 60 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 12 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: '#64748b', fontSize: 15 },
});
