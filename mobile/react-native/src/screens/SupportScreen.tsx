import React, { useState } from 'react';
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
