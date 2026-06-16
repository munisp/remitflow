import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, RefreshControl, StyleSheet, ActivityIndicator,
} from 'react-native';
import { getMiddlewareHealth } from '../../services/futureProofingApi';

interface ServiceHealth { name: string; status: string; latencyMs: number }

const SERVICE_ICONS: Record<string, string> = {
  redis: '💾', openSearch: '🔍', keycloak: '🔑', permify: '🛡',
  dapr: '🔗', apisix: '🌐', tigerBeetle: '🏦', fluvio: '📡',
  lakehouse: '🏠', openAppSec: '🔒', mojaloop: '🔄', kafka: '📨', temporal: '⏱',
};

export default function MiddlewareHealthScreen() {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      const data = await getMiddlewareHealth();
      setServices(Object.entries(data).map(([name, info]) => ({ name, ...info })));
    } catch {
      // handled by empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  const healthyCount = services.filter(s => s.status === 'healthy').length;
  const allHealthy = healthyCount === services.length && services.length > 0;

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadHealth(); }} />}
      ListHeaderComponent={
        <View style={[styles.overviewCard, allHealthy ? styles.healthyBg : styles.degradedBg]}>
          <Text style={styles.overviewIcon}>{allHealthy ? '✓' : '⚠'}</Text>
          <View>
            <Text style={styles.overviewTitle}>{allHealthy ? 'All Systems Operational' : 'Some Systems Degraded'}</Text>
            <Text style={styles.overviewSub}>{healthyCount} / {services.length} services healthy</Text>
          </View>
        </View>
      }
      data={services}
      keyExtractor={item => item.name}
      renderItem={({ item }) => {
        const isHealthy = item.status === 'healthy';
        return (
          <View style={styles.serviceCard}>
            <Text style={styles.serviceIcon}>{SERVICE_ICONS[item.name] ?? '⚙'}</Text>
            <View style={styles.serviceInfo}>
              <Text style={styles.serviceName}>{item.name}</Text>
              <Text style={[styles.serviceStatus, { color: isHealthy ? '#666' : '#e53e3e' }]}>
                {isHealthy ? `${item.latencyMs}ms latency` : 'Unavailable'}
              </Text>
            </View>
            <View style={[styles.statusDot, { backgroundColor: isHealthy ? '#22c55e' : '#ef4444' }]} />
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  overviewCard: { borderRadius: 12, padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  healthyBg: { backgroundColor: '#f0fff4', borderWidth: 1, borderColor: '#c6f6d5' },
  degradedBg: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fef3c7' },
  overviewIcon: { fontSize: 28 },
  overviewTitle: { fontSize: 16, fontWeight: 'bold' },
  overviewSub: { color: '#666', marginTop: 2 },
  serviceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', borderRadius: 10, padding: 14, marginBottom: 8 },
  serviceIcon: { fontSize: 20, width: 36, textAlign: 'center' },
  serviceInfo: { flex: 1, marginLeft: 8 },
  serviceName: { fontWeight: '600' },
  serviceStatus: { fontSize: 12, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
});
