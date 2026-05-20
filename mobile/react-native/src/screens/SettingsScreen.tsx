import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [editMode, setEditMode] = useState(false);
  const { data: profile, isLoading, refetch } = trpc.profile.get.useQuery();
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const updateMutation = trpc.profile.update.useMutation({ onSuccess: () => { setEditMode(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const { data: security } = trpc.security.settings.useQuery();
  React.useEffect(() => { if (profile) setForm({ name: profile.name ?? '', phone: profile.phone ?? '', email: profile.email ?? '' }); }, [profile]);
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Settings</Text><TouchableOpacity onPress={() => setEditMode(!editMode)}><Text style={s.editBtn}>{editMode ? 'Cancel' : 'Edit'}</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.sectionTitle}>Profile</Text>
          <View style={s.card}>
            {(['name', 'phone', 'email'] as const).map((f) => (
              <View key={f} style={s.field}>
                <Text style={s.fieldLabel}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
                {editMode ? <TextInput style={s.input} value={form[f]} onChangeText={(v) => setForm((x) => ({ ...x, [f]: v }))} placeholderTextColor="${DARK.dim}" keyboardType={f === 'email' ? 'email-address' : f === 'phone' ? 'phone-pad' : 'default'} /> : <Text style={s.fieldValue}>{(profile as any)?.[f] ?? '—'}</Text>}
              </View>
            ))}
            {editMode && <TouchableOpacity style={s.saveBtn} onPress={() => updateMutation.mutate(form)} disabled={updateMutation.isPending}>{updateMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Changes</Text>}</TouchableOpacity>}
          </View>
          <Text style={s.sectionTitle}>Security</Text>
          <View style={s.card}>
            <View style={s.secRow}><Text style={s.secLabel}>Two-Factor Authentication</Text><Text style={[s.secStatus, { color: security?.twoFactorEnabled ? '#10b981' : '#ef4444' }]}>{security?.twoFactorEnabled ? 'Enabled' : 'Disabled'}</Text></View>
            <View style={s.secRow}><Text style={s.secLabel}>Biometric Login</Text><Text style={[s.secStatus, { color: security?.biometricEnabled ? '#10b981' : '#6b7280' }]}>{security?.biometricEnabled ? 'Enabled' : 'Disabled'}</Text></View>
            <TouchableOpacity style={s.secBtn} onPress={() => Alert.alert('Security', 'Manage security settings in the web portal for full control')}><Text style={s.secBtnText}>Manage Security →</Text></TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, editBtn: { color: '${DARK.primary}', fontSize: 16 },
  content: { padding: 16, gap: 8 }, sectionTitle: { color: '${DARK.muted}', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: '${DARK.card}', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' },
  field: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' }, fieldLabel: { color: '${DARK.muted}', fontSize: 12, marginBottom: 4 }, fieldValue: { color: '${DARK.text}', fontSize: 15 },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 8, padding: 10, color: '${DARK.text}', fontSize: 15 },
  saveBtn: { backgroundColor: '${DARK.primary}', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 }, saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  secLabel: { color: '${DARK.text}', fontSize: 14 }, secStatus: { fontSize: 13, fontWeight: '600' },
  secBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 }, secBtnText: { color: '${DARK.primary}', fontSize: 14, fontWeight: '600' },
});
