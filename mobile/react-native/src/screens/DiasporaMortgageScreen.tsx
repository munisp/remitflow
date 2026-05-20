import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

interface MortgageApplication {
  id: string;
  loanAmount: number;
  propertyValue: number;
  country: string;
  loanTerm: number;
  status: 'Pending' | 'Approved' | 'Rejected';
}

export default function DiasporaMortgageScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // Local loading state for general actions
  const [error, setError] = useState<string | null>(null); // Local error state for general actions

  // tRPC queries and mutations
  const { data: mortgages, isLoading: isLoadingMortgages, error: mortgagesError, refetch: refetchMortgages } = trpc.diasporaMortgage.list.useQuery<MortgageApplication[]>();
  const applyMortgageMutation = trpc.diasporaMortgage.apply.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Mortgage application submitted successfully!');
      setShowCreate(false);
      refetchMortgages();
      setLoanAmount('');
      setPropertyValue('');
      setCountry('');
      setLoanTerm('');
      setLtv('0');
    },
    onError: (err) => {
      Alert.alert('Error', err.message || 'Failed to submit mortgage application.');
    },
  });

  const approveMortgageMutation = trpc.diasporaMortgage.approve.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Mortgage application approved!');
      refetchMortgages();
    },
    onError: (err) => {
      Alert.alert('Error', err.message || 'Failed to approve mortgage application.');
    },
  });

  const rejectMortgageMutation = trpc.diasporaMortgage.reject.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Mortgage application rejected!');
      refetchMortgages();
    },
    onError: (err) => {
      Alert.alert('Error', err.message || 'Failed to reject mortgage application.');
    },
  });

  const handleRetry = () => {
    setError(null);
    refetchMortgages();
  };

  // State for mortgage application form
  const [loanAmount, setLoanAmount] = useState('');
  const [propertyValue, setPropertyValue] = useState('');
  const [ltv, setLtv] = useState('0');
  const [country, setCountry] = useState('');
  const [loanTerm, setLoanTerm] = useState('');

  const calculateLTV = (pv: string, la: string) => {
    const propertyVal = parseFloat(pv);
    const loanAmt = parseFloat(la);
    if (!isNaN(propertyVal) && !isNaN(loanAmt) && propertyVal > 0) {
      setLtv(((loanAmt / propertyVal) * 100).toFixed(2));
    } else {
      setLtv('0');
    }
  };

  const handleSubmitApplication = () => {
    if (!loanAmount || !propertyValue || !country || !loanTerm) {
      Alert.alert('Error', 'Please fill all required fields.');
      return;
    }
    Alert.alert(
      'Confirm Application',
      'Are you sure you want to submit this mortgage application?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: () => applyMortgageMutation.mutate({ loanAmount: parseFloat(loanAmount), propertyValue: parseFloat(propertyValue), country, loanTerm: parseInt(loanTerm) }) },
      ]
    );
  };

  const handleApprove = (id: string) => {
    Alert.alert(
      'Approve Application',
      `Are you sure you want to approve application ${id}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => approveMortgageMutation.mutate({ id }) },
      ]
    );
  };

  const handleReject = (id: string) => {
    Alert.alert(
      'Reject Application',
      `Are you sure you want to reject application ${id}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', onPress: () => rejectMortgageMutation.mutate({ id }) },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Diaspora Mortgage</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {isLoadingMortgages && (
        <View style={styles.centeredMessage}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.messageText}>Loading mortgages...</Text>
        </View>
      )}

      {mortgagesError && (
        <View style={styles.centeredMessage}>
          <Text style={styles.messageText}>Error: {mortgagesError.message}</Text>
          <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoadingMortgages && !mortgagesError && (!mortgages || mortgages.length === 0) && (
        <View style={styles.centeredMessage}>
          <Text style={styles.emoji}>🏠</Text>
          <Text style={styles.messageText}>No mortgage applications found. Start a new one!</Text>
        </View>
      )}

      {!isLoadingMortgages && !mortgagesError && mortgages && mortgages.length > 0 && (
        <ScrollView style={styles.content}>
          {mortgages.map((mortgage) => (
            <View key={mortgage.id} style={styles.card}>
              <Text style={styles.cardTitle}>Application ID: {mortgage.id}</Text>
              <Text style={styles.cardText}>Amount: ${mortgage.loanAmount.toLocaleString()}</Text>
              <Text style={styles.cardText}>Property Value: ${mortgage.propertyValue.toLocaleString()}</Text>
              <Text style={styles.cardText}>LTV: {((mortgage.loanAmount / mortgage.propertyValue) * 100).toFixed(2)}%</Text>
              <Text style={styles.cardText}>Country: {mortgage.country}</Text>
              <Text style={styles.cardText}>Loan Term: {mortgage.loanTerm} years</Text>
              <Text style={styles.cardStatus}>Status: {mortgage.status}</Text>
              {mortgage.status === 'Pending' && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity onPress={() => handleApprove(mortgage.id)} style={[styles.actionButton, styles.approveButton]}>
                    {approveMortgageMutation.isLoading ? (
                      <ActivityIndicator size="small" color="#f1f5f9" />
                    ) : (
                      <Text style={styles.actionButtonText}>Approve</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleReject(mortgage.id)} style={[styles.actionButton, styles.rejectButton]}>
                    {rejectMortgageMutation.isLoading ? (
                      <ActivityIndicator size="small" color="#f1f5f9" />
                    ) : (
                      <Text style={styles.actionButtonText}>Reject</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreate}
        onRequestClose={() => setShowCreate(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Mortgage Application</Text>
            <TextInput
              style={styles.input}
              placeholder="Loan Amount"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={loanAmount}
              onChangeText={(text) => {
                setLoanAmount(text);
                calculateLTV(propertyValue, text);
              }}
            />
            <TextInput
              style={styles.input}
              placeholder="Property Value"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={propertyValue}
              onChangeText={(text) => {
                setPropertyValue(text);
                calculateLTV(text, loanAmount);
              }}
            />
            <Text style={styles.ltvText}>LTV: {ltv}%</Text>
            <TextInput
              style={styles.input}
              placeholder="Country"
              placeholderTextColor="#94a3b8"
              value={country}
              onChangeText={setCountry}
            />
            <TextInput
              style={styles.input}
              placeholder="Loan Term (years)"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={loanTerm}
              onChangeText={setLoanTerm}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setShowCreate(false)} style={[styles.modalButton, styles.cancelButton]}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSubmitApplication} style={[styles.modalButton, styles.submitButton]}>
                {applyMortgageMutation.isLoading ? (
                  <ActivityIndicator size="small" color="#f1f5f9" />
                ) : (
                  <Text style={styles.modalButtonText}>Submit</Text>
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
  content: { flex: 1, padding: 16 },
  centeredMessage: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageText: { color: '#f1f5f9', fontSize: 16, marginTop: 10 },
  emoji: { fontSize: 40, marginBottom: 10 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5, marginTop: 15 },
  retryButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#f1f5f9', marginBottom: 8 },
  cardText: { color: '#f1f5f9', marginBottom: 4 },
  cardStatus: { color: '#6366f1', fontWeight: '600', marginTop: 8 },
  actionButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  actionButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 5, marginLeft: 10 },
  approveButton: { backgroundColor: '#22c55e' }, // Green for approve
  rejectButton: { backgroundColor: '#ef4444' }, // Red for reject
  actionButtonText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)' },
  modalContent: { backgroundColor: '#0f172a', borderRadius: 10, padding: 20, width: '90%', borderWidth: 1, borderColor: '#334155' },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 5, padding: 12, color: '#f1f5f9', marginBottom: 15, backgroundColor: '#1e293b' },
  ltvText: { color: '#f1f5f9', fontSize: 14, marginBottom: 15, textAlign: 'right' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20 },
  modalButton: { paddingVertical: 12, paddingHorizontal: 25, borderRadius: 5, minWidth: 100, alignItems: 'center' },
  cancelButton: { backgroundColor: '#94a3b8' },
  submitButton: { backgroundColor: '#6366f1' },
  modalButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
});
