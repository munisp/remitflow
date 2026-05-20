import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function ReferralScreen() {
  const navigation = useNavigation();
  const { data: info, isLoading } = trpc.referral.info.useQuery();
  const { data: stats } = trpc.referral.stats.useQuery();
  const handleShare = () => {
    if (!info?.referralCode) return;
    Share.share({ message: \`Join RemitFlow and send money home for less! Use my code \${info.referralCode} to get started: https://remitflow.app/join?ref=\${info.referralCode}\` });
  };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Referral Program</Text><View /></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.codeCard}>
            <Text style={s.codeLabel}>Your Referral Code</Text>
            <Text style={s.code}>{info?.referralCode ?? '—'}</Text>
            <Text style={s.codeSub}>Share this code and earn rewards for every friend who joins</Text>
            <TouchableOpacity style={s.shareBtn} onPress={handleShare}><Text style={s.shareBtnText}>📤 Share Code</Text></TouchableOpacity>
          </View>
          <View style={s.statsRow}>
            {[{ label: 'Total Referrals', value: info?.totalReferrals ?? 0 }, { label: 'Total Earned', value: \`$\${(stats?.totalEarned ?? 0).toFixed(2)}\` }, { label: 'Pending', value: \`$\${(stats?.pendingEarnings ?? 0).toFixed(2)}\` }].map((stat) => (
              <View key={stat.label} style={s.statCard}><Text style={s.statValue}>{stat.value}</Text><Text style={s.statLabel}>{stat.label}</Text></View>
            ))}
          </View>
          {info?.leaderboard && info.leaderboard.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>🏆 Top Referrers</Text>
              {info.leaderboard.slice(0, 5).map((entry: any, i: number) => (
                <View key={i} style={s.leaderRow}>
                  <Text style={s.rank}>#{i + 1}</Text>
                  <Text style={s.leaderName}>{entry.name ?? 'Anonymous'}</Text>
                  <Text style={s.leaderCount}>{entry.referrals} referrals</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 16 },
  codeCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '${DARK.border}' },
  codeLabel: { color: '${DARK.muted}', fontSize: 13, marginBottom: 8 }, code: { color: '${DARK.primary}', fontSize: 32, fontWeight: '800', letterSpacing: 4, marginBottom: 8 },
  codeSub: { color: '${DARK.muted}', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  shareBtn: { backgroundColor: '${DARK.primary}', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }, shareBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 10 }, statCard: { flex: 1, backgroundColor: '${DARK.card}', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '${DARK.border}' },
  statValue: { color: '${DARK.primary}', fontSize: 20, fontWeight: '700' }, statLabel: { color: '${DARK.muted}', fontSize: 11, marginTop: 4, textAlign: 'center' },
  section: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' },
  sectionTitle: { color: '${DARK.text}', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  rank: { color: '${DARK.primary}', fontSize: 14, fontWeight: '700', width: 30 }, leaderName: { flex: 1, color: '${DARK.text}', fontSize: 14 }, leaderCount: { color: '${DARK.muted}', fontSize: 13 },
});
