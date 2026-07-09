import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function BusinessCreditScoringScreen() {
  const navigation = useNavigation();

  const [showCreditApplicationModal, setShowCreditApplicationModal] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [requestedCreditLimit, setRequestedCreditLimit] = useState('');

  const { data: scoreData, isLoading: isLoadingScore, error: scoreError, refetch: refetchScore } = trpc.businessCreditScoring.getScore.useQuery();
  const requestScoreMutation = trpc.businessCreditScoring.requestScore.useMutation();

  const handleSubmitApplication = () => {
    Alert.alert(
      'Confirm Application',
      'Are you sure you want to submit this credit application?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: () => {
            // Simulate API call for application submission
            // In a real app, this would be a separate mutation or part of requestScoreMutation
            console.log('Submitting application:', { businessName, industry, annualRevenue, requestedCreditLimit });
            requestScoreMutation.mutate({
                businessName,
                industry,
                annualRevenue: parseFloat(annualRevenue),
                requestedCreditLimit: parseFloat(requestedCreditLimit),
            }, {
                onSuccess: () => {
                    Alert.alert('Success', 'Credit application submitted successfully!');
                    setShowCreditApplicationModal(false);
                    setBusinessName('');
                    setIndustry('');
                    setAnnualRevenue('');
                    setRequestedCreditLimit('');
                    refetchScore(); // Refresh score after application
                },
                onError: (err) => {
                    Alert.alert('Error', `Failed to submit application: ${err.message}`);
                }
            });
        }},
      ]
    );
  };

  const renderContent = () => {
    if (isLoadingScore) {
      return (
        <View style={styles.centeredView}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.mutedText}>Loading credit score...</Text>
        </View>
      );
    }

    if (scoreError) {
      return (
        <View style={styles.centeredView}>
          <Text style={styles.errorText}>Error: {scoreError.message}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetchScore}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!scoreData || !scoreData.score) {
      return (
        <View style={styles.centeredView}>
          <Text style={styles.emptyStateEmoji}>🤔</Text>
          <Text style={styles.emptyStateText}>No credit score found. Apply for one!</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setShowCreditApplicationModal(true)}>
            <Text style={styles.primaryButtonText}>Apply for Credit Score</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <ScrollView style={styles.contentContainer}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your Business Credit Score</Text>
          <Text style={styles.scoreText}>{scoreData.score}</Text>
          <Text style={styles.gradeText}>Grade: {scoreData.grade}</Text>
          <Text style={styles.mutedText}>Last updated: {new Date(scoreData.lastUpdated).toLocaleDateString()}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowCreditApplicationModal(true)}>
            <Text style={styles.secondaryButtonText}>Request New Score / Apply for Credit</Text>
          </TouchableOpacity>
        </View>

        {/* Future: Display past applications/requests here */}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Business Credit Scoring</Text>
        <TouchableOpacity onPress={() => setShowCreditApplicationModal(true)}><Text style={styles.addBtn}>+ Apply</Text></TouchableOpacity>
      </View>

      {renderContent()}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreditApplicationModal}
        onRequestClose={() => setShowCreditApplicationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Credit Application</Text>
            <TextInput
              style={styles.input}
              placeholder="Business Name"
              placeholderTextColor="#94a3b8"
              value={businessName}
              onChangeText={setBusinessName}
            />
            <TextInput
              style={styles.input}
              placeholder="Industry (e.g., Tech, Retail)"
              placeholderTextColor="#94a3b8"
              value={industry}
              onChangeText={setIndustry}
            />
            <TextInput
              style={styles.input}
              placeholder="Annual Revenue (e.g., 1000000)"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={annualRevenue}
              onChangeText={setAnnualRevenue}
            />
            <TextInput
              style={styles.input}
              placeholder="Requested Credit Limit (e.g., 50000)"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={requestedCreditLimit}
              onChangeText={setRequestedCreditLimit}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCreditApplicationModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={requestScoreMutation.isLoading ? styles.submitButtonDisabled : styles.submitButton}
                onPress={handleSubmitApplication}
                disabled={requestScoreMutation.isLoading}
              >
                {requestScoreMutation.isLoading ? (
                  <ActivityIndicator color="#f1f5f9" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Application</Text>
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
  contentContainer: { flex: 1, padding: 16 },
  centeredView: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9', marginBottom: 10 },
  scoreText: { fontSize: 36, fontWeight: 'bold', color: '#6366f1', textAlign: 'center', marginBottom: 5 },
  gradeText: { fontSize: 24, fontWeight: '600', color: '#f1f5f9', textAlign: 'center', marginBottom: 15 },
  mutedText: { color: '#94a3b8', fontSize: 12, textAlign: 'center', marginTop: 5 },
  errorText: { color: '#ef4444', fontSize: 16, textAlign: 'center', marginBottom: 10 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5, marginTop: 10 },
  retryButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  emptyStateEmoji: { fontSize: 60, marginBottom: 10 },
  emptyStateText: { color: '#f1f5f9', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  primaryButton: { backgroundColor: '#6366f1', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 8 },
  primaryButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { borderWidth: 1, borderColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5, marginTop: 15 },
  secondaryButtonText: { color: '#6366f1', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)' },
  modalContent: { backgroundColor: '#1e293b', borderRadius: 10, padding: 20, width: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 5, padding: 12, color: '#f1f5f9', marginBottom: 15, backgroundColor: '#0f172a' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20 },
  cancelButton: { backgroundColor: '#475569', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 8 },
  cancelButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  submitButton: { backgroundColor: '#6366f1', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 8 },
  submitButtonDisabled: { backgroundColor: '#4a5568', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 8 },
  submitButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
});
