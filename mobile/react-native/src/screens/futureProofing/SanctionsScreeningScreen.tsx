import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { screenSanctions } from '../../services/futureProofingApi';

export default function SanctionsScreeningScreen() {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [dob, setDob] = useState('');
  const [isScreening, setIsScreening] = useState(false);
  const [result, setResult] = useState<{
    screeningId: string;
    riskLevel: string;
    hits: Array<{ name: string; list: string; score: number }>;
  } | null>(null);

  const handleScreen = async () => {
    if (!name.trim()) return Alert.alert('Error', 'Name is required');
    setIsScreening(true);
    setResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const res = await screenSanctions(name.trim(), country.trim() || undefined, dob.trim() || undefined);
      setResult(res);
      Haptics.notificationAsync(
        res.hits.length > 0 ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setIsScreening(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.infoCard}>
        <Text style={styles.infoText}>🛡 Multi-list screening: OFAC SDN, UN, EU, UK, NFIU Nigeria. Uses Jaro-Winkler fuzzy matching.</Text>
      </View>

      <Text style={styles.label}>Full Name *</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Enter name to screen" />

      <Text style={styles.label}>Country (optional)</Text>
      <TextInput style={styles.input} value={country} onChangeText={setCountry} placeholder="e.g., Nigeria" />

      <Text style={styles.label}>Date of Birth (optional)</Text>
      <TextInput style={styles.input} value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />

      <TouchableOpacity style={styles.screenBtn} onPress={handleScreen} disabled={isScreening}>
        {isScreening
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.screenBtnText}>🔍 Run Screening</Text>
        }
      </TouchableOpacity>

      {result && (
        <View style={[styles.resultCard, result.hits.length > 0 ? styles.hitCard : styles.clearCard]}>
          <Text style={styles.resultTitle}>
            {result.hits.length > 0 ? '⚠️ Potential Match Found' : '✓ No Matches Found'}
          </Text>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Risk Level</Text>
            <Text style={[styles.resultValue, { color: result.riskLevel === 'high' ? '#e53e3e' : '#38a169' }]}>{result.riskLevel.toUpperCase()}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Screening ID</Text>
            <Text style={styles.resultValue}>{result.screeningId}</Text>
          </View>
          {result.hits.map((hit, i) => (
            <View key={i} style={styles.hitDetail}>
              <Text style={styles.hitName}>{hit.name}</Text>
              <Text style={styles.hitMeta}>List: {hit.list} • Score: {(hit.score * 100).toFixed(0)}%</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  infoCard: { backgroundColor: '#fff7ed', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#fed7aa', marginBottom: 20 },
  infoText: { fontSize: 13, color: '#9a3412' },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: '#fafafa' },
  screenBtn: { backgroundColor: '#ea580c', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  screenBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultCard: { borderRadius: 12, padding: 16, marginTop: 24 },
  hitCard: { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fed7d7' },
  clearCard: { backgroundColor: '#f0fff4', borderWidth: 1, borderColor: '#c6f6d5' },
  resultTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  resultLabel: { color: '#666', fontSize: 13 },
  resultValue: { fontWeight: '500', fontSize: 13 },
  hitDetail: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#fed7d7', padding: 10, marginTop: 8 },
  hitName: { fontWeight: '600' },
  hitMeta: { color: '#666', fontSize: 12, marginTop: 2 },
});
