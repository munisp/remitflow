import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import BiometricService from '../../services/BiometricService';

export const BiometricSetupScreen = ({ navigation }: any) => {
  const [available, setAvailable] = useState(false);
  const [types, setTypes] = useState<string[]>([]);

  useEffect(() => {
    checkBiometric();
  }, []);

  const checkBiometric = async () => {
    const isAvailable = await BiometricService.isAvailable();
    setAvailable(isAvailable);
    if (isAvailable) {
      const supportedTypes = await BiometricService.getSupportedTypes();
      setTypes(supportedTypes);
    }
  };

  const handleEnable = async () => {
    const success = await BiometricService.authenticate('Set up biometric authentication');
    if (success) {
      await BiometricService.enable();
      Alert.alert('Success', 'Biometric authentication enabled');
      navigation.replace('Main');
    }
  };

  const handleSkip = () => {
    navigation.replace('Main');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Biometric Authentication</Text>
      <Text style={styles.subtitle}>
        {available ? `Enable ${types.join(' or ')} for quick access` : 'Not available on this device'}
      </Text>

      {available && (
        <TouchableOpacity style={styles.button} onPress={handleEnable}>
          <Text style={styles.buttonText}>Enable Biometric</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={handleSkip}>
        <Text style={styles.linkText}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 10, color: '#333', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 40, textAlign: 'center' },
  button: { backgroundColor: '#667eea', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 15 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { color: '#667eea', textAlign: 'center', marginTop: 20 },
});
