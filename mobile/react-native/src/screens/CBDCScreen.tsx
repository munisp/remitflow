import React, { useState } from 'react';
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
