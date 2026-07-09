import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { getConnectedAccounts, getSupportedBanks, initiateBankConnection } from '../../services/futureProofingApi';

interface Account { bankName: string; accountNumber: string; accountType: string }
interface Bank { id: string; name: string; nibssCode: string }

export default function OpenBankingScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [acctRes, bankRes] = await Promise.all([getConnectedAccounts(), getSupportedBanks()]);
      setAccounts(acctRes.accounts || []);
      setBanks(bankRes.banks || []);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleConnect = async (bank: Bank) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await initiateBankConnection(bank.id);
      Alert.alert('Bank Connection', `Connecting to ${bank.name}...\nConsent ID: ${result.consentId}`);
      loadData();
    } catch (e: any) {
      Alert.alert('Failed', e.message);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}
      ListHeaderComponent={
        <>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>🏦 CBN Open Banking</Text>
            <Text style={styles.headerSub}>{accounts.length} account{accounts.length !== 1 ? 's' : ''} connected</Text>
          </View>
          {accounts.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Connected Accounts</Text>
              {accounts.map((acct, i) => (
                <View key={i} style={styles.accountCard}>
                  <View style={styles.accountIcon}><Text style={styles.accountIconText}>🏛</Text></View>
                  <View style={styles.accountInfo}>
                    <Text style={styles.accountName}>{acct.bankName}</Text>
                    <Text style={styles.accountSub}>{acct.accountType} • ****{acct.accountNumber.slice(-4)}</Text>
                  </View>
                  <View style={styles.activeBadge}><Text style={styles.activeText}>Active</Text></View>
                </View>
              ))}
            </>
          )}
          <Text style={styles.sectionTitle}>Connect a Bank</Text>
          <Text style={styles.sectionSub}>CBN Open Banking compliant. Your data is encrypted.</Text>
        </>
      }
      data={banks}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <View style={styles.bankCard}>
          <View style={styles.bankIcon}>
            <Text style={styles.bankIconText}>{item.name.charAt(0)}</Text>
          </View>
          <View style={styles.bankInfo}>
            <Text style={styles.bankName}>{item.name}</Text>
            <Text style={styles.bankCode}>NIBSS: {item.nibssCode}</Text>
          </View>
          <TouchableOpacity style={styles.connectBtn} onPress={() => handleConnect(item)}>
            <Text style={styles.connectText}>Connect</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#00695C', borderRadius: 12, padding: 16, marginBottom: 20 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  headerSub: { color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
  sectionSub: { color: '#666', fontSize: 13, marginBottom: 12 },
  accountCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', borderRadius: 12, padding: 14, marginBottom: 8 },
  accountIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e0f2f1', justifyContent: 'center', alignItems: 'center' },
  accountIconText: { fontSize: 20 },
  accountInfo: { flex: 1, marginLeft: 12 },
  accountName: { fontWeight: '600' },
  accountSub: { color: '#666', fontSize: 12, marginTop: 2 },
  activeBadge: { backgroundColor: '#e8f5e9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  activeText: { color: '#2e7d32', fontSize: 12, fontWeight: '600' },
  bankCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', borderRadius: 12, padding: 14, marginBottom: 8 },
  bankIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e3f2fd', justifyContent: 'center', alignItems: 'center' },
  bankIconText: { fontSize: 16, fontWeight: 'bold', color: '#1565c0' },
  bankInfo: { flex: 1, marginLeft: 12 },
  bankName: { fontWeight: '500' },
  bankCode: { color: '#666', fontSize: 12, marginTop: 2 },
  connectBtn: { borderWidth: 1, borderColor: '#007AFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  connectText: { color: '#007AFF', fontWeight: '600', fontSize: 13 },
});
