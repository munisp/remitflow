/**
 * Script to create all missing React Native and Flutter screens for mobile parity.
 * Run: node scripts/create-mobile-screens.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log('✅ Created:', path);
}

const DARK = {
  bg: '#0f0f1a',
  card: '#1a1a2e',
  border: '#2d2d4e',
  primary: '#6366f1',
  text: '#e2e8f0',
  muted: '#9ca3af',
  dim: '#6b7280',
};

// ─── React Native Screens ────────────────────────────────────────────────────

write('mobile/react-native/src/screens/DisputesScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function DisputesScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ transactionId: '', reason: '', description: '' });
  const { data, isLoading, refetch } = trpc.disputes.list.useQuery();
  const createMutation = trpc.disputes.create.useMutation({
    onSuccess: () => { setShowCreate(false); refetch(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  const STATUS_COLOR: Record<string, string> = { open: '#f59e0b', resolved: '#10b981', closed: '#6b7280', pending: '#6366f1' };
  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>Disputes</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ Raise</Text></TouchableOpacity>
      </View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>⚖️</Text><Text style={s.emptyText}>No disputes</Text><Text style={s.emptySub}>Raise a dispute if you have an issue with a transaction</Text></View>}
          {data?.map((d: any) => (
            <View key={d.id} style={s.card}>
              <View style={s.row}><Text style={s.ref}>#{d.id} — {d.reason}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[d.status] ?? '#6b7280' }]}>{d.status}</Text></View>
              <Text style={s.desc}>{d.description}</Text>
              <Text style={s.date}>{new Date(d.createdAt).toLocaleDateString()}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>Raise a Dispute</Text>
          {(['transactionId', 'reason', 'description'] as const).map((f) => (
            <View key={f}>
              <Text style={s.label}>{f === 'transactionId' ? 'Transaction ID' : f === 'reason' ? 'Reason' : 'Description'}</Text>
              <TextInput style={s.input} value={form[f]} onChangeText={(v) => setForm((x) => ({ ...x, [f]: v }))} placeholder={f === 'transactionId' ? 'TXN-...' : f === 'reason' ? 'e.g. Unauthorized charge' : 'Describe the issue...'} placeholderTextColor="${DARK.dim}" multiline={f === 'description'} numberOfLines={f === 'description' ? 3 : 1} />
            </View>
          ))}
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ transactionId: form.transactionId, reason: form.reason, description: form.description })} disabled={createMutation.isPending}>
            {createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Submit Dispute</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancel} onPress={() => setShowCreate(false)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  ref: { color: '${DARK.text}', fontSize: 14, fontWeight: '600' }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  desc: { color: '${DARK.muted}', fontSize: 13, marginBottom: 4 }, date: { color: '${DARK.dim}', fontSize: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancel: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/ReferralScreen.tsx', `import React from 'react';
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
`);

write('mobile/react-native/src/screens/AirtimeScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const PROVIDERS = ['MTN', 'Airtel', 'Glo', '9mobile', 'Vodacom', 'Safaricom', 'Orange'];
const AMOUNTS = [5, 10, 20, 50, 100];

export default function AirtimeScreen() {
  const navigation = useNavigation();
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState('MTN');
  const [amount, setAmount] = useState('');
  const topupMutation = trpc.airtime.topup.useMutation({
    onSuccess: () => { Alert.alert('Success', 'Airtime sent successfully!'); setPhone(''); setAmount(''); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Airtime Top-Up</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>Phone Number</Text>
        <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="+234 800 000 0000" placeholderTextColor="${DARK.dim}" keyboardType="phone-pad" />
        <Text style={s.label}>Provider</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.providerRow}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity key={p} style={[s.providerBtn, provider === p && s.providerBtnActive]} onPress={() => setProvider(p)}>
              <Text style={[s.providerBtnText, provider === p && s.providerBtnTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={s.label}>Amount (USD)</Text>
        <View style={s.amountRow}>
          {AMOUNTS.map((a) => (
            <TouchableOpacity key={a} style={[s.amountBtn, amount === String(a) && s.amountBtnActive]} onPress={() => setAmount(String(a))}>
              <Text style={[s.amountBtnText, amount === String(a) && s.amountBtnTextActive]}>\${a}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={[s.input, { marginTop: 8 }]} value={amount} onChangeText={setAmount} placeholder="Custom amount" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
        <TouchableOpacity style={s.submitBtn} onPress={() => topupMutation.mutate({ phone, provider, amount: parseFloat(amount) || 0, currency: 'USD' })} disabled={topupMutation.isPending || !phone || !amount}>
          {topupMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Send Airtime</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 8 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.card}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  providerRow: { marginBottom: 4 }, providerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '${DARK.border}', marginRight: 8 },
  providerBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, providerBtnText: { color: '${DARK.muted}', fontSize: 13 }, providerBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  amountRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, amountBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '${DARK.border}' },
  amountBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, amountBtnText: { color: '${DARK.muted}', fontSize: 14 }, amountBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  submitBtn: { backgroundColor: '${DARK.primary}', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 }, submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
`);

write('mobile/react-native/src/screens/QRPayScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Clipboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function QRPayScreen() {
  const navigation = useNavigation();
  const [tab, setTab] = useState<'receive' | 'send'>('receive');
  const { data: qrInfo, isLoading } = trpc.qr.info.useQuery();
  const copyLink = () => {
    if (qrInfo?.paymentLink) { Clipboard.setString(qrInfo.paymentLink); Alert.alert('Copied', 'Payment link copied to clipboard'); }
  };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>QR Pay</Text><View /></View>
      <View style={s.tabs}>
        {(['receive', 'send'] as const).map((t) => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{t === 'receive' ? '📥 Receive' : '📤 Send'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          {tab === 'receive' ? (
            <View style={s.qrCard}>
              <Text style={s.qrPlaceholder}>[ QR Code ]</Text>
              <Text style={s.qrId}>User ID: {qrInfo?.userId ?? '—'}</Text>
              <Text style={s.qrData}>{qrInfo?.qrData ?? '—'}</Text>
              <TouchableOpacity style={s.copyBtn} onPress={copyLink}><Text style={s.copyBtnText}>📋 Copy Payment Link</Text></TouchableOpacity>
              <Text style={s.link}>{qrInfo?.paymentLink ?? '—'}</Text>
            </View>
          ) : (
            <View style={s.sendCard}>
              <Text style={s.sendIcon}>📷</Text>
              <Text style={s.sendTitle}>Scan QR Code</Text>
              <Text style={s.sendSub}>Point your camera at a RemitFlow QR code to pay instantly</Text>
              <TouchableOpacity style={s.scanBtn} onPress={() => Alert.alert('Camera', 'QR scanner requires camera permission on a real device')}><Text style={s.scanBtnText}>Open Camera</Text></TouchableOpacity>
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
  tabs: { flexDirection: 'row', margin: 16, backgroundColor: '${DARK.card}', borderRadius: 12, padding: 4 },
  tab: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' }, tabActive: { backgroundColor: '${DARK.primary}' },
  tabText: { color: '${DARK.muted}', fontSize: 14, fontWeight: '500' }, tabTextActive: { color: '#fff', fontWeight: '600' },
  content: { padding: 16 },
  qrCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '${DARK.border}' },
  qrPlaceholder: { width: 180, height: 180, backgroundColor: '#fff', borderRadius: 12, textAlign: 'center', lineHeight: 180, fontSize: 14, color: '#000', marginBottom: 16 },
  qrId: { color: '${DARK.muted}', fontSize: 13, marginBottom: 4 }, qrData: { color: '${DARK.dim}', fontSize: 11, marginBottom: 16, textAlign: 'center' },
  copyBtn: { backgroundColor: '${DARK.primary}', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginBottom: 12 }, copyBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  link: { color: '${DARK.muted}', fontSize: 12, textAlign: 'center' },
  sendCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: '${DARK.border}' },
  sendIcon: { fontSize: 64, marginBottom: 16 }, sendTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 8 }, sendSub: { color: '${DARK.muted}', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  scanBtn: { backgroundColor: '${DARK.primary}', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 }, scanBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
`);

write('mobile/react-native/src/screens/VirtualAccountScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Clipboard, Modal, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function VirtualAccountScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const { data, isLoading, refetch } = trpc.virtualAccounts.list.useQuery();
  const createMutation = trpc.virtualAccounts.create.useMutation({ onSuccess: () => { setShowCreate(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const copy = (text: string, label: string) => { Clipboard.setString(text); Alert.alert('Copied', \`\${label} copied to clipboard\`); };
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS'];
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Virtual Accounts</Text><TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ New</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🏦</Text><Text style={s.emptyText}>No virtual accounts</Text><Text style={s.emptySub}>Create a virtual account to receive payments</Text></View>}
          {data?.map((acc: any) => (
            <View key={acc.id} style={s.card}>
              <View style={s.cardHeader}><Text style={s.currency}>{acc.currency}</Text><Text style={[s.status, { color: acc.status === 'active' ? '#10b981' : '#6b7280' }]}>{acc.status}</Text></View>
              {[['Account Number', acc.accountNumber], ['Bank Name', acc.bankName], ['IBAN', acc.iban], ['SWIFT', acc.swiftCode]].filter(([, v]) => v).map(([label, value]) => (
                <TouchableOpacity key={label as string} style={s.field} onPress={() => copy(value as string, label as string)}>
                  <Text style={s.fieldLabel}>{label as string}</Text><Text style={s.fieldValue}>{value as string}</Text><Text style={s.copyIcon}>📋</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>New Virtual Account</Text>
          <Text style={s.label}>Currency</Text>
          <View style={s.currencyRow}>{CURRENCIES.map((c) => (<TouchableOpacity key={c} style={[s.currBtn, currency === c && s.currBtnActive]} onPress={() => setCurrency(c)}><Text style={[s.currBtnText, currency === c && s.currBtnTextActive]}>{c}</Text></TouchableOpacity>))}</View>
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ currency })} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Create Account</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancel} onPress={() => setShowCreate(false)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 16 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  currency: { color: '${DARK.text}', fontSize: 18, fontWeight: '700' }, status: { fontSize: 13, fontWeight: '500' },
  field: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  fieldLabel: { color: '${DARK.muted}', fontSize: 12, width: 110 }, fieldValue: { flex: 1, color: '${DARK.text}', fontSize: 13, fontFamily: 'monospace' }, copyIcon: { fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 8 },
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }, currBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '${DARK.border}' },
  currBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, currBtnText: { color: '${DARK.muted}', fontSize: 13 }, currBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancel: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/SupportScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function SupportScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ subject: '', message: '', category: 'general' });
  const { data, isLoading, refetch } = trpc.support.tickets.useQuery();
  const createMutation = trpc.support.createTicket.useMutation({ onSuccess: () => { setShowCreate(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const closeMutation = trpc.support.closeTicket.useMutation({ onSuccess: refetch, onError: (e) => Alert.alert('Error', e.message) });
  const STATUS_COLOR: Record<string, string> = { open: '#f59e0b', resolved: '#10b981', closed: '#6b7280', pending: '#6366f1' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Support</Text><TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ Ticket</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🎧</Text><Text style={s.emptyText}>No support tickets</Text><Text style={s.emptySub}>Create a ticket if you need help</Text></View>}
          {data?.map((t: any) => (
            <View key={t.id} style={s.card}>
              <View style={s.row}><Text style={s.subject}>{t.subject}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[t.status] ?? '#6b7280' }]}>{t.status}</Text></View>
              <Text style={s.message}>{t.message}</Text>
              <View style={s.cardFooter}><Text style={s.date}>{new Date(t.createdAt).toLocaleDateString()}</Text>{t.status === 'open' && <TouchableOpacity onPress={() => closeMutation.mutate({ id: t.id })}><Text style={s.closeBtn}>Close</Text></TouchableOpacity>}</View>
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>New Support Ticket</Text>
          <Text style={s.label}>Subject</Text>
          <TextInput style={s.input} value={form.subject} onChangeText={(v) => setForm((f) => ({ ...f, subject: v }))} placeholder="What do you need help with?" placeholderTextColor="${DARK.dim}" />
          <Text style={s.label}>Message</Text>
          <TextInput style={[s.input, { height: 80 }]} value={form.message} onChangeText={(v) => setForm((f) => ({ ...f, message: v }))} placeholder="Describe your issue in detail..." placeholderTextColor="${DARK.dim}" multiline />
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ subject: form.subject, message: form.message, category: form.category })} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Submit Ticket</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancel} onPress={() => setShowCreate(false)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  subject: { color: '${DARK.text}', fontSize: 14, fontWeight: '600', flex: 1 }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  message: { color: '${DARK.muted}', fontSize: 13, marginBottom: 8 }, cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { color: '${DARK.dim}', fontSize: 12 }, closeBtn: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancel: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/SettingsScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [editMode, setEditMode] = useState(false);
  const { data: profile, isLoading, refetch } = trpc.profile.get.useQuery();
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const updateMutation = trpc.profile.update.useMutation({ onSuccess: () => { setEditMode(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const { data: security } = trpc.security.settings.useQuery();
  React.useEffect(() => { if (profile) setForm({ name: profile.name ?? '', phone: profile.phone ?? '', email: profile.email ?? '' }); }, [profile]);
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Settings</Text><TouchableOpacity onPress={() => setEditMode(!editMode)}><Text style={s.editBtn}>{editMode ? 'Cancel' : 'Edit'}</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.sectionTitle}>Profile</Text>
          <View style={s.card}>
            {(['name', 'phone', 'email'] as const).map((f) => (
              <View key={f} style={s.field}>
                <Text style={s.fieldLabel}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
                {editMode ? <TextInput style={s.input} value={form[f]} onChangeText={(v) => setForm((x) => ({ ...x, [f]: v }))} placeholderTextColor="${DARK.dim}" keyboardType={f === 'email' ? 'email-address' : f === 'phone' ? 'phone-pad' : 'default'} /> : <Text style={s.fieldValue}>{(profile as any)?.[f] ?? '—'}</Text>}
              </View>
            ))}
            {editMode && <TouchableOpacity style={s.saveBtn} onPress={() => updateMutation.mutate(form)} disabled={updateMutation.isPending}>{updateMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Changes</Text>}</TouchableOpacity>}
          </View>
          <Text style={s.sectionTitle}>Security</Text>
          <View style={s.card}>
            <View style={s.secRow}><Text style={s.secLabel}>Two-Factor Authentication</Text><Text style={[s.secStatus, { color: security?.twoFactorEnabled ? '#10b981' : '#ef4444' }]}>{security?.twoFactorEnabled ? 'Enabled' : 'Disabled'}</Text></View>
            <View style={s.secRow}><Text style={s.secLabel}>Biometric Login</Text><Text style={[s.secStatus, { color: security?.biometricEnabled ? '#10b981' : '#6b7280' }]}>{security?.biometricEnabled ? 'Enabled' : 'Disabled'}</Text></View>
            <TouchableOpacity style={s.secBtn} onPress={() => Alert.alert('Security', 'Manage security settings in the web portal for full control')}><Text style={s.secBtnText}>Manage Security →</Text></TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, editBtn: { color: '${DARK.primary}', fontSize: 16 },
  content: { padding: 16, gap: 8 }, sectionTitle: { color: '${DARK.muted}', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' },
  field: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' }, fieldLabel: { color: '${DARK.muted}', fontSize: 12, marginBottom: 4 }, fieldValue: { color: '${DARK.text}', fontSize: 15 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 8, padding: 10, color: '${DARK.text}', fontSize: 15 },
  saveBtn: { backgroundColor: '${DARK.primary}', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 }, saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  secLabel: { color: '${DARK.text}', fontSize: 14 }, secStatus: { fontSize: 13, fontWeight: '600' },
  secBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 }, secBtnText: { color: '${DARK.primary}', fontSize: 14, fontWeight: '600' },
});
`);

write('mobile/react-native/src/screens/RecurringPaymentsScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function RecurringPaymentsScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ recipientEmail: '', amount: '', currency: 'USD', frequency: 'monthly', description: '' });
  const { data, isLoading, refetch } = trpc.recurringPayments.list.useQuery();
  const createMutation = trpc.recurringPayments.create.useMutation({ onSuccess: () => { setShowCreate(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const cancelMutation = trpc.recurringPayments.cancel.useMutation({ onSuccess: refetch, onError: (e) => Alert.alert('Error', e.message) });
  const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'];
  const STATUS_COLOR: Record<string, string> = { active: '#10b981', paused: '#f59e0b', cancelled: '#6b7280' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Recurring Payments</Text><TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ New</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🔄</Text><Text style={s.emptyText}>No recurring payments</Text><Text style={s.emptySub}>Set up automatic payments to family or bills</Text></View>}
          {data?.map((p: any) => (
            <View key={p.id} style={s.card}>
              <View style={s.row}><Text style={s.recipient}>{p.recipientEmail}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[p.status] ?? '#6b7280' }]}>{p.status}</Text></View>
              <Text style={s.amount}>{p.currency} {Number(p.amount).toLocaleString()} / {p.frequency}</Text>
              {p.description && <Text style={s.desc}>{p.description}</Text>}
              <Text style={s.next}>Next: {p.nextExecutionAt ? new Date(p.nextExecutionAt).toLocaleDateString() : '—'}</Text>
              {p.status === 'active' && <TouchableOpacity style={s.cancelBtn} onPress={() => Alert.alert('Cancel', 'Cancel this recurring payment?', [{ text: 'No', style: 'cancel' }, { text: 'Yes', style: 'destructive', onPress: () => cancelMutation.mutate({ id: p.id }) }])}><Text style={s.cancelBtnText}>Cancel Payment</Text></TouchableOpacity>}
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>New Recurring Payment</Text>
          {(['recipientEmail', 'amount', 'description'] as const).map((f) => (
            <View key={f}><Text style={s.label}>{f === 'recipientEmail' ? 'Recipient Email' : f === 'amount' ? 'Amount (USD)' : 'Description (optional)'}</Text>
            <TextInput style={s.input} value={form[f]} onChangeText={(v) => setForm((x) => ({ ...x, [f]: v }))} placeholder={f === 'recipientEmail' ? 'recipient@email.com' : f === 'amount' ? '100' : 'e.g. Monthly rent'} placeholderTextColor="${DARK.dim}" keyboardType={f === 'amount' ? 'numeric' : 'default'} /></View>
          ))}
          <Text style={s.label}>Frequency</Text>
          <View style={s.freqRow}>{FREQUENCIES.map((f) => (<TouchableOpacity key={f} style={[s.freqBtn, form.frequency === f && s.freqBtnActive]} onPress={() => setForm((x) => ({ ...x, frequency: f }))}><Text style={[s.freqBtnText, form.frequency === f && s.freqBtnTextActive]}>{f}</Text></TouchableOpacity>))}</View>
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ recipientEmail: form.recipientEmail, amount: parseFloat(form.amount) || 0, currency: 'USD', frequency: form.frequency as any, description: form.description })} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Create</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowCreate(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 18, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  recipient: { color: '${DARK.text}', fontSize: 14, fontWeight: '600', flex: 1 }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  amount: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600', marginBottom: 4 }, desc: { color: '${DARK.muted}', fontSize: 13, marginBottom: 4 }, next: { color: '${DARK.dim}', fontSize: 12, marginBottom: 8 },
  cancelBtn: { backgroundColor: '#3b1a1a', padding: 8, borderRadius: 8, alignItems: 'center' }, cancelBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  freqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, freqBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '${DARK.border}' },
  freqBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, freqBtnText: { color: '${DARK.muted}', fontSize: 13 }, freqBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/SplitBillScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function SplitBillScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', totalAmount: '', currency: 'USD', participantEmails: '' });
  const { data, isLoading, refetch } = trpc.splitBill.list.useQuery();
  const createMutation = trpc.splitBill.create.useMutation({ onSuccess: () => { setShowCreate(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const cancelMutation = trpc.splitBill.cancel.useMutation({ onSuccess: refetch, onError: (e) => Alert.alert('Error', e.message) });
  const STATUS_COLOR: Record<string, string> = { active: '#10b981', completed: '#6366f1', cancelled: '#6b7280' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Split Bill</Text><TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ Split</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🍽️</Text><Text style={s.emptyText}>No split bills</Text><Text style={s.emptySub}>Split a bill with friends or family</Text></View>}
          {data?.map((bill: any) => (
            <View key={bill.id} style={s.card}>
              <View style={s.row}><Text style={s.billTitle}>{bill.title}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[bill.status] ?? '#6b7280' }]}>{bill.status}</Text></View>
              <Text style={s.amount}>{bill.currency} {Number(bill.totalAmount).toLocaleString()}</Text>
              <Text style={s.participants}>{bill.participantCount ?? 0} participants · {bill.paidCount ?? 0} paid</Text>
              {bill.status === 'active' && <TouchableOpacity style={s.cancelBtn} onPress={() => cancelMutation.mutate({ id: bill.id })}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>}
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>Split a Bill</Text>
          <Text style={s.label}>Bill Title</Text><TextInput style={s.input} value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} placeholder="e.g. Dinner at Nando's" placeholderTextColor="${DARK.dim}" />
          <Text style={s.label}>Total Amount (USD)</Text><TextInput style={s.input} value={form.totalAmount} onChangeText={(v) => setForm((f) => ({ ...f, totalAmount: v }))} placeholder="150" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
          <Text style={s.label}>Participant Emails (comma-separated)</Text><TextInput style={[s.input, { height: 60 }]} value={form.participantEmails} onChangeText={(v) => setForm((f) => ({ ...f, participantEmails: v }))} placeholder="alice@email.com, bob@email.com" placeholderTextColor="${DARK.dim}" multiline />
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ title: form.title, totalAmount: parseFloat(form.totalAmount) || 0, currency: 'USD', participantEmails: form.participantEmails.split(',').map((e) => e.trim()).filter(Boolean) })} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Create Split</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowCreate(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  billTitle: { color: '${DARK.text}', fontSize: 15, fontWeight: '600', flex: 1 }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  amount: { color: '${DARK.primary}', fontSize: 18, fontWeight: '700', marginBottom: 4 }, participants: { color: '${DARK.muted}', fontSize: 13, marginBottom: 8 },
  cancelBtn: { backgroundColor: '#3b1a1a', padding: 8, borderRadius: 8, alignItems: 'center' }, cancelBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/RateLockScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function RateLockScreen() {
  const navigation = useNavigation();
  const [showLock, setShowLock] = useState(false);
  const [form, setForm] = useState({ fromCurrency: 'USD', toCurrency: 'NGN', amount: '', durationHours: '24' });
  const { data: locks, isLoading, refetch } = trpc.fx.locks.useQuery();
  const lockMutation = trpc.fx.lockRate.useMutation({ onSuccess: () => { setShowLock(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const STATUS_COLOR: Record<string, string> = { active: '#10b981', expired: '#6b7280', used: '#6366f1' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Rate Lock</Text><TouchableOpacity onPress={() => setShowLock(true)}><Text style={s.addBtn}>+ Lock</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!locks || locks.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🔒</Text><Text style={s.emptyText}>No rate locks</Text><Text style={s.emptySub}>Lock today's FX rate for up to 72 hours</Text></View>}
          {locks?.map((lock: any) => (
            <View key={lock.id} style={s.card}>
              <View style={s.row}><Text style={s.pair}>{lock.fromCurrency} → {lock.toCurrency}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[lock.status] ?? '#6b7280' }]}>{lock.status}</Text></View>
              <Text style={s.rate}>Locked Rate: {Number(lock.lockedRate).toFixed(4)}</Text>
              <Text style={s.amount}>Amount: {lock.fromCurrency} {Number(lock.amount).toLocaleString()}</Text>
              <Text style={s.expiry}>Expires: {lock.expiresAt ? new Date(lock.expiresAt).toLocaleString() : '—'}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showLock} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>Lock FX Rate</Text>
          <Text style={s.label}>From Currency</Text><TextInput style={s.input} value={form.fromCurrency} onChangeText={(v) => setForm((f) => ({ ...f, fromCurrency: v.toUpperCase() }))} placeholder="USD" placeholderTextColor="${DARK.dim}" autoCapitalize="characters" />
          <Text style={s.label}>To Currency</Text><TextInput style={s.input} value={form.toCurrency} onChangeText={(v) => setForm((f) => ({ ...f, toCurrency: v.toUpperCase() }))} placeholder="NGN" placeholderTextColor="${DARK.dim}" autoCapitalize="characters" />
          <Text style={s.label}>Amount</Text><TextInput style={s.input} value={form.amount} onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="500" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
          <Text style={s.label}>Duration (hours)</Text>
          <View style={s.durationRow}>{['1', '6', '24', '48', '72'].map((h) => (<TouchableOpacity key={h} style={[s.durBtn, form.durationHours === h && s.durBtnActive]} onPress={() => setForm((f) => ({ ...f, durationHours: h }))}><Text style={[s.durBtnText, form.durationHours === h && s.durBtnTextActive]}>{h}h</Text></TouchableOpacity>))}</View>
          <TouchableOpacity style={s.submit} onPress={() => lockMutation.mutate({ fromCurrency: form.fromCurrency, toCurrency: form.toCurrency, amount: parseFloat(form.amount) || 0, durationHours: parseInt(form.durationHours) || 24 })} disabled={lockMutation.isPending}>{lockMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Lock Rate</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowLock(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  pair: { color: '${DARK.text}', fontSize: 15, fontWeight: '600' }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  rate: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600', marginBottom: 4 }, amount: { color: '${DARK.muted}', fontSize: 13, marginBottom: 4 }, expiry: { color: '${DARK.dim}', fontSize: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  durationRow: { flexDirection: 'row', gap: 8 }, durBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '${DARK.border}', alignItems: 'center' },
  durBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, durBtnText: { color: '${DARK.muted}', fontSize: 13 }, durBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/RateCalculatorScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'CNY', 'INR', 'BRL', 'CAD', 'AUD'];

export default function RateCalculatorScreen() {
  const navigation = useNavigation();
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('NGN');
  const [amount, setAmount] = useState('100');
  const { data: calcResult, isLoading } = trpc.fx.calculate.useQuery({ from, to, amount: parseFloat(amount) || 0 }, { enabled: !!amount && parseFloat(amount) > 0 });
  const { data: rates } = trpc.fx.rates.useQuery({ baseCurrency: from });
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Rate Calculator</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <Text style={s.label}>You Send</Text>
          <View style={s.inputRow}>
            <TextInput style={s.amountInput} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholderTextColor="${DARK.dim}" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.currScroll}>
              {CURRENCIES.map((c) => (<TouchableOpacity key={c} style={[s.currBtn, from === c && s.currBtnActive]} onPress={() => setFrom(c)}><Text style={[s.currBtnText, from === c && s.currBtnTextActive]}>{c}</Text></TouchableOpacity>))}
            </ScrollView>
          </View>
          <View style={s.divider}><Text style={s.dividerText}>⇅</Text></View>
          <Text style={s.label}>Recipient Gets</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.currScroll}>
            {CURRENCIES.map((c) => (<TouchableOpacity key={c} style={[s.currBtn, to === c && s.currBtnActive]} onPress={() => setTo(c)}><Text style={[s.currBtnText, to === c && s.currBtnTextActive]}>{c}</Text></TouchableOpacity>))}
          </ScrollView>
          {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 20 }} /> : calcResult ? (
            <View style={s.result}>
              <Text style={s.resultAmount}>{to} {Number(calcResult.convertedAmount ?? calcResult.result ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              <Text style={s.resultRate}>1 {from} = {Number(calcResult.rate ?? (rates?.rates?.[to] ?? 0)).toFixed(4)} {to}</Text>
              <Text style={s.resultFee}>Fee: {from} {Number(calcResult.fee ?? 0).toFixed(2)}</Text>
            </View>
          ) : null}
        </View>
        {rates?.rates && (
          <View style={s.ratesCard}>
            <Text style={s.ratesTitle}>Live Rates (base: {from})</Text>
            {Object.entries(rates.rates).slice(0, 10).map(([currency, rate]) => (
              <View key={currency} style={s.rateRow}><Text style={s.rateCurrency}>{currency}</Text><Text style={s.rateValue}>{Number(rate).toFixed(4)}</Text></View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6 },
  card: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '${DARK.border}' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  amountInput: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 20, fontWeight: '700', width: 120 },
  currScroll: { flex: 1 }, currBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '${DARK.border}', marginRight: 6 },
  currBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, currBtnText: { color: '${DARK.muted}', fontSize: 13 }, currBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  divider: { alignItems: 'center', paddingVertical: 12 }, dividerText: { color: '${DARK.primary}', fontSize: 24 },
  result: { marginTop: 16, padding: 16, backgroundColor: '${DARK.bg}', borderRadius: 12, alignItems: 'center' },
  resultAmount: { color: '${DARK.primary}', fontSize: 28, fontWeight: '800', marginBottom: 4 }, resultRate: { color: '${DARK.muted}', fontSize: 14, marginBottom: 4 }, resultFee: { color: '${DARK.dim}', fontSize: 13 },
  ratesCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, ratesTitle: { color: '${DARK.text}', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' }, rateCurrency: { color: '${DARK.text}', fontSize: 14 }, rateValue: { color: '${DARK.primary}', fontSize: 14, fontWeight: '600' },
});
`);

write('mobile/react-native/src/screens/DirectDebitScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function DirectDebitScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ bankName: '', accountNumber: '', sortCode: '', amount: '', reference: '' });
  const { data, isLoading, refetch } = trpc.directDebit.mandates.useQuery();
  const createMutation = trpc.directDebit.create.useMutation({ onSuccess: () => { setShowCreate(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const cancelMutation = trpc.directDebit.cancel.useMutation({ onSuccess: refetch, onError: (e) => Alert.alert('Error', e.message) });
  const STATUS_COLOR: Record<string, string> = { active: '#10b981', cancelled: '#6b7280', pending: '#f59e0b' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Direct Debit</Text><TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ New</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🏦</Text><Text style={s.emptyText}>No direct debits</Text><Text style={s.emptySub}>Set up a direct debit mandate</Text></View>}
          {data?.map((m: any) => (
            <View key={m.id} style={s.card}>
              <View style={s.row}><Text style={s.bankName}>{m.bankName}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[m.status] ?? '#6b7280' }]}>{m.status}</Text></View>
              <Text style={s.account}>Account: ****{m.accountNumber?.slice(-4)}</Text>
              <Text style={s.amount}>Amount: {m.currency ?? 'GBP'} {Number(m.amount).toLocaleString()}</Text>
              {m.status === 'active' && <TouchableOpacity style={s.cancelBtn} onPress={() => Alert.alert('Cancel', 'Cancel this direct debit?', [{ text: 'No', style: 'cancel' }, { text: 'Yes', style: 'destructive', onPress: () => cancelMutation.mutate({ id: m.id }) }])}><Text style={s.cancelBtnText}>Cancel Mandate</Text></TouchableOpacity>}
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>New Direct Debit</Text>
          {(['bankName', 'accountNumber', 'sortCode', 'amount', 'reference'] as const).map((f) => (
            <View key={f}><Text style={s.label}>{f === 'bankName' ? 'Bank Name' : f === 'accountNumber' ? 'Account Number' : f === 'sortCode' ? 'Sort Code' : f === 'amount' ? 'Amount' : 'Reference'}</Text>
            <TextInput style={s.input} value={form[f]} onChangeText={(v) => setForm((x) => ({ ...x, [f]: v }))} placeholder={f === 'bankName' ? 'Barclays' : f === 'accountNumber' ? '12345678' : f === 'sortCode' ? '20-00-00' : f === 'amount' ? '50' : 'Monthly subscription'} placeholderTextColor="${DARK.dim}" keyboardType={f === 'amount' ? 'numeric' : 'default'} /></View>
          ))}
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ bankName: form.bankName, accountNumber: form.accountNumber, sortCode: form.sortCode, amount: parseFloat(form.amount) || 0, reference: form.reference })} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Create Mandate</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowCreate(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  bankName: { color: '${DARK.text}', fontSize: 15, fontWeight: '600' }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  account: { color: '${DARK.muted}', fontSize: 13, marginBottom: 4 }, amount: { color: '${DARK.primary}', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  cancelBtn: { backgroundColor: '#3b1a1a', padding: 8, borderRadius: 8, alignItems: 'center' }, cancelBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/BillPaymentScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const CATEGORIES = [
  { id: 'electricity', label: '⚡ Electricity', icon: '⚡' },
  { id: 'water', label: '💧 Water', icon: '💧' },
  { id: 'internet', label: '🌐 Internet', icon: '🌐' },
  { id: 'tv', label: '📺 TV / DSTV', icon: '📺' },
  { id: 'phone', label: '📱 Phone', icon: '📱' },
  { id: 'school', label: '🎓 School Fees', icon: '🎓' },
];

export default function BillPaymentScreen() {
  const navigation = useNavigation();
  const [category, setCategory] = useState('electricity');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const { data: bills } = trpc.bills.list.useQuery();
  const payMutation = trpc.bills.pay.useMutation({
    onSuccess: () => { Alert.alert('Success', 'Bill paid successfully!'); setAccountNumber(''); setAmount(''); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Bill Payment</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.sectionTitle}>Select Category</Text>
        <View style={s.categoryGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity key={cat.id} style={[s.catBtn, category === cat.id && s.catBtnActive]} onPress={() => setCategory(cat.id)}>
              <Text style={s.catIcon}>{cat.icon}</Text>
              <Text style={[s.catLabel, category === cat.id && s.catLabelActive]}>{cat.label.replace(cat.icon + ' ', '')}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>Account / Meter Number</Text>
        <TextInput style={s.input} value={accountNumber} onChangeText={setAccountNumber} placeholder="Enter account number" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
        <Text style={s.label}>Amount (USD)</Text>
        <TextInput style={s.input} value={amount} onChangeText={setAmount} placeholder="50" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
        <TouchableOpacity style={s.payBtn} onPress={() => payMutation.mutate({ category, accountNumber, amount: parseFloat(amount) || 0, currency: 'USD' })} disabled={payMutation.isPending || !accountNumber || !amount}>
          {payMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.payBtnText}>Pay Bill</Text>}
        </TouchableOpacity>
        {bills && bills.length > 0 && (
          <View style={s.historyCard}>
            <Text style={s.historyTitle}>Recent Payments</Text>
            {bills.slice(0, 5).map((b: any) => (
              <View key={b.id} style={s.historyRow}>
                <Text style={s.historyLabel}>{b.category} — {b.accountNumber}</Text>
                <Text style={s.historyAmount}>{b.currency} {Number(b.amount).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 8 }, sectionTitle: { color: '${DARK.text}', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }, catBtn: { width: '30%', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '${DARK.border}', alignItems: 'center', backgroundColor: '${DARK.card}' },
  catBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, catIcon: { fontSize: 24, marginBottom: 4 }, catLabel: { color: '${DARK.muted}', fontSize: 11, textAlign: 'center' }, catLabelActive: { color: '${DARK.primary}', fontWeight: '600' },
  label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 }, input: { backgroundColor: '${DARK.card}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  payBtn: { backgroundColor: '${DARK.primary}', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 }, payBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  historyCard: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}', marginTop: 16 }, historyTitle: { color: '${DARK.text}', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' }, historyLabel: { color: '${DARK.muted}', fontSize: 13 }, historyAmount: { color: '${DARK.primary}', fontSize: 13, fontWeight: '600' },
});
`);

write('mobile/react-native/src/screens/BatchPaymentsScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function BatchPaymentsScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const { data, isLoading, refetch } = trpc.batchPayments.list.useQuery();
  const createMutation = trpc.batchPayments.create.useMutation({ onSuccess: () => { setShowCreate(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const cancelMutation = trpc.batchPayments.cancel.useMutation({ onSuccess: refetch, onError: (e) => Alert.alert('Error', e.message) });
  const STATUS_COLOR: Record<string, string> = { pending: '#f59e0b', processing: '#6366f1', completed: '#10b981', failed: '#ef4444', cancelled: '#6b7280' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Batch Payments</Text><TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ New</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>📦</Text><Text style={s.emptyText}>No batch payments</Text><Text style={s.emptySub}>Create a batch to send multiple payments at once</Text></View>}
          {data?.map((b: any) => (
            <View key={b.id} style={s.card}>
              <View style={s.row}><Text style={s.batchName}>{b.name ?? \`Batch #\${b.id}\`}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[b.status] ?? '#6b7280' }]}>{b.status}</Text></View>
              <Text style={s.count}>{b.totalPayments ?? 0} payments · {b.currency ?? 'USD'} {Number(b.totalAmount ?? 0).toLocaleString()}</Text>
              <Text style={s.date}>{new Date(b.createdAt).toLocaleDateString()}</Text>
              {b.status === 'pending' && <TouchableOpacity style={s.cancelBtn} onPress={() => cancelMutation.mutate({ id: b.id })}><Text style={s.cancelBtnText}>Cancel Batch</Text></TouchableOpacity>}
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>New Batch Payment</Text>
          <Text style={s.label}>Batch Name</Text><TextInput style={s.input} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. November Payroll" placeholderTextColor="${DARK.dim}" />
          <Text style={s.label}>Description (optional)</Text><TextInput style={s.input} value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Monthly salary payments" placeholderTextColor="${DARK.dim}" />
          <View style={s.note}><Text style={s.noteText}>💡 Upload a CSV file via the web portal to add recipients to this batch</Text></View>
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ name: form.name, description: form.description, payments: [] })} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Create Batch</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowCreate(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  batchName: { color: '${DARK.text}', fontSize: 15, fontWeight: '600', flex: 1 }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  count: { color: '${DARK.muted}', fontSize: 13, marginBottom: 4 }, date: { color: '${DARK.dim}', fontSize: 12, marginBottom: 8 },
  cancelBtn: { backgroundColor: '#3b1a1a', padding: 8, borderRadius: 8, alignItems: 'center' }, cancelBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  note: { backgroundColor: '#1e1b4b', borderRadius: 8, padding: 12, marginTop: 12 }, noteText: { color: '#a5b4fc', fontSize: 13 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/CBDCScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function CBDCScreen() {
  const navigation = useNavigation();
  const [showTransfer, setShowTransfer] = useState(false);
  const [form, setForm] = useState({ fromWalletId: '', toAddress: '', amount: '' });
  const { data: wallets, isLoading, refetch } = trpc.cbdc.wallets.useQuery();
  const transferMutation = trpc.cbdc.transfer.useMutation({ onSuccess: () => { setShowTransfer(false); refetch(); Alert.alert('Success', 'CBDC transfer initiated'); }, onError: (e) => Alert.alert('Error', e.message) });
  const CBDC_COLORS: Record<string, string> = { eNaira: '#10b981', eCedi: '#f59e0b', eKwanza: '#6366f1', eShekel: '#3b82f6' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>CBDC Wallet</Text><View /></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          {(!wallets || wallets.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🏛️</Text><Text style={s.emptyText}>No CBDC wallets</Text><Text style={s.emptySub}>Central Bank Digital Currency wallets will appear here</Text></View>}
          {wallets?.map((w: any) => (
            <View key={w.id} style={[s.walletCard, { borderLeftColor: CBDC_COLORS[w.currency] ?? '${DARK.primary}' }]}>
              <Text style={s.walletCurrency}>{w.currency}</Text>
              <Text style={s.walletBalance}>{Number(w.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              <Text style={s.walletAddress}>{w.walletAddress ? w.walletAddress.slice(0, 20) + '...' : '—'}</Text>
              <TouchableOpacity style={s.transferBtn} onPress={() => { setForm((f) => ({ ...f, fromWalletId: String(w.id) })); setShowTransfer(true); }}><Text style={s.transferBtnText}>Transfer</Text></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showTransfer} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>CBDC Transfer</Text>
          <Text style={s.label}>Recipient Address</Text><TextInput style={s.input} value={form.toAddress} onChangeText={(v) => setForm((f) => ({ ...f, toAddress: v }))} placeholder="0x..." placeholderTextColor="${DARK.dim}" />
          <Text style={s.label}>Amount</Text><TextInput style={s.input} value={form.amount} onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="100" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
          <TouchableOpacity style={s.submit} onPress={() => transferMutation.mutate({ fromWalletId: parseInt(form.fromWalletId), toAddress: form.toAddress, amount: parseFloat(form.amount) || 0 })} disabled={transferMutation.isPending}>{transferMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Send</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowTransfer(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 16 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  walletCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '${DARK.border}', borderLeftWidth: 4 },
  walletCurrency: { color: '${DARK.muted}', fontSize: 13, marginBottom: 4 }, walletBalance: { color: '${DARK.text}', fontSize: 28, fontWeight: '800', marginBottom: 4 }, walletAddress: { color: '${DARK.dim}', fontSize: 11, marginBottom: 12, fontFamily: 'monospace' },
  transferBtn: { backgroundColor: '${DARK.primary}', padding: 10, borderRadius: 8, alignItems: 'center' }, transferBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/StablecoinScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function StablecoinScreen() {
  const navigation = useNavigation();
  const [showSwap, setShowSwap] = useState(false);
  const [form, setForm] = useState({ fromSymbol: 'USDT', toSymbol: 'USDC', amount: '' });
  const { data: balances, isLoading, refetch } = trpc.stablecoin.balances.useQuery();
  const swapMutation = trpc.stablecoin.swap.useMutation({ onSuccess: () => { setShowSwap(false); refetch(); Alert.alert('Success', 'Swap completed'); }, onError: (e) => Alert.alert('Error', e.message) });
  const COIN_COLORS: Record<string, string> = { USDT: '#26a17b', USDC: '#2775ca', cUSD: '#35d07f', DAI: '#f5ac37' };
  const SYMBOLS = ['USDT', 'USDC', 'cUSD', 'DAI'];
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Stablecoin Wallet</Text><TouchableOpacity onPress={() => setShowSwap(true)}><Text style={s.addBtn}>⇄ Swap</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          {(!balances || balances.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🪙</Text><Text style={s.emptyText}>No stablecoin wallets</Text><Text style={s.emptySub}>Your USDT, USDC, and cUSD balances will appear here</Text></View>}
          {balances?.map((b: any) => (
            <View key={b.symbol} style={[s.coinCard, { borderLeftColor: COIN_COLORS[b.symbol] ?? '${DARK.primary}' }]}>
              <View style={s.coinHeader}><Text style={s.coinSymbol}>{b.symbol}</Text><Text style={s.coinName}>{b.name ?? b.symbol}</Text></View>
              <Text style={s.coinBalance}>{Number(b.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text>
              <Text style={s.coinUSD}>≈ USD {Number(b.usdValue ?? b.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showSwap} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>Swap Stablecoins</Text>
          <Text style={s.label}>From</Text>
          <View style={s.symbolRow}>{SYMBOLS.map((sym) => (<TouchableOpacity key={sym} style={[s.symBtn, form.fromSymbol === sym && s.symBtnActive]} onPress={() => setForm((f) => ({ ...f, fromSymbol: sym }))}><Text style={[s.symBtnText, form.fromSymbol === sym && s.symBtnTextActive]}>{sym}</Text></TouchableOpacity>))}</View>
          <Text style={s.label}>To</Text>
          <View style={s.symbolRow}>{SYMBOLS.filter((s) => s !== form.fromSymbol).map((sym) => (<TouchableOpacity key={sym} style={[s.symBtn, form.toSymbol === sym && s.symBtnActive]} onPress={() => setForm((f) => ({ ...f, toSymbol: sym }))}><Text style={[s.symBtnText, form.toSymbol === sym && s.symBtnTextActive]}>{sym}</Text></TouchableOpacity>))}</View>
          <Text style={s.label}>Amount</Text><TextInput style={s.input} value={form.amount} onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="100" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
          <TouchableOpacity style={s.submit} onPress={() => swapMutation.mutate({ fromSymbol: form.fromSymbol, toSymbol: form.toSymbol, amount: parseFloat(form.amount) || 0 })} disabled={swapMutation.isPending}>{swapMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Swap</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowSwap(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  content: { padding: 16, gap: 16 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  coinCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '${DARK.border}', borderLeftWidth: 4 }, coinHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coinSymbol: { color: '${DARK.text}', fontSize: 18, fontWeight: '700' }, coinName: { color: '${DARK.muted}', fontSize: 13 }, coinBalance: { color: '${DARK.text}', fontSize: 26, fontWeight: '800', marginBottom: 4 }, coinUSD: { color: '${DARK.muted}', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  symbolRow: { flexDirection: 'row', gap: 8 }, symBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '${DARK.border}', alignItems: 'center' },
  symBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, symBtnText: { color: '${DARK.muted}', fontSize: 13 }, symBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
`);

write('mobile/react-native/src/screens/BNPLScreen.tsx', `import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function BNPLScreen() {
  const navigation = useNavigation();
  const [showApply, setShowApply] = useState(false);
  const [form, setForm] = useState({ amount: '', purpose: '', installments: '3' });
  const { data: eligibility, isLoading: loadingEligibility } = trpc.bnpl.eligibility.useQuery();
  const { data: plans, isLoading: loadingPlans, refetch } = trpc.bnpl.plans.useQuery();
  const applyMutation = trpc.bnpl.apply.useMutation({ onSuccess: () => { setShowApply(false); refetch(); Alert.alert('Applied', 'Your BNPL application has been submitted'); }, onError: (e) => Alert.alert('Error', e.message) });
  const STATUS_COLOR: Record<string, string> = { active: '#10b981', pending: '#f59e0b', completed: '#6366f1', rejected: '#ef4444' };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Buy Now Pay Later</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        {loadingEligibility ? <ActivityIndicator color="${DARK.primary}" /> : eligibility && (
          <View style={[s.eligCard, { borderColor: eligibility.eligible ? '#10b981' : '#ef4444' }]}>
            <Text style={s.eligTitle}>{eligibility.eligible ? '✅ You are eligible' : '❌ Not eligible'}</Text>
            <Text style={s.eligLimit}>Credit Limit: USD {Number(eligibility.limit ?? eligibility.creditLimit ?? 0).toLocaleString()}</Text>
            {eligibility.reason && <Text style={s.eligReason}>{eligibility.reason}</Text>}
            {eligibility.eligible && <TouchableOpacity style={s.applyBtn} onPress={() => setShowApply(true)}><Text style={s.applyBtnText}>Apply for BNPL</Text></TouchableOpacity>}
          </View>
        )}
        <Text style={s.sectionTitle}>Active Plans</Text>
        {loadingPlans ? <ActivityIndicator color="${DARK.primary}" /> : (!plans || plans.length === 0) ? (
          <Text style={s.emptyText}>No active BNPL plans</Text>
        ) : plans.map((p: any) => (
          <View key={p.id} style={s.planCard}>
            <View style={s.row}><Text style={s.planMerchant}>{p.merchant ?? 'BNPL Plan'}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[p.status] ?? '#6b7280' }]}>{p.status}</Text></View>
            <Text style={s.planAmount}>USD {Number(p.totalAmount).toLocaleString()}</Text>
            <Text style={s.planInstallments}>{p.installmentsPaid ?? 0}/{p.totalInstallments ?? 0} installments paid</Text>
          </View>
        ))}
      </ScrollView>
      <Modal visible={showApply} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal
