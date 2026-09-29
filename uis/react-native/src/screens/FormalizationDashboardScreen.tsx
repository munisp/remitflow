import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function FormalizationDashboardScreen() {
  const navigation = useNavigation();
  // wave16 fail-closed: formalization.getDashboard has NO server-side router at
  // all (phantom namespace, audit §5.9) and no mounted equivalent. The screen
  // honestly reports the feature state instead of attempting a phantom call.
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Formalization Dashboard</Text>
        <View style={{ width: 50 }} />
      </View>
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🚧</Text>
        <Text style={styles.emptyTitle}>This feature is not yet available</Text>
        <Text style={styles.emptyText}>
          The formalization dashboard is not part of the currently enabled backend
          feature set. No data was requested and nothing here is a live record.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  title: { fontSize: 16, fontWeight: '700', color: '#f1f5f9', flex: 1, textAlign: 'center' },
  back: { color: '#6366f1', fontSize: 14, width: 50 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#f1f5f9', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptyText: { color: '#64748b', fontSize: 15, textAlign: 'center' },
});
