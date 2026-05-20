import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchTransactions } from '../../store/slices/transactionSlice';

export const TransactionListScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const { transactions, loading, error } = useAppSelector(state => state.transaction);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    await dispatch(fetchTransactions({}));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTransactions();
    setRefreshing(false);
  };

  const renderTransaction = ({ item }: any) => (
    <TouchableOpacity
      style={styles.transactionCard}
      onPress={() => navigation.navigate('TransactionDetail', { id: item.id })}
    >
      <View style={styles.transactionHeader}>
        <Text style={styles.transactionType}>{item.type}</Text>
        <Text style={[styles.amount, item.amount > 0 ? styles.amountPositive : styles.amountNegative]}>
          ${item.amount.toFixed(2)}
        </Text>
      </View>
      <Text style={styles.customerName}>{item.customerName}</Text>
      <View style={styles.transactionFooter}>
        <Text style={styles.reference}>{item.reference}</Text>
        <View style={[styles.statusBadge, styles[`status${item.status}`]]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.timestamp}>{new Date(item.timestamp).toLocaleString()}</Text>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadTransactions}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={transactions}
        renderItem={renderTransaction}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No transactions found</Text>
          </View>
        }
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateTransaction')}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  transactionCard: { backgroundColor: '#fff', padding: 15, marginHorizontal: 15, marginVertical: 8, borderRadius: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  transactionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  transactionType: { fontSize: 16, fontWeight: '600', color: '#333' },
  amount: { fontSize: 18, fontWeight: 'bold' },
  amountPositive: { color: '#10b981' },
  amountNegative: { color: '#ef4444' },
  customerName: { fontSize: 14, color: '#666', marginBottom: 8 },
  transactionFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reference: { fontSize: 12, color: '#999' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statuspending: { backgroundColor: '#fef3c7' },
  statuscompleted: { backgroundColor: '#d1fae5' },
  statusfailed: { backgroundColor: '#fee2e2' },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  timestamp: { fontSize: 11, color: '#999' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  errorText: { fontSize: 16, color: '#ef4444', textAlign: 'center', marginBottom: 20 },
  retryButton: { backgroundColor: '#667eea', paddingHorizontal: 30, paddingVertical: 12, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: '#667eea', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  fabText: { fontSize: 32, color: '#fff', fontWeight: '300' },
});

