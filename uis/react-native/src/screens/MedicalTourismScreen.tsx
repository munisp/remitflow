import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
export default function MedicalTourismScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  // wave16 fail-closed: there is no mounted medical-tourism/provider-directory router or
  // procedure on the server (phantom medicalTourism.listProviders removed; verified against
  // the full mounted surface). No trpc call is attempted; the screen honestly reports the
  // feature state.
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Medical Providers</Text>
        {user && <Text style={styles.subtitle}>Logged in as {user.name ?? user.email}</Text>}
      </View>
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🚧</Text>
        <Text style={styles.emptyText}>This feature is not yet available</Text>
        <Text style={styles.emptySubtext}>
          Medical Tourism is not part of the currently enabled backend feature set. No data was
          requested and nothing here is a live record.
        </Text>
      </View>
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 24, paddingBottom: 16 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#6366f1', fontSize: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#94a3b8' },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  emptySubtext: { fontSize: 14, color: '#64748b', textAlign: 'center' },
});
