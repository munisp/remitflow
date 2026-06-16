import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { submitFedNowTransfer } from '../../services/futureProofingApi';

export default function FedNowTransferScreen() {
  const [amount, setAmount] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [creditorName, setCreditorName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ transactionId: string; endToEndId: string; status: string } | null>(null);

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return Alert.alert('Error', 'Please enter a valid amount');
    if (routingNumber.length !== 9) return Alert.alert('Error', 'Routing number must be 9 digits');
    if (!accountNumber) return Alert.alert('Error', 'Account number is required');
    if (!creditorName) return Alert.alert('Error', 'Creditor name is required');
    if (amt > 500000) return Alert.alert('Error', 'FedNow max is $500,000');

    setIsSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const res = await submitFedNowTransfer(amt, routingNumber, accountNumber, creditorName);
      setResult(res);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Transfer Failed', e.message || 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>⚡ FedNow Instant Payments</Text>
        <Text style={styles.bannerSub}>Real-time settlement via the Federal Reserve • USD only • Max $500,000</Text>
      </View>

      <Text style={styles.label}>Amount (USD)</Text>
      <TextInput
        style={styles.amountInput}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>ABA Routing Number</Text>
      <TextInput
        style={styles.input}
        value={routingNumber}
        onChangeText={setRoutingNumber}
        placeholder="9 digits"
        keyboardType="number-pad"
        maxLength={9}
      />

      <Text style={styles.label}>Account Number</Text>
      <TextInput
        style={styles.input}
        value={accountNumber}
        onChangeText={setAccountNumber}
        placeholder="Recipient account"
        keyboardType="number-pad"
      />

      <Text style={styles.label}>Creditor Name</Text>
      <TextInput
        style={styles.input}
        value={creditorName}
        onChangeText={setCreditorName}
        placeholder="Full name of recipient"
      />

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitDisabled]}
        onPress={handleSubmit}
        disabled={isSubmitting}
      >
        {isSubmitting
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitText}>Submit FedNow Transfer</Text>
        }
      </TouchableOpacity>

      {result && (
        <View style={[styles.resultCard, result.status === 'ACSP' || result.status === 'ACSC' ? styles.successCard : styles.errorCard]}>
          <Text style={styles.resultTitle}>
            {result.status === 'ACSP' || result.status === 'ACSC' ? '✓ Transfer Submitted' : '✕ Transfer Failed'}
          </Text>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Transaction ID</Text>
            <Text style={styles.resultValue}>{result.transactionId}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>End-to-End ID</Text>
            <Text style={styles.resultValue}>{result.endToEndId}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Status</Text>
            <Text style={styles.resultValue}>{result.status}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>ISO 20022</Text>
            <Text style={styles.resultValue}>pacs.008 generated</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  banner: { backgroundColor: '#0052CC', borderRadius: 12, padding: 16, marginBottom: 24 },
  bannerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  bannerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 12 },
  amountInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, fontSize: 24, fontWeight: 'bold', backgroundColor: '#fafafa' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: '#fafafa' },
  submitButton: { backgroundColor: '#0052CC', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultCard: { borderRadius: 12, padding: 16, marginTop: 24 },
  successCard: { backgroundColor: '#f0fff4', borderWidth: 1, borderColor: '#c6f6d5' },
  errorCard: { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fed7d7' },
  resultTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  resultLabel: { color: '#666', fontSize: 13 },
  resultValue: { fontWeight: '500', fontSize: 13 },
});
