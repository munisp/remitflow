import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import AuthService from '../../services/AuthService';

const RESEND_COOLDOWN_SECONDS = 60;

export const OTPVerificationScreen = ({ navigation, route }: any) => {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(RESEND_COOLDOWN_SECONDS);
  const [canResend, setCanResend] = useState(false);

  useEffect(() => {
    if (resendCountdown <= 0) {
      setCanResend(true);
      return;
    }
    const timer = setTimeout(() => {
      setResendCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit OTP');
      return;
    }
    setLoading(true);
    try {
      await AuthService.verifyOTP(otp);
      Alert.alert('Success', 'OTP verified successfully');
      navigation.replace('Main');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = useCallback(async () => {
    if (!canResend || resendLoading) return;
    setResendLoading(true);
    try {
      await AuthService.resendOTP();
      setOtp('');
      setCanResend(false);
      setResendCountdown(RESEND_COOLDOWN_SECONDS);
      Alert.alert('OTP Sent', 'A new OTP has been sent to your phone.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to resend OTP. Please try again.');
    } finally {
      setResendLoading(false);
    }
  }, [canResend, resendLoading]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter OTP</Text>
      <Text style={styles.subtitle}>We sent a 6-digit code to your phone</Text>
      <TextInput
        style={styles.input}
        placeholder="000000"
        placeholderTextColor="#bbb"
        value={otp}
        onChangeText={setOtp}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />
      <TouchableOpacity
        style={[styles.button, (loading || otp.length !== 6) && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={loading || otp.length !== 6}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Verify OTP</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.resendButton, !canResend && styles.resendButtonDisabled]}
        onPress={handleResend}
        disabled={!canResend || resendLoading}
      >
        {resendLoading ? (
          <ActivityIndicator color="#667eea" size="small" />
        ) : (
          <Text style={[styles.linkText, !canResend && styles.linkTextDisabled]}>
            {canResend ? 'Resend OTP' : `Resend in ${resendCountdown}s`}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 10, color: '#1a1a2e' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 32 },
  input: { borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12, padding: 16, marginBottom: 20, fontSize: 28, textAlign: 'center', letterSpacing: 12, color: '#1a1a2e', backgroundColor: '#f9f9f9' },
  button: { backgroundColor: '#667eea', padding: 16, borderRadius: 12, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  buttonDisabled: { backgroundColor: '#b0b8f8' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resendButton: { marginTop: 20, alignItems: 'center', padding: 8 },
  resendButtonDisabled: { opacity: 0.6 },
  linkText: { color: '#667eea', fontSize: 15, fontWeight: '500' },
  linkTextDisabled: { color: '#999' },
});
