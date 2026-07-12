import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function ExpenseManagementScreen() {
  const navigation = useNavigation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newReportCategory, setNewReportCategory] = useState('');
  const [newReportAmount, setNewReportAmount] = useState('');
  const [newReportDescription, setNewReportDescription] = useState('');

  const { data: expenseReports, isLoading, isError, error, refetch } = trpc.expenseManagement.list.useQuery();
  const submitReportMutation = trpc.expenseManagement.submitReport.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Expense report submitted for approval.');
      setShowCreateModal(false);
      setNewReportCategory('');
      setNewReportAmount('');
      setNewReportDescription('');
      refetch();
    },
    onError: (err) => {
      Alert.alert('Error', `Failed to submit report: ${err.message}`);
    },
  });

  const handleCreateReport = () => {
    if (!newReportCategory || !newReportAmount) {
      Alert.alert('Error', 'Category and Amount are required.');
      return;
    }
    submitReportMutation.mutate({
      category: newReportCategory,
      amount: parseFloat(newReportAmount),
      description: newReportDescription,
    });
  };

  const handleApproveReport = (reportId: string) => {
    Alert.alert(
      'Approve Report',
      'Are you sure you want to approve this expense report?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => console.log(`Approving report ${reportId}`) }, // Placeholder for actual approval mutation
      ]
    );
  };

  const handleRejectReport = (reportId: string) => {
    Alert.alert(
      'Reject Report',
      'Are you sure you want to reject this expense report?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', onPress: () => console.log(`Rejecting report ${reportId}`) }, // Placeholder for actual rejection mutation
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading expense reports...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Error: {error?.message}</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Expense Management</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {expenseReports?.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>💸</Text>
          <Text style={styles.emptyText}>No expense reports yet. Start by adding a new one!</Text>
        </View>
      ) : (
        <ScrollView style={styles.scrollView}>
          {expenseReports?.map((report) => (
            <View key={report.id} style={styles.reportCard}>
              <View style={styles.reportHeader}>
                <Text style={styles.reportCategory}>{report.category}</Text>
                <Text style={styles.reportAmount}>${report.amount.toFixed(2)}</Text>
              </View>
              <Text style={styles.reportDescription}>{report.description || 'No description'}</Text>
              <Text style={styles.reportStatus}>Status: {report.status}</Text>
              <Text style={styles.reportDate}>Date: {new Date(report.date).toLocaleDateString()}</Text>
              {report.status === 'Pending' && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity onPress={() => handleApproveReport(report.id)} style={[styles.actionButton, styles.approveButton]}>
                    <Text style={styles.actionButtonText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRejectReport(report.id)} style={[styles.actionButton, styles.rejectButton]}>
                    <Text style={styles.actionButtonText}>Reject</Text>
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
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create New Expense Report</Text>
            <TextInput
              style={styles.input}
              placeholder="Category (e.g., Travel, Meals)"
              placeholderTextColor="#94a3b8"
              value={newReportCategory}
              onChangeText={setNewReportCategory}
            />
            <TextInput
              style={styles.input}
              placeholder="Amount"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={newReportAmount}
              onChangeText={setNewReportAmount}
            />
            <TextInput
              style={styles.input}
              placeholder="Description (Optional)"
              placeholderTextColor="#94a3b8"
              value={newReportDescription}
              onChangeText={setNewReportDescription}
              multiline
            />
            <TouchableOpacity onPress={handleCreateReport} style={styles.submitButton} disabled={submitReportMutation.isLoading}>
              {submitReportMutation.isLoading ? (
                <ActivityIndicator color="#f1f5f9" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Report</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCreateModal(false)} style={styles.cancelButton}>
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
  scrollView: { flex: 1, padding: 16 },
  reportCard: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  reportCategory: { fontSize: 16, fontWeight: '600', color: '#f1f5f9' },
  reportAmount: { fontSize: 16, fontWeight: '600', color: '#6366f1' },
  reportDescription: { fontSize: 14, color: '#94a3b8', marginBottom: 4 },
  reportStatus: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic', marginBottom: 8 },
  reportDate: { fontSize: 13, color: '#94a3b8', marginBottom: 8 },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 5,
    marginLeft: 10,
  },
  approveButton: {
    backgroundColor: '#22c55e', // Green
  },
  rejectButton: {
    backgroundColor: '#ef4444', // Red
  },
  actionButtonText: {
    color: '#f1f5f9',
    fontWeight: '600',
    fontSize: 13,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#f1f5f9', marginTop: 10 },
  errorText: { color: '#ef4444', fontSize: 16, marginBottom: 10 },
  retryButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  retryButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyEmoji: { fontSize: 60, marginBottom: 10 },
  emptyText: { color: '#94a3b8', fontSize: 16, textAlign: 'center' },
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
    width: '85%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 20, textAlign: 'center' },
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
    marginTop: 10,
  },
  submitButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  cancelButton: {
    marginTop: 10,
    padding: 10,
    alignItems: 'center',
  },
  cancelButtonText: { color: '#94a3b8', fontSize: 14 },
});
