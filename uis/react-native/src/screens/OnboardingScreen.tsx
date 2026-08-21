import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ScrollView, Animated, Dimensions, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BiometricService } from '../services/biometricService';
import { PushNotificationService } from '../services/pushNotificationService';
import { PinService, PIN_ENABLED_KEY } from '../services/pinService';

const { width } = Dimensions.get('window');

type Step = 'welcome' | 'pin' | 'biometrics' | 'notifications' | 'done';

interface OnboardingScreenProps {
  onComplete: () => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const [step, setStep] = useState<Step>('welcome');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const steps: Step[] = ['welcome', 'pin', 'biometrics', 'notifications', 'done'];
  const stepIndex = steps.indexOf(step);
  const progress = (stepIndex / (steps.length - 1)) * 100;

  const animateNext = (nextStep: Step) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -width, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setStep(nextStep);
      slideAnim.setValue(width);
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    });
  };

  const handlePinSubmit = async () => {
    if (pin.length < 4) { setPinError('PIN must be at least 4 digits'); return; }
    if (pin !== confirmPin) { setPinError('PINs do not match'); return; }
    try {
      // CLI-005: only a salted hash of the PIN is stored, in keystore-backed
      // storage — the plaintext PIN is never persisted.
      await PinService.setPin(pin);
    } catch {
      setPinError('Could not secure your PIN on this device. Please try again.');
      return;
    }
    await AsyncStorage.setItem(PIN_ENABLED_KEY, 'true');
    setPinError('');
    animateNext('biometrics');
  };

  const handleBiometrics = async (enable: boolean) => {
    if (enable) {
      const available = await BiometricService.isAvailable();
      if (!available) {
        Alert.alert('Not Available', 'Biometric authentication is not available on this device.');
        setBiometricEnabled(false);
        animateNext('notifications');
        return;
      }
      const success = await BiometricService.authenticate('Enable biometric login for RemitFlow');
      if (success) {
        await AsyncStorage.setItem('biometric_enabled', 'true');
        setBiometricEnabled(true);
      }
    } else {
      await AsyncStorage.setItem('biometric_enabled', 'false');
    }
    animateNext('notifications');
  };

  const handleNotifications = async (enable: boolean) => {
    if (enable) {
      const granted = await PushNotificationService.requestPermission();
      if (granted) {
        await AsyncStorage.setItem('notifications_enabled', 'true');
        setNotificationsEnabled(true);
      } else {
        Alert.alert('Permission Denied', 'You can enable notifications later in Settings.');
      }
    } else {
      await AsyncStorage.setItem('notifications_enabled', 'false');
    }
    animateNext('done');
  };

  const handleComplete = async () => {
    await AsyncStorage.setItem('onboarding_completed', 'true');
    onComplete();
  };

  const renderStep = () => {
    switch (step) {
      case 'welcome':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.emoji}>⚡</Text>
            <Text style={styles.title}>Welcome to RemitFlow</Text>
            <Text style={styles.subtitle}>
              Send money across borders instantly. Let's set up your account security in 3 quick steps.
            </Text>
            <View style={styles.featureList}>
              {['🔒 Set a secure PIN', '👆 Enable biometric login', '🔔 Stay notified on transfers'].map((f, i) => (
                <View key={i} style={styles.featureItem}>
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={() => animateNext('pin')}>
              <Text style={styles.primaryButtonText}>Get Started</Text>
            </TouchableOpacity>
          </View>
        );

      case 'pin':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.emoji}>🔒</Text>
            <Text style={styles.title}>Set Your PIN</Text>
            <Text style={styles.subtitle}>Create a 4–6 digit PIN to secure your account</Text>
            <TextInput
              style={styles.pinInput}
              placeholder="Enter PIN"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              keyboardType="numeric"
              maxLength={6}
              value={pin}
              onChangeText={setPin}
            />
            <TextInput
              style={styles.pinInput}
              placeholder="Confirm PIN"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              keyboardType="numeric"
              maxLength={6}
              value={confirmPin}
              onChangeText={setConfirmPin}
            />
            {pinError ? <Text style={styles.errorText}>{pinError}</Text> : null}
            <TouchableOpacity
              style={[styles.primaryButton, (!pin || !confirmPin) && styles.disabledButton]}
              onPress={handlePinSubmit}
              disabled={!pin || !confirmPin}
            >
              <Text style={styles.primaryButtonText}>Set PIN</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => animateNext('biometrics')}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        );

      case 'biometrics':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.emoji}>{Platform.OS === 'ios' ? '😊' : '👆'}</Text>
            <Text style={styles.title}>Enable Biometric Login</Text>
            <Text style={styles.subtitle}>
              Use {Platform.OS === 'ios' ? 'Face ID or Touch ID' : 'fingerprint'} to log in faster and more securely
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => handleBiometrics(true)}>
              <Text style={styles.primaryButtonText}>Enable Biometrics</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => handleBiometrics(false)}>
              <Text style={styles.secondaryButtonText}>Not Now</Text>
            </TouchableOpacity>
          </View>
        );

      case 'notifications':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.emoji}>🔔</Text>
            <Text style={styles.title}>Stay Informed</Text>
            <Text style={styles.subtitle}>
              Get instant notifications for transfer confirmations, FX alerts, and KYC status updates
            </Text>
            <View style={styles.notifList}>
              {['✅ Transfer confirmations', '💱 Favourable exchange rates', '📋 KYC status updates', '🚨 Security alerts'].map((n, i) => (
                <Text key={i} style={styles.notifItem}>{n}</Text>
              ))}
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={() => handleNotifications(true)}>
              <Text style={styles.primaryButtonText}>Enable Notifications</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => handleNotifications(false)}>
              <Text style={styles.secondaryButtonText}>Not Now</Text>
            </TouchableOpacity>
          </View>
        );

      case 'done':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.emoji}>🎉</Text>
            <Text style={styles.title}>You're All Set!</Text>
            <Text style={styles.subtitle}>Your account is secured and ready to use</Text>
            <View style={styles.summaryList}>
              <Text style={styles.summaryItem}>🔒 PIN: Enabled</Text>
              <Text style={styles.summaryItem}>
                👆 Biometrics: {biometricEnabled ? 'Enabled' : 'Skipped'}
              </Text>
              <Text style={styles.summaryItem}>
                🔔 Notifications: {notificationsEnabled ? 'Enabled' : 'Skipped'}
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={handleComplete}>
              <Text style={styles.primaryButtonText}>Start Using RemitFlow</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: `${progress}%` }]} />
      </View>

      {/* Step Indicator */}
      <View style={styles.stepIndicator}>
        {steps.slice(0, -1).map((s, i) => (
          <View key={s} style={[styles.dot, i <= stepIndex - 1 && styles.dotActive, s === step && styles.dotCurrent]} />
        ))}
      </View>

      <Animated.View style={[styles.content, { transform: [{ translateX: slideAnim }] }]}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderStep()}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  progressContainer: { height: 3, backgroundColor: '#1f1f2e', marginTop: Platform.OS === 'ios' ? 50 : 20 },
  progressBar: { height: 3, backgroundColor: '#7c3aed', borderRadius: 2 },
  stepIndicator: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2d2d3f' },
  dotActive: { backgroundColor: '#7c3aed' },
  dotCurrent: { backgroundColor: '#a78bfa', width: 24 },
  content: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  stepContainer: { alignItems: 'center', gap: 16 },
  emoji: { fontSize: 64, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#f9fafb', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#9ca3af', textAlign: 'center', lineHeight: 24, maxWidth: 300 },
  featureList: { gap: 12, marginVertical: 8, width: '100%' },
  featureItem: { backgroundColor: '#1f1f2e', borderRadius: 12, padding: 16 },
  featureText: { color: '#e5e7eb', fontSize: 15 },
  pinInput: {
    width: '100%', backgroundColor: '#1f1f2e', borderRadius: 12, padding: 16,
    color: '#f9fafb', fontSize: 18, letterSpacing: 8, textAlign: 'center',
    borderWidth: 1, borderColor: '#2d2d3f',
  },
  errorText: { color: '#f87171', fontSize: 13 },
  primaryButton: {
    width: '100%', backgroundColor: '#7c3aed', borderRadius: 12,
    padding: 16, alignItems: 'center', marginTop: 8,
  },
  primaryButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    width: '100%', backgroundColor: '#1f1f2e', borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  secondaryButtonText: { color: '#9ca3af', fontSize: 16 },
  disabledButton: { opacity: 0.5 },
  skipText: { color: '#6b7280', fontSize: 14, marginTop: 8 },
  notifList: { gap: 10, marginVertical: 8, width: '100%' },
  notifItem: { color: '#e5e7eb', fontSize: 15, backgroundColor: '#1f1f2e', padding: 12, borderRadius: 10 },
  summaryList: { gap: 10, marginVertical: 8, width: '100%' },
  summaryItem: { color: '#e5e7eb', fontSize: 15, backgroundColor: '#1f1f2e', padding: 12, borderRadius: 10 },
});

export default OnboardingScreen;
