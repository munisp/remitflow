import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
export default function DocumentVaultScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  // wave16 fail-closed: documentVault is only mounted behind the legacy feature-pack gate (OFF by default) and has no mounted non-legacy equivalent.
  // No phantom call is attempted; the screen honestly reports the feature state.
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Document Vault</Text>
        {user && <Text style={styles.subtitle}>Logged in as {user.name ?? user.email}</Text>}
      </View>
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🚧</Text>
        <Text style={styles.emptyText}>This feature is not yet available</Text>
        <Text style={styles.emptySubtext}>
          Document Vault is not part of the currently enabled backend feature set. No data was
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
  card: { backgroundColor: '#1e293b', marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 16 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4 },
  badge: { backgroundColor: '#312e81', color: '#a5b4fc', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start', fontSize: 12, marginBottom: 4 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#10b981', marginBottom: 4 },
  date: { fontSize: 12, color: '#64748b' },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  emptySubtext: { fontSize: 14, color: '#64748b' },
});
