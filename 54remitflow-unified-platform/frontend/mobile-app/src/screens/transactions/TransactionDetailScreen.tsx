import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchTransactionById } from '../../store/slices/transactionSlice';

export const TransactionDetailScreen = ({ route, navigation }: any) => {
  const { id } = route.params;
  const dispatch = useAppDispatch();
  const { currentTransaction, loading } = useAppSelector(state => state.transaction);

  useEffect(() => {
    dispatch(fetchTransactionById(id));
  }, [id]);

  if (loading || !currentTransaction) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  const tx = currentTransaction;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.amount}>${tx.amount.toFixed(2)}</Text>
        <View style={[styles.statusBadge, styles[`status${tx.status}`]]}>
          <Text style={styles.statusText}>{tx.status}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transaction Details</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Type:</Text>
          <Text style={styles.value}>{tx.type}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Reference:</Text>
          <Text style={styles.value}>{tx.reference}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Date:</Text>
          <Text style={styles.value}>{new Date(tx.timestamp).toLocaleString()}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Customer Information</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Name:</Text>
          <Text style={styles.value}>{tx.customerName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>ID:</Text>
          <Text style={styles.value}>{tx.customerId}</Text>
        </View>
      </View>

      {tx.commission && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Commission</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Amount:</Text>
            <Text style={[styles.value, styles.commission]}>${tx.commission.toFixed(2)}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
        <Text style={styles.buttonText}>Close</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', padding: 20, alignItems: 'center', marginBottom: 15 },
  amount: { fontSize: 36, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  statusBadge: { paddingHorizontal: 15, paddingVertical: 6, borderRadius: 15 },
  statuspending: { backgroundColor: '#fef3c7' },
  statuscompleted: { backgroundColor: '#d1fae5' },
  statusfailed: { backgroundColor: '#fee2e2' },
  statusText: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  section: { backgroundColor: '#fff', padding: 20, marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  label: { fontSize: 14, color: '#666' },
  value: { fontSize: 14, fontWeight: '500', color: '#333' },
  commission: { color: '#10b981' },
  button: { backgroundColor: '#667eea', padding: 15, margin: 15, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

