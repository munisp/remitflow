import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function CardsScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [cardLabel, setCardLabel] = useState('');
  const [cardType, setCardType] = useState<'virtual' | 'physical'>('virtual');

  const { data, isLoading, refetch } = trpc.cards.list.useQuery();
  const createMutation = trpc.cards.create.useMutation({
    onSuccess: () => { setShowCreate(false); setCardLabel(''); refetch(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  const freezeMutation = trpc.cards.freeze.useMutation({ onSuccess: refetch, onError: (e) => Alert.alert('Error', e.message) });
  const unfreezeMutation = trpc.cards.unfreeze.useMutation({ onSuccess: refetch, onError: (e) => Alert.alert('Error', e.message) });
  const deleteMutation = trpc.cards.delete.useMutation({
    onSuccess: refetch,
    onError: (e) => Alert.alert('Error', e.message),
  });

  const handleDelete = (id: number) => {
    Alert.alert('Delete Card', 'Are you sure you want to delete this card?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate({ id }) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Cards</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}>
          <Text style={styles.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {(!data || data.length === 0) && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💳</Text>
              <Text style={styles.emptyText}>No cards yet</Text>
              <Text style={styles.emptySub}>Add a virtual or physical card to get started</Text>
            </View>
          )}
          {data?.map((card: any) => (
            <View key={card.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardType}>{card.type === 'virtual' ? '💳 Virtual' : '🏦 Physical'}</Text>
                <Text style={[styles.cardStatus, card.status === 'active' ? styles.active : styles.frozen]}>
                  {card.status}
                </Text>
              </View>
              <Text style={styles.cardNumber}>{card.maskedNumber ?? '•••• •••• •••• ' + (card.last4 ?? '????')}</Text>
              <Text style={styles.cardLabel}>{card.label ?? 'My Card'}</Text>
              <Text style={styles.cardExpiry}>Expires {card.expiryMonth}/{card.expiryYear}</Text>
              <View style={styles.cardActions}>
                {card.status === 'active' ? (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => freezeMutation.mutate({ id: card.id })}>
                    <Text style={styles.actionBtnText}>❄️ Freeze</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => unfreezeMutation.mutate({ id: card.id })}>
                    <Text style={styles.actionBtnText}>🔥 Unfreeze</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(card.id)}>
                  <Text style={styles.actionBtnText}>🗑️ Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={showCreate} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add New Card</Text>
            <Text style={styles.label}>Card Label</Text>
            <TextInput
              style={styles.input}
              value={cardLabel}
              onChangeText={setCardLabel}
              placeholder="e.g. Travel Card"
              placeholderTextColor="#6b7280"
            />
            <Text style={styles.label}>Card Type</Text>
            <View style={styles.typeRow}>
              {(['virtual', 'physical'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeBtn, cardType === t && styles.typeBtnActive]}
                  onPress={() => setCardType(t)}
                >
                  <Text style={[styles.typeBtnText, cardType === t && styles.typeBtnTextActive]}>
                    {t === 'virtual' ? '💳 Virtual' : '🏦 Physical'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={() => createMutation.mutate({ label: cardLabel, type: cardType, currency: 'USD' })}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Create Card</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  back: { color: '#6366f1', fontSize: 16 },
  title: { color: '#e2e8f0', fontSize: 20, fontWeight: '700' },
  addBtn: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, gap: 16 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#e2e8f0', fontSize: 18, fontWeight: '600' },
  emptySub: { color: '#9ca3af', fontSize: 14, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2d2d4e' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  cardType: { color: '#9ca3af', fontSize: 13 },
  cardStatus: { fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  active: { backgroundColor: '#065f46', color: '#34d399' },
  frozen: { backgroundColor: '#1e3a5f', color: '#60a5fa' },
  cardNumber: { color: '#e2e8f0', fontSize: 18, fontFamily: 'monospace', letterSpacing: 2, marginBottom: 8 },
  cardLabel: { color: '#9ca3af', fontSize: 13, marginBottom: 4 },
  cardExpiry: { color: '#6b7280', fontSize: 12, marginBottom: 16 },
  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, backgroundColor: '#2d2d4e', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  deleteBtn: { backgroundColor: '#3b1a1a' },
  actionBtnText: { color: '#e2e8f0', fontSize: 13, fontWeight: '500' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '#e2e8f0', fontSize: 20, fontWeight: '700', marginBottom: 20 },
  label: { color: '#9ca3af', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 10, padding: 12, color: '#e2e8f0', fontSize: 15 },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2d2d4e', alignItems: 'center' },
  typeBtnActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  typeBtnText: { color: '#9ca3af', fontSize: 14 },
  typeBtnTextActive: { color: '#6366f1', fontWeight: '600' },
  submitBtn: { backgroundColor: '#6366f1', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#9ca3af', fontSize: 15 },
});
