import React, { useState } from 'react';
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
