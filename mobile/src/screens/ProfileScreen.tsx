import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

export default function ProfileScreen({ navigation }: any) {
  const { user, logout } = useAuth();

  const menuItems = [
    { icon: 'person-outline', label: 'Personal Information', screen: 'PersonalInfo' },
    { icon: 'shield-checkmark-outline', label: 'Security Settings', screen: 'Security' },
    { icon: 'card-outline', label: 'Payment Methods', screen: 'PaymentMethods' },
    { icon: 'notifications-outline', label: 'Notifications', screen: 'Notifications' },
    { icon: 'globe-outline', label: 'Language & Region', screen: 'Language' },
    { icon: 'document-text-outline', label: 'Documents & Verification', screen: 'KYC' },
    { icon: 'help-circle-outline', label: 'Help & Support', screen: 'Support' },
    { icon: 'information-circle-outline', label: 'About RemitFlow', screen: 'About' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {/* Profile Header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color="#FFFFFF" />
          </View>
          <Text style={styles.name}>{user?.name || 'User Name'}</Text>
          <Text style={styles.email}>{user?.email || 'user@example.com'}</Text>
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={14} color="#00D4AA" />
            <Text style={styles.badgeText}>
              {user?.kycStatus === 'verified' ? 'Verified' : 'Verification Pending'}
            </Text>
          </View>
        </View>

        {/* Menu Items */}
        <View style={styles.menu}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.menuItem, index === menuItems.length - 1 && styles.menuItemLast]}
              onPress={() => item.screen === 'KYC' ? navigation.navigate('KYC') : null}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name={item.icon as any} size={22} color="#635BFF" />
                <Text style={styles.menuItemLabel}>{item.label}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Ionicons name="log-out-outline" size={22} color="#FF6B6B" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>RemitFlow v2.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { alignItems: 'center', padding: 24, backgroundColor: '#0A2540' },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#635BFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  name: { fontSize: 22, fontWeight: 'bold', color: '#FFFFFF' },
  email: { fontSize: 14, color: '#A0AEC0', marginTop: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00D4AA20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 12,
  },
  badgeText: { color: '#00D4AA', fontSize: 13, fontWeight: '600' },
  menu: { backgroundColor: '#FFFFFF', marginTop: 16, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuItemLabel: { fontSize: 16, color: '#374151' },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#FF6B6B' },
  version: { textAlign: 'center', color: '#9CA3AF', fontSize: 12, marginTop: 24, marginBottom: 32 },
});
