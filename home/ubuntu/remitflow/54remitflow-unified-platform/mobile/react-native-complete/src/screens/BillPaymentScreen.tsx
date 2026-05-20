import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { APIClient } from '../api/APIClient';
import { AnalyticsService } from '../services/AnalyticsService';


const apiClient = new APIClient();

export const BillPaymentScreen = ({ navigation }: any) => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('utilities');
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    AnalyticsService.trackScreenView('BillPayment');
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/trpc/bills.history');
      setHistory(res?.result?.data ?? []);
    } catch (e) {
      AnalyticsService.trackError('billpayment_load_failed', e);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => (
    <ScrollView>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Category</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {['utilities', 'internet', 'tv', 'insurance', 'education'].map(c => (
            <TouchableOpacity key={c} style={[styles.badge, { padding: 8, backgroundColor: category === c ? '#6366f1' : '#2e2e3e' }]} onPress={() => setCategory(c)}>
              <Text style={styles.badgeText}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <TouchableOpacity style={[styles.actionBtn, { margin: 16 }]} onPress={() => Alert.alert('Pay Bill', 'Select a biller from the web app to set up bill payments.')}>
        <Text style={styles.actionBtnText}>+ Pay New Bill</Text>
      </TouchableOpacity>
      <Text style={[styles.cardTitle, { margin: 16, marginBottom: 8 }]}>Payment History</Text>
      {history.filter(h => h.biller?.toLowerCase().includes(search.toLowerCase()) || !search).map(h => (
        <View key={h.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{h.biller ?? 'Bill Payment'}</Text>
            <View style={[styles.badge, h.status === 'paid' ? styles.successBadge : styles.warningBadge]}>
              <Text style={styles.badgeText}>{h.status}</Text>
            </View>
          </View>
          <Text style={styles.amount}>${(h.amount ?? 0).toFixed(2)}</Text>
          <Text style={styles.label}>{h.paidAt ? new Date(h.paidAt).toLocaleDateString() : 'N/A'}</Text>
        </View>
      ))}
      {!history.length && <Text style={styles.emptyText}>No bill payment history.</Text>}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Bill Payment</Text>
      </View>
      <TextInput
        style={styles.searchInput}
        placeholder="Search..."
        value={search}
        onChangeText={setSearch}
      />
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading Bill Payment...</Text>
        </View>
      ) : renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  backBtn: { marginRight: 12 },
  backText: { color: '#6366f1', fontSize: 14 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', flex: 1 },
  searchInput: { margin: 16, padding: 12, backgroundColor: '#1e1e2e', borderRadius: 8, color: '#fff', fontSize: 14 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', marginTop: 8 },
  card: { margin: 8, marginHorizontal: 16, padding: 16, backgroundColor: '#1e1e2e', borderRadius: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: '#888', marginBottom: 8 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: '#6366f1', marginTop: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  actionBtn: { marginTop: 8, padding: 10, backgroundColor: '#6366f1', borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 40, fontSize: 15 },
  progressBar: { height: 6, backgroundColor: '#2e2e3e', borderRadius: 3, marginVertical: 6 },
  progressFill: { height: 6, backgroundColor: '#6366f1', borderRadius: 3 },
  amount: { fontSize: 22, fontWeight: 'bold', color: '#6366f1' },
  label: { fontSize: 12, color: '#888', marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  dangerBtn: { padding: 10, backgroundColor: '#ef4444', borderRadius: 8, alignItems: 'center', marginTop: 8 },
  successBadge: { backgroundColor: '#22c55e' },
  warningBadge: { backgroundColor: '#f59e0b' },
  dangerBadge: { backgroundColor: '#ef4444' },
});
