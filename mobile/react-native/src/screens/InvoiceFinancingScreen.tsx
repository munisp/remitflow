import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function InvoiceFinancingScreen() {
  const navigation = useNavigation();
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [clientName, setClientName] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');

  const { data: invoices, isLoading, isError, error, refetch } = trpc.invoiceFinancing.list.useQuery();
  const applyForFinancingMutation = trpc.invoiceFinancing.applyForFinancing.useMutation();

  const handleApplyForFinancing = () => {
    if (!invoiceNumber || !invoiceAmount || !dueDate || !clientName || !advanceAmount) {
      Alert.alert('Error', 'Please fill all fields.');
      return;
    }

    Alert.alert(
      'Confirm Application',
      `Apply for financing for invoice ${invoiceNumber} with advance of $${advanceAmount}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: async () => {
            try {
              await applyForFinancingMutation.mutateAsync({
                invoiceNumber,
                amount: parseFloat(invoiceAmount),
                dueDate,
                clientName,
                advanceAmount: parseFloat(advanceAmount),
              });
              Alert.alert('Success', 'Financing application submitted successfully!');
              setShowApplyModal(false);
              setInvoiceNumber('');
              setInvoiceAmount('');
              setDueDate('');
              setClientName('');
              setAdvanceAmount('');
              refetch(); // Refresh the list
            } catch (err: any) {
              Alert.alert('Error', `Failed to submit application: ${err.message || 'Unknown error'}`);
            }
          },
        },
      ]
    );
  };

  const handleRepayInvoice = (invoiceId: string) => {
    Alert.alert(
      'Confirm Repayment',
      `Are you sure you want to mark invoice ${invoiceId} as repaid?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Repay', onPress: () => Alert.alert('Repay Action', `Invoice ${invoiceId} repaid. (Simulated)`) },
      ]
    );
  };

  const handleApproveRequest = (invoiceId: string) => {
    Alert.alert(
      'Confirm Approval',
      `Are you sure you want to approve the advance request for invoice ${invoiceId}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => Alert.alert('Approve Action', `Request for ${invoiceId} approved. (Simulated)`) },
      ]
    );
  };

  const handleRejectRequest = (invoiceId: string) => {
    Alert.alert(
      'Confirm Rejection',
      `Are you sure you want to reject the advance request for invoice ${invoiceId}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', onPress: () => Alert.alert('Reject Action', `Request for ${invoiceId} rejected. (Simulated)`) },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Invoice Financing</Text>
        <TouchableOpacity onPress={() => setShowApplyModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {isLoading && (
        <View style={styles.centeredView}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading invoices...</Text>
        </View>
      )}

      {isError && (
        <View style={styles.centeredView}>
          <Text style={styles.errorText}>Failed to load invoices: {error?.message}</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && !isError && (!invoices || invoices.length === 0) && (
        <View style={styles.centeredView}>
          <Text style={styles.emptyEmoji}>📊</Text>
          <Text style={styles.emptyText}>No invoices found. Start by applying for financing!</Text>
        </View>
      )}

      {!isLoading && !isError && invoices && invoices.length > 0 && (
        <ScrollView style={styles.scrollViewContent}>
          {invoices.map((invoice: any) => (
            <View key={invoice.id} style={styles.invoiceCard}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Invoice #:</Text>
                <Text style={styles.cardValue}>{invoice.invoiceNumber}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Client:</Text>
                <Text style={styles.cardValue}>{invoice.clientName}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Amount:</Text>
                <Text style={styles.cardValue}>${invoice.amount.toFixed(2)}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Due Date:</Text>
                <Text style={styles.cardValue}>{invoice.dueDate}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Advance:</Text>
                <Text style={styles.cardValue}>${invoice.advanceAmount.toFixed(2)}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Status:</Text>
                <Text style={[styles.cardValue, invoice.status === 'Approved' ? styles.statusApproved : invoice.status === 'Pending' ? styles.statusPending : styles.statusRejected]}>{invoice.status}</Text>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => Alert.alert('View Details', `Details for invoice ${invoice.invoiceNumber}`)} style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>View</Text>
                </TouchableOpacity>
                {invoice.status === 'Approved' && (
                  <TouchableOpacity onPress={() => handleRepayInvoice(invoice.id)} style={[styles.actionButton, styles.repayButton]}>
                    <Text style={styles.actionButtonText}>Repay</Text>
                  </TouchableOpacity>
                )}
                {invoice.status === 'Pending' && (
                  <>
                    <TouchableOpacity onPress={() => handleApproveRequest(invoice.id)} style={[styles.actionButton, styles.approveButton]}>
                      <Text style={styles.actionButtonText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleRejectRequest(invoice.id)} style={[styles.actionButton, styles.rejectButton]}>
                      <Text style={styles.actionButtonText}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showApplyModal}
        onRequestClose={() => setShowApplyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Apply for Invoice Financing</Text>
            <TextInput
              style={styles.input}
              placeholder="Invoice Number"
              placeholderTextColor="#94a3b8"
              value={invoiceNumber}
              onChangeText={setInvoiceNumber}
            />
            <TextInput
              style={styles.input}
              placeholder="Invoice Amount (e.g., 1000.00)"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={invoiceAmount}
              onChangeText={setInvoiceAmount}
            />
            <TextInput
              style={styles.input}
              placeholder="Due Date (YYYY-MM-DD)"
              placeholderTextColor="#94a3b8"
              value={dueDate}
              onChangeText={setDueDate}
            />
            <TextInput
              style={styles.input}
              placeholder="Client Name"
              placeholderTextColor="#94a3b8"
              value={clientName}
              onChangeText={setClientName}
            />
            <TextInput
              style={styles.input}
              placeholder="Advance Amount (e.g., 800.00)"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={advanceAmount}
              onChangeText={setAdvanceAmount}
            />
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleApplyForFinancing}
              disabled={applyForFinancingMutation.isLoading}
            >
              {applyForFinancingMutation.isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Application</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowApplyModal(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
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
  invoiceCard: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  cardValue: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '500',
  },
  statusApproved: {
    color: '#22c55e', // Green
  },
  statusPending: {
    color: '#facc15', // Yellow
  },
  statusRejected: {
    color: '#ef4444', // Red
  },
  cardActions: {
    flexDirection: 'row',
    marginTop: 12,
    justifyContent: 'flex-end',
  },
  actionButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 5,
    marginLeft: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  repayButton: {
    backgroundColor: '#f97316', // Orange
  },
  approveButton: {
    backgroundColor: '#22c55e', // Green
  },
  rejectButton: {
    backgroundColor: '#ef4444', // Red
  },
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    color: '#f1f5f9',
    marginTop: 10,
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 16,
  },
  retryButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    fontSize: 16,
  },
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
    width: '90%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#0f172a',
    color: '#f1f5f9',
    borderRadius: 5,
    padding: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  submitButton: {
    backgroundColor: '#6366f1',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 10,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#334155',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
  },
});
