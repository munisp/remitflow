import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchReconciliationById } from '../../store/slices/reconciliationSlice';

export const ReconciliationDetailScreen = ({ route }: any) => {
  const { id } = route.params;
  const dispatch = useAppDispatch();
  const { currentReconciliation } = useAppSelector(s => s.reconciliation);
  
  useEffect(() => { dispatch(fetchReconciliationById(id)); }, [id]);
  
  if (!currentReconciliation) return null;
  
  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reconciliation Details</Text>
        <Text style={styles.label}>ID: {currentReconciliation.id}</Text>
        <Text style={styles.label}>Status: {currentReconciliation.status}</Text>
        <Text style={styles.label}>Date: {new Date(currentReconciliation.date).toLocaleDateString()}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Discrepancies</Text>
        {currentReconciliation.discrepancies?.map((d: any, i: number) => (
          <View key={i} style={styles.discrepancy}>
            <Text style={styles.discrepancyText}>{d.description}</Text>
            <Text style={styles.amount}>${d.amount}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  section: { backgroundColor: '#fff', padding: 20, marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 15 },
  label: { fontSize: 14, color: '#666', marginBottom: 8 },
  discrepancy: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  discrepancyText: { fontSize: 14, flex: 1 },
  amount: { fontSize: 14, fontWeight: '600', color: '#ef4444' },
});