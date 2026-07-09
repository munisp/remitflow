import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';

interface PaymentRailsPageItem {
  id: number;
  name: string;
  status?: string;
  description?: string;
}

export const PaymentRailsPageScreen: React.FC = () => {
  const [items, setItems] = useState<PaymentRailsPageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch('/trpc/paymentRails.list');
      const data = await response.json();
      setItems(data?.result?.data ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Payment Rails</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id?.toString()}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#6C63FF" />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No Payment Rails data yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card}>
            <Text style={styles.cardTitle}>
              {item['name' as keyof PaymentRailsPageItem]?.toString() ?? item.description ?? `Item ${item.id}`}
            </Text>
            {item.status && (
              <Text style={styles.cardStatus}>{item.status}</Text>
            )}
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingBottom: 80 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F23',
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F0F23',
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  cardStatus: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  retryBtn: {
    backgroundColor: '#6C63FF',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

export default PaymentRailsPageScreen;
