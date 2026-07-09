import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { DARK } from '../theme/dark';

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
      {isLoading ? <ActivityIndicator color={DARK.primary} style={{ marginTop: 40 }} /> : (
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
          <Text style={s.label}>From Currency</Text><TextInput style={s.input} value={form.fromCurrency} onChangeText={(v) => setForm((f) => ({ ...f, fromCurrency: v.toUpperCase() }))} placeholder="USD" placeholderTextColor={DARK.dim} autoCapitalize="characters" />
          <Text style={s.label}>To Currency</Text><TextInput style={s.input} value={form.toCurrency} onChangeText={(v) => setForm((f) => ({ ...f, toCurrency: v.toUpperCase() }))} placeholder="NGN" placeholderTextColor={DARK.dim} autoCapitalize="characters" />
          <Text style={s.label}>Amount</Text><TextInput style={s.input} value={form.amount} onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="500" placeholderTextColor={DARK.dim} keyboardType="numeric" />
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
  container: { flex: 1, backgroundColor: DARK.bg }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: DARK.border },
  back: { color: DARK.primary, fontSize: 16 }, title: { color: DARK.text, fontSize: 20, fontWeight: '700' }, addBtn: { color: DARK.primary, fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: DARK.text, fontSize: 18, fontWeight: '600' }, emptySub: { color: DARK.muted, fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: DARK.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: DARK.border }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  pair: { color: DARK.text, fontSize: 15, fontWeight: '600' }, badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  rate: { color: DARK.primary, fontSize: 16, fontWeight: '600', marginBottom: 4 }, amount: { color: DARK.muted, fontSize: 13, marginBottom: 4 }, expiry: { color: DARK.dim, fontSize: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: DARK.text, fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: DARK.muted, fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: DARK.bg, borderWidth: 1, borderColor: DARK.border, borderRadius: 10, padding: 12, color: DARK.text, fontSize: 15 },
  durationRow: { flexDirection: 'row', gap: 8 }, durBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: DARK.border, alignItems: 'center' },
  durBtnActive: { borderColor: DARK.primary, backgroundColor: '#1e1b4b' }, durBtnText: { color: DARK.muted, fontSize: 13 }, durBtnTextActive: { color: DARK.primary, fontWeight: '600' },
  submit: { backgroundColor: DARK.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: DARK.muted, fontSize: 15 },
});
