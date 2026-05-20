import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function BusinessSavingsScreen() {
  const navigation = useNavigation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const { data: accounts, isLoading, isError, error, refetch } = trpc.businessSavings.list.useQuery();
  const openAccountMutation = trpc.businessSavings.openAccount.useMutation();
  const depositMutation = trpc.businessSavings.deposit.useMutation();

  const handleOpenAccount = () => {
    if (!newAccountName) {
      Alert.alert('Error', 'Account name cannot be empty.');
      return;
    }
    openAccountMutation.mutate({ name: newAccountName }, {
      onSuccess: () => {
        Alert.alert('Success', 'New savings account opened!');
        setNewAccountName('');
        setShowCreateModal(false);
        refetch();
      },
      onError: (err) => {
        Alert.alert('Error', err.message);
      },
    });
  };

  const handleDeposit = () => {
    if (!selectedAccountId || !depositAmount) {
      Alert.alert('Error', 'Please select an account and enter a deposit amount.');
      return;
    }
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid deposit amount.');
      return;
    }
    depositMutation.mutate({ accountId: selectedAccountId, amount }, {
      onSuccess: () => {
        Alert.alert('Success', `Successfully deposited $${amount.toFixed(2)}`);
        setDepositAmount('');
        setSelectedAccountId(null);
        refetch();
      },
      onError: (err) => {
        Alert.alert('Error', err.message);
      },
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Business Savings</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {isLoading && (
        <View style={styles.centeredMessage}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.mutedText}>Loading savings accounts...</Text>
        </View>
      )}

      {isError && (
        <View style={styles.centeredMessage}>
          <Text style={styles.errorText}>Failed to load accounts: {error?.message}</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && !isError && (!accounts || accounts.length === 0) && (
        <View style={styles.centeredMessage}>
          <Text style={styles.emptyStateEmoji}>🏦</Text>
          <Text style={styles.mutedText}>No business savings accounts found. Open a new one!</Text>
        </View>
      )}

      {!isLoading && !isError && accounts && accounts.length > 0 && (
        <ScrollView style={styles.scrollViewContent}>
          {accounts.map((account) => (
            <View key={account.id} style={styles.card}>
              <Text style={styles.cardTitle}>{account.name}</Text>
              <Text style={styles.cardBalance}>Balance: ${account.balance.toFixed(2)}</Text>
              <Text style={styles.cardText}>Type: {account.type}</Text>
              <Text style={styles.cardText}>Interest Rate: {account.interestRate}%</Text>
              <TouchableOpacity
                onPress={() => {
                  setSelectedAccountId(account.id);
                  setShowCreateModal(true);
                }}
                style={styles.depositButton}
              >
                <Text style={styles.depositButtonText}>Deposit</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{selectedAccountId ? 'Deposit Funds' : 'Open New Account'}</Text>
            {selectedAccountId ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Deposit Amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  value={depositAmount}
                  onChangeText={setDepositAmount}
                />
                <TouchableOpacity onPress={handleDeposit} style={styles.modalButton}>
                  <Text style={styles.modalButtonText}>Confirm Deposit</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Account Name"
                  placeholderTextColor="#94a3b8"
                  value={newAccountName}
                  onChangeText={setNewAccountName}
                />
                <TouchableOpacity onPress={handleOpenAccount} style={styles.modalButton}>
                  <Text style={styles.modalButtonText}>Open Account</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity onPress={() => {
              setShowCreateModal(false);
              setSelectedAccountId(null);
              setNewAccountName('');
              setDepositAmount('');
            }} style={[styles.modalButton, styles.modalCancelButton]}>
              <Text style={styles.modalButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  title: { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  back: { color: '#6366f1', fontSize: 14 },
  addBtn: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
  scrollViewContent: { padding: 16 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9', marginBottom: 4 },
  cardBalance: { fontSize: 18, fontWeight: '700', color: '#6366f1', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#f1f5f9', marginBottom: 2 },
  centeredMessage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  mutedText: { color: '#94a3b8', fontSize: 16, textAlign: 'center' },
  errorText: { color: '#ef4444', fontSize: 16, textAlign: 'center', marginBottom: 10 },
  emptyStateEmoji: { fontSize: 40, marginBottom: 10 },
  retryButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
    marginTop: 10,
  },
  retryButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 20,
    width: '80%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 20 },
  input: {
    width: '100%',
    backgroundColor: '#0f172a',
    color: '#f1f5f9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
  },
  modalButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  modalCancelButton: {
    backgroundColor: '#475569',
    marginTop: 10,
  },
  depositButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 5,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  depositButtonText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
});
