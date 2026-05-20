import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

type FrequencyType = 'weekly' | 'bi_weekly' | 'semi_monthly' | 'monthly';

interface CreateRunForm {
  companyId: number | null;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  frequency: FrequencyType;
  notes: string;
}

const FREQUENCY_OPTIONS: { label: string; value: FrequencyType }[] = [
  { label: 'Weekly', value: 'weekly' },
  { label: 'Bi-Weekly', value: 'bi_weekly' },
  { label: 'Semi-Monthly', value: 'semi_monthly' },
  { label: 'Monthly', value: 'monthly' },
];

const EMPTY_FORM: CreateRunForm = {
  companyId: null,
  periodStart: '',
  periodEnd: '',
  payDate: '',
  frequency: 'monthly',
  notes: '',
};

export default function PayrollRunScreen() {
  const navigation = useNavigation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState<CreateRunForm>(EMPTY_FORM);

  const utils = trpc.useUtils();
  const { data: companies, isLoading: isLoadingCompanies, error: companiesError, refetch: refetchCompanies } = trpc.globalPayroll.listCompanies.useQuery();
  const selectedCompanyId = form.companyId ?? (companies as any[])?.[0]?.id ?? 0;
  const { data: runs, isLoading: isLoadingRuns, error: runsError, refetch: refetchRuns } = trpc.globalPayroll.listRuns.useQuery(
    { companyId: selectedCompanyId },
    { enabled: !!selectedCompanyId }
  );

  const createRunMutation = trpc.globalPayroll.createRun.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Payroll run created successfully!');
      setForm(EMPTY_FORM);
      setShowCreateModal(false);
      utils.globalPayroll.listRuns.invalidate();
    },
    onError: (error: any) => {
      Alert.alert('Error', `Failed to create payroll run: ${error.message}`);
    },
  });

  const approveRunMutation = trpc.globalPayroll.approveRun.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Payroll run approved.');
      utils.globalPayroll.listRuns.invalidate();
    },
    onError: (error: any) => Alert.alert('Error', error.message),
  });

  const disburseRunMutation = trpc.globalPayroll.disburseRun.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Disbursement initiated.');
      utils.globalPayroll.listRuns.invalidate();
    },
    onError: (error: any) => Alert.alert('Error', error.message),
  });

  const handleCreateRun = () => {
    if (!form.companyId && !selectedCompanyId) {
      Alert.alert('Error', 'Please select a company.');
      return;
    }
    if (!form.periodStart || !form.periodEnd || !form.payDate) {
      Alert.alert('Error', 'Please fill in all required date fields.');
      return;
    }
    createRunMutation.mutate({
      companyId: form.companyId ?? selectedCompanyId,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      payDate: form.payDate,
      frequency: form.frequency,
      notes: form.notes || undefined,
    });
  };

  const handleApproveRun = (runId: number) => {
    Alert.alert('Approve Payroll Run', 'Are you sure you want to approve this payroll run?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => approveRunMutation.mutate({ runId }) },
    ]);
  };

  const handleDisburseRun = (runId: number) => {
    Alert.alert('Disburse Payroll Run', 'This will initiate payments to all employees. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disburse', style: 'destructive', onPress: () => disburseRunMutation.mutate({ runId }) },
    ]);
  };

  const companyList = (companies as any[]) ?? [];
  const runList = (runs as any[]) ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Payroll Runs</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>

      {/* Company selector */}
      {companyList.length > 1 && (
        <View style={styles.companySelector}>
          <Picker
            selectedValue={form.companyId ?? selectedCompanyId}
            style={styles.picker}
            onValueChange={(v) => setForm(f => ({ ...f, companyId: v }))}
          >
            {companyList.map((c: any) => (
              <Picker.Item key={c.id} label={c.name} value={c.id} color="#f1f5f9" />
            ))}
          </Picker>
        </View>
      )}

      <ScrollView style={styles.content}>
        {isLoadingRuns || isLoadingCompanies ? (
          <ActivityIndicator size="large" color="#6366f1" />
        ) : runsError || companiesError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Failed to load payroll data.</Text>
            <TouchableOpacity onPress={() => { refetchRuns(); refetchCompanies(); }} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : runList.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>No payroll runs yet. Create your first run!</Text>
          </View>
        ) : (
          runList.map((run: any) => (
            <View key={run.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {run.periodStart ? new Date(run.periodStart).toLocaleDateString() : '—'} – {run.periodEnd ? new Date(run.periodEnd).toLocaleDateString() : '—'}
              </Text>
              <Text style={styles.cardText}>Pay date: {run.payDate ? new Date(run.payDate).toLocaleDateString() : '—'}</Text>
              <Text style={styles.cardText}>Frequency: {run.frequency?.replace(/_/g, ' ')}</Text>
              <Text style={styles.cardText}>Employees: {run.employeeCount ?? 0} · Total: ${Number(run.totalGross ?? 0).toLocaleString()}</Text>
              <Text style={[styles.statusBadge, styles[`status_${run.status}` as keyof typeof styles] ?? styles.status_draft]}>
                {run.status?.replace(/_/g, ' ').toUpperCase()}
              </Text>
              <View style={styles.cardActions}>
                {run.status === 'draft' && (
                  <TouchableOpacity onPress={() => handleApproveRun(run.id)} style={styles.actionButton} disabled={approveRunMutation.isPending}>
                    <Text style={styles.actionButtonText}>Approve</Text>
                  </TouchableOpacity>
                )}
                {run.status === 'approved' && (
                  <TouchableOpacity onPress={() => handleDisburseRun(run.id)} style={[styles.actionButton, styles.disburseButton]} disabled={disburseRunMutation.isPending}>
                    <Text style={styles.actionButtonText}>Disburse</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal animationType="slide" transparent visible={showCreateModal} onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Payroll Run</Text>

            {companyList.length > 1 && (
              <>
                <Text style={styles.label}>Company</Text>
                <Picker
                  selectedValue={form.companyId}
                  style={styles.picker}
                  onValueChange={(v) => setForm(f => ({ ...f, companyId: v }))}
                >
                  {companyList.map((c: any) => (
                    <Picker.Item key={c.id} label={c.name} value={c.id} color="#f1f5f9" />
                  ))}
                </Picker>
              </>
            )}

            <Text style={styles.label}>Period Start (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2025-01-01" placeholderTextColor="#94a3b8"
              value={form.periodStart} onChangeText={v => setForm(f => ({ ...f, periodStart: v }))} />

            <Text style={styles.label}>Period End (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2025-01-31" placeholderTextColor="#94a3b8"
              value={form.periodEnd} onChangeText={v => setForm(f => ({ ...f, periodEnd: v }))} />

            <Text style={styles.label}>Pay Date (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2025-02-05" placeholderTextColor="#94a3b8"
              value={form.payDate} onChangeText={v => setForm(f => ({ ...f, payDate: v }))} />

            <Text style={styles.label}>Frequency</Text>
            <Picker
              selectedValue={form.frequency}
              style={styles.picker}
              onValueChange={(v: FrequencyType) => setForm(f => ({ ...f, frequency: v }))}
            >
              {FREQUENCY_OPTIONS.map(opt => (
                <Picker.Item key={opt.value} label={opt.label} value={opt.value} color="#f1f5f9" />
              ))}
            </Picker>

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput style={styles.input} placeholder="Optional notes" placeholderTextColor="#94a3b8"
              value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} />

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowCreateModal(false)} style={[styles.modalButton, styles.cancelButton]}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateRun} style={[styles.modalButton, styles.createButton]}
                disabled={createRunMutation.isPending}>
                <Text style={styles.modalButtonText}>{createRunMutation.isPending ? 'Creating...' : 'Create'}</Text>
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
  companySelector: { backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155', paddingHorizontal: 16 },
  content: { flex: 1, padding: 16 },
  card: { backgroundColor: '#1e293b', padding: 16, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9', marginBottom: 4 },
  cardText: { fontSize: 14, color: '#94a3b8', marginBottom: 2 },
  statusBadge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, alignSelf: 'flex-start', marginTop: 6, marginBottom: 8 },
  status_draft: { backgroundColor: '#334155', color: '#94a3b8' },
  status_pending_approval: { backgroundColor: '#78350f', color: '#fcd34d' },
  status_approved: { backgroundColor: '#1e3a5f', color: '#93c5fd' },
  status_disbursing: { backgroundColor: '#3b0764', color: '#d8b4fe' },
  status_completed: { backgroundColor: '#14532d', color: '#86efac' },
  status_cancelled: { backgroundColor: '#7f1d1d', color: '#fca5a5' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  actionButton: { backgroundColor: '#6366f1', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 5, marginLeft: 8 },
  disburseButton: { backgroundColor: '#059669' },
  actionButtonText: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { color: '#ef4444', fontSize: 16, textAlign: 'center', marginBottom: 10 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 15, borderRadius: 5 },
  retryButtonText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, marginTop: 60 },
  emptyEmoji: { fontSize: 50, marginBottom: 10 },
  emptyText: { color: '#94a3b8', fontSize: 16, textAlign: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)' },
  modalContent: { backgroundColor: '#1e293b', padding: 20, borderRadius: 10, width: '90%', borderWidth: 1, borderColor: '#334155', maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 15, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 5, padding: 10, color: '#f1f5f9', marginBottom: 12, backgroundColor: '#0f172a' },
  label: { fontSize: 13, color: '#94a3b8', marginBottom: 4, marginTop: 4 },
  picker: { height: 50, width: '100%', color: '#f1f5f9', backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 5, marginBottom: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 15 },
  modalButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5 },
  modalButtonText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  cancelButton: { backgroundColor: '#475569' },
  createButton: { backgroundColor: '#6366f1' },
});
