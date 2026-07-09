import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

// Define types for invoice and form data
interface Invoice {
  id: string;
  invoiceNumber: string;
  contractorName: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Paid';
  description?: string;
  bankDetails: string;
  taxInfo: string;
}

export default function ContractorPaymentsScreen() {
  const navigation = useNavigation();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newInvoiceNumber, setNewInvoiceNumber] = useState('');
  const [newContractorName, setNewContractorName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCurrency, setNewCurrency] = useState('USD');
  const [newDueDate, setNewDueDate] = useState(''); // YYYY-MM-DD
  const [newDescription, setNewDescription] = useState('');
  const [newBankDetails, setNewBankDetails] = useState('');
  const [newTaxInfo, setNewTaxInfo] = useState('');

  // tRPC queries and mutations
  const { data: invoices, isLoading, isError, error, refetch } = trpc.contractorPayments.listInvoices.useQuery();
  const submitInvoiceMutation = trpc.contractorPayments.submitInvoice.useMutation();

  const handleCreateInvoice = () => {
    if (!newInvoiceNumber || !newContractorName || !newAmount || !newDueDate || !newBankDetails || !newTaxInfo) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }

    Alert.alert(
      'Confirm Submission',
      'Are you sure you want to submit this invoice?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            try {
              await submitInvoiceMutation.mutateAsync({
                invoiceNumber: newInvoiceNumber,
                contractorName: newContractorName,
                amount: parseFloat(newAmount),
                currency: newCurrency,
                dueDate: newDueDate,
                description: newDescription,
                bankDetails: newBankDetails,
                taxInfo: newTaxInfo,
              });
              Alert.alert('Success', 'Invoice submitted successfully!');
              setShowCreateModal(false);
              resetForm();
              refetch(); // Refresh the list of invoices
            } catch (err: any) {
              Alert.alert('Error', `Failed to submit invoice: ${err.message || 'Unknown error'}`);
            }
          },
        },
      ]
    );
  };

  const resetForm = () => {
    setNewInvoiceNumber('');
    setNewContractorName('');
    setNewAmount('');
    setNewCurrency('USD');
    setNewDueDate('');
    setNewDescription('');
    setNewBankDetails('');
    setNewTaxInfo('');
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.centeredView}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.mutedText}>Loading invoices...</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.centeredView}>
          <Text style={styles.errorText}>Failed to load invoices: {error?.message}</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!invoices || invoices.length === 0) {
      return (
        <View style={styles.centeredView}>
          <Text style={styles.emptyEmoji}>🧾</Text>
          <Text style={styles.emptyText}>No invoices found. Submit a new one!</Text>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        {invoices.map((invoice) => (
          <View key={invoice.id} style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Invoice #:</Text>
              <Text style={styles.cardValue}>{invoice.invoiceNumber}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Contractor:</Text>
              <Text style={styles.cardValue}>{invoice.contractorName}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Amount:</Text>
              <Text style={styles.cardValue}>{invoice.currency} {invoice.amount.toFixed(2)}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Due Date:</Text>
              <Text style={styles.cardValue}>{invoice.dueDate}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Status:</Text>
              <Text style={[styles.cardValue, { color: invoice.status === 'Paid' ? '#34d399' : invoice.status === 'Approved' ? '#a78bfa' : invoice.status === 'Rejected' ? '#ef4444' : '#facc15' }]}>{invoice.status}</Text>
            </View>
            {invoice.description && (
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Description:</Text>
                <Text style={styles.cardValue}>{invoice.description}</Text>
              </View>
            )}
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Bank Details:</Text>
              <Text style={styles.cardValue}>{invoice.bankDetails}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Tax Info:</Text>
              <Text style={styles.cardValue}>{invoice.taxInfo}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Contractor Payments</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {renderContent()}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateModal}
        onRequestClose={() => {
          Alert.alert('Modal has been closed.');
          setShowCreateModal(!showCreateModal);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalView}>
            <Text style={styles.modalTitle}>Submit New Invoice</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Invoice Number"
              value={newInvoiceNumber}
              onChangeText={setNewInvoiceNumber}
            />
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Contractor Name"
              value={newContractorName}
              onChangeText={setNewContractorName}
            />
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Amount (e.g., 123.45)"
              keyboardType="numeric"
              value={newAmount}
              onChangeText={setNewAmount}
            />
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Currency (e.g., USD)"
              value={newCurrency}
              onChangeText={setNewCurrency}
            />
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Due Date (YYYY-MM-DD)"
              value={newDueDate}
              onChangeText={setNewDueDate}
            />
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Description (Optional)"
              value={newDescription}
              onChangeText={setNewDescription}
              multiline
            />
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Bank Details (Account, Routing)"
              value={newBankDetails}
              onChangeText={setNewBankDetails}
            />
            <TextInput
              style={styles.input}
              placeholderTextColor="#94a3b8"
              placeholder="Tax Info (EIN/Tax ID)"
              value={newTaxInfo}
              onChangeText={setNewTaxInfo}
            />

            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.buttonClose]}
                onPress={() => {
                  setShowCreateModal(!showCreateModal);
                  resetForm();
                }}
              >
                <Text style={styles.textStyle}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonSubmit]}
                onPress={handleCreateInvoice}
                disabled={submitInvoiceMutation.isLoading}
              >
                {submitInvoiceMutation.isLoading ? (
                  <ActivityIndicator color="#f1f5f9" />
                ) : (
                  <Text style={styles.textStyle}>Submit Invoice</Text>
                )}
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
  scrollViewContent: { padding: 16 },
  card: {
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
    fontWeight: '500',
  },
  cardValue: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  mutedText: {
    color: '#94a3b8',
    marginTop: 10,
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
  retryButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  retryButtonText: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 18,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalView: {
    margin: 20,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 35,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '90%',
  },
  modalTitle: {
    marginBottom: 20,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  input: {
    height: 40,
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 5,
    width: '100%',
    marginBottom: 15,
    paddingHorizontal: 10,
    color: '#f1f5f9',
    backgroundColor: '#0f172a',
  },
  modalButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  button: {
    borderRadius: 5,
    padding: 10,
    elevation: 2,
    flex: 1,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  buttonClose: {
    backgroundColor: '#94a3b8',
  },
  buttonSubmit: {
    backgroundColor: '#6366f1',
  },
  textStyle: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
