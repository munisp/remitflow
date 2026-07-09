import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'CNY', 'INR', 'BRL'];

export default function FXAlertsScreen() {
  const navigation = useNavigation();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ fromCurrency: 'USD', toCurrency: 'NGN', targetRate: '', direction: 'above' as 'above' | 'below' });

  const { data: alerts, isLoading, refetch } = trpc.fxAlerts.list.useQuery();
  const { data: rates } = trpc.paymentRails.getLiveRates.useQuery({ baseCurrency: form.fromCurrency });

  const createMutation = trpc.fxAlerts.create.useMutation({
    onSuccess: () => { setShowCreate(false); utils.fxAlerts.list.invalidate(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  const deleteMutation = trpc.fxAlerts.delete.useMutation({
    onSuccess: () => utils.fxAlerts.list.invalidate(),
  });

  const currentRate = rates?.rates?.[form.toCurrency] ?? 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>FX Alerts</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Text style={styles.addBtnText}>+ Alert</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={alerts ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.alertCard}>
              <View style={styles.alertPair}>
                <Text style={styles.alertCurrencies}>{item.fromCurrency}/{item.toCurrency}</Text>
                <View style={[styles.alertBadge, { backgroundColor: item.triggered ? '#10b981' + '20' : '#f59e0b' + '20' }]}>
                  <Text style={[styles.alertBadgeText, { color: item.triggered ? '#10b981' : '#f59e0b' }]}>
                    {item.triggered ? '✓ Triggered' : '⏳ Watching'}
                  </Text>
                </View>
              </View>
              <Text style={styles.alertTarget}>
                {item.direction === 'above' ? '↑ Above' : '↓ Below'} {Number(item.targetRate).toFixed(4)}
              </Text>
              <Text style={styles.alertCreated}>Created {new Date(item.createdAt).toLocaleDateString()}</Text>
              <TouchableOpacity
                style={styles.deleteAlertBtn}
                onPress={() => deleteMutation.mutate({ id: item.id })}
              >
                <Text style={styles.deleteAlertBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📈</Text>
              <Text style={styles.emptyText}>No FX alerts yet</Text>
              <Text style={styles.emptySubText}>Create an alert to get notified when exchange rates hit your target</Text>
            </View>
          }
          onRefresh={refetch}
          refreshing={isLoading}
        />
      )}

      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create FX Alert</Text>

            <Text style={styles.fieldLabel}>From Currency</Text>
            <View style={styles.currencyRow}>
              {CURRENCIES.slice(0, 5).map(c => (
                <TouchableOpacity key={c} style={[styles.currencyChip, form.fromCurrency === c && styles.currencyChipActive]} onPress={() => setForm(f => ({ ...f, fromCurrency: c }))}>
                  <Text style={[styles.currencyChipText, form.fromCurrency === c && styles.currencyChipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>To Currency</Text>
            <View style={styles.currencyRow}>
              {CURRENCIES.slice(5).map(c => (
                <TouchableOpacity key={c} style={[styles.currencyChip, form.toCurrency === c && styles.currencyChipActive]} onPress={() => setForm(f => ({ ...f, toCurrency: c }))}>
                  <Text style={[styles.currencyChipText, form.toCurrency === c && styles.currencyChipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.currentRateText}>Current: 1 {form.fromCurrency} = {currentRate.toFixed(4)} {form.toCurrency}</Text>

            <Text style={styles.fieldLabel}>Alert Direction</Text>
            <View style={styles.directionRow}>
              {(['above', 'below'] as const).map(d => (
                <TouchableOpacity key={d} style={[styles.directionBtn, form.direction === d && styles.directionBtnActive]} onPress={() => setForm(f => ({ ...f, direction: d }))}>
                  <Text style={[styles.directionBtnText, form.direction === d && styles.directionBtnTextActive]}>
                    {d === 'above' ? '↑ Above' : '↓ Below'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Target Rate</Text>
            <TextInput
              style={styles.input}
              value={form.targetRate}
              onChangeText={(v) => setForm(f => ({ ...f, targetRate: v }))}
              placeholder={currentRate.toFixed(4)}
              placeholderTextColor="#6b7280"
              keyboardType="decimal-pad"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => createMutation.mutate({ ...form, targetRate: parseFloat(form.targetRate) })}
                disabled={createMutation.isPending || !form.targetRate}
              >
                {createMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Create Alert</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 56, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  backText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  addBtn: { backgroundColor: '#6366f1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  alertCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#2d2d4e' },
  alertPair: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  alertCurrencies: { color: '#fff', fontSize: 18, fontWeight: '700' },
  alertBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  alertBadgeText: { fontSize: 12, fontWeight: '600' },
  alertTarget: { color: '#e2e8f0', fontSize: 14, marginBottom: 4 },
  alertCreated: { color: '#6b7280', fontSize: 12, marginBottom: 8 },
  deleteAlertBtn: { alignSelf: 'flex-end' },
  deleteAlertBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#e2e8f0', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySubText: { color: '#6b7280', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 16 },
  fieldLabel: { color: '#9ca3af', fontSize: 13, marginBottom: 8, marginTop: 12 },
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  currencyChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2d2d4e' },
  currencyChipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  currencyChipText: { color: '#9ca3af', fontSize: 13 },
  currencyChipTextActive: { color: '#fff' },
  currentRateText: { color: '#10b981', fontSize: 13, marginTop: 8 },
  directionRow: { flexDirection: 'row', gap: 12 },
  directionBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2d2d4e', alignItems: 'center' },
  directionBtnActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  directionBtnText: { color: '#9ca3af', fontWeight: '600' },
  directionBtnTextActive: { color: '#fff' },
  input: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2d2d4e' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, backgroundColor: '#0f0f1a', borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtnText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#6366f1', borderRadius: 12, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
