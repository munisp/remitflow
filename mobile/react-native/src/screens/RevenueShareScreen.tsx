import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function RevenueShareScreen() {
  const navigation = useNavigation();
  const { data: summary, isLoading } = trpc.revenueShare.getSummary.useQuery();
  const { data: payouts } = trpc.revenueShare.getPayouts.useQuery({ limit: 10 });

  const requestPayout = trpc.revenueShare.requestPayout.useMutation({
    onSuccess: () => Alert.alert('Success', 'Payout request submitted successfully!'),
    onError: (e) => Alert.alert('Error', e.message),
  });

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Revenue Share</Text>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Total Earned</Text>
            <Text style={styles.earningsAmount}>${Number(summary?.totalEarned ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
            <View style={styles.earningsRow}>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatLabel}>Pending</Text>
                <Text style={styles.earningsStatValue}>${Number(summary?.pendingPayout ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatLabel}>This Month</Text>
                <Text style={styles.earningsStatValue}>${Number(summary?.thisMonth ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatLabel}>Tier</Text>
                <Text style={[styles.earningsStatValue, { color: '#f59e0b' }]}>{summary?.tier ?? 'Bronze'}</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.payoutBtn, Number(summary?.pendingPayout ?? 0) < 50 && styles.payoutBtnDisabled]}
            onPress={() => requestPayout.mutate({ amount: Number(summary?.pendingPayout ?? 0) })}
            disabled={Number(summary?.pendingPayout ?? 0) < 50 || requestPayout.isPending}
          >
            {requestPayout.isPending ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.payoutBtnText}>
                {Number(summary?.pendingPayout ?? 0) < 50 ? `Min $50 required (${Number(summary?.pendingPayout ?? 0).toFixed(2)} pending)` : 'Request Payout'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Payout History</Text>
          <View style={styles.payoutList}>
            {(payouts ?? []).map((p) => (
              <View key={p.id} style={styles.payoutItem}>
                <View>
                  <Text style={styles.payoutDate}>{new Date(p.createdAt).toLocaleDateString()}</Text>
                  <Text style={styles.payoutStatus}>{p.status}</Text>
                </View>
                <Text style={[styles.payoutAmount, { color: p.status === 'paid' ? '#10b981' : '#f59e0b' }]}>
                  ${Number(p.amount).toFixed(2)}
                </Text>
              </View>
            ))}
            {(!payouts || payouts.length === 0) && (
              <Text style={styles.empty}>No payouts yet</Text>
            )}
          </View>
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  back: { marginTop: 48, marginBottom: 8 },
  backText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 20 },
  earningsCard: { backgroundColor: '#6366f1', borderRadius: 20, padding: 24, marginBottom: 16 },
  earningsLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 4 },
  earningsAmount: { color: '#fff', fontSize: 40, fontWeight: '800', marginBottom: 20 },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  earningsStat: { alignItems: 'center' },
  earningsStatLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 4 },
  earningsStatValue: { color: '#fff', fontSize: 16, fontWeight: '700' },
  payoutBtn: { backgroundColor: '#10b981', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 24 },
  payoutBtnDisabled: { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2d2d4e' },
  payoutBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 12 },
  payoutList: { backgroundColor: '#1a1a2e', borderRadius: 16, overflow: 'hidden' },
  payoutItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  payoutDate: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  payoutStatus: { color: '#9ca3af', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  payoutAmount: { fontSize: 16, fontWeight: '700' },
  empty: { color: '#6b7280', textAlign: 'center', padding: 24 },
});
