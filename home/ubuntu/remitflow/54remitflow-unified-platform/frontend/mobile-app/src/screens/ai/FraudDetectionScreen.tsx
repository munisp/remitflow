import React, { useState, useEffect } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { ApiService } from '../../services/ApiService';

export const FraudDetectionScreen = () => {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAlerts = async () => {
    try {
      const res = await ApiService.get('/api/v1/fraud/alerts');
      setAlerts(res.data?.alerts || []);
    } catch (e) {
      console.error('Failed to load fraud alerts:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchAlerts(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#667eea" /></View>;

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} />}>
      <Text style={styles.header}>Fraud Alerts ({alerts.length})</Text>
      {alerts.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.emptyText}>No active fraud alerts</Text></View>
      ) : alerts.map((alert, i) => (
        <View key={i} style={[styles.card, alert.severity === 'high' && styles.highRisk]}>
          <Text style={styles.alertTitle}>{alert.type || 'Suspicious Activity'}</Text>
          <Text style={styles.alertDesc}>{alert.description || 'Review required'}</Text>
          <Text style={styles.alertMeta}>Severity: {alert.severity || 'medium'} • {alert.timestamp || ''}</Text>
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: '#1a1a2e' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#f59e0b' },
  highRisk: { borderLeftColor: '#ef4444' },
  emptyCard: { backgroundColor: '#fff', padding: 30, borderRadius: 10, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 15 },
  alertTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', marginBottom: 4 },
  alertDesc: { fontSize: 13, color: '#666', marginBottom: 6 },
  alertMeta: { fontSize: 12, color: '#999' },
});
