import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const STABLECOINS = ['USDT', 'USDC', 'BUSD', 'DAI', 'NGNT', 'cUSD', 'PYUSD'];
const FIATS = ['USD', 'NGN', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'XOF'];
const CHAINS = ['ethereum', 'polygon', 'bsc', 'solana', 'tron', 'arbitrum', 'optimism', 'base', 'avalanche'];
const BILLERS = ['electricity', 'water', 'internet', 'rent', 'phone', 'insurance', 'tax'];

const COIN_COLORS: Record<string, string> = { USDT: '#26a17b', USDC: '#2775ca', BUSD: '#f0b90b', DAI: '#f5ac37', NGNT: '#22c55e', cUSD: '#14b8a6', PYUSD: '#6366f1' };
const COIN_INFO: Record<string, { name: string; apy: number }> = {
  USDT: { name: 'Tether USD', apy: 4.2 },
  USDC: { name: 'USD Coin', apy: 4.5 },
  BUSD: { name: 'Binance USD', apy: 3.5 },
  DAI: { name: 'Dai', apy: 3.8 },
  NGNT: { name: 'Naira Token', apy: 0 },
  cUSD: { name: 'Celo Dollar', apy: 0 },
  PYUSD: { name: 'PayPal USD', apy: 4.0 },
};

type TabKey = 'onramp' | 'offramp' | 'swap' | 'send' | 'yield' | 'bridge' | 'bill';

export default function StablecoinScreen() {
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<TabKey>('onramp');

  // Queries
  const { data: balances, isLoading, refetch } = trpc.stablecoin.balances.useQuery();

  // Mutations
  const buyMutation = trpc.stablecoin.buyWithFiat.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'On-ramp complete!'); }, onError: (e) => Alert.alert('Error', e.message) });
  const sellMutation = trpc.stablecoin.sellToFiat.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'Off-ramp complete!'); }, onError: (e) => Alert.alert('Error', e.message) });
  const swapMutation = trpc.stablecoin.swap.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'Swap complete!'); }, onError: (e) => Alert.alert('Error', e.message) });
  const sendMutation = trpc.stablecoin.send.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'Sent!'); }, onError: (e) => Alert.alert('Error', e.message) });
  const stakeMutation = trpc.stablecoin.stakeForYield.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'Staked!'); }, onError: (e) => Alert.alert('Error', e.message) });
  const unstakeMutation = trpc.stablecoin.unstake.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'Unstaked!'); }, onError: (e) => Alert.alert('Error', e.message) });
  const bridgeMutation = trpc.stablecoin.bridgeChain.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'Bridge initiated!'); }, onError: (e) => Alert.alert('Error', e.message) });
  const billMutation = trpc.stablecoin.payBill.useMutation({ onSuccess: () => { refetch(); Alert.alert('Success', 'Bill paid!'); }, onError: (e) => Alert.alert('Error', e.message) });

  // Form state
  const [buyFiat, setBuyFiat] = useState('USD');
  const [buyStable, setBuyStable] = useState('USDC');
  const [buyAmt, setBuyAmt] = useState('');
  const [sellStable, setSellStable] = useState('USDC');
  const [sellFiat, setSellFiat] = useState('USD');
  const [sellAmt, setSellAmt] = useState('');
  const [swapFrom, setSwapFrom] = useState('USDT');
  const [swapTo, setSwapTo] = useState('USDC');
  const [swapAmt, setSwapAmt] = useState('');
  const [sendAddr, setSendAddr] = useState('');
  const [sendAmt, setSendAmt] = useState('');
  const [stakeSymbol, setStakeSymbol] = useState('USDC');
  const [stakeAmt, setStakeAmt] = useState('');
  const [bridgeSym, setBridgeSym] = useState('USDC');
  const [bridgeFromChain, setBridgeFromChain] = useState('ethereum');
  const [bridgeToChain, setBridgeToChain] = useState('polygon');
  const [bridgeAmt, setBridgeAmt] = useState('');
  const [billBiller, setBillBiller] = useState('electricity');
  const [billStable, setBillStable] = useState('USDC');
  const [billAcct, setBillAcct] = useState('');
  const [billAmt, setBillAmt] = useState('');
  const [pickerState, setPickerState] = useState<{ visible: boolean; items: string[]; onSelect: (v: string) => void }>({ visible: false, items: [], onSelect: () => {} });

  const totalUSD = (balances ?? []).reduce((s: number, b: any) => s + (b.balance ?? 0), 0);

  const showPicker = (items: string[], onSelect: (v: string) => void) => {
    setPickerState({ visible: true, items, onSelect: (v) => { onSelect(v); setPickerState(p => ({ ...p, visible: false })); } });
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'onramp', label: 'On-Ramp' },
    { key: 'offramp', label: 'Off-Ramp' },
    { key: 'swap', label: 'Swap' },
    { key: 'send', label: 'Send' },
    { key: 'yield', label: 'Yield' },
    { key: 'bridge', label: 'Bridge' },
    { key: 'bill', label: 'Bill Pay' },
  ];

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>{'<'} Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Stablecoins</Text>
        <View style={{ width: 60 }} />
      </View>

      {isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} /> : (
        <>
          {/* Balance Summary */}
          <View style={s.summaryRow}>
            <View>
              <Text style={s.summaryLabel}>Total Balance</Text>
              <Text style={s.summaryValue}>${totalUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
            </View>
            <View style={s.coinCount}>
              <Text style={s.coinCountText}>{(balances ?? []).length} coins</Text>
            </View>
          </View>

          {/* Balance Cards */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.balanceScroll} contentContainerStyle={{ paddingHorizontal: 12 }}>
            {(balances ?? []).map((b: any) => (
              <View key={b.symbol} style={[s.balanceCard, { borderLeftColor: COIN_COLORS[b.symbol] ?? '#6366f1' }]}>
                <Text style={[s.coinSym, { color: COIN_COLORS[b.symbol] ?? '#6366f1' }]}>{b.symbol}</Text>
                <Text style={s.coinBal}>${(b.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Tab Bar */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 12 }}>
            {tabs.map(t => (
              <TouchableOpacity key={t.key} style={[s.tab, activeTab === t.key && s.tabActive]} onPress={() => setActiveTab(t.key)}>
                <Text style={[s.tabText, activeTab === t.key && s.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Tab Content */}
          <ScrollView style={s.content} contentContainerStyle={{ padding: 16 }}>
            {activeTab === 'onramp' && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Buy Stablecoin with Fiat</Text>
                <Text style={s.label}>Fiat Currency</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(FIATS, setBuyFiat)}>
                  <Text style={s.pickerText}>{buyFiat}</Text>
                </TouchableOpacity>
                <Text style={s.label}>Stablecoin</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(STABLECOINS, setBuyStable)}>
                  <Text style={s.pickerText}>{buyStable}</Text>
                </TouchableOpacity>
                <Text style={s.label}>Amount ({buyFiat})</Text>
                <TextInput style={s.input} value={buyAmt} onChangeText={setBuyAmt} placeholder="0.00" placeholderTextColor="#6b7280" keyboardType="numeric" />
                <View style={s.infoRow}>
                  <Text style={s.infoText}>Fee: 0.5% | Provider: Circle / Yellow Card</Text>
                </View>
                <TouchableOpacity style={s.btn} onPress={() => buyMutation.mutate({ fiatCurrency: buyFiat, stablecoin: buyStable, fiatAmount: parseFloat(buyAmt) || 0 })} disabled={buyMutation.isPending}>
                  {buyMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Buy {buyStable}</Text>}
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'offramp' && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Sell Stablecoin to Fiat</Text>
                <Text style={s.label}>Stablecoin</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(STABLECOINS, setSellStable)}>
                  <Text style={s.pickerText}>{sellStable}</Text>
                </TouchableOpacity>
                <Text style={s.label}>Fiat Currency</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(FIATS, setSellFiat)}>
                  <Text style={s.pickerText}>{sellFiat}</Text>
                </TouchableOpacity>
                <Text style={s.label}>Amount ({sellStable})</Text>
                <TextInput style={s.input} value={sellAmt} onChangeText={setSellAmt} placeholder="0.00" placeholderTextColor="#6b7280" keyboardType="numeric" />
                <View style={s.infoRow}>
                  <Text style={s.infoText}>Fee: 0.75%</Text>
                </View>
                <TouchableOpacity style={s.btn} onPress={() => sellMutation.mutate({ stablecoin: sellStable, fiatCurrency: sellFiat, stablecoinAmount: parseFloat(sellAmt) || 0 })} disabled={sellMutation.isPending}>
                  {sellMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sell {sellStable}</Text>}
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'swap' && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Swap Stablecoins</Text>
                <View style={s.row}>
                  <View style={s.halfCol}>
                    <Text style={s.label}>From</Text>
                    <TouchableOpacity style={s.picker} onPress={() => showPicker(STABLECOINS, setSwapFrom)}>
                      <Text style={s.pickerText}>{swapFrom}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.halfCol}>
                    <Text style={s.label}>To</Text>
                    <TouchableOpacity style={s.picker} onPress={() => showPicker(STABLECOINS.filter(c => c !== swapFrom), setSwapTo)}>
                      <Text style={s.pickerText}>{swapTo}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={s.label}>Amount</Text>
                <TextInput style={s.input} value={swapAmt} onChangeText={setSwapAmt} placeholder="0.00" placeholderTextColor="#6b7280" keyboardType="numeric" />
                <View style={s.infoRow}>
                  <Text style={s.infoText}>Fee: 0.2% | Est: ~30 seconds</Text>
                </View>
                <TouchableOpacity style={s.btn} onPress={() => swapMutation.mutate({ from: swapFrom, to: swapTo, amount: parseFloat(swapAmt) || 0 })} disabled={swapMutation.isPending}>
                  {swapMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Swap {swapFrom} → {swapTo}</Text>}
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'send' && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Send Stablecoin</Text>
                <Text style={s.label}>Recipient Address</Text>
                <TextInput style={s.input} value={sendAddr} onChangeText={setSendAddr} placeholder="0x..." placeholderTextColor="#6b7280" />
                <Text style={s.label}>Amount</Text>
                <TextInput style={s.input} value={sendAmt} onChangeText={setSendAmt} placeholder="0.00" placeholderTextColor="#6b7280" keyboardType="numeric" />
                <View style={s.infoRow}>
                  <Text style={s.infoText}>Address validated against sanctions lists</Text>
                </View>
                <TouchableOpacity style={s.btn} onPress={() => sendMutation.mutate({ symbol: 'USDC', toAddress: sendAddr, amount: parseFloat(sendAmt) || 0 })} disabled={sendMutation.isPending}>
                  {sendMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send</Text>}
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'yield' && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>DeFi Yield</Text>
                <View style={[s.infoRow, { marginBottom: 12 }]}>
                  <Text style={s.infoText}>Stake stablecoins in vetted DeFi protocols for yield</Text>
                </View>
                {Object.entries(COIN_INFO).filter(([_, v]) => v.apy > 0).map(([sym, info]) => (
                  <View key={sym} style={s.yieldCard}>
                    <View>
                      <Text style={s.yieldSym}>{sym}</Text>
                      <Text style={s.yieldName}>{info.name}</Text>
                    </View>
                    <View style={s.apyBadge}>
                      <Text style={s.apyText}>{info.apy}% APY</Text>
                    </View>
                  </View>
                ))}
                <Text style={s.label}>Stablecoin</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(STABLECOINS, setStakeSymbol)}>
                  <Text style={s.pickerText}>{stakeSymbol}</Text>
                </TouchableOpacity>
                <Text style={s.label}>Amount</Text>
                <TextInput style={s.input} value={stakeAmt} onChangeText={setStakeAmt} placeholder="0.00" placeholderTextColor="#6b7280" keyboardType="numeric" />
                <View style={s.row}>
                  <TouchableOpacity style={[s.btn, { flex: 1, marginRight: 6 }]} onPress={() => stakeMutation.mutate({ stablecoin: stakeSymbol, amount: parseFloat(stakeAmt) || 0 })} disabled={stakeMutation.isPending}>
                    {stakeMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Stake</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btn, { flex: 1, marginLeft: 6, backgroundColor: '#2d2d4e' }]} onPress={() => unstakeMutation.mutate({ stablecoin: stakeSymbol, amount: parseFloat(stakeAmt) || 0 })} disabled={unstakeMutation.isPending}>
                    {unstakeMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Unstake</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {activeTab === 'bridge' && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Cross-Chain Bridge</Text>
                <Text style={s.label}>Stablecoin</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(STABLECOINS, setBridgeSym)}>
                  <Text style={s.pickerText}>{bridgeSym}</Text>
                </TouchableOpacity>
                <View style={s.row}>
                  <View style={s.halfCol}>
                    <Text style={s.label}>From</Text>
                    <TouchableOpacity style={s.picker} onPress={() => showPicker(CHAINS, setBridgeFromChain)}>
                      <Text style={s.pickerText}>{bridgeFromChain}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.halfCol}>
                    <Text style={s.label}>To</Text>
                    <TouchableOpacity style={s.picker} onPress={() => showPicker(CHAINS.filter(c => c !== bridgeFromChain), setBridgeToChain)}>
                      <Text style={s.pickerText}>{bridgeToChain}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={s.label}>Amount</Text>
                <TextInput style={s.input} value={bridgeAmt} onChangeText={setBridgeAmt} placeholder="0.00" placeholderTextColor="#6b7280" keyboardType="numeric" />
                <View style={s.infoRow}>
                  <Text style={s.infoText}>Fee: 0.1% + gas | Route: Across / Stargate</Text>
                </View>
                <TouchableOpacity style={s.btn} onPress={() => bridgeMutation.mutate({ stablecoin: bridgeSym, fromChain: bridgeFromChain, toChain: bridgeToChain, amount: parseFloat(bridgeAmt) || 0 })} disabled={bridgeMutation.isPending}>
                  {bridgeMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Bridge {bridgeSym}</Text>}
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'bill' && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Pay Bills with Stablecoin</Text>
                <Text style={s.label}>Biller Type</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(BILLERS, setBillBiller)}>
                  <Text style={s.pickerText}>{billBiller}</Text>
                </TouchableOpacity>
                <Text style={s.label}>Account / Reference</Text>
                <TextInput style={s.input} value={billAcct} onChangeText={setBillAcct} placeholder="Account number" placeholderTextColor="#6b7280" />
                <Text style={s.label}>Pay with</Text>
                <TouchableOpacity style={s.picker} onPress={() => showPicker(STABLECOINS, setBillStable)}>
                  <Text style={s.pickerText}>{billStable}</Text>
                </TouchableOpacity>
                <Text style={s.label}>Amount</Text>
                <TextInput style={s.input} value={billAmt} onChangeText={setBillAmt} placeholder="0.00" placeholderTextColor="#6b7280" keyboardType="numeric" />
                <View style={s.infoRow}>
                  <Text style={s.infoText}>Fee: 0.25%</Text>
                </View>
                <TouchableOpacity style={s.btn} onPress={() => billMutation.mutate({ billType: billBiller as any, billerName: billBiller, billerAccountNumber: billAcct, stablecoin: billStable, amount: parseFloat(billAmt) || 0 })} disabled={billMutation.isPending}>
                  {billMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Pay Bill</Text>}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </>
      )}

      {/* Picker Modal */}
      <Modal visible={pickerState.visible} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Select</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {pickerState.items.map(item => (
                <TouchableOpacity key={item} style={s.pickerItem} onPress={() => pickerState.onSelect(item)}>
                  <Text style={s.pickerItemText}>{item}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.cancelModal} onPress={() => setPickerState(p => ({ ...p, visible: false }))}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  back: { color: '#6366f1', fontSize: 16 },
  title: { color: '#e2e8f0', fontSize: 20, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a1a2e' },
  summaryLabel: { color: '#9ca3af', fontSize: 12 },
  summaryValue: { color: '#e2e8f0', fontSize: 24, fontWeight: '800', marginTop: 4 },
  coinCount: { backgroundColor: 'rgba(34,197,94,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  coinCountText: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  balanceScroll: { maxHeight: 72, backgroundColor: '#0f0f1a' },
  balanceCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, marginRight: 8, borderWidth: 1, borderColor: '#2d2d4e', borderLeftWidth: 4, width: 120 },
  coinSym: { fontWeight: '700', fontSize: 14 },
  coinBal: { color: '#e2e8f0', fontWeight: '800', fontSize: 16, marginTop: 4 },
  tabBar: { maxHeight: 44, backgroundColor: '#1a1a2e', borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  tab: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#6366f1' },
  tabText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#6366f1' },
  content: { flex: 1 },
  section: { gap: 12 },
  sectionTitle: { color: '#e2e8f0', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  label: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
  picker: { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 8, padding: 12 },
  pickerText: { color: '#e2e8f0', fontSize: 14 },
  input: { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 8, padding: 12, color: '#e2e8f0', fontSize: 15 },
  infoRow: { backgroundColor: 'rgba(99,102,241,0.05)', borderRadius: 8, padding: 10 },
  infoText: { color: '#9ca3af', fontSize: 11 },
  btn: { backgroundColor: '#6366f1', padding: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12 },
  halfCol: { flex: 1 },
  yieldCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 12, padding: 14, marginBottom: 8 },
  yieldSym: { color: '#e2e8f0', fontWeight: '700', fontSize: 14 },
  yieldName: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  apyBadge: { backgroundColor: 'rgba(34,197,94,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  apyText: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '#e2e8f0', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  pickerItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  pickerItemText: { color: '#e2e8f0', fontSize: 15 },
  cancelModal: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelText: { color: '#9ca3af', fontSize: 15 },
});
