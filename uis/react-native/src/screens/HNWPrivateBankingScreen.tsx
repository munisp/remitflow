import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { useAuth } from '../contexts/AuthContext';

export default function HNWPrivateBankingScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);
  const [checkoutLoading, setCheckoutLoading] = React.useState<string | null>(null);

  const { data: profile, isLoading, refetch } = (trpc as any)?.['hnwBanking']?.['getProfile']?.useQuery?.() ?? {
    data: null,
    isLoading: false,
    refetch: () => {},
  };

  const createCheckout = (trpc as any)?.['hnwBanking']?.['createHnwCheckout']?.useMutation?.({
    onSuccess: (data: any) => {
      if (data?.url) {
        Linking.openURL(data.url);
      }
      setCheckoutLoading(null);
    },
    onError: () => setCheckoutLoading(null),
  }) ?? { mutate: () => {} };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch?.();
    setRefreshing(false);
  };

  const handleCheckout = (serviceType: string) => {
    setCheckoutLoading(serviceType);
    createCheckout?.mutate?.({ serviceType, origin: 'https://remitflow.app' });
  };

  const tierColors: Record<string, string> = {
    platinum: '#e5e7eb',
    gold: '#f59e0b',
    silver: '#94a3b8',
    standard: '#6366f1',
  };
  const tier = (profile as any)?.tier ?? 'standard';
  const tierColor = tierColors[tier] ?? '#6366f1';

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Private Banking</Text>
        <Text style={styles.subtitle}>High Net Worth Services</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" size="large" style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Profile Card */}
          <View style={[styles.profileCard, { borderColor: tierColor }]}>
            <View style={styles.profileRow}>
              <View>
                <Text style={styles.profileName}>{user?.name ?? 'HNW Client'}</Text>
                <Text style={styles.profileEmail}>{user?.email ?? ''}</Text>
              </View>
              <View style={[styles.tierBadge, { backgroundColor: tierColor + '22' }]}>
                <Text style={[styles.tierText, { color: tierColor }]}>
                  {tier.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {(profile as any)?.negotiatedBps ?? 0} bps
                </Text>
                <Text style={styles.statLabel}>Your Spread</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#10b981' }]}>
                  ${(((profile as any)?.savingsBps ?? 0) * 100).toLocaleString()}
                </Text>
                <Text style={styles.statLabel}>Savings / $1M</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {(profile as any)?.rmName ?? 'TBA'}
                </Text>
                <Text style={styles.statLabel}>RM Contact</Text>
              </View>
            </View>
          </View>

          {/* Premium Services */}
          <Text style={styles.sectionTitle}>Premium Services</Text>

          <View style={styles.serviceCard}>
            <View style={styles.serviceHeader}>
              <Text style={styles.serviceIcon}>⚡</Text>
              <View style={styles.serviceInfo}>
                <Text style={styles.serviceName}>Priority SWIFT</Text>
                <Text style={styles.serviceDesc}>Same-day SWIFT processing with dedicated compliance lane</Text>
              </View>
              <Text style={styles.servicePrice}>$25</Text>
            </View>
            <TouchableOpacity
              style={[styles.checkoutBtn, checkoutLoading === 'priority_swift' && styles.checkoutBtnDisabled]}
              onPress={() => handleCheckout('priority_swift')}
              disabled={checkoutLoading === 'priority_swift'}
            >
              {checkoutLoading === 'priority_swift' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.checkoutBtnText}>Activate Priority SWIFT</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.serviceCard}>
            <View style={styles.serviceHeader}>
              <Text style={styles.serviceIcon}>👑</Text>
              <View style={styles.serviceInfo}>
                <Text style={styles.serviceName}>Advisory Retainer</Text>
                <Text style={styles.serviceDesc}>Monthly dedicated RM, FX strategy, and compliance advisory</Text>
              </View>
              <Text style={styles.servicePrice}>$250</Text>
            </View>
            <TouchableOpacity
              style={[styles.checkoutBtn, styles.checkoutBtnGold, checkoutLoading === 'advisory_retainer' && styles.checkoutBtnDisabled]}
              onPress={() => handleCheckout('advisory_retainer')}
              disabled={checkoutLoading === 'advisory_retainer'}
            >
              {checkoutLoading === 'advisory_retainer' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.checkoutBtnText}>Activate Advisory Retainer</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Benefits */}
          <Text style={styles.sectionTitle}>HNW Benefits</Text>
          {[
            { icon: '🔒', title: 'Dedicated Compliance Lane', desc: 'Skip standard AML queues with pre-approved status' },
            { icon: '📊', title: 'FX Rate Negotiation', desc: 'Negotiate spreads below 0.5% for transfers over $50K' },
            { icon: '🌍', title: 'Multi-Corridor Access', desc: 'Priority routing across 150+ countries' },
            { icon: '📱', title: '24/7 RM Support', desc: 'Direct WhatsApp and phone access to your RM' },
          ].map((benefit, idx) => (
            <View key={idx} style={styles.benefitCard}>
              <Text style={styles.benefitIcon}>{benefit.icon}</Text>
              <View style={styles.benefitInfo}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitDesc}>{benefit.desc}</Text>
              </View>
            </View>
          ))}

          {/* Stripe Test Note */}
          <View style={styles.testNote}>
            <Text style={styles.testNoteText}>
              🧪 Test mode: Use card 4242 4242 4242 4242 with any future expiry
            </Text>
          </View>
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 24, paddingBottom: 16 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#6366f1', fontSize: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#94a3b8' },
  profileCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  profileName: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  profileEmail: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  tierBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  tierText: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#94a3b8', paddingHorizontal: 16, marginBottom: 12, marginTop: 4 },
  serviceCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
  },
  serviceHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  serviceIcon: { fontSize: 24, marginRight: 12 },
  serviceInfo: { flex: 1 },
  serviceName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  serviceDesc: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  servicePrice: { fontSize: 18, fontWeight: 'bold', color: '#10b981' },
  checkoutBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  checkoutBtnGold: { backgroundColor: '#b45309' },
  checkoutBtnDisabled: { opacity: 0.6 },
  checkoutBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  benefitCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  benefitIcon: { fontSize: 24, marginRight: 12 },
  benefitInfo: { flex: 1 },
  benefitTitle: { fontSize: 14, fontWeight: '600', color: '#fff' },
  benefitDesc: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  testNote: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
  },
  testNoteText: { fontSize: 12, color: '#f59e0b' },
});
