
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';

const rnBiometrics = new ReactNativeBiometrics();

export const BiometricAuth = ({ onSuccess }: any) => {
  const handleBiometricAuth = async () => {
    try {
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();
      
      if (!available) {
        Alert.alert('Error', 'Biometric authentication not available');
        return;
      }

      const { success } = await rnBiometrics.simplePrompt({
        promptMessage: 'Authenticate to continue',
        cancelButtonText: 'Cancel',
      });

      if (success) {
        onSuccess({ biometricType: biometryType });
      } else {
        Alert.alert('Error', 'Authentication failed');
      }
    } catch (error) {
      Alert.alert('Error', 'Biometric authentication error');
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button} onPress={handleBiometricAuth}>
        <Text style={styles.buttonText}>🔐 Use Biometric</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20 },
  button: { backgroundColor: '#10b981', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
