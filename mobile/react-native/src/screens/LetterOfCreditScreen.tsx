import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function LetterOfCreditScreen() {
  const navigation = useNavigation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newLcDetails, setNewLcDetails] = useState({
    applicant: '',
    beneficiary: '',
    amount: '',
    currency: '',
    issueDate: '',
    expiryDate: '',
    documentsRequired: '',
  });

  const { data: lcs, isLoading, isError, error, refetch } = trpc.letterOfCredit.list.useQuery();
  const createLcMutation = trpc.letterOfCredit.open.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Letter of Credit opened successfully!');
      setShowCreateModal(false);
      setNewLcDetails({
        applicant: '',
        beneficiary: '',
        amount: '',
        currency: '',
        issueDate: '',
        expiryDate: '',
        documentsRequired: '',
      });
      refetch();
    },
    onError: (err) => {
      Alert.alert('Error', `Failed to open Letter of Credit: ${err.message}`);
    },
  });

  const handleCreateLc = () => {
    if (!newLcDetails.applicant || !newLcDetails.beneficiary || !newLcDetails.amount || !newLcDetails.currency) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }
    createLcMutation.mutate(newLcDetails);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Letters of Credit</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {isLoading && (
        <View style={styles.centeredView}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading Letters of Credit...</Text>
        </View>
      )}

      {isError && (
        <View style={styles.centeredView}>
          <Text style={styles.errorText}>Error: {error?.message}</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && !isError && (!lcs || lcs.length === 0) && (
        <View style={styles.centeredView}>
          <Text style={styles.emptyStateEmoji}>📄</Text>
          <Text style={styles.emptyStateText}>No Letters of Credit found. Create a new one!</Text>
        </View>
      )}

      {!isLoading && !isError && lcs && lcs.length > 0 && (
        <ScrollView style={styles.scrollView}>
          {lcs.map((lc) => (
            <View key={lc.id} style={styles.card}>
              <Text style={styles.cardTitle}>LC #{lc.id}</Text>
              <Text style={styles.cardText}><Text style={styles.cardLabel}>Applicant:</Text> {lc.applicant}</Text>
              <Text style={styles.cardText}><Text style={styles.cardLabel}>Beneficiary:</Text> {lc.beneficiary}</Text>
              <Text style={styles.cardText}><Text style={styles.cardLabel}>Amount:</Text> {lc.currency} {lc.amount}</Text>
              <Text style={styles.cardText}><Text style={styles.cardLabel}>Status:</Text> {lc.status}</Text>
              <View style={styles.cardActions}>
                {lc.status === 'Pending Approval' && (
                  <>
                    <TouchableOpacity onPress={() => Alert.alert('Approve LC', `Are you sure you want to approve LC #${lc.id}?`, [{ text: 'Cancel' }, { text: 'Approve', onPress: () => console.log('Approve LC', lc.id) }])} style={[styles.actionButton, styles.approveButton]}>
                      <Text style={styles.actionButtonText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Alert.alert('Reject LC', `Are you sure you want to reject LC #${lc.id}?`, [{ text: 'Cancel' }, { text: 'Reject', onPress: () => console.log('Reject LC', lc.id) }])} style={[styles.actionButton, styles.rejectButton]}>
                      <Text style={styles.actionButtonText}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity onPress={() => Alert.alert('View Details', `Details for LC #${lc.id}`)} style={[styles.actionButton, styles.viewDetailsButton]}>
                  <Text style={styles.actionButtonText}>View Details</Text>
                </TouchableOpacity>
              </View>
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
            <Text style={styles.modalTitle}>Open New Letter of Credit</Text>
            <TextInput
              style={styles.input}
              placeholder="Applicant Name"
              placeholderTextColor="#94a3b8"
              value={newLcDetails.applicant}
              onChangeText={(text) => setNewLcDetails({ ...newLcDetails, applicant: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="Beneficiary Name"
              placeholderTextColor="#94a3b8"
              value={newLcDetails.beneficiary}
              onChangeText={(text) => setNewLcDetails({ ...newLcDetails, beneficiary: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="Amount"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={newLcDetails.amount}
              onChangeText={(text) => setNewLcDetails({ ...newLcDetails, amount: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="Currency (e.g., USD)"
              placeholderTextColor="#94a3b8"
              value={newLcDetails.currency}
              onChangeText={(text) => setNewLcDetails({ ...newLcDetails, currency: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="Issue Date (YYYY-MM-DD)"
              placeholderTextColor="#94a3b8"
              value={newLcDetails.issueDate}
              onChangeText={(text) => setNewLcDetails({ ...newLcDetails, issueDate: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="Expiry Date (YYYY-MM-DD)"
              placeholderTextColor="#94a3b8"
              value={newLcDetails.expiryDate}
              onChangeText={(text) => setNewLcDetails({ ...newLcDetails, expiryDate: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="Documents Required"
              placeholderTextColor="#94a3b8"
              value={newLcDetails.documentsRequired}
              onChangeText={(text) => setNewLcDetails({ ...newLcDetails, documentsRequired: text })}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowCreateModal(false)} style={[styles.modalButton, styles.cancelButton]}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateLc} style={[styles.modalButton, styles.createButton]}>
                <Text style={styles.modalButtonText}>Create LC</Text>
              </TouchableOpacity>
            </View>
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
  scrollView: { flex: 1, padding: 16 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#f1f5f9', marginBottom: 4 },
  cardLabel: { fontWeight: '600', color: '#94a3b8' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  actionButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 5, marginLeft: 10 },
  actionButtonText: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  approveButton: { backgroundColor: '#22c55e' }, // Green
  rejectButton: { backgroundColor: '#ef4444' }, // Red
  viewDetailsButton: { backgroundColor: '#6366f1' }, // Accent color
  centeredView: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#f1f5f9', marginTop: 10, fontSize: 16 },
  errorText: { color: '#ef4444', fontSize: 16, marginBottom: 10, textAlign: 'center' },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5 },
  retryButtonText: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  emptyStateEmoji: { fontSize: 60, marginBottom: 10 },
  emptyStateText: { color: '#94a3b8', fontSize: 16, textAlign: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)' },
  modalContent: { backgroundColor: '#1e293b', borderRadius: 10, padding: 20, width: '90%', maxHeight: '80%' },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 5, padding: 12, color: '#f1f5f9', marginBottom: 15, backgroundColor: '#0f172a' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20 },
  modalButton: { paddingVertical: 12, paddingHorizontal: 25, borderRadius: 8, flex: 1, marginHorizontal: 5, alignItems: 'center' },
  modalButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  cancelButton: { backgroundColor: '#475569' },
  createButton: { backgroundColor: '#6366f1' },
});
