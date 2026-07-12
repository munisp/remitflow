import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function MerchantKYBReviewScreen() {
  const navigation = useNavigation();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<any>(null);
  const [companyName, setCompanyName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  const { data: applications, isLoading, isError, error, refetch } = trpc.merchantKybReview.getMyStatus.useQuery();
  const submitMutation = trpc.merchantKybReview.submit.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Application submitted successfully!');
      setShowCreateModal(false);
      setShowReviewModal(false);
      setCompanyName('');
      setRegistrationNumber('');
      setBusinessAddress('');
      setReviewNotes('');
      refetch();
    },
    onError: (err) => {
      Alert.alert('Error', `Failed to submit application: ${err.message}`);
    },
  });

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleRetry = () => {
    refetch();
  };

  const handleOpenCreateModal = () => {
    setSelectedApplication(null);
    setCompanyName('');
    setRegistrationNumber('');
    setBusinessAddress('');
    setReviewNotes('');
    setShowCreateModal(true);
  };

  const handleOpenReviewModal = (application: any) => {
    setSelectedApplication(application);
    setCompanyName(application.companyName);
    setRegistrationNumber(application.registrationNumber);
    setBusinessAddress(application.businessAddress);
    setReviewNotes(application.reviewNotes || '');
    setShowReviewModal(true);
  };

  const handleSubmitApplication = () => {
    if (!companyName || !registrationNumber || !businessAddress) {
      Alert.alert('Validation Error', 'Please fill in all required fields.');
      return;
    }
    Alert.alert(
      'Confirm Submission',
      'Are you sure you want to submit this application?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: () => submitMutation.mutate({ id: selectedApplication?.id, companyName, registrationNumber, businessAddress, status: 'Pending', reviewNotes: '' }) },
      ]
    );
  };

  const handleApproveReview = () => {
    if (!selectedApplication) return;
    Alert.alert(
      'Confirm Approval',
      'Are you sure you want to approve this application?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => submitMutation.mutate({ ...selectedApplication, status: 'Approved', reviewNotes }) },
      ]
    );
  };

  const handleRejectReview = () => {
    if (!selectedApplication) return;
    if (!reviewNotes) {
      Alert.alert('Validation Error', 'Review notes are required for rejection.');
      return;
    }
    Alert.alert(
      'Confirm Rejection',
      'Are you sure you want to reject this application?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', onPress: () => submitMutation.mutate({ ...selectedApplication, status: 'Rejected', reviewNotes }) },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centeredView}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading applications...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centeredView}>
        <Text style={styles.errorText}>Error: {error?.message}</Text>
        <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasApplications = applications && applications.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleGoBack}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Merchant KYB Review</Text>
        <TouchableOpacity onPress={handleOpenCreateModal}><Text style={styles.addBtn}>+ New Application</Text></TouchableOpacity>
      </View>

      {!hasApplications ? (
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateEmoji}>📝</Text>
          <Text style={styles.emptyStateText}>No KYB applications found. Start by adding a new one!</Text>
        </View>
      ) : (
        <ScrollView style={styles.scrollView}>
          {applications.map((app: any) => (
            <TouchableOpacity key={app.id} style={styles.card} onPress={() => handleOpenReviewModal(app)}>
              <Text style={styles.cardTitle}>{app.companyName}</Text>
              <Text style={styles.cardText}>Reg. No: {app.registrationNumber}</Text>
              <Text style={styles.cardText}>Address: {app.businessAddress}</Text>
              <Text style={[styles.cardStatus, app.status === 'Approved' && styles.statusApproved, app.status === 'Rejected' && styles.statusRejected]}>Status: {app.status}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateModal || showReviewModal}
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{selectedApplication ? 'Review KYB Application' : 'New KYB Application'}</Text>

            <TextInput
              style={styles.input}
              placeholder="Company Name"
              placeholderTextColor="#94a3b8"
              value={companyName}
              onChangeText={setCompanyName}
              editable={!selectedApplication || selectedApplication.status === 'Pending'}
            />
            <TextInput
              style={styles.input}
              placeholder="Registration Number"
              placeholderTextColor="#94a3b8"
              value={registrationNumber}
              onChangeText={setRegistrationNumber}
              editable={!selectedApplication || selectedApplication.status === 'Pending'}
            />
            <TextInput
              style={styles.input}
              placeholder="Business Address"
              placeholderTextColor="#94a3b8"
              value={businessAddress}
              onChangeText={setBusinessAddress}
              editable={!selectedApplication || selectedApplication.status === 'Pending'}
            />

            {selectedApplication && (
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Review Notes (for admin)"
                placeholderTextColor="#94a3b8"
                value={reviewNotes}
                onChangeText={setReviewNotes}
                multiline
                numberOfLines={4}
              />
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={handleCloseModal} style={[styles.button, styles.cancelButton]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              {selectedApplication ? (
                <>
                  <TouchableOpacity onPress={handleRejectReview} style={[styles.button, styles.rejectButton]}>
                    <Text style={styles.buttonText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleApproveReview} style={[styles.button, styles.approveButton]}>
                    <Text style={styles.buttonText}>Approve</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity onPress={handleSubmitApplication} style={[styles.button, styles.submitButton]}>
                  <Text style={styles.buttonText}>Submit Application</Text>
                </TouchableOpacity>
              )}
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

  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    marginTop: 10,
    color: '#f1f5f9',
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
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
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyStateEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  emptyStateText: {
    color: '#94a3b8',
    fontSize: 16,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 4,
  },
  cardText: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 2,
  },
  cardStatus: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    color: '#f1f5f9',
  },
  statusApproved: {
    color: '#22c55e',
  },
  statusRejected: {
    color: '#ef4444',
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 10,
    width: '90%',
    maxHeight: '80%',
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
    padding: 12,
    borderRadius: 5,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 5,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  buttonText: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#475569',
  },
  submitButton: {
    backgroundColor: '#6366f1',
  },
  approveButton: {
    backgroundColor: '#22c55e',
  },
  rejectButton: {
    backgroundColor: '#ef4444',
  },
});