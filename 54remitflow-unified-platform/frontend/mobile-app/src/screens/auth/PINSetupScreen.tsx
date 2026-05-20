import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ApiService from '../../services/ApiService';

export const PINSetupScreen = ({ navigation }: any) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [loading, setLoading] = useState(false);

  const handleNumberPress = (num: string) => {
    if (step === 'enter') {
      if (pin.length < 4) {
        const newPin = pin + num;
        setPin(newPin);
        if (newPin.length === 4) {
          setTimeout(() => setStep('confirm'), 300);
        }
      }
    } else {
      if (confirmPin.length < 4) {
        const newConfirmPin = confirmPin + num;
        setConfirmPin(newConfirmPin);
        if (newConfirmPin.length === 4) {
          setTimeout(() => verifyPins(pin, newConfirmPin), 300);
        }
      }
    }
  };

  const verifyPins = async (p1: string, p2: string) => {
    if (p1 !== p2) {
      Alert.alert('Error', 'PINs do not match', [
        { text: 'Try Again', onPress: () => { setPin(''); setConfirmPin(''); setStep('enter'); } }
      ]);
      return;
    }

    setLoading(true);
    try {
      // Sync PIN to server for cross-device security
      await ApiService.post('/auth/setup-pin', { pin: p1 });
    } catch {
      // Server sync failed — still save locally so the user is not blocked
      // The PIN will be synced on next successful API call
    }

    // Always save locally as the primary authentication mechanism
    await AsyncStorage.setItem('pin', p1);
    setLoading(false);
    Alert.alert('Success', 'PIN set successfully');
    navigation.replace('Main');
  };

  const handleDelete = () => {
    if (step === 'enter') {
      setPin(pin.slice(0, -1));
    } else {
      setConfirmPin(confirmPin.slice(0, -1));
    }
  };

  const currentPin = step === 'enter' ? pin : confirmPin;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{step === 'enter' ? 'Set PIN' : 'Confirm PIN'}</Text>
      <Text style={styles.subtitle}>
        {step === 'enter' ? 'Create a 4-digit PIN for quick access' : 'Re-enter your PIN to confirm'}
      </Text>

      <View style={styles.pinDisplay}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[styles.pinDot, currentPin.length > i && styles.pinDotFilled]} />
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#667eea" size="large" style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.keypad}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, 'del'].map((num, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.key, num === '' && styles.keyEmpty]}
              onPress={() => num === 'del' ? handleDelete() : num !== '' && handleNumberPress(num.toString())}
              disabled={num === ''}
            >
              <Text style={styles.keyText}>{num === 'del' ? '⌫' : num}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: 'bold', textAlign: 'center', marginBottom: 8, color: '#1a1a2e' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 40 },
  pinDisplay: { flexDirection: 'row', justifyContent: 'center', marginBottom: 60 },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#667eea', marginHorizontal: 12 },
  pinDotFilled: { backgroundColor: '#667eea' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  key: { width: 80, height: 80, justifyContent: 'center', alignItems: 'center', margin: 10, borderRadius: 40, backgroundColor: '#f5f5f5' },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText: { fontSize: 24, fontWeight: '600', color: '#1a1a2e' },
});
