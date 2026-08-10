import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

interface Transaction {
  id: string;
  type: 'sent' | 'received';
  amount: number;
  currency: string;
  recipient: string;
  recipientCountry: string;
  status: 'completed' | 'pending' | 'failed';
  date: string;
  method: string;
}

const mockTransactions: Transaction[] = [
  { id: '1', type: 'sent', amount: 500, currency: 'USD', recipient: 'John Doe', recipientCountry: 'NG', status: 'completed', date: '2026-08-10T10:30:00Z', method: 'Mobile Money' },
  { id: '2', type: 'received', amount: 1200, currency: 'USD', recipient: 'Jane Smith', recipientCountry: 'KE', status: 'completed', date: '2026-08-09T15:45:00Z', method: 'Bank Transfer' },
  { id: '3', type: 'sent', amount: 300, currency: 'USD', recipient: 'Family Account', recipientCountry: 'GH', status: 'pending', date: '2026-08-08T09:00:00Z', method: 'Cash Pickup' },
  { id: '4', type: 'sent', amount: 1000, currency: 'USD', recipient: 'Business Partner', recipientCountry: 'ZA', status: 'completed', date: '2026-08-07T14:20:00Z', method: 'Bank Transfer' },
  { id: '5', type: 'sent', amount: 250, currency: 'USD', recipient: 'Sarah Johnson', recipientCountry: 'ET', status: 'failed', date: '2026-08-06T11:10:00Z', method: 'Mobile Money' },
];

export default function TransactionHistoryScreen() {
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');

  const filtered = filter === 'all' ? mockTransactions : mockTransactions.filter(t => t.type === filter);

  const renderItem = ({ item }: { item: Transaction }) => (
    <View style={styles.transactionItem}>
      <View style={[styles.iconContainer, { backgroundColor: item.type === 'sent' ? '#FF6B6B15' : '#00D4AA15' }]}>
        <Ionicons
          name={item.type === 'sent' ? 'arrow-up' : 'arrow-down'}
          size={20}
          color={item.type === 'sent' ? '#FF6B6B' : '#00D4AA'}
        />
      </View>
      <View style={styles.details}>
        <Text style={styles.recipient}>{item.recipient}</Text>
        <Text style={styles.meta}>{item.recipientCountry} · {item.method}</Text>
        <Text style={styles.date}>{new Date(item.date).toLocaleDateString()}</Text>
      </View>
      <View style={styles.amountContainer}>
        <Text style={[styles.amount, { color: item.type === 'sent' ? '#FF6B6B' : '#00D4AA' }]}>
          {item.type === 'sent' ? '-' : '+'}${item.amount.toFixed(2)}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: item.status === 'completed' ? '#00D4AA15' : item.status === 'pending' ? '#FFA50015' : '#FF6B6B15' }]}>
          <Text style={[styles.statusText, { color: item.status === 'completed' ? '#00D4AA' : item.status === 'pending' ? '#FFA500' : '#FF6B6B' }]}>
            {item.status}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Transaction History</Text>

      {/* Filters */}
      <View style={styles.filterContainer}>
        {(['all', 'sent', 'received'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterButton, filter === f && styles.filterButtonActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#0A2540', padding: 20 },
  filterContainer: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 16 },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterButtonActive: { backgroundColor: '#635BFF', borderColor: '#635BFF' },
  filterText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  filterTextActive: { color: '#FFFFFF' },
  list: { paddingHorizontal: 20, gap: 12 },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  iconContainer: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  details: { flex: 1, marginLeft: 12 },
  recipient: { fontSize: 16, fontWeight: '600', color: '#0A2540' },
  meta: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  date: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  amountContainer: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, marginTop: 4 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
});
