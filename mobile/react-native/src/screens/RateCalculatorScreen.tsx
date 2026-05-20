import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'CNY', 'INR', 'BRL', 'CAD', 'AUD'];

export default function RateCalculatorScreen() {
  const navigation = useNavigation();
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('NGN');
  const [amount, setAmount] = useState('100');
  const { data: calcResult, isLoading } = trpc.fx.calculate.useQuery({ from, to, amount: parseFloat(amount) || 0 }, { enabled: !!amount && parseFloat(amount) > 0 });
  const { data: rates } = trpc.fx.rates.useQuery({ baseCurrency: from });
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Rate Calculator</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <Text style={s.label}>You Send</Text>
          <View style={s.inputRow}>
            <TextInput style={s.amountInput} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholderTextColor="${DARK.dim}" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.currScroll}>
              {CURRENCIES.map((c) => (<TouchableOpacity key={c} style={[s.currBtn, from === c && s.currBtnActive]} onPress={() => setFrom(c)}><Text style={[s.currBtnText, from === c && s.currBtnTextActive]}>{c}</Text></TouchableOpacity>))}
            </ScrollView>
          </View>
          <View style={s.divider}><Text style={s.dividerText}>⇅</Text></View>
          <Text style={s.label}>Recipient Gets</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.currScroll}>
            {CURRENCIES.map((c) => (<TouchableOpacity key={c} style={[s.currBtn, to === c && s.currBtnActive]} onPress={() => setTo(c)}><Text style={[s.currBtnText, to === c && s.currBtnTextActive]}>{c}</Text></TouchableOpacity>))}
          </ScrollView>
          {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 20 }} /> : calcResult ? (
            <View style={s.result}>
              <Text style={s.resultAmount}>{to} {Number(calcResult.convertedAmount ?? calcResult.result ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              <Text style={s.resultRate}>1 {from} = {Number(calcResult.rate ?? (rates?.rates?.[to] ?? 0)).toFixed(4)} {to}</Text>
              <Text style={s.resultFee}>Fee: {from} {Number(calcResult.fee ?? 0).toFixed(2)}</Text>
            </View>
          ) : null}
        </View>
        {rates?.rates && (
          <View style={s.ratesCard}>
            <Text style={s.ratesTitle}>Live Rates (base: {from})</Text>
            {Object.entries(rates.rates).slice(0, 10).map(([currency, rate]) => (
              <View key={currency} style={s.rateRow}><Text style={s.rateCurrency}>{currency}</Text><Text style={s.rateValue}>{Number(rate).toFixed(4)}</Text></View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6 },
  card: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '${DARK.border}' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  amountInput: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 20, fontWeight: '700', width: 120 },
  currScroll: { flex: 1 }, currBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '${DARK.border}', marginRight: 6 },
  currBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, currBtnText: { color: '${DARK.muted}', fontSize: 13 }, currBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  divider: { alignItems: 'center', paddingVertical: 12 }, dividerText: { color: '${DARK.primary}', fontSize: 24 },
  result: { marginTop: 16, padding: 16, backgroundColor: '${DARK.bg}', borderRadius: 12, alignItems: 'center' },
  resultAmount: { color: '${DARK.primary}', fontSize: 28, fontWeight: '800', marginBottom: 4 }, resultRate: { color: '${DARK.muted}', fontSize: 14, marginBottom: 4 }, resultFee: { color: '${DARK.dim}', fontSize: 13 },
  ratesCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '${DARK.border}' }, ratesTitle: { color: '${DARK.text}', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' }, rateCurrency: { color: '${DARK.text}', fontSize: 14 }, rateValue: { color: '${DARK.primary}', fontSize: 14, fontWeight: '600' },
});
