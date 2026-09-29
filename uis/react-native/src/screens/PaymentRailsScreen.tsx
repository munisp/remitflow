import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const RAILS = [
  { id: 'CIPS', name: 'CIPS', flag: '🇨🇳', desc: 'China Cross-Border Interbank Payment', currency: 'CNY', color: '#ef4444' },
  { id: 'UPI', name: 'UPI', flag: '🇮🇳', desc: 'Unified Payments Interface', currency: 'INR', color: '#f97316' },
  { id: 'PIX', name: 'PIX', flag: '🇧🇷', desc: 'Brazilian Instant Payment', currency: 'BRL', color: '#22c55e' },
  { id: 'SWIFT', name: 'SWIFT', flag: '🌐', desc: 'International Wire Transfer', currency: 'USD', color: '#3b82f6' },
  { id: 'SEPA', name: 'SEPA', flag: '🇪🇺', desc: 'Single Euro Payments Area', currency: 'EUR', color: '#6366f1' },
  { id: 'MOJALOOP', name: 'Mojaloop', flag: '🌍', desc: 'Open-source inclusive payments', currency: 'USD', color: '#8b5cf6' },
];

export default function PaymentRailsScreen() {
  const navigation = useNavigation();
  const [selectedRail, setSelectedRail] = useState('SWIFT');
  // wave16: paymentRails.* is mounted only behind the legacy feature-pack gate
  // (OFF by default). Live rates come from the mounted fx.liveRates procedure
  // (public, { rates, base, source, … }). There is NO mounted equivalent of
  // paymentRails.getSupportedRails — per-rail live status is therefore shown
  // as unavailable instead of fabricating an "Active" badge.
  const { data: rates, isLoading, isError, refetch } = trpc.fx.liveRates.useQuery({ base: 'USD' });

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Payment Rails</Text>
      <Text style={styles.subtitle}>Select a payment network for your transfer</Text>

      <View style={styles.railsGrid}>
        {RAILS.map((rail) => (
          <TouchableOpacity
            key={rail.id}
            style={[styles.railCard, selectedRail === rail.id && styles.railCardActive]}
            onPress={() => setSelectedRail(rail.id)}
          >
            <Text style={styles.railFlag}>{rail.flag}</Text>
            <Text style={[styles.railName, { color: rail.color }]}>{rail.name}</Text>
            <Text style={styles.railDesc}>{rail.desc}</Text>
            <View style={[styles.railStatus, { backgroundColor: '#9ca3af' + '20' }]}>
              <Text style={[styles.railStatusText, { color: '#9ca3af' }]}>
                ● Live status unavailable
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.statusNote}>
        Per-rail availability is not provided by the current backend build; the network
        is confirmed again at transfer time.
      </Text>

      <Text style={styles.sectionTitle}>Live Exchange Rates (USD base)</Text>
      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginVertical: 20 }} />
      ) : isError ? (
        <View style={styles.ratesCard}>
          <TouchableOpacity style={styles.rateRow} onPress={() => refetch()}>
            <Text style={[styles.rateCurrency, { color: '#ef4444' }]}>
              Live rates unavailable — tap to retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.ratesCard}>
          {Object.entries(rates?.rates ?? {}).slice(0, 10).map(([currency, rate]) => (
            <View key={currency} style={styles.rateRow}>
              <Text style={styles.rateCurrency}>{currency}</Text>
              <Text style={styles.rateValue}>{Number(rate).toFixed(4)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  back: { marginTop: 48, marginBottom: 8 },
  backText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4 },
  subtitle: { color: '#9ca3af', fontSize: 14, marginBottom: 20 },
  railsGrid: { gap: 12, marginBottom: 24 },
  railCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2d2d4e' },
  railCardActive: { borderColor: '#6366f1', borderWidth: 2 },
  railCardDisabled: { opacity: 0.5 },
  railFlag: { fontSize: 32, marginBottom: 8 },
  railName: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  railDesc: { color: '#9ca3af', fontSize: 13, marginBottom: 8 },
  railStatus: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  railStatusText: { fontSize: 12, fontWeight: '600' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 12 },
  ratesCard: { backgroundColor: '#1a1a2e', borderRadius: 16, overflow: 'hidden' },
  rateRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  rateCurrency: { flex: 1, color: '#e2e8f0', fontSize: 15, fontWeight: '600' },
  rateValue: { color: '#9ca3af', fontSize: 14, marginRight: 12 },
  statusNote: { color: '#6b7280', fontSize: 12, marginBottom: 20 },
});
