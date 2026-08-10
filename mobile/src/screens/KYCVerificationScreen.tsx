import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

const API_BASE_URL = 'https://api.remitflow.com';

export default function KYCVerificationScreen() {
  const [selfie, setSelfie] = useState<string | null>(null);
  const [idDocument, setIdDocument] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any>(null);

  const pickImage = async (type: 'selfie' | 'id') => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: type === 'selfie' ? [1, 1] : [4, 3],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      if (type === 'selfie') {
        setSelfie(result.assets[0].base64);
      } else {
        setIdDocument(result.assets[0].base64);
      }
    }
  };

  const handleVerify = async () => {
    if (!selfie || !idDocument) {
      Alert.alert('Error', 'Please capture both selfie and ID document');
      return;
    }

    setIsVerifying(true);
    try {
      const response = await fetch(`${API_BASE_URL}/kyc/full-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-001',
          sessionId: `kyc-${Date.now()}`,
          selfieImage: `data:image/jpeg;base64,${selfie}`,
          idDocumentImage: `data:image/jpeg;base64,${idDocument}`,
        }),
      });

      const result = await response.json();
      setVerificationResult(result);

      if (result.passed) {
        Alert.alert('Success', 'Identity verified successfully!');
      } else {
        Alert.alert('Verification Failed', 'Please try again with better lighting.');
      }
    } catch (error) {
      Alert.alert('Error', 'Verification service unavailable. Please try again later.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Verify Your Identity</Text>
      <Text style={styles.subtitle}>We need to verify your identity to comply with regulations.</Text>

      <View style={styles.steps}>
        {/* Step 1: Selfie */}
        <View style={styles.step}>
          <View style={[styles.stepNumber, selfie && styles.stepComplete]}>
            <Text style={styles.stepNumberText}>1</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Take a Selfie</Text>
            <Text style={styles.stepDescription}>Look straight at the camera in good lighting</Text>
            {selfie ? (
              <Image source={{ uri: `data:image/jpeg;base64,${selfie}` }} style={styles.previewImage} />
            ) : (
              <TouchableOpacity style={styles.captureButton} onPress={() => pickImage('selfie')}>
                <Ionicons name="camera" size={24} color="#635BFF" />
                <Text style={styles.captureText}>Capture Selfie</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Step 2: ID Document */}
        <View style={styles.step}>
          <View style={[styles.stepNumber, idDocument && styles.stepComplete]}>
            <Text style={styles.stepNumberText}>2</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>ID Document</Text>
            <Text style={styles.stepDescription}>Passport, National ID, or Driver's License</Text>
            {idDocument ? (
              <Image source={{ uri: `data:image/jpeg;base64,${idDocument}` }} style={styles.previewImage} />
            ) : (
              <TouchableOpacity style={styles.captureButton} onPress={() => pickImage('id')}>
                <Ionicons name="card" size={24} color="#635BFF" />
                <Text style={styles.captureText}>Capture ID</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Verification Result */}
      {verificationResult && (
        <View style={[styles.resultCard, verificationResult.passed ? styles.resultSuccess : styles.resultFail]}>
          <Ionicons
            name={verificationResult.passed ? 'checkmark-circle' : 'close-circle'}
            size={32}
            color={verificationResult.passed ? '#00D4AA' : '#FF6B6B'}
          />
          <Text style={styles.resultText}>
            {verificationResult.passed ? 'Identity Verified' : 'Verification Failed'}
          </Text>
          {verificationResult.liveness && (
            <Text style={styles.resultDetail}>
              Liveness: {verificationResult.liveness.confidence?.toFixed(2)} confidence
            </Text>
          )}
        </View>
      )}

      {/* Submit Button */}
      <TouchableOpacity
        style={[styles.submitButton, (!selfie || !idDocument || isVerifying) && styles.submitButtonDisabled]}
        onPress={handleVerify}
        disabled={!selfie || !idDocument || isVerifying}
      >
        {isVerifying ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.submitButtonText}>Verify Identity</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        Your biometric data is encrypted and stored securely. We never share it with third parties.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA', padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#0A2540', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B7280', marginBottom: 32 },
  steps: { gap: 24 },
  step: { flexDirection: 'row', gap: 16 },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepComplete: { backgroundColor: '#00D4AA' },
  stepNumberText: { fontSize: 14, fontWeight: 'bold', color: '#374151' },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: 16, fontWeight: '600', color: '#0A2540', marginBottom: 4 },
  stepDescription: { fontSize: 13, color: '#6B7280', marginBottom: 12 },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#635BFF',
    borderRadius: 12,
    padding: 16,
    borderStyle: 'dashed',
  },
  captureText: { color: '#635BFF', fontWeight: '600' },
  previewImage: { width: '100%', height: 180, borderRadius: 12, resizeMode: 'cover' },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
    marginBottom: 16,
  },
  resultSuccess: { borderLeftWidth: 4, borderLeftColor: '#00D4AA' },
  resultFail: { borderLeftWidth: 4, borderLeftColor: '#FF6B6B' },
  resultText: { fontSize: 16, fontWeight: '600', color: '#0A2540' },
  resultDetail: { fontSize: 13, color: '#6B7280' },
  submitButton: {
    backgroundColor: '#00D4AA',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' },
  disclaimer: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 16 },
});
