import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { APIClient } from '../api/APIClient';
import { AnalyticsService } from '../services/AnalyticsService';


const apiClient = new APIClient();

export const QRPayScreen = ({ navigation }: any) => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [qrInfo, setQrInfo] = useState<any>(null);
  const [tab, setTab] = useState<'receive'|'send'>('receive');

  useEffect(() => {
    AnalyticsService.trackScreenView('QRPay');
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/trpc/qr.info');
      setQrInfo(res?.result?.data);
    } catch (e) {
      AnalyticsService.trackError('qrpay_load_failed', e);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => (
    <ScrollView>
      <View style={{ flexDirection: 'row', margin: 16, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#6366f1' }}>
        {(['receive', 'send'] as const).map(t => (
          <TouchableOpacity key={t} style={{ flex: 1, padding: 10, backgroundColor: tab === t ? '#6366f1' : 'transparent', alignItems: 'center' }} onPress={() => setTab(t)}>
            <Text style={{ color: tab === t ? '#fff' : '#6366f1', fontWeight: '600', textTransform: 'capitalize' }}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'receive' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your QR Code</Text>
          <View style={{ height: 200, backgroundColor: '#2e2e3e', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginVertical: 12 }}>
            <Text style={{ fontSize: 48 }}>⬛</Text>
            <Text style={{ color: '#888', marginTop: 8 }}>QR Code</Text>
          </View>
          <Text style={styles.label}>User ID: {qrInfo?.userId ?? 'N/A'}</Text>
          <Text style={styles.label}>Link: {qrInfo?.paymentLink ?? 'N/A'}</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert('Share', 'Share your QR code')}>
            <Text style={styles.actionBtnText}>Share QR Code</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Scan to Pay</Text>
          <View style={{ height: 200, backgroundColor: '#2e2e3e', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginVertical: 12 }}>
            <Text style={{ fontSize: 48 }}>📷</Text>
            <Text style={{ color: '#888', marginTop: 8 }}>Camera Preview</Text>
          </View>
          <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert('Scan', 'Camera access required to scan QR codes')}>
            <Text style={styles.actionBtnText}>Open Camera</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>QR Pay</Text>
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
          <Text style={styles.loadingText}>Loading QR Pay...</Text>
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
