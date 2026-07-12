import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { DARK } from '../theme/dark';

const CATEGORIES = [
  { id: 'electricity', label: '⚡ Electricity', icon: '⚡' },
  { id: 'water', label: '💧 Water', icon: '💧' },
  { id: 'internet', label: '🌐 Internet', icon: '🌐' },
  { id: 'tv', label: '📺 TV / DSTV', icon: '📺' },
  { id: 'phone', label: '📱 Phone', icon: '📱' },
  { id: 'school', label: '🎓 School Fees', icon: '🎓' },
];

export default function BillPaymentScreen() {
  const navigation = useNavigation();
  const [category, setCategory] = useState('electricity');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const { data: bills } = trpc.bills.list.useQuery();
  const payMutation = trpc.bills.pay.useMutation({
    onSuccess: () => { Alert.alert('Success', 'Bill paid successfully!'); setAccountNumber(''); setAmount(''); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Bill Payment</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.sectionTitle}>Select Category</Text>
        <View style={s.categoryGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity key={cat.id} style={[s.catBtn, category === cat.id && s.catBtnActive]} onPress={() => setCategory(cat.id)}>
              <Text style={s.catIcon}>{cat.icon}</Text>
              <Text style={[s.catLabel, category === cat.id && s.catLabelActive]}>{cat.label.replace(cat.icon + ' ', '')}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>Account / Meter Number</Text>
        <TextInput style={s.input} value={accountNumber} onChangeText={setAccountNumber} placeholder="Enter account number" placeholderTextColor={DARK.dim} keyboardType="numeric" />
        <Text style={s.label}>Amount (USD)</Text>
        <TextInput style={s.input} value={amount} onChangeText={setAmount} placeholder="50" placeholderTextColor={DARK.dim} keyboardType="numeric" />
        <TouchableOpacity style={s.payBtn} onPress={() => payMutation.mutate({ category, accountNumber, amount: parseFloat(amount) || 0, currency: 'USD' })} disabled={payMutation.isPending || !accountNumber || !amount}>
          {payMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.payBtnText}>Pay Bill</Text>}
        </TouchableOpacity>
        {bills && bills.length > 0 && (
          <View style={s.historyCard}>
            <Text style={s.historyTitle}>Recent Payments</Text>
            {bills.slice(0, 5).map((b: any) => (
              <View key={b.id} style={s.historyRow}>
                <Text style={s.historyLabel}>{b.category} — {b.accountNumber}</Text>
                <Text style={s.historyAmount}>{b.currency} {Number(b.amount).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK.bg }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: DARK.border },
  back: { color: DARK.primary, fontSize: 16 }, title: { color: DARK.text, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 8 }, sectionTitle: { color: DARK.text, fontSize: 15, fontWeight: '600', marginBottom: 8 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }, catBtn: { width: '30%', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: DARK.border, alignItems: 'center', backgroundColor: DARK.card },
  catBtnActive: { borderColor: DARK.primary, backgroundColor: '#1e1b4b' }, catIcon: { fontSize: 24, marginBottom: 4 }, catLabel: { color: DARK.muted, fontSize: 11, textAlign: 'center' }, catLabelActive: { color: DARK.primary, fontWeight: '600' },
  label: { color: DARK.muted, fontSize: 13, marginBottom: 6, marginTop: 12 }, input: { backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border, borderRadius: 10, padding: 12, color: DARK.text, fontSize: 15 },
  payBtn: { backgroundColor: DARK.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 }, payBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  historyCard: { backgroundColor: DARK.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: DARK.border, marginTop: 16 }, historyTitle: { color: DARK.text, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: DARK.border }, historyLabel: { color: DARK.muted, fontSize: 13 }, historyAmount: { color: DARK.primary, fontSize: 13, fontWeight: '600' },
});
