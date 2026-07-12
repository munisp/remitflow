import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { DARK } from '../theme/dark';

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
      {isLoading ? <ActivityIndicator color={DARK.primary} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>📦</Text><Text style={s.emptyText}>No batch payments</Text><Text style={s.emptySub}>Create a batch to send multiple payments at once</Text></View>}
          {data?.map((b: any) => (
            <View key={b.id} style={s.card}>
              <View style={s.row}><Text style={s.batchName}>{b.name ?? `Batch #${b.id}`}</Text><Text style={[s.badge, { backgroundColor: STATUS_COLOR[b.status] ?? '#6b7280' }]}>{b.status}</Text></View>
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
          <Text style={s.label}>Batch Name</Text><TextInput style={s.input} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. November Payroll" placeholderTextColor={DARK.dim} />
          <Text style={s.label}>Description (optional)</Text><TextInput style={s.input} value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Monthly salary payments" placeholderTextColor={DARK.dim} />
          <View style={s.note}><Text style={s.noteText}>💡 Upload a CSV file via the web portal to add recipients to this batch</Text></View>
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ name: form.name, description: form.description, payments: [] })} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Create Batch</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowCreate(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK.bg }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: DARK.border },
  back: { color: DARK.primary, fontSize: 16 }, title: { color: DARK.text, fontSize: 20, fontWeight: '700' }, addBtn: { color: DARK.primary, fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: DARK.text, fontSize: 18, fontWeight: '600' }, emptySub: { color: DARK.muted, fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: DARK.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: DARK.border }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  batchName: { color: DARK.text, fontSize: 15, fontWeight: '600', flex: 1 }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  count: { color: DARK.muted, fontSize: 13, marginBottom: 4 }, date: { color: DARK.dim, fontSize: 12, marginBottom: 8 },
  cancelBtn: { backgroundColor: '#3b1a1a', padding: 8, borderRadius: 8, alignItems: 'center' }, cancelBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: DARK.text, fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: DARK.muted, fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: DARK.bg, borderWidth: 1, borderColor: DARK.border, borderRadius: 10, padding: 12, color: DARK.text, fontSize: 15 },
  note: { backgroundColor: '#1e1b4b', borderRadius: 8, padding: 12, marginTop: 12 }, noteText: { color: '#a5b4fc', fontSize: 13 },
  submit: { backgroundColor: DARK.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: DARK.muted, fontSize: 15 },
});
