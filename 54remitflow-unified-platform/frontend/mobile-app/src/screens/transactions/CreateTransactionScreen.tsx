import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useAppDispatch } from '../../store';
import { createTransaction } from '../../store/slices/transactionSlice';

export const CreateTransactionScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const [formData, setFormData] = useState({
    type: 'deposit',
    amount: '',
    customerId: '',
    customerName: '',
    description: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.amount || !formData.customerId || !formData.customerName) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }

    setLoading(true);
    try {
      await dispatch(createTransaction({
        ...formData,
        amount: parseFloat(formData.amount),
      })).unwrap();
      
      Alert.alert('Success', 'Transaction created successfully', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create transaction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.label}>Transaction Type *</Text>
        <View style={styles.typeButtons}>
          {['deposit', 'withdrawal', 'transfer'].map(type => (
            <TouchableOpacity
              key={type}
              style={[styles.typeButton, formData.type === type && styles.typeButtonActive]}
              onPress={() => setFormData({ ...formData, type })}
            >
              <Text style={[styles.typeButtonText, formData.type === type && styles.typeButtonTextActive]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Amount *</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          value={formData.amount}
          onChangeText={text => setFormData({ ...formData, amount: text })}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Customer ID *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter customer ID"
          value={formData.customerId}
          onChangeText={text => setFormData({ ...formData, customerId: text })}
        />

        <Text style={styles.label}>Customer Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter customer name"
          value={formData.customerName}
          onChangeText={text => setFormData({ ...formData, customerName: text })}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Enter description (optional)"
          value={formData.description}
          onChangeText={text => setFormData({ ...formData, description: text })}
          multiline
          numberOfLines={4}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Transaction'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  form: { padding: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 15 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 15, fontSize: 16 },
  textArea: { height: 100, textAlignVertical: 'top' },
  typeButtons: { flexDirection: 'row', marginBottom: 10 },
  typeButton: { flex: 1, padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, alignItems: 'center', marginRight: 10 },
  typeButtonActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  typeButtonText: { fontSize: 14, color: '#666' },
  typeButtonTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: '#667eea', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 30 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

