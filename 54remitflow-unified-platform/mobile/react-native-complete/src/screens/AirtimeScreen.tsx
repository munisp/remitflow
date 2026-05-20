import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { APIClient } from '../api/APIClient';
import { AnalyticsService } from '../services/AnalyticsService';


const apiClient = new APIClient();

export const AirtimeScreen = ({ navigation }: any) => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('MTN');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    AnalyticsService.trackScreenView('Airtime');
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // No initial load needed
      setLoading(false);
    } catch (e) {
      AnalyticsService.trackError('airtime_load_failed', e);
    } finally {
      setLoading(false);
    }
  };

  const sendAirtime = async () => {
    if (!phone || !amount) { Alert.alert('Error', 'Phone number and amount are required'); return; }
    setSending(true);
    try {
      await apiClient.post('/api/trpc/airtime.topup', { provider, phoneNumber: phone, amount: parseFloat(amount) });
      Alert.alert('Success', `${provider} airtime of $${amount} sent to ${phone}`);
      setPhone(''); setAmount('');
    } catch { Alert.alert('Error', 'Airtime top-up failed'); } finally { setSending(false); }
  };

  const renderContent = () => (
    <ScrollView>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Select Provider</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {['MTN', 'Airtel', 'Glo', '9mobile', 'Safaricom', 'Vodacom'].map(p => (
            <TouchableOpacity key={p} style={[styles.badge, { padding: 8, backgroundColor: provider === p ? '#6366f1' : '#2e2e3e' }]} onPress={() => setProvider(p)}>
              <Text style={styles.badgeText}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Phone Number</Text>
        <TextInput style={[styles.searchInput, { margin: 0, marginTop: 8 }]} placeholder="+234 800 000 0000" placeholderTextColor="#555" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Amount (USD)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {['5', '10', '20', '50'].map(a => (
            <TouchableOpacity key={a} style={[styles.badge, { padding: 8, backgroundColor: amount === a ? '#6366f1' : '#2e2e3e' }]} onPress={() => setAmount(a)}>
              <Text style={styles.badgeText}>${a}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={[styles.searchInput, { margin: 0, marginTop: 8 }]} placeholder="Custom amount" placeholderTextColor="#555" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      </View>
      <TouchableOpacity style={[styles.actionBtn, { margin: 16 }]} onPress={sendAirtime} disabled={sending}>
        <Text style={styles.actionBtnText}>{sending ? 'Sending...' : `Send ${provider} Airtime`}</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Airtime & Data</Text>
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
          <Text style={styles.loadingText}>Loading Airtime & Data...</Text>
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
