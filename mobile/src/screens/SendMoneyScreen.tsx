import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const API_BASE_URL = 'https://api.remitflow.com';

export default function SendMoneyScreen() {
  const [amount, setAmount] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('NG');
  const [payoutMethod, setPayoutMethod] = useState('mobile_money');
  const [isLoading, setIsLoading] = useState(false);
  const [fxQuote, setFxQuote] = useState<any>(null);

  const countries = [
    { code: 'NG', name: 'Nigeria', flag: '🇳🇬', methods: ['mobile_money', 'bank_transfer', 'cash_pickup'] },
    { code: 'KE', name: 'Kenya', flag: '🇰🇪', methods: ['mobile_money', 'bank_transfer'] },
    { code: 'GH', name: 'Ghana', flag: '🇬🇭', methods: ['mobile_money', 'bank_transfer', 'cash_pickup'] },
    { code: 'ZA', name: 'South Africa', flag: '🇿🇦', methods: ['bank_transfer', 'card_deposit'] },
    { code: 'ET', name: 'Ethiopia', flag: '🇪🇹', methods: ['bank_transfer', 'cash_pickup'] },
  ];

  const selectedCountryData = countries.find(c => c.code === selectedCountry);

  const getFxQuote = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    try {
      const response = await fetch(`${API_BASE_URL}/fx/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_currency: 'USD',
          quote_currency: selectedCountryData?.code === 'ZA' ? 'ZAR' : 'NGN',
          amount: parseFloat(amount),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setFxQuote(data);
      }
    } catch (error) {
      console.error('FX quote failed:', error);
    }
  };

  const handleSend = async () => {
    if (!amount || !recipientPhone || !recipientName) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    setIsLoading(true);
    try {
      // Step 1: Compliance screening
      const complianceRes = await fetch(`${API_BASE_URL}/compliance/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_usd: parseFloat(amount),
          sender_country: 'GB',
          receiver_country: selectedCountry,
          sender_name: 'Test Sender',
          receiver_name: recipientName,
        }),
      });

      const compliance = await complianceRes.json();

      if (compliance.riskLevel === 'critical') {
        Alert.alert('Transaction Blocked', 'This transaction has been flagged for compliance review.');
        setIsLoading(false);
        return;
      }

      // Step 2: Create transaction
      const txRes = await fetch(`${API_BASE_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_account_id: 'sender-001',
          receiver_account_id: 'receiver-001',
          amount: parseFloat(amount),
          currency: 'USD',
          reference: `Send to ${recipientName}`,
        }),
      });

      const tx = await txRes.json();

      if (tx.success) {
        Alert.alert('Success', `Transfer initiated! Transaction ID: ${tx.data.transaction_id}`);
      } else {
        Alert.alert('Error', tx.error || 'Transfer failed');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.title}>Send Money</Text>

        {/* Amount Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Amount (USD)</Text>
          <View style={styles.amountInput}>
            <Text style={styles.currencySymbol}>$</Text>
            <TextInput
              style={styles.amountField}
              keyboardType="decimal-pad"
              placeholder="0.00"
              value={amount}
              onChangeText={setAmount}
              onBlur={getFxQuote}
            />
          </View>
        </View>

        {/* Country Selection */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Destination Country</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.countryScroll}>
            {countries.map((country) => (
              <TouchableOpacity
                key={country.code}
                style={[styles.countryChip, selectedCountry === country.code && styles.countryChipActive]}
                onPress={() => {
                  setSelectedCountry(country.code);
                  setPayoutMethod(country.methods[0]);
                  setFxQuote(null);
                }}
              >
                <Text style={styles.countryFlag}>{country.flag}</Text>
                <Text style={[styles.countryName, selectedCountry === country.code && styles.countryNameActive]}>
                  {country.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Payout Method */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Payout Method</Text>
          <View style={styles.methodsGrid}>
            {selectedCountryData?.methods.map((method) => (
              <TouchableOpacity
                key={method}
                style={[styles.methodChip, payoutMethod === method && styles.methodChipActive]}
                onPress={() => setPayoutMethod(method)}
              >
                <Ionicons
                  name={method === 'mobile_money' ? 'phone-portrait' : method === 'bank_transfer' ? 'business' : 'cash'}
                  size={20}
                  color={payoutMethod === method ? '#FFFFFF' : '#6B7280'}
                />
                <Text style={[styles.methodText, payoutMethod === method && styles.methodTextActive]}>
                  {method.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Recipient Details */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Recipient Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={recipientName}
            onChangeText={setRecipientName}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Recipient Phone</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. +234 801 234 5678"
            keyboardType="phone-pad"
            value={recipientPhone}
            onChangeText={setRecipientPhone}
          />
        </View>

        {/* FX Quote */}
        {fxQuote && (
          <View style={styles.quoteCard}>
            <Text style={styles.quoteTitle}>Exchange Rate</Text>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>You send</Text>
              <Text style={styles.quoteValue}>${parseFloat(amount).toFixed(2)} USD</Text>
            </View>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>They receive</Text>
              <Text style={styles.quoteValue}>
                {fxQuote.customer_amount?.toFixed(2)} {fxQuote.quote_currency}
              </Text>
            </View>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>Rate</Text>
              <Text style={styles.quoteValue}>{fxQuote.customer_rate?.toFixed(4)}</Text>
            </View>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>Fee</Text>
              <Text style={styles.quoteValue}>${(parseFloat(amount) * 0.015).toFixed(2)}</Text>
            </View>
          </View>
        )}

        {/* Send Button */}
        <TouchableOpacity
          style={[styles.sendButton, isLoading && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.sendButtonText}>Send Money</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By sending money, you agree to our Terms of Service and confirm this transaction is not fraudulent.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollView: { padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#0A2540', marginBottom: 24 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  amountInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  currencySymbol: { fontSize: 24, fontWeight: 'bold', color: '#0A2540', marginRight: 8 },
  amountField: { flex: 1, fontSize: 24, fontWeight: 'bold', color: '#0A2540', paddingVertical: 16 },
  countryScroll: { flexDirection: 'row' },
  countryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  countryChipActive: { borderColor: '#635BFF', backgroundColor: '#635BFF10' },
  countryFlag: { fontSize: 20, marginRight: 8 },
  countryName: { fontSize: 14, fontWeight: '600', color: '#374151' },
  countryNameActive: { color: '#635BFF' },
  methodsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  methodChipActive: { backgroundColor: '#635BFF', borderColor: '#635BFF' },
  methodText: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  methodTextActive: { color: '#FFFFFF' },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    color: '#0A2540',
  },
  quoteCard: {
    backgroundColor: '#0A2540',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  quoteTitle: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 12 },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  quoteLabel: { fontSize: 14, color: '#A0AEC0' },
  quoteValue: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  sendButton: {
    backgroundColor: '#00D4AA',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  sendButtonDisabled: { opacity: 0.6 },
  sendButtonText: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF' },
  disclaimer: { fontSize: 12, color: '#6B7280', textAlign: 'center', lineHeight: 18 },
});
