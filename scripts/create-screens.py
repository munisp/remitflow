import os

def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(content)
    print(f"✅ {path}")

BASE = "/home/ubuntu/remitflow"
RN = f"{BASE}/mobile/react-native/src/screens"
FL = f"{BASE}/mobile/flutter/lib/screens"

# Run the JS script for the screens that were already written inline
# Now create the remaining screens that weren't created yet

# BNPLScreen - complete it
write(f"{RN}/BNPLScreen.tsx", '''import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function BNPLScreen() {
  const navigation = useNavigation();
  const [showApply, setShowApply] = useState(false);
  const [form, setForm] = useState({ amount: '', purpose: '', installments: '3' });
  const { data: eligibility, isLoading: loadingEligibility } = trpc.bnpl.eligibility.useQuery();
  const { data: plans, isLoading: loadingPlans, refetch } = trpc.bnpl.plans.useQuery();
  const applyMutation = trpc.bnpl.apply.useMutation({
    onSuccess: () => { setShowApply(false); refetch(); Alert.alert('Applied', 'Your BNPL application has been submitted'); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  const STATUS_COLOR: Record<string, string> = { active: '#10b981', pending: '#f59e0b', completed: '#6366f1', rejected: '#ef4444' };
  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>Buy Now Pay Later</Text>
        <View />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {loadingEligibility ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : eligibility && (
          <View style={[s.eligCard, { borderColor: eligibility.eligible ? '#10b981' : '#ef4444' }]}>
            <Text style={s.eligTitle}>{eligibility.eligible ? '✅ You are eligible' : '❌ Not eligible'}</Text>
            <Text style={s.eligLimit}>Credit Limit: USD {Number(eligibility.limit ?? eligibility.creditLimit ?? 0).toLocaleString()}</Text>
            {eligibility.reason && <Text style={s.eligReason}>{eligibility.reason}</Text>}
            {eligibility.eligible && (
              <TouchableOpacity style={s.applyBtn} onPress={() => setShowApply(true)}>
                <Text style={s.applyBtnText}>Apply for BNPL</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        <Text style={s.sectionTitle}>Active Plans</Text>
        {loadingPlans ? <ActivityIndicator color="#6366f1" /> : (!plans || plans.length === 0) ? (
          <View style={s.empty}><Text style={s.emptyIcon}>💳</Text><Text style={s.emptyText}>No active BNPL plans</Text></View>
        ) : plans.map((p: any) => (
          <View key={p.id} style={s.planCard}>
            <View style={s.row}>
              <Text style={s.planMerchant}>{p.merchant ?? 'BNPL Plan'}</Text>
              <Text style={[s.badge, { backgroundColor: STATUS_COLOR[p.status] ?? '#6b7280' }]}>{p.status}</Text>
            </View>
            <Text style={s.planAmount}>USD {Number(p.totalAmount).toLocaleString()}</Text>
            <Text style={s.planInstallments}>{p.installmentsPaid ?? 0}/{p.totalInstallments ?? 0} installments paid</Text>
          </View>
        ))}
      </ScrollView>
      <Modal visible={showApply} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>Apply for BNPL</Text>
          <Text style={s.label}>Amount (USD)</Text>
          <TextInput style={s.input} value={form.amount} onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="500" placeholderTextColor="#6b7280" keyboardType="numeric" />
          <Text style={s.label}>Purpose</Text>
          <TextInput style={s.input} value={form.purpose} onChangeText={(v) => setForm((f) => ({ ...f, purpose: v }))} placeholder="e.g. Electronics purchase" placeholderTextColor="#6b7280" />
          <Text style={s.label}>Installments</Text>
          <View style={s.installRow}>
            {['3', '6', '12'].map((n) => (
              <TouchableOpacity key={n} style={[s.installBtn, form.installments === n && s.installBtnActive]} onPress={() => setForm((f) => ({ ...f, installments: n }))}>
                <Text style={[s.installBtnText, form.installments === n && s.installBtnTextActive]}>{n} months</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.submit} onPress={() => applyMutation.mutate({ amount: parseFloat(form.amount) || 0, purpose: form.purpose, installments: parseInt(form.installments) })} disabled={applyMutation.isPending}>
            {applyMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Submit Application</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowApply(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  back: { color: '#6366f1', fontSize: 16 }, title: { color: '#e2e8f0', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 16 },
  eligCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, borderWidth: 2 },
  eligTitle: { color: '#e2e8f0', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  eligLimit: { color: '#6366f1', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  eligReason: { color: '#9ca3af', fontSize: 13, marginBottom: 12 },
  applyBtn: { backgroundColor: '#6366f1', padding: 12, borderRadius: 10, alignItems: 'center' },
  applyBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionTitle: { color: '#e2e8f0', fontSize: 16, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 20 }, emptyIcon: { fontSize: 40, marginBottom: 8 }, emptyText: { color: '#9ca3af', fontSize: 15 },
  planCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#2d2d4e' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  planMerchant: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', flex: 1 },
  badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  planAmount: { color: '#6366f1', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  planInstallments: { color: '#9ca3af', fontSize: 13 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '#e2e8f0', fontSize: 20, fontWeight: '700', marginBottom: 16 },
  label: { color: '#9ca3af', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 10, padding: 12, color: '#e2e8f0', fontSize: 15 },
  installRow: { flexDirection: 'row', gap: 8 },
  installBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#2d2d4e', alignItems: 'center' },
  installBtnActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  installBtnText: { color: '#9ca3af', fontSize: 13 }, installBtnTextActive: { color: '#6366f1', fontWeight: '600' },
  submit: { backgroundColor: '#6366f1', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '#9ca3af', fontSize: 15 },
});
''')

write(f"{RN}/CheckoutSDKScreen.tsx", '''import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Clipboard, Modal, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function CheckoutSDKScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState('');
  const { data, isLoading, refetch } = trpc.checkout.apiKeys.useQuery();
  const createMutation = trpc.checkout.createKey.useMutation({
    onSuccess: () => { setShowCreate(false); setKeyName(''); refetch(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  const copy = (text: string) => { Clipboard.setString(text); Alert.alert('Copied', 'API key copied to clipboard'); };
  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>Checkout SDK</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}><Text style={s.addBtn}>+ New Key</Text></TouchableOpacity>
      </View>
      {isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {(!data || data.length === 0) && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🔑</Text>
              <Text style={s.emptyText}>No API keys</Text>
              <Text style={s.emptySub}>Create an API key to integrate RemitFlow Checkout into your app</Text>
            </View>
          )}
          {data?.map((key: any) => (
            <View key={key.id} style={s.card}>
              <View style={s.row}>
                <Text style={s.keyName}>{key.name ?? 'API Key'}</Text>
                <Text style={[s.badge, { backgroundColor: key.isActive ? '#065f46' : '#3b1a1a' }]}>{key.isActive ? 'Active' : 'Revoked'}</Text>
              </View>
              <Text style={s.keyValue}>{key.key ? key.key.slice(0, 20) + '...' : '••••••••••••••••••••'}</Text>
              <Text style={s.keyDate}>Created: {new Date(key.createdAt).toLocaleDateString()}</Text>
              {key.isActive && (
                <TouchableOpacity style={s.copyBtn} onPress={() => copy(key.key ?? '')}>
                  <Text style={s.copyBtnText}>📋 Copy Key</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>New API Key</Text>
          <Text style={s.label}>Key Name</Text>
          <TextInput style={s.input} value={keyName} onChangeText={setKeyName} placeholder="e.g. Production Key" placeholderTextColor="#6b7280" />
          <View style={s.warningBox}>
            <Text style={s.warningText}>⚠️ Store your API key securely. It will only be shown once after creation.</Text>
          </View>
          <TouchableOpacity style={s.submit} onPress={() => createMutation.mutate({ name: keyName })} disabled={createMutation.isPending || !keyName}>
            {createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Create Key</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowCreate(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  back: { color: '#6366f1', fontSize: 16 }, title: { color: '#e2e8f0', fontSize: 20, fontWeight: '700' }, addBtn: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 12 },
  empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '#e2e8f0', fontSize: 18, fontWeight: '600' }, emptySub: { color: '#9ca3af', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#2d2d4e' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  keyName: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', flex: 1 },
  badge: { fontSize: 11, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  keyValue: { color: '#9ca3af', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  keyDate: { color: '#6b7280', fontSize: 12, marginBottom: 8 },
  copyBtn: { backgroundColor: '#1e1b4b', padding: 8, borderRadius: 8, alignItems: 'center' }, copyBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '#e2e8f0', fontSize: 20, fontWeight: '700', marginBottom: 16 },
  label: { color: '#9ca3af', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 10, padding: 12, color: '#e2e8f0', fontSize: 15 },
  warningBox: { backgroundColor: '#2d1a0a', borderRadius: 8, padding: 12, marginTop: 12 },
  warningText: { color: '#fbbf24', fontSize: 13 },
  submit: { backgroundColor: '#6366f1', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '#9ca3af', fontSize: 15 },
});
''')

print("\n✅ All remaining RN screens created!")
print("\nCreated screens:")
import glob
screens = sorted(glob.glob(f"{RN}/*.tsx"))
for s in screens:
    print(f"  - {os.path.basename(s)}")
print(f"\nTotal: {len(screens)} screens")
