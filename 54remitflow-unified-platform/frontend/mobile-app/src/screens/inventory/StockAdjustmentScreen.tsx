import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, StyleSheet } from 'react-native';
import { useAppDispatch } from '../../store';
import { adjustStock } from '../../store/slices/inventorySlice';

export const StockAdjustmentScreen = ({ route, navigation }: any) => {
  const { productId, productName, currentStock } = route.params;
  const dispatch = useAppDispatch();
  const [adjustment, setAdjustment] = useState('');
  const [reason, setReason] = useState('');
  
  const handleSubmit = async () => {
    if (!adjustment || !reason) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    try {
      await dispatch(adjustStock({ productId, adjustment: parseInt(adjustment), reason })).unwrap();
      Alert.alert('Success', 'Stock adjusted', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };
  
  return (
    <ScrollView style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.label}>Product</Text>
        <Text style={styles.value}>{productName}</Text>
        <Text style={styles.label}>Current Stock</Text>
        <Text style={styles.value}>{currentStock}</Text>
      </View>
      <TextInput style={styles.input} placeholder="Adjustment (+/-)" value={adjustment} onChangeText={setAdjustment} keyboardType="numeric" />
      <TextInput style={[styles.input, styles.textArea]} placeholder="Reason" value={reason} onChangeText={setReason} multiline />
      <TouchableOpacity style={styles.button} onPress={handleSubmit}>
        <Text style={styles.buttonText}>Adjust Stock</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  info: { backgroundColor: '#fff', padding: 20, borderRadius: 10, marginBottom: 20 },
  label: { fontSize: 14, color: '#666', marginBottom: 5 },
  value: { fontSize: 18, fontWeight: '600', marginBottom: 15 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 15, marginBottom: 15 },
  textArea: { height: 100, textAlignVertical: 'top' },
  button: { backgroundColor: '#667eea', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});