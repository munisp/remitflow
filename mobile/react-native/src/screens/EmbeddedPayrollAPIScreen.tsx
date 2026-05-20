import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function EmbeddedPayrollAPIScreen() {
  const navigation = useNavigation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newApiKeyName, setNewApiKeyName] = useState('');

  const { data: apiKeys, isLoading: isLoadingApiKeys, error: apiKeysError, refetch: refetchApiKeys } = trpc.embeddedPayrollApi.listApiKeys.useQuery();
  const issueApiKeyMutation = trpc.embeddedPayrollApi.issueApiKey.useMutation();
  const revokeApiKeyMutation = trpc.embeddedPayrollApi.revokeApiKey.useMutation();

  const handleIssueApiKey = async () => {
    if (!newApiKeyName.trim()) {
      Alert.alert('Error', 'API Key name cannot be empty.');
      return;
    }
    try {
      await issueApiKeyMutation.mutateAsync({ name: newApiKeyName });
      Alert.alert('Success', `API Key '${newApiKeyName}' issued successfully.`);
      setNewApiKeyName('');
      setShowCreateModal(false);
      refetchApiKeys();
    } catch (error: any) {
      Alert.alert('Error', `Failed to issue API Key: ${error.message}`);
    }
  };

  const handleRevokeApiKey = (apiKeyId: string) => {
    Alert.alert(
      'Confirm Revocation',
      'Are you sure you want to revoke this API Key?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          onPress: async () => {
            try {
              await revokeApiKeyMutation.mutateAsync({ id: apiKeyId });
              Alert.alert('Success', 'API Key revoked successfully.');
              refetchApiKeys();
            } catch (error: any) {
              Alert.alert('Error', `Failed to revoke API Key: ${error.message}`);
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const renderContent = () => {
    if (isLoadingApiKeys) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.mutedText}>Loading API Keys...</Text>
        </View>
      );
    }

    if (apiKeysError) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Error: {apiKeysError.message}</Text>
          <TouchableOpacity onPress={refetchApiKeys} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!apiKeys || apiKeys.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🔑</Text>
          <Text style={styles.emptyText}>No API Keys found. Issue a new one!</Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.scrollViewContent}>
        {apiKeys.map((key: any) => (
          <View key={key.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{key.name}</Text>
              <Text style={styles.cardStatus}>{key.status === 'active' ? 'Active' : 'Revoked'}</Text>
            </View>
            <Text style={styles.cardText}>ID: {key.id}</Text>
            <Text style={styles.cardText}>Key: {key.key.substring(0, 4)}...{key.key.substring(key.key.length - 4)}</Text>
            <Text style={styles.cardText}>Created: {new Date(key.createdAt).toLocaleDateString()}</Text>
            <Text style={styles.cardText}>Last Used: {key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never'}</Text>
            {key.status === 'active' && (
              <TouchableOpacity onPress={() => handleRevokeApiKey(key.id)} style={styles.revokeButton}>
                <Text style={styles.revokeButtonText}>Revoke</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Embedded Payroll API</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}><Text style={styles.addBtn}>+ New</Text></TouchableOpacity>
      </View>
      {renderContent()}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Issue New API Key</Text>
            <TextInput
              style={styles.textInput}
              placeholder="API Key Name"
              placeholderTextColor="#94a3b8"
              value={newApiKeyName}
              onChangeText={setNewApiKeyName}
            />
            <View style={styles.modalButtonContainer}>
              <TouchableOpacity onPress={() => setShowCreateModal(false)} style={styles.modalCancelButton}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleIssueApiKey} style={styles.modalSubmitButton}>
                <Text style={styles.modalButtonText}>Issue Key</Text>
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
  scrollViewContent: { flex: 1, padding: 16 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9' },
  cardStatus: { fontSize: 12, color: '#94a3b8' },
  cardText: { fontSize: 14, color: '#f1f5f9', marginBottom: 4 },
  revokeButton: { backgroundColor: '#dc2626', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 5, alignSelf: 'flex-start', marginTop: 10 },
  revokeButtonText: { color: '#f1f5f9', fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mutedText: { color: '#94a3b8', marginTop: 10 },
  errorText: { color: '#ef4444', fontSize: 16, marginBottom: 10 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5 },
  retryButtonText: { color: '#f1f5f9', fontWeight: '600' },
  emptyEmoji: { fontSize: 60, marginBottom: 10 },
  emptyText: { color: '#94a3b8', fontSize: 16 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)' },
  modalContent: { backgroundColor: '#0f172a', borderRadius: 10, padding: 20, width: '80%', borderWidth: 1, borderColor: '#334155' },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 20, textAlign: 'center' },
  textInput: { borderWidth: 1, borderColor: '#334155', borderRadius: 5, padding: 10, color: '#f1f5f9', marginBottom: 20, backgroundColor: '#1e293b' },
  modalButtonContainer: { flexDirection: 'row', justifyContent: 'space-around' },
  modalCancelButton: { backgroundColor: '#475569', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5 },
  modalSubmitButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5 },
  modalButtonText: { color: '#f1f5f9', fontWeight: '600' },
});
