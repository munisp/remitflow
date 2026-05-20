import React, { useState } from 'react';
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
