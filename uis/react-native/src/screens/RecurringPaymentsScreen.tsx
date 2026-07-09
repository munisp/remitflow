import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { DARK } from '../theme/dark';

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
      {isLoading ? <ActivityIndicator color={DARK.primary} style={{ marginTop: 40 }} /> : (
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
            <TextInput style={s.input} value={form[f]} onChangeText={(v) => setForm((x) => ({ ...x, [f]: v }))} placeholder={f === 'recipientEmail' ? 'recipient@email.com' : f === 'amount' ? '100' : 'e.g. Monthly rent'} placeholderTextColor={DARK.dim} keyboardType={f === 'amount' ? 'numeric' : 'default'} /></View>
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
  container: { flex: 1, backgroundColor: DARK.bg }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: DARK.border },
  back: { color: DARK.primary, fontSize: 16 }, title: { color: DARK.text, fontSize: 18, fontWeight: '700' }, addBtn: { color: DARK.primary, fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: DARK.text, fontSize: 18, fontWeight: '600' }, emptySub: { color: DARK.muted, fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: DARK.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: DARK.border }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  recipient: { color: DARK.text, fontSize: 14, fontWeight: '600', flex: 1 }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  amount: { color: DARK.primary, fontSize: 16, fontWeight: '600', marginBottom: 4 }, desc: { color: DARK.muted, fontSize: 13, marginBottom: 4 }, next: { color: DARK.dim, fontSize: 12, marginBottom: 8 },
  cancelBtn: { backgroundColor: '#3b1a1a', padding: 8, borderRadius: 8, alignItems: 'center' }, cancelBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: DARK.text, fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: DARK.muted, fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: DARK.bg, borderWidth: 1, borderColor: DARK.border, borderRadius: 10, padding: 12, color: DARK.text, fontSize: 15 },
  freqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, freqBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: DARK.border },
  freqBtnActive: { borderColor: DARK.primary, backgroundColor: '#1e1b4b' }, freqBtnText: { color: DARK.muted, fontSize: 13 }, freqBtnTextActive: { color: DARK.primary, fontWeight: '600' },
  submit: { backgroundColor: DARK.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: DARK.muted, fontSize: 15 },
});
