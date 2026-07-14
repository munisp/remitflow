import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import {
  checkBiometricAvailability,
  isBiometricLoginEnabled,
  getBiometricSession,
  BiometricType,
} from '../services/biometricService';

export default function LoginScreen() {
  const { setSession } = useAuth();
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricType, setBiometricType] = useState<BiometricType>('none');
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { available, biometryType } = await checkBiometricAvailability();
      if (available) {
        setBiometricType(biometryType);
        const enabled = await isBiometricLoginEnabled();
        setBiometricEnabled(enabled);
        if (enabled) handleBiometricLogin();
      }
    })();
  }, []);

  const handleBiometricLogin = useCallback(async () => {
    setBiometricLoading(true);
    try {
      const session = await getBiometricSession();
      if (session) {
        await setSession(session);
      } else {
        Alert.alert('Biometric Failed', 'Could not verify identity. Please log in with your session token.');
      }
    } catch {
      Alert.alert('Error', 'Biometric authentication failed.');
    } finally {
      setBiometricLoading(false);
    }
  }, [setSession]);

  const handleLogin = async () => {
    if (!sessionId.trim()) {
      Alert.alert('Error', 'Please enter your session token');
      return;
    }
    setLoading(true);
    try {
      await setSession(sessionId.trim());
    } catch {
      Alert.alert('Login Failed', 'Invalid session token. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const biometricIcon = biometricType === 'FaceID' ? '🪪' : biometricType === 'TouchID' ? '👆' : '🔐';
  const biometricLabel =
    biometricType === 'FaceID' ? 'Sign in with Face ID' :
    biometricType === 'TouchID' ? 'Sign in with Touch ID' : 'Sign in with Biometrics';

  return (
    <LinearGradient colors={['#0f0f1a', '#1a1a2e', '#16213e']} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <View style={styles.logoContainer}>
          <Text style={styles.logo}>💸</Text>
          <Text style={styles.title}>RemitFlow</Text>
          <Text style={styles.subtitle}>Cross-Border Remittance Platform</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In</Text>
          <Text style={styles.cardSubtitle}>
            Enter your session token from the web app to continue
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Session token"
            placeholderTextColor="#6b7280"
            value={sessionId}
            onChangeText={setSessionId}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Biometric login button */}
          {biometricEnabled && biometricType !== 'none' && (
            <TouchableOpacity
              style={[styles.button, styles.biometricButton, biometricLoading && styles.buttonDisabled]}
              onPress={handleBiometricLogin}
              disabled={biometricLoading}
            >
              {biometricLoading ? (
                <ActivityIndicator color="#6366f1" />
              ) : (
                <Text style={styles.biometricButtonText}>
                  {biometricIcon} {biometricLabel}
                </Text>
              )}
            </TouchableOpacity>
          )}

          <Text style={styles.hint}>
            Visit remitflow.app on your browser to get your session token from Settings → API Access.
          </Text>
        </View>

        <View style={styles.features}>
          {['150+ Countries', 'Real-time FX', 'Bank-grade Security', 'Instant Transfers'].map((f) => (
            <View key={f} style={styles.featureChip}>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 64, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#9ca3af', marginTop: 4 },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2d2d4e',
    marginBottom: 24,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  cardSubtitle: { fontSize: 13, color: '#9ca3af', marginBottom: 20, lineHeight: 18 },
  input: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2d2d4e',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  biometricButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  biometricButtonText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: '#6b7280', textAlign: 'center', lineHeight: 16, marginTop: 4 },
  features: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  featureChip: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2d2d4e',
  },
  featureText: { color: '#9ca3af', fontSize: 12 },
});
