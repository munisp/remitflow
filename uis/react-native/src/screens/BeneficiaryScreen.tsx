import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

// wave14 perf (L1): fixed row geometry for getItemLayout — card height 86
// (enforced in styles, texts numberOfLines={1}) + 8 marginBottom.
const BEN_ROW_HEIGHT = 86 + 8;

type Beneficiary = { id: number; name: string; email: string; bankName: string; currency: string };

const BeneficiaryRow = React.memo(function BeneficiaryRow({
  item,
  onDelete,
}: {
  item: Beneficiary;
  onDelete: (item: Beneficiary) => void;
}) {
  return (
    <View style={styles.beneficiaryCard}>
      <View style={styles.beneficiaryAvatar}>
        <Text style={styles.beneficiaryAvatarText}>{item.name[0].toUpperCase()}</Text>
      </View>
      <View style={styles.beneficiaryInfo}>
        <Text style={styles.beneficiaryName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.beneficiaryDetail} numberOfLines={1}>{item.email}</Text>
        <Text style={styles.beneficiaryDetail} numberOfLines={1}>{item.bankName} · {item.currency}</Text>
      </View>
      <TouchableOpacity onPress={() => onDelete(item)}>
        <Text style={styles.deleteBtn}>🗑</Text>
      </TouchableOpacity>
    </View>
  );
});

export default function BeneficiaryScreen() {
  const navigation = useNavigation();
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', bankName: '', accountNumber: '', currency: 'USD', country: '', totpCode: '' });

  const { data: beneficiaries, isLoading, refetch } = trpc.beneficiaries.list.useQuery();
  // wave16 C2: mounted names are add/remove (server/routers.ts:1937/1970), not create/delete.
  // beneficiaries.add enforces a TOTP step-up when 2FA is enrolled — surface the code input below.
  const createMutation = trpc.beneficiaries.add.useMutation({
    onSuccess: () => { setShowAdd(false); setForm({ name: '', email: '', bankName: '', accountNumber: '', currency: 'USD', country: '', totpCode: '' }); utils.beneficiaries.list.invalidate(); },
    onError: (e: any) => Alert.alert('Error', e.message),
  });
  const deleteMutation = trpc.beneficiaries.remove.useMutation({
    onSuccess: () => utils.beneficiaries.list.invalidate(),
    onError: (e: any) => Alert.alert('Error', e.message),
  });

  // wave14 perf (L1): stable renderItem/getItemLayout so FlatList doesn't
  // re-render rows on every parent render.
  const deleteMutateRef = React.useRef(deleteMutation.mutate);
  deleteMutateRef.current = deleteMutation.mutate;
  const handleDelete = useCallback((item: Beneficiary) => {
    Alert.alert('Delete', `Remove ${item.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutateRef.current({ id: Number(item.id) }) },
    ]);
  }, []);
  const renderItem = useCallback(
    ({ item }: { item: Beneficiary }) => <BeneficiaryRow item={item} onDelete={handleDelete} />,
    [handleDelete],
  );
  const getItemLayout = useCallback(
    (_: ArrayLike<Beneficiary> | null | undefined, index: number) => ({
      length: BEN_ROW_HEIGHT,
      offset: BEN_ROW_HEIGHT * index + 16, // contentContainerStyle padding
      index,
    }),
    [],
  );

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
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16 }}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          removeClippedSubviews
          initialNumToRender={10}
          windowSize={7}
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
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>2FA Code (required if 2FA is enabled)</Text>
              <TextInput
                style={styles.input}
                value={form.totpCode}
                onChangeText={(v) => setForm(f => ({ ...f, totpCode: v.replace(/\D/g, '').slice(0, 6) }))}
                placeholder="123456"
                placeholderTextColor="#6b7280"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => {
                  const { totpCode, ...rest } = form;
                  createMutation.mutate({ ...rest, ...(totpCode ? { totpCode } : {}) });
                }}
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
  beneficiaryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 8, height: 86 },
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
