import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchCustomers } from '../../store/slices/customerSlice';

export const CustomerListScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const { customers, loading } = useAppSelector(state => state.customer);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    await dispatch(fetchCustomers({}));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCustomers();
    setRefreshing(false);
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery)
  );

  const renderCustomer = ({ item }: any) => (
    <TouchableOpacity
      style={styles.customerCard}
      onPress={() => navigation.navigate('CustomerDetail', { id: item.id })}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.customerInfo}>
        <Text style={styles.customerName}>{item.name}</Text>
        <Text style={styles.customerPhone}>{item.phone}</Text>
        <Text style={styles.customerEmail}>{item.email}</Text>
      </View>
      <View style={styles.customerStats}>
        <Text style={styles.statsLabel}>Balance</Text>
        <Text style={styles.statsValue}>${item.balance?.toFixed(2) || '0.00'}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search customers..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <FlatList
        data={filteredCustomers}
        renderItem={renderCustomer}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No customers found</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddCustomer')}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  searchContainer: { backgroundColor: '#fff', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  searchInput: { backgroundColor: '#f5f5f5', borderRadius: 8, padding: 12, fontSize: 16 },
  customerCard: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, marginHorizontal: 15, marginVertical: 8, borderRadius: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#667eea', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  avatarText: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  customerInfo: { flex: 1 },
  customerName: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 4 },
  customerPhone: { fontSize: 14, color: '#666', marginBottom: 2 },
  customerEmail: { fontSize: 12, color: '#999' },
  customerStats: { alignItems: 'flex-end' },
  statsLabel: { fontSize: 11, color: '#999', marginBottom: 4 },
  statsValue: { fontSize: 16, fontWeight: 'bold', color: '#10b981' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: '#667eea', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  fabText: { fontSize: 32, color: '#fff', fontWeight: '300' },
});

