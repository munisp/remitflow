import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { trpc } from '../services/trpc';

const FLAG: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', NGN: '🇳🇬', KES: '🇰🇪',
  GHS: '🇬🇭', ZAR: '🇿🇦', CNY: '🇨🇳', INR: '🇮🇳', BRL: '🇧🇷',
};

export default function WalletScreen() {
  const { data: wallets, isLoading, refetch } = trpc.wallet.list.useQuery();
  const createMutation = trpc.wallet.create.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => Alert.alert('Error', e.message),
  });

  const totalUSD = wallets?.reduce((s, w) => s + Number(w.balanceUsd ?? 0), 0) ?? 0;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>My Wallets</Text>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Portfolio (USD)</Text>
        <Text style={styles.totalAmount}>${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.walletGrid}>
          {(wallets ?? []).map((wallet) => (
            <View key={wallet.id} style={styles.walletCard}>
              <Text style={styles.walletFlag}>{FLAG[wallet.currency] ?? '💱'}</Text>
              <Text style={styles.walletCurrency}>{wallet.currency}</Text>
              <Text style={styles.walletBalance}>
                {Number(wallet.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
              <Text style={styles.walletUsd}>${Number(wallet.balanceUsd ?? 0).toFixed(2)} USD</Text>
              <View style={styles.walletActions}>
                <TouchableOpacity style={styles.walletBtn}>
                  <Text style={styles.walletBtnText}>Top Up</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.walletBtn, styles.walletBtnOutline]}>
                  <Text style={[styles.walletBtnText, { color: '#6366f1' }]}>Withdraw</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => Alert.alert('Add Wallet', 'Select currency', [
          ...['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS'].map(c => ({
            text: `${FLAG[c] ?? ''} ${c}`,
            onPress: () => createMutation.mutate({ currency: c }),
          })),
          { text: 'Cancel', style: 'cancel' },
        ])}
      >
        <Text style={styles.addBtnText}>+ Add Currency Wallet</Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 16, marginTop: 48 },
  totalCard: { backgroundColor: '#6366f1', borderRadius: 20, padding: 24, marginBottom: 20 },
  totalLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 4 },
  totalAmount: { color: '#fff', fontSize: 36, fontWeight: '800' },
  walletGrid: { gap: 12 },
  walletCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2d2d4e' },
  walletFlag: { fontSize: 32, marginBottom: 8 },
  walletCurrency: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  walletBalance: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 2 },
  walletUsd: { color: '#6b7280', fontSize: 13, marginBottom: 16 },
  walletActions: { flexDirection: 'row', gap: 8 },
  walletBtn: { flex: 1, backgroundColor: '#6366f1', borderRadius: 10, padding: 10, alignItems: 'center' },
  walletBtnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#6366f1' },
  walletBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  addBtn: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 2, borderColor: '#2d2d4e', borderStyle: 'dashed', marginTop: 16 },
  addBtnText: { color: '#6366f1', fontWeight: '700', fontSize: 15 },
});
