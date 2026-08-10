import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function ComplianceScreen() {
  const complianceItems = [
    {
      title: 'Identity Verification',
      status: 'verified',
      description: 'Your identity has been verified using biometric checks.',
      icon: 'shield-checkmark',
      color: '#00D4AA',
    },
    {
      title: 'PEP Screening',
      status: 'clear',
      description: 'No politically exposed person indicators found.',
      icon: 'people',
      color: '#00D4AA',
    },
    {
      title: 'Sanctions Check',
      status: 'clear',
      description: 'No matches on OFAC, UN, or EU sanctions lists.',
      icon: 'list',
      color: '#00D4AA',
    },
    {
      title: 'Source of Funds',
      status: 'pending',
      description: 'Please upload your latest payslip or bank statement.',
      icon: 'document',
      color: '#FFA500',
    },
    {
      title: 'Transaction Monitoring',
      status: 'active',
      description: 'Your transactions are being monitored for suspicious activity.',
      icon: 'eye',
      color: '#635BFF',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.title}>Compliance Status</Text>
        <Text style={styles.subtitle}>Your account compliance and regulatory standing.</Text>

        <View style={styles.overallCard}>
          <View style={styles.overallIcon}>
            <Ionicons name="shield-checkmark" size={32} color="#00D4AA" />
          </View>
          <View>
            <Text style={styles.overallTitle}>Compliant</Text>
            <Text style={styles.overallSubtitle}>All required checks passed</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Compliance Checks</Text>
        <View style={styles.checksList}>
          {complianceItems.map((item, index) => (
            <View key={index} style={styles.checkItem}>
              <View style={[styles.checkIcon, { backgroundColor: item.color + '15' }]}>
                <Ionicons name={item.icon as any} size={22} color={item.color} />
              </View>
              <View style={styles.checkContent}>
                <View style={styles.checkHeader}>
                  <Text style={styles.checkTitle}>{item.title}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: item.color + '15' }]}>
                    <Text style={[styles.statusText, { color: item.color }]}>{item.status}</Text>
                  </View>
                </View>
                <Text style={styles.checkDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.downloadButton}>
          <Ionicons name="download-outline" size={20} color="#FFFFFF" />
          <Text style={styles.downloadText}>Download Compliance Report</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          RemitFlow is regulated by the FCA (Ref: 900001) and complies with FATF, GDPR, and applicable AML regulations.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollView: { padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#0A2540', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B7280', marginBottom: 24 },
  overallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#00D4AA15',
    padding: 20,
    borderRadius: 16,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#00D4AA',
  },
  overallIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#00D4AA20', justifyContent: 'center', alignItems: 'center' },
  overallTitle: { fontSize: 18, fontWeight: 'bold', color: '#00D4AA' },
  overallSubtitle: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#0A2540', marginBottom: 12 },
  checksList: { gap: 12 },
  checkItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  checkIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  checkContent: { flex: 1, marginLeft: 12 },
  checkHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  checkTitle: { fontSize: 16, fontWeight: '600', color: '#0A2540' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  checkDescription: { fontSize: 13, color: '#6B7280' },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0A2540',
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
  },
  downloadText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  disclaimer: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
