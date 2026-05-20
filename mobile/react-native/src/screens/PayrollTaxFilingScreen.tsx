import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

interface TaxFiling {
  id: string;
  period: string;
  grossIncome: number;
  deductions: number;
  taxAmount: number;
  status: 'pending' | 'calculated' | 'submitted' | 'approved' | 'rejected';
  createdAt: string;
}

export default function PayrollTaxFilingScreen() {
  const navigation = useNavigation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [taxPeriod, setTaxPeriod] = useState('');
  const [grossIncome, setGrossIncome] = useState('');
  const [deductions, setDeductions] = useState('');
  const [calculatedTax, setCalculatedTax] = useState<number | null>(null);

  const { data: filings, isLoading: isLoadingFilings, isError: isErrorFilings, refetch: refetchFilings } = trpc.payrollTaxFiling.list.useQuery();
  const calculateMutation = trpc.payrollTaxFiling.calculate.useMutation();
  const submitMutation = trpc.payrollTaxFiling.submit.useMutation();

  const handleCalculateTax = async () => {
    if (!taxPeriod || !grossIncome || !deductions) {
      Alert.alert('Error', 'Please fill all fields.');
      return;
    }
    try {
      const result = await calculateMutation.mutateAsync({
        period: taxPeriod,
        grossIncome: parseFloat(grossIncome),
        deductions: parseFloat(deductions),
      });
      setCalculatedTax(result.taxAmount);
      Alert.alert('Success', `Calculated Tax: ${result.taxAmount}`);
    } catch (error: any) {
      Alert.alert('Calculation Error', error.message || 'Failed to calculate tax.');
    }
  };

  const handleSubmitTax = async () => {
    if (!calculatedTax) {
      Alert.alert('Error', 'Please calculate tax first.');
      return;
    }
    Alert.alert(
      'Confirm Submission',
      'Are you sure you want to submit this tax filing?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            try {
              await submitMutation.mutateAsync({
                period: taxPeriod,
                grossIncome: parseFloat(grossIncome),
                deductions: parseFloat(deductions),
                taxAmount: calculatedTax,
              });
              Alert.alert('Success', 'Tax filing submitted successfully!');
              setShowCreateModal(false);
              setTaxPeriod('');
              setGrossIncome('');
              setDeductions('');
              setCalculatedTax(null);
              refetchFilings();
            } catch (error: any) {
              Alert.alert('Submission Error', error.message || 'Failed to submit tax.');
            }
          },
        },
      ]
    );
  };

  const renderContent = () => {
    if (isLoadingFilings) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading tax filings...</Text>
        </View>
      );
    }

    if (isErrorFilings) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load tax filings. 😔</Text>
          <TouchableOpacity onPress={refetchFilings} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!filings || filings.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🧾</Text>
          <Text style={styles.emptyText}>No tax filings found. Start by creating a new one!</Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.scrollViewContent}>
        {filings.map((filing) => (
          <View key={filing.id} style={styles.card}>
            <Text style={styles.cardTitle}>Period: {filing.period}</Text>
            <Text style={styles.cardText}>Gross Income: ${filing.grossIncome.toFixed(2)}</Text>
            <Text style={styles.cardText}>Deductions: ${filing.deductions.toFixed(2)}</Text>
            <Text style={styles.cardText}>Tax Amount: ${filing.taxAmount.toFixed(2)}</Text>
            <Text style={styles.cardText}>Status: <Text style={{ color: filing.status === 'approved' ? '#34d399' : filing.status === 'rejected' ? '#ef4444' : '#facc15' }}>{filing.status}</Text></Text>
            <Text style={styles.cardTextMuted}>Filed on: {new Date(filing.createdAt).toLocaleDateString()}</Text>
            {/* Add approve/reject actions if applicable, for now just display status */}
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Payroll Tax Filing</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {renderContent()}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Tax Filing</Text>
            <TextInput
              style={styles.input}
              placeholder="Tax Period (e.g., Q1 2026)"
              placeholderTextColor="#94a3b8"
              value={taxPeriod}
              onChangeText={setTaxPeriod}
            />
            <TextInput
              style={styles.input}
              placeholder="Gross Income"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={grossIncome}
              onChangeText={setGrossIncome}
            />
            <TextInput
              style={styles.input}
              placeholder="Deductions"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={deductions}
              onChangeText={setDeductions}
            />
            {calculatedTax !== null && (
              <Text style={styles.calculatedTaxText}>Calculated Tax: ${calculatedTax.toFixed(2)}</Text>
            )}
            <TouchableOpacity
              style={[styles.button, styles.calculateButton]}
              onPress={handleCalculateTax}
              disabled={calculateMutation.isLoading}
            >
              {calculateMutation.isLoading ? (
                <ActivityIndicator color="#f1f5f9" />
              ) : (
                <Text style={styles.buttonText}>Calculate Tax</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.submitButton]}
              onPress={handleSubmitTax}
              disabled={submitMutation.isLoading || calculatedTax === null}
            >
              {submitMutation.isLoading ? (
                <ActivityIndicator color="#f1f5f9" />
              ) : (
                <Text style={styles.buttonText}>Submit Filing</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowCreateModal(false)}>
              <Text style={styles.closeButtonText}>Cancel</Text>
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
  scrollViewContent: { flex: 1, padding: 16 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9', marginBottom: 4 },
  cardText: { fontSize: 14, color: '#f1f5f9', marginBottom: 2 },
  cardTextMuted: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#f1f5f9', marginTop: 10, fontSize: 16 },
  errorText: { color: '#ef4444', fontSize: 16, marginBottom: 10, textAlign: 'center' },
  emptyEmoji: { fontSize: 50, marginBottom: 10 },
  emptyText: { color: '#94a3b8', fontSize: 16, textAlign: 'center' },
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
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 20,
    width: '90%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 20, textAlign: 'center' },
  input: {
    backgroundColor: '#1e293b',
    color: '#f1f5f9',
    borderRadius: 5,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  calculatedTaxText: { color: '#f1f5f9', fontSize: 16, marginBottom: 15, textAlign: 'center' },
  button: {
    paddingVertical: 12,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 10,
  },
  calculateButton: {
    backgroundColor: '#6366f1',
  },
  submitButton: {
    backgroundColor: '#34d399',
  },
  closeButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    borderRadius: 5,
    alignItems: 'center',
  },
  buttonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  closeButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
});
