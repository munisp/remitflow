/**
 * RemitFlow Mobile — PBAC Policies Screen (React Native)
 * Displays the 14 PBAC policies, entitlement grid, and deny event log.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface PbacPolicy {
  id: string;
  name: string;
  resource: string;
  action: string;
  conditions: string[];
  maxAmount?: number;
  requiresMfa?: boolean;
  enabled: boolean;
}

interface DenyEvent {
  id: number;
  userId: number;
  policy: string;
  resource: string;
  reason: string;
  createdAt: string;
}

const API_BASE = 'https://remitflow.manus.space/api/trpc';

// Static policy reference (mirrors server/pbac.ts)
const PBAC_POLICIES: PbacPolicy[] = [
  { id: 'transfer.send', name: 'Transfer Send', resource: 'transfer', action: 'send', conditions: ['KYC verified', 'Daily limit check', 'Anomaly score < 0.85'], maxAmount: 10000, requiresMfa: false, enabled: true },
  { id: 'wallet.withdraw', name: 'Wallet Withdraw', resource: 'wallet', action: 'withdraw', conditions: ['KYC tier limit', 'Balance check', 'Fraud score < 0.7'], maxAmount: 5000, requiresMfa: false, enabled: true },
  { id: 'kyc.approve', name: 'KYC Approve', resource: 'kyc', action: 'approve', conditions: ['Admin role', '2FA within 15 min'], requiresMfa: true, enabled: true },
  { id: 'transactions.export', name: 'Transactions Export', resource: 'transactions', action: 'export', conditions: ['Admin or compliance role', 'Audit logged'], requiresMfa: false, enabled: true },
  { id: 'beneficiaries.update', name: 'Beneficiary Update', resource: 'beneficiaries', action: 'update', conditions: ['Rate limit: 10/hour', 'Velocity check'], requiresMfa: false, enabled: true },
  { id: 'admin.impersonate', name: 'Admin Impersonate', resource: 'admin', action: 'impersonate', conditions: ['Admin role', '2FA within 15 min', 'Audit logged'], requiresMfa: true, enabled: true },
  { id: 'admin.enforce2fa', name: 'Enforce 2FA Policy', resource: 'admin', action: 'enforce2fa', conditions: ['Admin role', '2FA within 15 min'], requiresMfa: true, enabled: true },
  { id: 'batch.send', name: 'Batch Send', resource: 'batch', action: 'send', conditions: ['KYC tier 2+', 'Max 100 recipients'], maxAmount: 50000, requiresMfa: false, enabled: true },
  { id: 'card.issue', name: 'Card Issue', resource: 'card', action: 'issue', conditions: ['KYC verified', 'No active freeze'], requiresMfa: false, enabled: true },
  { id: 'savings.withdraw', name: 'Savings Withdraw', resource: 'savings', action: 'withdraw', conditions: ['Goal maturity check', 'Penalty calculation'], requiresMfa: false, enabled: true },
  { id: 'compliance.report', name: 'Compliance Report', resource: 'compliance', action: 'report', conditions: ['Compliance role', 'Date range limit 90d'], requiresMfa: false, enabled: true },
  { id: 'partner.payout', name: 'Partner Payout', resource: 'partner', action: 'payout', conditions: ['Partner role', 'Verified tenant'], maxAmount: 100000, requiresMfa: false, enabled: true },
  { id: 'fx.lock', name: 'FX Rate Lock', resource: 'fx', action: 'lock', conditions: ['KYC verified', 'Max 60s lock'], requiresMfa: false, enabled: true },
  { id: 'virtual.account', name: 'Virtual Account', resource: 'virtual', action: 'create', conditions: ['KYC tier 1+', 'Max 5 per user'], requiresMfa: false, enabled: true },
];

const PBACPoliciesScreen: React.FC = () => {
  const navigation = useNavigation();
  const [denyEvents, setDenyEvents] = useState<DenyEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'policies' | 'denials'>('policies');

  const loadDenyEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/pbac.getDenyEvents?input={"limit":20}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        setDenyEvents(json.result?.data ?? []);
      }
    } catch { /* fallback to empty */ }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { loadDenyEvents(); }, []);

  const filteredPolicies = PBAC_POLICIES.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.resource.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>{'<'} Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>PBAC Policies</Text>
        <Text style={styles.policyCount}>{PBAC_POLICIES.length} policies</Text>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'policies' && styles.tabActive]}
          onPress={() => setActiveTab('policies')}
        >
          <Text style={[styles.tabText, activeTab === 'policies' && styles.tabTextActive]}>Policies</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'denials' && styles.tabActive]}
          onPress={() => setActiveTab('denials')}
        >
          <Text style={[styles.tabText, activeTab === 'denials' && styles.tabTextActive]}>Deny Events</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadDenyEvents(); }} />}
      >
        {activeTab === 'policies' ? (
          <View style={styles.content}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search policies..."
              value={search}
              onChangeText={setSearch}
              placeholderTextColor="#9ca3af"
            />
            {filteredPolicies.map((policy) => (
              <View key={policy.id} style={styles.policyCard}>
                <View style={styles.policyHeader}>
                  <Text style={styles.policyName}>{policy.name}</Text>
                  <View style={[styles.enabledBadge, { backgroundColor: policy.enabled ? '#dcfce7' : '#fee2e2' }]}>
                    <Text style={[styles.enabledBadgeText, { color: policy.enabled ? '#15803d' : '#991b1b' }]}>
                      {policy.enabled ? 'Active' : 'Disabled'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.policyId}>{policy.id}</Text>
                <View style={styles.policyMeta}>
                  <Text style={styles.policyMetaText}>Resource: {policy.resource}</Text>
                  <Text style={styles.policyMetaText}>Action: {policy.action}</Text>
                  {policy.maxAmount && <Text style={styles.policyMetaText}>Max: ${policy.maxAmount.toLocaleString()}</Text>}
                  {policy.requiresMfa && <Text style={[styles.policyMetaText, { color: '#7c3aed' }]}>Requires 2FA</Text>}
                </View>
                <View style={styles.conditionsSection}>
                  <Text style={styles.conditionsLabel}>Conditions:</Text>
                  {policy.conditions.map((c, i) => (
                    <Text key={i} style={styles.conditionItem}>• {c}</Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.content}>
            {loading ? (
              <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />
            ) : denyEvents.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No deny events recorded</Text>
              </View>
            ) : (
              denyEvents.map((event) => (
                <View key={event.id} style={styles.denyCard}>
                  <View style={styles.denyCardHeader}>
                    <Text style={styles.denyPolicy}>{event.policy}</Text>
                    <Text style={styles.denyTime}>{new Date(event.createdAt).toLocaleTimeString()}</Text>
                  </View>
                  <Text style={styles.denyResource}>Resource: {event.resource}</Text>
                  <Text style={styles.denyReason}>{event.reason}</Text>
                  <Text style={styles.denyUser}>User #{event.userId}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  backButton: { marginRight: 12 },
  backButtonText: { color: '#3b82f6', fontSize: 16 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#0f172a' },
  policyCount: { fontSize: 12, color: '#64748b', backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#3b82f6' },
  tabText: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  tabTextActive: { color: '#3b82f6', fontWeight: '600' },
  content: { padding: 12 },
  searchInput: { backgroundColor: '#fff', borderRadius: 8, padding: 10, fontSize: 14, color: '#0f172a', marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  policyCard: { backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  policyHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  policyName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0f172a' },
  enabledBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  enabledBadgeText: { fontSize: 11, fontWeight: '600' },
  policyId: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 8 },
  policyMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  policyMetaText: { fontSize: 12, color: '#475569', backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  conditionsSection: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 8 },
  conditionsLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 4 },
  conditionItem: { fontSize: 12, color: '#475569', marginBottom: 2 },
  denyCard: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#ef4444', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  denyCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  denyPolicy: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0f172a' },
  denyTime: { fontSize: 11, color: '#94a3b8' },
  denyResource: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  denyReason: { fontSize: 12, color: '#ef4444', marginBottom: 2 },
  denyUser: { fontSize: 11, color: '#94a3b8' },
  loader: { marginTop: 40 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateText: { fontSize: 14, color: '#94a3b8' },
});

export default PBACPoliciesScreen;
