import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { DARK } from '../theme/dark';

export default function BillPaymentScreen() {
  const navigation = useNavigation();
  const [category, setCategory] = useState('');
  const [provider, setProvider] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  // wave16 C2: bills.list does not exist on the mounted surface (routers.ts:4054-4092 has
  // only categories/pay; billsV2 has billers/validateAccount/pay — no list anywhere).
  // The phantom "Recent Payments" history is removed (fail closed); the category grid now
  // consumes the mounted bills.categories so provider selection matches the pay schema.
  const { data: categories, isLoading: loadingCategories, error: categoriesError, refetch: refetchCategories } = trpc.bills.categories.useQuery();
  const payMutation = trpc.bills.pay.useMutation({
    onSuccess: () => { Alert.alert('Success', 'Bill paid successfully!'); setAccountNumber(''); setAmount(''); },
    onError: (e: any) => Alert.alert('Error', e.message),
  });
  const selectedCategory = (categories ?? []).find((c: any) => c.id === category);
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Bill Payment</Text><View /></View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.sectionTitle}>Select Category</Text>
        {loadingCategories ? (
          <ActivityIndicator color={DARK.primary} style={{ marginVertical: 12 }} />
        ) : categoriesError ? (
          <View style={s.historyCard}>
            <Text style={s.historyTitle}>Bill categories are unavailable right now.</Text>
            <TouchableOpacity onPress={() => refetchCategories()}><Text style={[s.historyLabel, { color: DARK.primary }]}>Retry</Text></TouchableOpacity>
          </View>
        ) : (
          <View style={s.categoryGrid}>
            {(categories ?? []).map((cat: any) => (
              <TouchableOpacity key={cat.id} style={[s.catBtn, category === cat.id && s.catBtnActive]} onPress={() => { setCategory(cat.id); setProvider(''); }}>
                <Text style={s.catIcon}>{cat.icon}</Text>
                <Text style={[s.catLabel, category === cat.id && s.catLabelActive]}>{cat.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {selectedCategory && (
          <>
            <Text style={s.label}>Provider</Text>
            <View style={s.categoryGrid}>
              {(selectedCategory.providers ?? []).map((p: string) => (
                <TouchableOpacity key={p} style={[s.catBtn, provider === p && s.catBtnActive]} onPress={() => setProvider(p)}>
                  <Text style={[s.catLabel, provider === p && s.catLabelActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <Text style={s.label}>Account / Meter Number</Text>
        <TextInput style={s.input} value={accountNumber} onChangeText={setAccountNumber} placeholder="Enter account number" placeholderTextColor={DARK.dim} keyboardType="numeric" />
        <Text style={s.label}>Amount (USD)</Text>
        <TextInput style={s.input} value={amount} onChangeText={setAmount} placeholder="50" placeholderTextColor={DARK.dim} keyboardType="numeric" />
        <TouchableOpacity style={s.payBtn} onPress={() => payMutation.mutate({ category, provider, accountNumber, amount: parseFloat(amount) || 0, currency: 'USD' })} disabled={payMutation.isPending || !category || !provider || !accountNumber || !amount}>
          {payMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.payBtnText}>Pay Bill</Text>}
        </TouchableOpacity>
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
