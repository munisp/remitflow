import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { APIClient } from '../api/APIClient';
import { AnalyticsService } from '../services/AnalyticsService';


const apiClient = new APIClient();

export const BNPLScreen = ({ navigation }: any) => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plans, setPlans] = useState<any[]>([]);
  const [eligibility, setEligibility] = useState<any>(null);

  useEffect(() => {
    AnalyticsService.trackScreenView('BNPL');
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, e] = await Promise.all([apiClient.get('/api/trpc/bnpl.plans'), apiClient.get('/api/trpc/bnpl.eligibility')]);
      setPlans(p?.result?.data ?? []); setEligibility(e?.result?.data);
    } catch (e) {
      AnalyticsService.trackError('bnpl_load_failed', e);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => (
    <ScrollView>
      {eligibility && (
        <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: '#6366f1' }]}>
          <Text style={styles.cardTitle}>Credit Limit</Text>
          <Text style={styles.amount}>${(eligibility.limit ?? eligibility.creditLimit ?? 0).toFixed(2)}</Text>
          <Text style={styles.label}>Available for BNPL purchases</Text>
        </View>
      )}
      <Text style={[styles.cardTitle, { margin: 16, marginBottom: 8 }]}>Active Plans</Text>
      {plans.filter(p => p.merchant?.toLowerCase().includes(search.toLowerCase()) || !search).map(plan => (
        <View key={plan.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{plan.merchant ?? 'Purchase'}</Text>
            <View style={[styles.badge, plan.status === 'active' ? styles.successBadge : styles.warningBadge]}>
              <Text style={styles.badgeText}>{plan.status}</Text>
            </View>
          </View>
          <Text style={styles.cardSubtitle}>{plan.installments} installments · ${(plan.installmentAmount ?? 0).toFixed(2)}/mo</Text>
          <Text style={styles.label}>Total: ${(plan.totalAmount ?? 0).toFixed(2)} · Due: {plan.nextDueDate ?? 'N/A'}</Text>
        </View>
      ))}
      {!plans.length && <Text style={styles.emptyText}>No active BNPL plans.</Text>}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Buy Now Pay Later</Text>
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
          <Text style={styles.loadingText}>Loading Buy Now Pay Later...</Text>
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
