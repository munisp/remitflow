import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import ApiClient from '../../services/ApiClient';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  description: string;
  recipient: string;
  reference: string;
  fee: number;
  created_at: string;
}

const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 'TXN-001', type: 'deposit', amount: 50000, status: 'completed', description: 'Cash deposit', recipient: 'Self', reference: 'REF-001', fee: 100, created_at: '2024-01-15T10:30:00Z' },
  { id: 'TXN-002', type: 'withdrawal', amount: 25000, status: 'completed', description: 'ATM withdrawal', recipient: 'Self', reference: 'REF-002', fee: 50, created_at: '2024-01-15T09:15:00Z' },
  { id: 'TXN-003', type: 'transfer', amount: 15000, status: 'pending', description: 'Bank transfer', recipient: 'Jane Doe', reference: 'REF-003', fee: 25, created_at: '2024-01-14T14:20:00Z' },
  { id: 'TXN-004', type: 'bills', amount: 8500, status: 'completed', description: 'Electricity bill', recipient: 'EKEDC', reference: 'REF-004', fee: 100, created_at: '2024-01-14T11:45:00Z' },
  { id: 'TXN-005', type: 'deposit', amount: 100000, status: 'completed', description: 'Agent deposit', recipient: 'Self', reference: 'REF-005', fee: 200, created_at: '2024-01-13T16:30:00Z' },
  { id: 'TXN-006', type: 'transfer', amount: 35000, status: 'failed', description: 'Failed transfer', recipient: 'John Smith', reference: 'REF-006', fee: 0, created_at: '2024-01-13T10:00:00Z' },
];

const TransactionsScreen: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewTx, setShowNewTx] = useState(false);
  const [newTx, setNewTx] = useState({ type: 'deposit', amount: '', recipient: '', description: '' });
  const [processing, setProcessing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const loadTransactions = async () => {
    try {
      const res = await ApiClient.get<{ transactions: Transaction[] }>('/api/transactions');
      if (res.data.transactions) setTransactions(res.data.transactions);
    } catch {
      setTransactions(MOCK_TRANSACTIONS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadTransactions(); }, []);

  const handleCreate = async () => {
    if (!newTx.amount || parseFloat(newTx.amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    setProcessing(true);
    try {
      const res = await ApiClient.post<{ transaction: Transaction }>('/api/transactions', {
        ...newTx,
        amount: parseFloat(newTx.amount),
      });
      if (res.data.transaction) {
        setTransactions(prev => [res.data.transaction, ...prev]);
      }
    } catch {
      const created: Transaction = {
        id: `TXN-${Date.now()}`,
        type: newTx.type,
        amount: parseFloat(newTx.amount),
        status: 'pending',
        description: newTx.description || `${newTx.type} transaction`,
        recipient: newTx.recipient || 'Self',
        reference: `REF-${Date.now()}`,
        fee: Math.round(parseFloat(newTx.amount) * 0.002),
        created_at: new Date().toISOString(),
      };
      setTransactions(prev => [created, ...prev]);
    } finally {
      setProcessing(false);
      setShowNewTx(false);
      setNewTx({ type: 'deposit', amount: '', recipient: '', description: '' });
    }
  };

  const handleDelete = async (txId: string) => {
    Alert.alert('Delete Transaction', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await ApiClient.delete(`/api/transactions/${txId}`);
          } catch {}
          setTransactions(prev => prev.filter(t => t.id !== txId));
          setSelectedTx(null);
        },
      },
    ]);
  };

  const formatCurrency = (amount: number) => `\u20A6${amount.toLocaleString()}`;

  const filtered = transactions.filter(tx => {
    const matchSearch = !searchTerm || tx.description.toLowerCase().includes(searchTerm.toLowerCase()) || tx.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchType = filterType === 'all' || tx.type === filterType;
    const matchStatus = filterStatus === 'all' || tx.status === filterStatus;
    return matchSearch && matchType && matchStatus;
  });

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#007AFF" /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Transactions</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowNewTx(true)}>
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search transactions..."
        value={searchTerm}
        onChangeText={setSearchTerm}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {['all', 'deposit', 'withdrawal', 'transfer', 'bills'].map(type => (
          <TouchableOpacity
            key={type}
            style={[styles.filterChip, filterType === type && styles.filterChipActive]}
            onPress={() => setFilterType(type)}
          >
            <Text style={[styles.filterChipText, filterType === type && styles.filterChipTextActive]}>
              {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTransactions(); }} />}
      >
        {filtered.map(tx => (
          <TouchableOpacity key={tx.id} style={styles.txRow} onPress={() => setSelectedTx(tx)}>
            <View>
              <Text style={styles.txDesc}>{tx.description}</Text>
              <Text style={styles.txMeta}>{tx.id} | {new Date(tx.created_at).toLocaleDateString()}</Text>
            </View>
            <View style={styles.txRight}>
              <Text style={[styles.txAmount, { color: tx.type === 'deposit' ? '#10B981' : '#EF4444' }]}>
                {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: tx.status === 'completed' ? '#D1FAE5' : tx.status === 'pending' ? '#FEF3C7' : '#FEE2E2' }]}>
                <Text style={[styles.statusText, { color: tx.status === 'completed' ? '#065F46' : tx.status === 'pending' ? '#92400E' : '#991B1B' }]}>{tx.status}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
        {filtered.length === 0 && <Text style={styles.emptyText}>No transactions found</Text>}
      </ScrollView>

      <Modal visible={showNewTx} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Transaction</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {['deposit', 'withdrawal', 'transfer', 'bills'].map(type => (
                <TouchableOpacity
                  key={type}
                  style={[styles.filterChip, newTx.type === type && styles.filterChipActive]}
                  onPress={() => setNewTx(p => ({ ...p, type }))}
                >
                  <Text style={[styles.filterChipText, newTx.type === type && styles.filterChipTextActive]}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput style={styles.input} placeholder="Amount" keyboardType="numeric" value={newTx.amount} onChangeText={v => setNewTx(p => ({ ...p, amount: v }))} />
            <TextInput style={styles.input} placeholder="Recipient" value={newTx.recipient} onChangeText={v => setNewTx(p => ({ ...p, recipient: v }))} />
            <TextInput style={styles.input} placeholder="Description" value={newTx.description} onChangeText={v => setNewTx(p => ({ ...p, description: v }))} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNewTx(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={handleCreate} disabled={processing}>
                {processing ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!selectedTx} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedTx && (
              <>
                <Text style={styles.modalTitle}>Transaction Details</Text>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>ID</Text><Text style={styles.detailValue}>{selectedTx.id}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>Type</Text><Text style={styles.detailValue}>{selectedTx.type}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>Amount</Text><Text style={styles.detailValue}>{formatCurrency(selectedTx.amount)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>Fee</Text><Text style={styles.detailValue}>{formatCurrency(selectedTx.fee)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>Status</Text><Text style={styles.detailValue}>{selectedTx.status}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>Recipient</Text><Text style={styles.detailValue}>{selectedTx.recipient}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>Reference</Text><Text style={styles.detailValue}>{selectedTx.reference}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>Date</Text><Text style={styles.detailValue}>{new Date(selectedTx.created_at).toLocaleString()}</Text></View>
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedTx(null)}>
                    <Text style={styles.cancelBtnText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#EF4444' }]} onPress={() => handleDelete(selectedTx.id)}>
                    <Text style={styles.submitBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC', padding: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  header: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  newBtn: { backgroundColor: '#4F46E5', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 10, shadowColor: '#4F46E5', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  newBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  searchInput: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, paddingLeft: 16, marginBottom: 14, fontSize: 14, borderWidth: 1.5, borderColor: '#E2E8F0', color: '#1E293B' },
  filterRow: { marginBottom: 14, maxHeight: 40 },
  filterChip: { backgroundColor: '#F1F5F9', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, marginRight: 8 },
  filterChipActive: { backgroundColor: '#4F46E5' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  filterChipTextActive: { color: '#FFFFFF' },
  list: { flex: 1 },
  txRow: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  txDesc: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
  txMeta: { fontSize: 11, color: '#94A3B8', marginTop: 3 },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontSize: 15, fontWeight: '700' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyText: { textAlign: 'center', color: '#94A3B8', marginTop: 60, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, maxHeight: '85%' },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 20, letterSpacing: -0.3 },
  input: { backgroundColor: '#F8FAFC', borderRadius: 14, padding: 14, marginBottom: 14, fontSize: 14, borderWidth: 1.5, borderColor: '#E2E8F0', color: '#1E293B' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, gap: 12 },
  cancelBtn: { flex: 1, borderRadius: 14, padding: 16, alignItems: 'center', backgroundColor: '#F1F5F9' },
  cancelBtnText: { color: '#475569', fontWeight: '700' },
  submitBtn: { flex: 1, borderRadius: 14, padding: 16, alignItems: 'center', backgroundColor: '#4F46E5', shadowColor: '#4F46E5', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  submitBtnText: { color: '#FFFFFF', fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  detailLabel: { fontSize: 14, color: '#94A3B8', fontWeight: '500' },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
});

export default TransactionsScreen;
