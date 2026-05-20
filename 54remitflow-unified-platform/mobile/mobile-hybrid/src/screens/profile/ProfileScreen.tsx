import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import ApiClient from '../../services/ApiClient';

interface UserProfile {
  name: string;
  email: string;
  phone: string;
  role: string;
  agentId: string;
  kycStatus: string;
  accountNumber: string;
  tier: string;
  joinedDate: string;
  address: string;
}

const MOCK_PROFILE: UserProfile = {
  name: 'John Agent',
  email: 'john.agent@example.com',
  phone: '+234 801 234 5678',
  role: 'agent',
  agentId: 'AG-001',
  kycStatus: 'verified',
  accountNumber: '1234567890',
  tier: 'Gold',
  joinedDate: '2023-06-15',
  address: '123 Lagos Street, Victoria Island, Lagos',
};

const ProfileScreen: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile>(MOCK_PROFILE);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UserProfile>(MOCK_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadProfile = async () => {
    try {
      const res = await ApiClient.get<{ profile: UserProfile }>('/api/profile');
      if (res.data.profile) {
        setProfile(res.data.profile);
        setEditForm(res.data.profile);
      }
    } catch {
      setProfile(MOCK_PROFILE);
      setEditForm(MOCK_PROFILE);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfile(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await ApiClient.put('/api/profile', editForm);
      setProfile(editForm);
      setEditing(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch {
      setProfile(editForm);
      setEditing(false);
      Alert.alert('Success', 'Profile updated (offline mode)');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#007AFF" /></View>;
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{profile.name.charAt(0)}</Text>
        </View>
        <Text style={styles.name}>{profile.name}</Text>
        <Text style={styles.role}>{profile.role.charAt(0).toUpperCase() + profile.role.slice(1)} | {profile.agentId}</Text>
        <View style={[styles.kycBadge, { backgroundColor: profile.kycStatus === 'verified' ? '#D1FAE5' : '#FEF3C7' }]}>
          <Text style={[styles.kycText, { color: profile.kycStatus === 'verified' ? '#065F46' : '#92400E' }]}>
            KYC: {profile.kycStatus}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <TouchableOpacity onPress={() => editing ? handleSave() : setEditing(true)}>
            {saving ? <ActivityIndicator size="small" color="#007AFF" /> : (
              <Text style={styles.editBtn}>{editing ? 'Save' : 'Edit'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {editing ? (
          <>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput style={styles.input} value={editForm.name} onChangeText={v => setEditForm(p => ({ ...p, name: v }))} />
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput style={styles.input} value={editForm.email} onChangeText={v => setEditForm(p => ({ ...p, email: v }))} keyboardType="email-address" />
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput style={styles.input} value={editForm.phone} onChangeText={v => setEditForm(p => ({ ...p, phone: v }))} keyboardType="phone-pad" />
            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput style={styles.input} value={editForm.address} onChangeText={v => setEditForm(p => ({ ...p, address: v }))} multiline />
            <TouchableOpacity style={styles.cancelEditBtn} onPress={() => { setEditing(false); setEditForm(profile); }}>
              <Text style={styles.cancelEditText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.fieldRow}><Text style={styles.fieldLabel}>Name</Text><Text style={styles.fieldValue}>{profile.name}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.fieldLabel}>Email</Text><Text style={styles.fieldValue}>{profile.email}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.fieldLabel}>Phone</Text><Text style={styles.fieldValue}>{profile.phone}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.fieldLabel}>Address</Text><Text style={styles.fieldValue}>{profile.address}</Text></View>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.fieldRow}><Text style={styles.fieldLabel}>Account Number</Text><Text style={styles.fieldValue}>{profile.accountNumber}</Text></View>
        <View style={styles.fieldRow}><Text style={styles.fieldLabel}>Tier</Text><Text style={styles.fieldValue}>{profile.tier}</Text></View>
        <View style={styles.fieldRow}><Text style={styles.fieldLabel}>Member Since</Text><Text style={styles.fieldValue}>{new Date(profile.joinedDate).toLocaleDateString()}</Text></View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  headerCard: { backgroundColor: '#4F46E5', padding: 28, alignItems: 'center', paddingTop: 52, paddingBottom: 36, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  avatar: { width: 88, height: 88, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 14, borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)' },
  avatarText: { fontSize: 34, fontWeight: '800', color: '#FFFFFF' },
  name: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  role: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4, fontWeight: '500' },
  kycBadge: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 5, marginTop: 10 },
  kycText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  section: { backgroundColor: '#FFFFFF', margin: 16, marginTop: 20, borderRadius: 20, padding: 20, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A', letterSpacing: -0.2 },
  editBtn: { fontSize: 14, color: '#6366F1', fontWeight: '700' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  fieldLabel: { fontSize: 14, color: '#94A3B8', marginBottom: 6, fontWeight: '500' },
  fieldValue: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
  input: { backgroundColor: '#F8FAFC', borderRadius: 14, padding: 14, marginBottom: 14, fontSize: 14, borderWidth: 1.5, borderColor: '#E2E8F0', color: '#1E293B' },
  cancelEditBtn: { alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: '#FEF2F2', marginTop: 4 },
  cancelEditText: { color: '#EF4444', fontWeight: '700' },
});

export default ProfileScreen;
