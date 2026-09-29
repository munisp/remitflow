import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function RevenueShareScreen() {
  const navigation = useNavigation();
  // wave16: revenueShare.getSummary / getPayouts / requestPayout do not exist
  // server-side. The mounted user-scope equivalent is revenueShare.myEarnings
  // (protectedProcedure, returns { reports, summary }). There is NO mounted
  // user-scope payout-request mutation, so that action fails closed below.
  const { data, isLoading, error } = trpc.revenueShare.myEarnings.useQuery({});
  const summary = data?.summary ?? null;
  const reports: any[] = data?.reports ?? [];
  const now = new Date();
  const thisMonth = reports
    .filter((r: any) => r.periodYear === now.getFullYear() && r.periodMonth === now.getMonth() + 1)
    .reduce((acc: number, r: any) => acc + Number(r.partnerEarnings ?? 0), 0);

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Revenue Share</Text>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : error ? (
        <View>
          <Text style={styles.empty}>Unable to load earnings: {(error as any)?.message ?? 'Unknown error'}</Text>
        </View>
      ) : (
        <>
          <View style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Total Earned</Text>
            <Text style={styles.earningsAmount}>${Number(summary?.totalEarned ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
            <View style={styles.earningsRow}>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatLabel}>Pending</Text>
                <Text style={styles.earningsStatValue}>${Number(summary?.totalPending ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatLabel}>This Month</Text>
                <Text style={styles.earningsStatValue}>${thisMonth.toFixed(2)}</Text>
              </View>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatLabel}>Paid Out</Text>
                <Text style={[styles.earningsStatValue, { color: '#10b981' }]}>${Number(summary?.totalPaid ?? 0).toFixed(2)}</Text>
              </View>
            </View>
          </View>

          {/* Fail closed: no mounted user-scope payout-request procedure exists. */}
          <View style={[styles.payoutBtn, styles.payoutBtnDisabled]}>
            <Text style={styles.payoutBtnText}>Payout requests are not yet available in this build</Text>
          </View>

          <Text style={styles.sectionTitle}>Earnings History</Text>
          <View style={styles.payoutList}>
            {reports.map((p: any) => (
              <View key={p.id} style={styles.payoutItem}>
                <View>
                  <Text style={styles.payoutDate}>{p.periodYear}-{String(p.periodMonth).padStart(2, '0')}</Text>
                  <Text style={styles.payoutStatus}>{p.status}</Text>
                </View>
                <Text style={[styles.payoutAmount, { color: p.status === 'paid' ? '#10b981' : '#f59e0b' }]}>
                  ${Number(p.partnerEarnings ?? 0).toFixed(2)}
                </Text>
              </View>
            ))}
            {reports.length === 0 && (
              <Text style={styles.empty}>No earnings reports yet</Text>
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
