import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { trpc } from '../services/trpc';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'CNY', 'INR', 'BRL'];

export default function SendMoneyScreen() {
  const [amount, setAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState('NGN');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'confirm' | 'success'>('form');

  const { data: rates } = trpc.paymentRails.getLiveRates.useQuery({ baseCurrency: fromCurrency });
  const sendMutation = trpc.transactions.send.useMutation({
    onSuccess: () => setStep('success'),
    onError: (e) => Alert.alert('Transfer Failed', e.message),
  });

  const rate = rates?.rates?.[toCurrency] ?? 1;
  const convertedAmount = amount ? (parseFloat(amount) * rate).toFixed(2) : '0.00';
  const fee = amount ? (parseFloat(amount) * 0.015).toFixed(2) : '0.00';

  const handleSend = () => {
    if (!amount || !recipientEmail) {
      Alert.alert('Missing Fields', 'Please fill in all required fields');
      return;
    }
    if (step === 'form') {
      setStep('confirm');
      return;
    }
    sendMutation.mutate({
      amount: parseFloat(amount),
      currency: fromCurrency,
      recipientEmail,
      note,
      rail: 'SWIFT',
    });
  };

  if (step === 'success') {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <Text style={styles.successIcon}>✅</Text>
        <Text style={styles.successTitle}>Transfer Initiated!</Text>
        <Text style={styles.successSub}>
          {fromCurrency} {amount} → {toCurrency} {convertedAmount}
        </Text>
        <Text style={styles.successSub}>to {recipientEmail}</Text>
        <TouchableOpacity style={styles.button} onPress={() => { setStep('form'); setAmount(''); setRecipientEmail(''); }}>
          <Text style={styles.buttonText}>Send Another</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Send Money</Text>

      {step === 'confirm' ? (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>Confirm Transfer</Text>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Amount</Text>
            <Text style={styles.confirmValue}>{fromCurrency} {amount}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Recipient receives</Text>
            <Text style={[styles.confirmValue, { color: '#10b981' }]}>{toCurrency} {convertedAmount}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Fee</Text>
            <Text style={styles.confirmValue}>{fromCurrency} {fee}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>To</Text>
            <Text style={styles.confirmValue}>{recipientEmail}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Exchange rate</Text>
            <Text style={styles.confirmValue}>1 {fromCurrency} = {rate.toFixed(4)} {toCurrency}</Text>
          </View>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.buttonOutline} onPress={() => setStep('form')}>
              <Text style={styles.buttonOutlineText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={handleSend} disabled={sendMutation.isPending}>
              {sendMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirm Send</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>You send</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#6b7280"
              />
              <View style={styles.currencyPicker}>
                {CURRENCIES.slice(0, 5).map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.currencyBtn, fromCurrency === c && styles.currencyBtnActive]}
                    onPress={() => setFromCurrency(c)}
                  >
                    <Text style={[styles.currencyText, fromCurrency === c && styles.currencyTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.rateRow}>
            <Text style={styles.rateText}>1 {fromCurrency} = {rate.toFixed(4)} {toCurrency}</Text>
            <Text style={styles.convertedText}>{toCurrency} {convertedAmount}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Recipient receives</Text>
            <View style={styles.currencyPicker}>
              {CURRENCIES.slice(5).map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.currencyBtn, toCurrency === c && styles.currencyBtnActive]}
                  onPress={() => setToCurrency(c)}
                >
                  <Text style={[styles.currencyText, toCurrency === c && styles.currencyTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Recipient email *</Text>
            <TextInput
              style={styles.input}
              value={recipientEmail}
              onChangeText={setRecipientEmail}
              placeholder="recipient@example.com"
              placeholderTextColor="#6b7280"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="What's this for?"
              placeholderTextColor="#6b7280"
            />
          </View>

          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Transfer fee (1.5%)</Text>
            <Text style={styles.feeValue}>{fromCurrency} {fee}</Text>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleSend}>
            <Text style={styles.buttonText}>Review Transfer</Text>
          </TouchableOpacity>
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 20, marginTop: 48 },
  card: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2d2d4e' },
  label: { color: '#9ca3af', fontSize: 13, marginBottom: 8 },
  amountRow: { gap: 12 },
  amountInput: { fontSize: 36, fontWeight: '800', color: '#fff', marginBottom: 12 },
  currencyPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  currencyBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2d2d4e' },
  currencyBtnActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  currencyText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  currencyTextActive: { color: '#fff' },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 12 },
  rateText: { color: '#6b7280', fontSize: 13 },
  convertedText: { color: '#10b981', fontSize: 16, fontWeight: '700' },
  input: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2d2d4e' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 16 },
  feeLabel: { color: '#6b7280', fontSize: 13 },
  feeValue: { color: '#f59e0b', fontSize: 13, fontWeight: '600' },
  button: { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  buttonOutline: { flex: 1, borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 2, borderColor: '#6366f1' },
  buttonOutlineText: { color: '#6366f1', fontSize: 16, fontWeight: '700' },
  confirmCard: { backgroundColor: '#1a1a2e', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#2d2d4e' },
  confirmTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 20 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  confirmLabel: { color: '#9ca3af', fontSize: 14 },
  confirmValue: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  successContainer: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  successIcon: { fontSize: 80, marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 8 },
  successSub: { color: '#9ca3af', fontSize: 16, marginBottom: 4 },
});
