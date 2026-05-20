import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { APIClient } from '../api/APIClient';
import { AnalyticsService } from '../services/AnalyticsService';


const apiClient = new APIClient();

export const FraudMonitorScreen = ({ navigation }: any) => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    AnalyticsService.trackScreenView('FraudMonitor');
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/trpc/fraudMonitor.alerts');
      setAlerts(res?.result?.data ?? []);
    } catch (e) {
      AnalyticsService.trackError('fraudmonitor_load_failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: number, action: 'approve' | 'block' | 'review') => {
    await apiClient.post('/api/trpc/fraudMonitor.action', { alertId: id, action });
    loadData();
  };

  const renderContent = () => (
    <ScrollView>
      {alerts.filter(a => a.description?.toLowerCase().includes(search.toLowerCase()) || !search).map(alert => (
        <View key={alert.id} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: alert.riskLevel === 'high' ? '#ef4444' : alert.riskLevel === 'medium' ? '#f59e0b' : '#22c55e' }]}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{alert.description ?? 'Fraud Alert'}</Text>
            <View style={[styles.badge, alert.riskLevel === 'high' ? styles.dangerBadge : alert.riskLevel === 'medium' ? styles.warningBadge : styles.successBadge]}>
              <Text style={styles.badgeText}>{alert.riskLevel}</Text>
            </View>
          </View>
          <Text style={styles.cardSubtitle}>Risk Score: {alert.riskScore ?? 0}/100 · ${(alert.amount ?? 0).toFixed(2)}</Text>
          <Text style={styles.label}>{alert.createdAt ? new Date(alert.createdAt).toLocaleString() : 'N/A'}</Text>
          {alert.status === 'pending' && (
            <View style={styles.row}>
              <TouchableOpacity style={[styles.actionBtn, { flex: 1, marginRight: 4, backgroundColor: '#22c55e' }]} onPress={() => handleAction(alert.id, 'approve')}>
                <Text style={styles.actionBtnText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dangerBtn, { flex: 1, marginLeft: 4, marginTop: 0 }]} onPress={() => handleAction(alert.id, 'block')}>
                <Text style={styles.actionBtnText}>Block</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
      {!alerts.length && <Text style={styles.emptyText}>No fraud alerts. System is clean.</Text>}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Fraud Monitor</Text>
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
          <Text style={styles.loadingText}>Loading Fraud Monitor...</Text>
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
