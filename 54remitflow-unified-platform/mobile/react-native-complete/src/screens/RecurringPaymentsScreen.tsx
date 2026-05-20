import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { APIClient } from '../api/APIClient';
import { AnalyticsService } from '../services/AnalyticsService';


const apiClient = new APIClient();

export const RecurringPaymentsScreen = ({ navigation }: any) => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    AnalyticsService.trackScreenView('RecurringPayments');
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/trpc/recurring.list');
      setPayments(res?.result?.data ?? []);
    } catch (e) {
      AnalyticsService.trackError('recurringpayments_load_failed', e);
    } finally {
      setLoading(false);
    }
  };

  const togglePause = async (id: number, isPaused: boolean) => {
    await apiClient.post(isPaused ? '/api/trpc/recurring.resume' : '/api/trpc/recurring.pause', { id });
    loadData();
  };

  const renderContent = () => (
    <ScrollView>
      {payments.filter(p => p.description?.toLowerCase().includes(search.toLowerCase()) || !search).map(p => (
        <View key={p.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{p.description ?? 'Recurring Payment'}</Text>
            <View style={[styles.badge, p.status === 'active' ? styles.successBadge : p.status === 'paused' ? styles.warningBadge : styles.dangerBadge]}>
              <Text style={styles.badgeText}>{p.status}</Text>
            </View>
          </View>
          <Text style={styles.amount}>${(p.amount ?? 0).toFixed(2)}</Text>
          <Text style={styles.label}>{p.frequency} · Next: {p.nextRunDate ? new Date(p.nextRunDate).toLocaleDateString() : 'N/A'}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.actionBtn, { flex: 1, marginRight: 4, backgroundColor: p.status === 'paused' ? '#22c55e' : '#f59e0b' }]} onPress={() => togglePause(p.id, p.status === 'paused')}>
              <Text style={styles.actionBtnText}>{p.status === 'paused' ? 'Resume' : 'Pause'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.dangerBtn, { flex: 1, marginLeft: 4, marginTop: 0 }]} onPress={() => Alert.alert('Cancel', 'Cancel this recurring payment?', [{ text: 'No' }, { text: 'Yes', onPress: async () => { await apiClient.post('/api/trpc/recurring.cancel', { id: p.id }); loadData(); } }])}>
              <Text style={styles.actionBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {!payments.length && <Text style={styles.emptyText}>No recurring payments set up.</Text>}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Recurring Payments</Text>
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
          <Text style={styles.loadingText}>Loading Recurring Payments...</Text>
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
