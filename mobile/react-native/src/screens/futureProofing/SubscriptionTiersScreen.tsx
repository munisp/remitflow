import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { getSubscriptionTiers, subscribeTier } from '../../services/futureProofingApi';

interface Tier { id: string; name: string; price: number; features: string[] }

export default function SubscriptionTiersScreen() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [currentTierId, setCurrentTierId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await getSubscriptionTiers();
        setTiers(res.tiers || []);
        setCurrentTierId(res.currentTierId ?? null);
      } catch {
        // handled by empty state
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSubscribe = async (tier: Tier) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      `Subscribe to ${tier.name}?`,
      'You can change or cancel anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Subscribe',
          onPress: async () => {
            try {
              await subscribeTier(tier.id);
              setCurrentTierId(tier.id);
              Alert.alert('Subscribed!', `Welcome to ${tier.name}`);
            } catch (e: any) {
              Alert.alert('Failed', e.message);
            }
          },
        },
      ],
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  const colors = ['#6b7280', '#3b82f6', '#8b5cf6', '#f59e0b'];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {tiers.map((tier, i) => {
        const isCurrent = tier.id === currentTierId;
        const isPopular = i === 1;
        const color = colors[i % colors.length];
        return (
          <View key={tier.id} style={[styles.card, isPopular && { borderColor: color, borderWidth: 2 }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.tierName, { color }]}>{tier.name}</Text>
              {isPopular && <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText}>Popular</Text></View>}
              {isCurrent && <View style={[styles.badge, { backgroundColor: '#22c55e' }]}><Text style={styles.badgeText}>Current</Text></View>}
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.price}>${tier.price}</Text>
              <Text style={styles.period}>/month</Text>
            </View>
            <View style={styles.divider} />
            {tier.features.map((f, j) => (
              <View key={j} style={styles.featureRow}>
                <Text style={[styles.checkmark, { color }]}>✓</Text>
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.subscribeBtn, isCurrent ? styles.currentBtn : { backgroundColor: color }]}
              onPress={() => !isCurrent && handleSubscribe(tier)}
              disabled={isCurrent}
            >
              <Text style={[styles.subscribeBtnText, isCurrent && { color: '#999' }]}>
                {isCurrent ? 'Current Plan' : 'Subscribe'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, borderWidth: 1, borderColor: '#eee' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierName: { fontSize: 20, fontWeight: 'bold' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 },
  price: { fontSize: 32, fontWeight: 'bold' },
  period: { color: '#666', fontSize: 14, marginBottom: 4 },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  checkmark: { fontSize: 16, fontWeight: 'bold' },
  featureText: { fontSize: 14, color: '#333' },
  subscribeBtn: { marginTop: 16, borderRadius: 10, padding: 14, alignItems: 'center' },
  currentBtn: { backgroundColor: '#f0f0f0' },
  subscribeBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
