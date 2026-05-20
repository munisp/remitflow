import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function StablecoinScreen() {
  const navigation = useNavigation();
  const [showSwap, setShowSwap] = useState(false);
  const [form, setForm] = useState({ fromSymbol: 'USDT', toSymbol: 'USDC', amount: '' });
  const { data: balances, isLoading, refetch } = trpc.stablecoin.balances.useQuery();
  const swapMutation = trpc.stablecoin.swap.useMutation({ onSuccess: () => { setShowSwap(false); refetch(); Alert.alert('Success', 'Swap completed'); }, onError: (e) => Alert.alert('Error', e.message) });
  const COIN_COLORS: Record<string, string> = { USDT: '#26a17b', USDC: '#2775ca', cUSD: '#35d07f', DAI: '#f5ac37' };
  const SYMBOLS = ['USDT', 'USDC', 'cUSD', 'DAI'];
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>Stablecoin Wallet</Text><TouchableOpacity onPress={() => setShowSwap(true)}><Text style={s.addBtn}>⇄ Swap</Text></TouchableOpacity></View>
      {isLoading ? <ActivityIndicator color="${DARK.primary}" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          {(!balances || balances.length === 0) && <View style={s.empty}><Text style={s.emptyIcon}>🪙</Text><Text style={s.emptyText}>No stablecoin wallets</Text><Text style={s.emptySub}>Your USDT, USDC, and cUSD balances will appear here</Text></View>}
          {balances?.map((b: any) => (
            <View key={b.symbol} style={[s.coinCard, { borderLeftColor: COIN_COLORS[b.symbol] ?? '${DARK.primary}' }]}>
              <View style={s.coinHeader}><Text style={s.coinSymbol}>{b.symbol}</Text><Text style={s.coinName}>{b.name ?? b.symbol}</Text></View>
              <Text style={s.coinBalance}>{Number(b.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text>
              <Text style={s.coinUSD}>≈ USD {Number(b.usdValue ?? b.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={showSwap} transparent animationType="slide">
        <View style={s.overlay}><View style={s.modal}>
          <Text style={s.modalTitle}>Swap Stablecoins</Text>
          <Text style={s.label}>From</Text>
          <View style={s.symbolRow}>{SYMBOLS.map((sym) => (<TouchableOpacity key={sym} style={[s.symBtn, form.fromSymbol === sym && s.symBtnActive]} onPress={() => setForm((f) => ({ ...f, fromSymbol: sym }))}><Text style={[s.symBtnText, form.fromSymbol === sym && s.symBtnTextActive]}>{sym}</Text></TouchableOpacity>))}</View>
          <Text style={s.label}>To</Text>
          <View style={s.symbolRow}>{SYMBOLS.filter((s) => s !== form.fromSymbol).map((sym) => (<TouchableOpacity key={sym} style={[s.symBtn, form.toSymbol === sym && s.symBtnActive]} onPress={() => setForm((f) => ({ ...f, toSymbol: sym }))}><Text style={[s.symBtnText, form.toSymbol === sym && s.symBtnTextActive]}>{sym}</Text></TouchableOpacity>))}</View>
          <Text style={s.label}>Amount</Text><TextInput style={s.input} value={form.amount} onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="100" placeholderTextColor="${DARK.dim}" keyboardType="numeric" />
          <TouchableOpacity style={s.submit} onPress={() => swapMutation.mutate({ fromSymbol: form.fromSymbol, toSymbol: form.toSymbol, amount: parseFloat(form.amount) || 0 })} disabled={swapMutation.isPending}>{swapMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Swap</Text>}</TouchableOpacity>
          <TouchableOpacity style={s.cancelModal} onPress={() => setShowSwap(false)}><Text style={s.cancelModalText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${DARK.bg}' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '${DARK.border}' },
  back: { color: '${DARK.primary}', fontSize: 16 }, title: { color: '${DARK.text}', fontSize: 20, fontWeight: '700' }, addBtn: { color: '${DARK.primary}', fontSize: 16, fontWeight: '600' },
  content: { padding: 16, gap: 16 }, empty: { alignItems: 'center', paddingTop: 60 }, emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyText: { color: '${DARK.text}', fontSize: 18, fontWeight: '600' }, emptySub: { color: '${DARK.muted}', fontSize: 14, marginTop: 4, textAlign: 'center' },
  coinCard: { backgroundColor: '${DARK.card}', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '${DARK.border}', borderLeftWidth: 4 }, coinHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coinSymbol: { color: '${DARK.text}', fontSize: 18, fontWeight: '700' }, coinName: { color: '${DARK.muted}', fontSize: 13 }, coinBalance: { color: '${DARK.text}', fontSize: 26, fontWeight: '800', marginBottom: 4 }, coinUSD: { color: '${DARK.muted}', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }, modal: { backgroundColor: '${DARK.card}', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '${DARK.text}', fontSize: 20, fontWeight: '700', marginBottom: 16 }, label: { color: '${DARK.muted}', fontSize: 13, marginBottom: 6, marginTop: 12 },
  symbolRow: { flexDirection: 'row', gap: 8 }, symBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '${DARK.border}', alignItems: 'center' },
  symBtnActive: { borderColor: '${DARK.primary}', backgroundColor: '#1e1b4b' }, symBtnText: { color: '${DARK.muted}', fontSize: 13 }, symBtnTextActive: { color: '${DARK.primary}', fontWeight: '600' },
  input: { backgroundColor: '${DARK.bg}', borderWidth: 1, borderColor: '${DARK.border}', borderRadius: 10, padding: 12, color: '${DARK.text}', fontSize: 15 },
  submit: { backgroundColor: '${DARK.primary}', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 }, cancelModalText: { color: '${DARK.muted}', fontSize: 15 },
});
