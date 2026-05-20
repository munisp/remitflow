import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, StyleSheet } from 'react-native';
import { useAppDispatch } from '../../store';
import { resolveDiscrepancy } from '../../store/slices/reconciliationSlice';

export const DiscrepancyResolutionScreen = ({ route, navigation }: any) => {
  const { discrepancyId } = route.params;
  const dispatch = useAppDispatch();
  const [notes, setNotes] = useState('');
  
  const handleResolve = async (action: 'approve' | 'reject') => {
    try {
      await dispatch(resolveDiscrepancy({ discrepancyId, action, notes })).unwrap();
      Alert.alert('Success', `Discrepancy ${action}d`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };
  
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Resolve Discrepancy</Text>
      <TextInput style={styles.textArea} placeholder="Add notes..." value={notes} onChangeText={setNotes} multiline />
      <TouchableOpacity style={[styles.button, styles.approveButton]} onPress={() => handleResolve('approve')}>
        <Text style={styles.buttonText}>Approve</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.button, styles.rejectButton]} onPress={() => handleResolve('reject')}>
        <Text style={styles.buttonText}>Reject</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  textArea: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 15, height: 150, textAlignVertical: 'top', marginBottom: 20 },
  button: { padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  approveButton: { backgroundColor: '#10b981' },
  rejectButton: { backgroundColor: '#ef4444' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});