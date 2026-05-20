import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function ESGReportingScreen() {
  const navigation = useNavigation();
  const [showGenerate, setShowGenerate] = useState(false);
  const [reportPeriod, setReportPeriod] = useState('');
  const [focusArea, setFocusArea] = useState('');

  const { data: reports, isLoading, isError, refetch } = trpc.esgReporting.list.useQuery();
  const generateMutation = trpc.esgReporting.generate.useMutation({
    onSuccess: () => {
      setShowGenerate(false);
      setReportPeriod('');
      setFocusArea('');
      refetch();
      Alert.alert('Success', 'ESG Report generated successfully');
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to generate report');
    }
  });

  const handleGenerate = () => {
    if (!reportPeriod || !focusArea) {
      Alert.alert('Validation', 'Please fill in all fields');
      return;
    }
    generateMutation.mutate({ period: reportPeriod, focusArea });
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading ESG Reports...</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Failed to load ESG reports</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!reports || reports.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyEmoji}>🌱</Text>
          <Text style={styles.emptyTitle}>No ESG Reports</Text>
          <Text style={styles.emptyDesc}>Generate your first ESG report to track carbon footprint and SDG alignment.</Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.listContainer} contentContainerStyle={styles.listContent}>
        {reports.map((report: any) => (
          <View key={report.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{report.period} Report</Text>
              <View style={[styles.statusBadge, { backgroundColor: report.status === 'COMPLETED' ? '#059669' : '#d97706' }]}>
                <Text style={styles.statusText}>{report.status}</Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Carbon Footprint:</Text>
                <Text style={styles.metricValue}>{report.carbonFootprint} tCO2e</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>SDG Alignment:</Text>
                <Text style={styles.metricValue}>{report.sdgAlignmentScore}%</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Focus Area:</Text>
                <Text style={styles.metricValue}>{report.focusArea}</Text>
              </View>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.dateText}>Generated on {new Date(report.createdAt).toLocaleDateString()}</Text>
              <TouchableOpacity onPress={() => Alert.alert('Download', 'Downloading report PDF...')}>
                <Text style={styles.actionText}>Download PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>ESG Reporting</Text>
        <TouchableOpacity onPress={() => setShowGenerate(true)}>
          <Text style={styles.addBtn}>+ Generate</Text>
        </TouchableOpacity>
      </View>

      {renderContent()}

      <Modal visible={showGenerate} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Generate ESG Report</Text>
              <TouchableOpacity onPress={() => setShowGenerate(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.formContainer}>
              <Text style={styles.label}>Reporting Period (e.g., Q3 2023)</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter period"
                placeholderTextColor="#94a3b8"
                value={reportPeriod}
                onChangeText={setReportPeriod}
              />
              
              <Text style={styles.label}>Primary Focus Area</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Carbon Reduction, Diversity"
                placeholderTextColor="#94a3b8"
                value={focusArea}
                onChangeText={setFocusArea}
              />
              
              <TouchableOpacity 
                style={styles.submitBtn} 
                onPress={handleGenerate}
                disabled={generateMutation.isLoading}
              >
                {generateMutation.isLoading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.submitBtnText}>Generate Report</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
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
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { color: '#94a3b8', marginTop: 12, fontSize: 16 },
  errorText: { color: '#ef4444', fontSize: 16, marginBottom: 16 },
  retryBtn: { backgroundColor: '#1e293b', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  retryBtnText: { color: '#f1f5f9', fontWeight: '600' },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },
  listContainer: { flex: 1 },
  listContent: { padding: 16, gap: 16 },
  card: { backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#334155' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  cardBody: { padding: 16, gap: 12 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { fontSize: 14, color: '#94a3b8' },
  metricValue: { fontSize: 14, fontWeight: '500', color: '#f1f5f9' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#0f172a', borderTopWidth: 1, borderTopColor: '#334155' },
  dateText: { fontSize: 12, color: '#94a3b8' },
  actionText: { fontSize: 14, fontWeight: '600', color: '#6366f1' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  closeBtn: { fontSize: 20, color: '#94a3b8', padding: 4 },
  formContainer: { padding: 20 },
  label: { fontSize: 14, fontWeight: '500', color: '#f1f5f9', marginBottom: 8 },
  input: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 12, color: '#f1f5f9', marginBottom: 20, fontSize: 16 },
  submitBtn: { backgroundColor: '#6366f1', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 10, marginBottom: 40 },
  submitBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' }
});