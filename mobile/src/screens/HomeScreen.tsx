import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen({ navigation }: any) {
  const { user, logout } = useAuth();

  const quickActions = [
    { icon: 'send', label: 'Send Money', screen: 'SendMoney', color: '#00D4AA' },
    { icon: 'time', label: 'History', screen: 'History', color: '#635BFF' },
    { icon: 'shield-checkmark', label: 'Verify ID', screen: 'KYC', color: '#FF6B6B' },
    { icon: 'person', label: 'Profile', screen: 'Profile', color: '#4ECDC4' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello, {user?.name || 'User'}</Text>
            <Text style={styles.subGreeting}>
              {user?.kycStatus === 'verified' ? '✓ Identity Verified' : '⚠ Verification Required'}
            </Text>
          </View>
          <TouchableOpacity onPress={logout} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={24} color="#FF6B6B" />
          </TouchableOpacity>
        </View>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>$2,450.00</Text>
          <Text style={styles.balanceCurrency}>USD</Text>
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {quickActions.map((action) => (
            <TouchableOpacity
              key={action.label}
              style={[styles.actionButton, { backgroundColor: action.color + '15' }]}
              onPress={() => navigation.navigate(action.screen)}
            >
              <Ionicons name={action.icon as any} size={28} color={action.color} />
              <Text style={[styles.actionLabel, { color: action.color }]}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recent Activity */}
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={styles.activityList}>
          {[
            { type: 'sent', to: 'John Doe', amount: -500, currency: 'USD', date: 'Today, 10:30 AM', status: 'completed' },
            { type: 'received', from: 'Jane Smith', amount: 1200, currency: 'USD', date: 'Yesterday, 3:45 PM', status: 'completed' },
            { type: 'sent', to: 'Family Account', amount: -300, currency: 'USD', date: 'Aug 8, 9:00 AM', status: 'pending' },
          ].map((tx, index) => (
            <View key={index} style={styles.activityItem}>
              <View style={[styles.activityIcon, { backgroundColor: tx.type === 'sent' ? '#FF6B6B15' : '#00D4AA15' }]}>
                <Ionicons
                  name={tx.type === 'sent' ? 'arrow-up' : 'arrow-down'}
                  size={20}
                  color={tx.type === 'sent' ? '#FF6B6B' : '#00D4AA'}
                />
              </View>
              <View style={styles.activityDetails}>
                <Text style={styles.activityTitle}>
                  {tx.type === 'sent' ? `To ${tx.to}` : `From ${tx.from}`}
                </Text>
                <Text style={styles.activityDate}>{tx.date}</Text>
              </View>
              <View style={styles.activityAmount}>
                <Text style={[styles.amountText, { color: tx.type === 'sent' ? '#FF6B6B' : '#00D4AA' }]}>
                  {tx.type === 'sent' ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                </Text>
                <Text style={[styles.statusText, { color: tx.status === 'completed' ? '#00D4AA' : '#FFA500' }]}>
                  {tx.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollView: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  greeting: { fontSize: 24, fontWeight: 'bold', color: '#0A2540' },
  subGreeting: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  logoutButton: { padding: 8 },
  balanceCard: {
    backgroundColor: '#0A2540',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  balanceLabel: { fontSize: 14, color: '#A0AEC0', marginBottom: 8 },
  balanceAmount: { fontSize: 36, fontWeight: 'bold', color: '#FFFFFF' },
  balanceCurrency: { fontSize: 14, color: '#A0AEC0', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#0A2540', marginBottom: 12, marginTop: 8 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  actionButton: {
    width: '47%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
  },
  actionLabel: { marginTop: 8, fontSize: 14, fontWeight: '600' },
  activityList: { gap: 12 },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  activityIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  activityDetails: { flex: 1, marginLeft: 12 },
  activityTitle: { fontSize: 16, fontWeight: '600', color: '#0A2540' },
  activityDate: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  activityAmount: { alignItems: 'flex-end' },
  amountText: { fontSize: 16, fontWeight: 'bold' },
  statusText: { fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
});
