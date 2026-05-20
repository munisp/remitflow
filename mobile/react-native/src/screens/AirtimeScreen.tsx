import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const PROVIDERS = ['MTN', 'Airtel', 'Glo', '9mobile', 'Vodacom', 'Safaricom', 'Orange'];
const AMOUNTS = [5, 10, 20, 50, 100];

export default function AirtimeScreen() {
  const navigation = useNavigation();
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState('MTN');
  const [amount, setAmount] = useState('');
  const topupMutation = trpc.airtime.topup.useMutation({
    onSuccess: () => { Alert.alert('Success', 'Airtime sent successfully!'); setPhone(''); setAmount(''); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Airtime Top-Up</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>Phone Number</Text>
        <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="+234 800 000 0000" placeholderTextColor="${DARK.dim}" keyboardType="phone-pad" />
        <Text style={s.label}>Provider</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.providerRow}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity key={p} style={[s.providerBtn, provider === p && s.providerBtnActive]} onPress={() => setProvider(p)}>
              <Text style={[s.providerBtnText, provider === p && s.providerBtnTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={s.label}>Amount (USD)</Text>
        <View style={s.amountRow}>
          {AMOUNTS.map((a) => (
            <TouchableOpacity key={a} style={[s.amountBtn, amount === String(a) && s.amountBtnActive]} onPress={() => setAmount(String(a))}>
              <Text style={[s.amountBtnText, amount === String(a) && s.amountBtnTextActive]}>\${a}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={[s.input, { marginTop: 8 }]} value={amount} onChangeText={setAmount} placeholder="Custom amount" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
        <TouchableOpacity style={s.submitBtn} onPress={() => topupMutation.mutate({ phone, provider, amount: parseFloat(amount) || 0, currency: 'USD' })} disabled={topupMutation.isPending || !phone || !amount}>
          {topupMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Send Airtime</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 8 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '${DARK.card}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  providerRow: { marginBottom: 4 }, providerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '${DARK.border}', marginRight: 8 },
  providerBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, providerBtnText: { color: '${DARK.muted}', fontSize: 13 }, providerBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  amountRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, amountBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '${DARK.border}' },
  amountBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, amountBtnText: { color: '${DARK.muted}', fontSize: 14 }, amountBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  submitBtn: { backgroundColor: '${DARK.primary}', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 }, submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
