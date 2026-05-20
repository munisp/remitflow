import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchInventory } from '../../store/slices/inventorySlice';

export const InventoryDashboardScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const { summary, lowStockItems } = useAppSelector(s => s.inventory);
  
  useEffect(() => { dispatch(fetchInventory()); }, []);
  
  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Total Inventory Value</Text>
        <Text style={styles.cardValue}>${summary?.totalValue || 0}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Low Stock Items</Text>
        <Text style={[styles.cardValue, styles.warning]}>{lowStockItems?.length || 0}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Total Products</Text>
        <Text style={styles.cardValue}>{summary?.totalProducts || 0}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 10, marginBottom: 15 },
  cardTitle: { fontSize: 14, color: '#666', marginBottom: 10 },
  cardValue: { fontSize: 32, fontWeight: 'bold', color: '#333' },
  warning: { color: '#f59e0b' },
});