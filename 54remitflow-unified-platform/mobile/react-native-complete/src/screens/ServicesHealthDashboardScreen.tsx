/**
 * RemitFlow Mobile — Services Health Dashboard Screen (React Native)
 * Displays live health status of all 50 microservices with WebSocket feed.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

type ServiceStatus = 'healthy' | 'degraded' | 'unavailable';

interface ServiceHealth {
  name: string;
  url: string;
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

interface HealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  status: string;
}

interface CircuitTrip {
  service: string;
  previousStatus: string;
  currentStatus: string;
  timestamp: string;
}

const STATUS_COLORS: Record<ServiceStatus, string> = {
  healthy: '#22c55e',
  degraded: '#eab308',
  unavailable: '#ef4444',
};

const API_BASE = 'https://remitflow.manus.space';

const ServicesHealthDashboardScreen: React.FC = () => {
  const navigation = useNavigation();
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [circuitTrips, setCircuitTrips] = useState<CircuitTrip[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const wsUrl = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/services-health';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setWsStatus('connecting');

    ws.onopen = () => {
      setWsStatus('open');
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'health_update') {
          setServices(msg.services);
          setSummary(msg.summary);
          setLastUpdate(new Date(msg.timestamp));
          setRefreshing(false);
        } else if (msg.type === 'circuit_trip') {
          setCircuitTrips((prev) => [msg, ...prev].slice(0, 20));
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setWsStatus('closed');
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => { ws.close(); };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping' }));
    } else {
      connect();
    }
    setTimeout(() => setRefreshing(false), 3000);
  }, [connect]);

  const filteredServices = services.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const renderServiceCard = ({ item }: { item: ServiceHealth }) => (
    <View style={[styles.serviceCard, { borderLeftColor: STATUS_COLORS[item.status] }]}>
      <View style={styles.serviceCardHeader}>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[item.status] }]} />
        <Text style={styles.serviceName} numberOfLines={1}>{item.name}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '22' }]}>
          <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[item.status] }]}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.serviceUrl} numberOfLines={1}>{item.url}</Text>
      {item.latencyMs !== undefined && (
        <Text style={styles.serviceLatency}>{item.latencyMs}ms</Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>{'<'} Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Services Health</Text>
        <View style={[styles.wsBadge, { backgroundColor: wsStatus === 'open' ? '#22c55e22' : '#ef444422' }]}>
          <Text style={[styles.wsBadgeText, { color: wsStatus === 'open' ? '#22c55e' : '#ef4444' }]}>
            {wsStatus === 'open' ? 'Live' : wsStatus === 'connecting' ? 'Connecting' : 'Reconnecting'}
          </Text>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        stickyHeaderIndices={[2]}
      >
        {/* Summary Cards */}
        {summary && (
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { borderTopColor: '#3b82f6' }]}>
              <Text style={styles.summaryValue}>{summary.total}</Text>
              <Text style={styles.summaryLabel}>Total</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: '#22c55e' }]}>
              <Text style={[styles.summaryValue, { color: '#22c55e' }]}>{summary.healthy}</Text>
              <Text style={styles.summaryLabel}>Healthy</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: '#eab308' }]}>
              <Text style={[styles.summaryValue, { color: '#eab308' }]}>{summary.degraded}</Text>
              <Text style={styles.summaryLabel}>Degraded</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: '#ef4444' }]}>
              <Text style={[styles.summaryValue, { color: '#ef4444' }]}>{summary.unavailable}</Text>
              <Text style={styles.summaryLabel}>Down</Text>
            </View>
          </View>
        )}

        {/* Status Banner */}
        {summary && (
          <View style={[styles.statusBanner, {
            backgroundColor: summary.status === 'healthy' ? '#f0fdf4' : summary.status === 'degraded' ? '#fefce8' : '#fef2f2',
            borderColor: summary.status === 'healthy' ? '#86efac' : summary.status === 'degraded' ? '#fde047' : '#fca5a5',
          }]}>
            <Text style={[styles.statusBannerText, {
              color: summary.status === 'healthy' ? '#15803d' : summary.status === 'degraded' ? '#854d0e' : '#991b1b',
            }]}>
              Platform Status: {summary.status.toUpperCase()} — {summary.healthy}/{summary.total} services healthy
            </Text>
          </View>
        )}

        {/* Search */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search services..."
            value={search}
            onChangeText={setSearch}
            placeholderTextColor="#9ca3af"
          />
        </View>

        {/* Circuit Trips */}
        {circuitTrips.length > 0 && (
          <View style={styles.tripsSection}>
            <Text style={styles.tripsSectionTitle}>Circuit-Breaker Events ({circuitTrips.length})</Text>
            {circuitTrips.slice(0, 5).map((trip, i) => (
              <View key={i} style={styles.tripRow}>
                <Text style={styles.tripTime}>{new Date(trip.timestamp).toLocaleTimeString()}</Text>
                <Text style={styles.tripService}>{trip.service}</Text>
                <Text style={styles.tripArrow}>{trip.previousStatus} → {trip.currentStatus}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Services List */}
        <View style={styles.servicesSection}>
          <Text style={styles.sectionTitle}>
            Services ({filteredServices.length})
          </Text>
          {wsStatus === 'connecting' && services.length === 0 ? (
            <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />
          ) : (
            filteredServices.map((item) => (
              <View key={item.name}>
                {renderServiceCard({ item })}
              </View>
            ))
          )}
        </View>

        {lastUpdate && (
          <Text style={styles.lastUpdate}>
            Last updated: {lastUpdate.toLocaleTimeString()}
          </Text>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  backButton: { marginRight: 12 },
  backButtonText: { color: '#3b82f6', fontSize: 16 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#0f172a' },
  wsBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  wsBadgeText: { fontSize: 11, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', padding: 12, gap: 8 },
  summaryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 8, padding: 10, alignItems: 'center', borderTopWidth: 3, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  summaryValue: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  summaryLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
  statusBanner: { margin: 12, padding: 12, borderRadius: 8, borderWidth: 1 },
  statusBannerText: { fontSize: 13, fontWeight: '600' },
  searchContainer: { padding: 12, backgroundColor: '#fff' },
  searchInput: { backgroundColor: '#f1f5f9', borderRadius: 8, padding: 10, fontSize: 14, color: '#0f172a' },
  tripsSection: { margin: 12, backgroundColor: '#fff', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#fed7aa' },
  tripsSectionTitle: { fontSize: 13, fontWeight: '600', color: '#ea580c', marginBottom: 8 },
  tripRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tripTime: { fontSize: 11, color: '#94a3b8', width: 70 },
  tripService: { flex: 1, fontSize: 12, fontWeight: '500', color: '#0f172a' },
  tripArrow: { fontSize: 11, color: '#64748b' },
  servicesSection: { padding: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a', marginBottom: 10 },
  serviceCard: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, borderLeftWidth: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  serviceCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  serviceName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  serviceUrl: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 2 },
  serviceLatency: { fontSize: 11, color: '#64748b' },
  loader: { marginTop: 40 },
  lastUpdate: { textAlign: 'center', fontSize: 11, color: '#94a3b8', padding: 16 },
});

export default ServicesHealthDashboardScreen;
