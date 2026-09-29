import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { trpc } from '../services/trpc';
import { enqueue, pendingCount } from '../services/offlineQueue';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'CNY', 'INR', 'BRL'];

export default function SendMoneyScreen() {
  const [amount, setAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState('NGN');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'confirm' | 'success'>('form');
  // TOTP step-up: the backend (transfer.send) requires a 6-digit TOTP code for
  // transfers above $1,000 USD equivalent and answers FORBIDDEN "2FA_REQUIRED:…"
  // when it is missing. Surface that requirement instead of bypassing it.
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => `rn-send-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  // fx.liveRates (mounted, public) replaces the legacy-gated
  // paymentRails.getLiveRates. Response: { rates: Record<currency, rate>, … }.
  const { data: rates, isLoading: ratesLoading, isError: ratesError, refetch: refetchRates } =
    trpc.fx.liveRates.useQuery({ base: fromCurrency });
  const sendMutation = trpc.transfer.send.useMutation({
    onSuccess: () => {
      setStep('success');
      setTotpRequired(false);
      setTotpCode('');
      setIdempotencyKey(`rn-send-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    },
    onError: (e: any) => {
      const msg: string = e?.message ?? 'Transfer failed';
      if (msg.includes('2FA_REQUIRED')) {
        // Fail into the step-up flow: keep the confirm screen, ask for TOTP.
        setTotpRequired(true);
        Alert.alert('Step-up authentication required', msg.replace('2FA_REQUIRED:', '').trim());
        return;
      }
      Alert.alert('Transfer Failed', msg);
    },
  });

  // Fail closed on rate display: never show a fabricated 1.0 fallback.
  const rate: number | null = rates?.rates?.[toCurrency] ?? null;
  const convertedAmount = amount && rate != null ? (parseFloat(amount) * rate).toFixed(2) : null;
  const fee = amount ? (parseFloat(amount) * 0.015).toFixed(2) : '0.00';

  const [isOffline, setIsOffline] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOffline(!(state.isConnected ?? true));
    });
    pendingCount().then(setQueuedCount);
    return () => unsubscribe();
  }, []);

  const buildPayload = () => ({
    fromCurrency,
    amount: parseFloat(amount),
    toCurrency,
    recipientName: recipientName.trim(),
    ...(recipientEmail.trim() ? { recipientEmail: recipientEmail.trim() } : {}),
    ...(note.trim() ? { description: note.trim() } : {}),
    idempotencyKey,
    ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
  });

  const handleSend = async () => {
    if (!amount || !recipientName.trim()) {
      Alert.alert('Missing Fields', 'Please enter an amount and the recipient name');
      return;
    }
    if (rate == null && !isOffline) {
      Alert.alert(
        'Rate Unavailable',
        'Live exchange rates could not be loaded. Please try again before sending.',
        [{ text: 'Retry', onPress: () => refetchRates() }, { text: 'Cancel', style: 'cancel' }],
      );
      return;
    }
    if (step === 'form') {
      setStep('confirm');
      return;
    }

    if (isOffline) {
      await enqueue({
        operationType: 'transfer',
        endpoint: 'transfer.send',
        payload: buildPayload(),
        idempotencyKey,
      });
      const count = await pendingCount();
      setQueuedCount(count);
      Alert.alert(
        'Queued Offline',
        'Your transfer has been saved and will be sent automatically when connectivity is restored.'
      );
      setStep('success');
      return;
    }

    sendMutation.mutate(buildPayload());
  };

  if (step === 'success') {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <Text style={styles.successIcon}>✅</Text>
        <Text style={styles.successTitle}>Transfer Initiated!</Text>
        <Text style={styles.successSub}>
          {fromCurrency} {amount}{convertedAmount != null ? ` → ${toCurrency} ${convertedAmount}` : ''}
        </Text>
        <Text style={styles.successSub}>to {recipientName}</Text>
        <TouchableOpacity style={styles.button} onPress={() => { setStep('form'); setAmount(''); setRecipientName(''); setRecipientEmail(''); }}>
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
            <Text style={[styles.confirmValue, { color: '#10b981' }]}>
              {convertedAmount != null ? `${toCurrency} ${convertedAmount}` : '—'}
            </Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Fee</Text>
            <Text style={styles.confirmValue}>{fromCurrency} {fee}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>To</Text>
            <Text style={styles.confirmValue}>{recipientName}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Exchange rate</Text>
            <Text style={styles.confirmValue}>
              {rate != null ? `1 ${fromCurrency} = ${rate.toFixed(4)} ${toCurrency}` : 'unavailable'}
            </Text>
          </View>
          {totpRequired && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.confirmLabel}>
                This transfer requires step-up authentication. Enter the 6-digit code from your authenticator app.
              </Text>
              <TextInput
                style={[styles.input, { marginTop: 8 }]}
                value={totpCode}
                onChangeText={setTotpCode}
                placeholder="123456"
                placeholderTextColor="#6b7280"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
          )}
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
            {ratesLoading ? (
              <Text style={styles.rateText}>Loading live rate…</Text>
            ) : rate != null ? (
              <>
                <Text style={styles.rateText}>1 {fromCurrency} = {rate.toFixed(4)} {toCurrency}</Text>
                <Text style={styles.convertedText}>{toCurrency} {convertedAmount}</Text>
              </>
            ) : (
              <TouchableOpacity onPress={() => refetchRates()}>
                <Text style={[styles.rateText, { color: '#ef4444' }]}>
                  {ratesError ? 'Live rate unavailable — tap to retry' : `No live rate for ${toCurrency} — tap to retry`}
                </Text>
              </TouchableOpacity>
            )}
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
            <Text style={styles.label}>Recipient name *</Text>
            <TextInput
              style={styles.input}
              value={recipientName}
              onChangeText={setRecipientName}
              placeholder="Full name of the recipient"
              placeholderTextColor="#6b7280"
              autoCapitalize="words"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Recipient email (optional)</Text>
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
