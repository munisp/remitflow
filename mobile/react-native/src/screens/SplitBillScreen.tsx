import React, { useState } from 'react';
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
