import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function BeneficiaryScreen() {
  const navigation = useNavigation();
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', bankName: '', accountNumber: '', currency: 'USD', country: '' });

  const { data: beneficiaries, isLoading, refetch } = trpc.beneficiaries.list.useQuery();
  const createMutation = trpc.beneficiaries.create.useMutation({
    onSuccess: () => { setShowAdd(false); setForm({ name: '', email: '', bankName: '', accountNumber: '', currency: 'USD', country: '' }); utils.beneficiaries.list.invalidate(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  const deleteMutation = trpc.beneficiaries.delete.useMutation({
    onSuccess: () => utils.beneficiaries.list.invalidate(),
    onError: (e) => Alert.alert('Error', e.message),
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Beneficiaries</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={beneficiaries ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.beneficiaryCard}>
              <View style={styles.beneficiaryAvatar}>
                <Text style={styles.beneficiaryAvatarText}>{item.name[0].toUpperCase()}</Text>
              </View>
              <View style={styles.beneficiaryInfo}>
                <Text style={styles.beneficiaryName}>{item.name}</Text>
                <Text style={styles.beneficiaryDetail}>{item.email}</Text>
                <Text style={styles.beneficiaryDetail}>{item.bankName} · {item.currency}</Text>
              </View>
              <TouchableOpacity
                onPress={() => Alert.alert('Delete', `Remove ${item.name}?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate({ id: item.id }) },
                ])}
              >
                <Text style={styles.deleteBtn}>🗑</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No beneficiaries yet. Add one to get started.</Text>}
          onRefresh={refetch}
          refreshing={isLoading}
        />
      )}

      <Modal visible={showAdd} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Beneficiary</Text>
            {[
              { key: 'name', label: 'Full Name', placeholder: 'John Doe' },
              { key: 'email', label: 'Email', placeholder: 'john@example.com' },
              { key: 'bankName', label: 'Bank Name', placeholder: 'First Bank' },
              { key: 'accountNumber', label: 'Account Number', placeholder: '0123456789' },
              { key: 'country', label: 'Country', placeholder: 'Nigeria' },
            ].map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key as keyof typeof form]}
                  onChangeText={(v) => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor="#6b7280"
                />
              </View>
            ))}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => createMutation.mutate(form)}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 56, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  backText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  addBtn: { backgroundColor: '#6366f1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  beneficiaryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 8 },
  beneficiaryAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  beneficiaryAvatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  beneficiaryInfo: { flex: 1 },
  beneficiaryName: { color: '#e2e8f0', fontSize: 15, fontWeight: '600' },
  beneficiaryDetail: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  deleteBtn: { fontSize: 20, padding: 4 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40, lineHeight: 22 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 16 },
  field: { marginBottom: 12 },
  fieldLabel: { color: '#9ca3af', fontSize: 13, marginBottom: 4 },
  input: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2d2d4e' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, backgroundColor: '#0f0f1a', borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtnText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#6366f1', borderRadius: 12, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
