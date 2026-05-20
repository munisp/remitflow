import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  AccessibilityProps,
  TextInput, // Added TextInput
} from 'react-native';
import { useNavigation, NativeStackScreenProps } from '@react-navigation/native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';

// --- Type Definitions ---

// Define the shape of the navigation stack parameters
type RootStackParamList = {
  BiometricAuth: undefined;
  Home: undefined; // Placeholder for the next screen after successful auth
  Login: undefined; // Placeholder for the fallback screen
};

type BiometricAuthScreenProps = NativeStackScreenProps<RootStackParamList, 'BiometricAuth'>;

// Define the shape of the API response for authentication
interface AuthResponse {
  success: boolean;
  token: string;
  message: string;
}

// Define the shape of the component's state
interface BiometricState {
  isSupported: boolean;
  biometryType: BiometryTypes | null;
  isLoading: boolean;
  error: string | null;
}

// --- Constants ---
const AUTH_TOKEN_KEY = '@app:authToken';
const API_BASE_URL = 'https://api.example.com/v1';

// --- Utility Functions (Mocked for Sandbox) ---

/**
 * Mock API call for server-side biometric verification.
 * In a real app, this would send a signed payload from react-native-biometrics
 * to the server for verification.
 */
const mockApiAuth = async (signature: string): Promise<AuthResponse> => {
  try {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // In a real app, replace with:
    // const response = await axios.post(`${API_BASE_URL}/biometric-login`, { signature });
    // return response.data;

    if (signature.length > 10) {
      return {
        success: true,
        token: 'mock-jwt-token-12345',
        message: 'Authentication successful',
      };
    } else {
      throw new Error('Invalid biometric signature.');
    }
  } catch (error) {
    const errorMessage = axios.isAxiosError(error) ? error.message : 'Network Error';
    return { success: false, token: '', message: `API Error: ${errorMessage}` };
  }
};

/**
 * Mock function for integrating with Paystack.
 * In a real app, this would open the Paystack payment modal.
 */
const initiatePaystackPayment = async (amount: number) => {
  Alert.alert('Payment Gateway', `Initiating Paystack payment for ₦${amount}.`);
  // Real implementation would use a library like react-native-paystack
};

/**
 * Mock function for integrating with Flutterwave.
 * In a real app, this would open the Flutterwave payment modal.
 */
const initiateFlutterwavePayment = async (amount: number) => {
  Alert.alert('Payment Gateway', `Initiating Flutterwave payment for ₦${amount}.`);
  // Real implementation would use a library like react-native-flutterwave
};

/**
 * Utility to save a value to AsyncStorage.
 */
const saveToOfflineStorage = async (key: string, value: string) => {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.error('Failed to save to AsyncStorage', e);
  }
};

/**
 * Utility to retrieve a value from AsyncStorage.
 */
const getFromOfflineStorage = async (key: string): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    console.error('Failed to get from AsyncStorage', e);
    return null;
  }
};

// --- Component ---

const BiometricAuthScreen: React.FC<BiometricAuthScreenProps> = () => {
  const navigation = useNavigation<BiometricAuthScreenProps['navigation']>();
  const rnBiometrics = new ReactNativeBiometrics();

  const [state, setState] = useState<BiometricState>({
    isSupported: false,
    biometryType: null,
    isLoading: false,
    error: null,
  });

  const { isSupported, biometryType, isLoading, error } = state;

  // 1. Check Biometric Support on Mount
  useEffect(() => {
    const checkBiometrics = async () => {
      try {
        const { available, biometryType } = await rnBiometrics.isSensorAvailable();

        setState(s => ({
          ...s,
          isSupported: available,
          biometryType: available ? biometryType : null,
          error: available ? null : 'Biometric authentication is not available on this device.',
        }));
      } catch (e) {
        console.error('Biometric check failed:', e);
        setState(s => ({
          ...s,
          isSupported: false,
          biometryType: null,
          error: 'An error occurred while checking biometric support.',
        }));
      }
    };

    checkBiometrics();
  }, []);

  // 2. Biometric Authentication Logic
  const handleBiometricAuth = useCallback(async () => {
    if (!isSupported || isLoading) return;

    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      // Step 1: Create a signature payload (e.g., a nonce or a challenge from the server)
      const epochTimeSeconds = String(Math.round(new Date().getTime() / 1000));
      const payload = `${epochTimeSeconds}some-unique-user-id`;

      // Step 2: Request biometric authentication and sign the payload
      const { success, signature } = await rnBiometrics.createSignature({
        promptMessage: 'Confirm your identity to log in',
        payload: payload,
        cancelButtonText: 'Use Password',
      });

      if (success && signature) {
        // Step 3: Send the signed payload to the server for verification
        const authResult = await mockApiAuth(signature);

        if (authResult.success) {
          // Step 4: Success - Save token and navigate
          await saveToOfflineStorage(AUTH_TOKEN_KEY, authResult.token);
          Alert.alert('Success', 'Logged in successfully with biometrics.');
          navigation.replace('Home');
        } else {
          // Step 4b: API verification failed
          throw new Error(authResult.message || 'Server verification failed.');
        }
      } else {
        // Step 3b: Biometric prompt failed (e.g., user cancelled, too many attempts)
        throw new Error('Biometric authentication failed or was cancelled.');
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred during authentication.';
      Alert.alert('Authentication Failed', errorMessage);
      setState(s => ({ ...s, error: errorMessage }));
    } finally {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, [isSupported, isLoading, navigation, rnBiometrics]);

  // 3. Fallback to Login Screen
  const handleFallback = useCallback(() => {
    navigation.replace('Login');
  }, [navigation]);

  // 4. Example Payment Integration (Form Validation Placeholder)
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const validateAndPay = useCallback(async (gateway: 'paystack' | 'flutterwave') => {
    const amount = parseFloat(paymentAmount);

    if (isNaN(amount) || amount <= 0) {
      setPaymentError('Please enter a valid amount greater than zero.');
      return;
    }

    setPaymentError(null);
    setState(s => ({ ...s, isLoading: true }));

    try {
      if (gateway === 'paystack') {
        await initiatePaystackPayment(amount);
      } else {
        await initiateFlutterwavePayment(amount);
      }
    } catch (e) {
      Alert.alert('Payment Error', 'Failed to initiate payment.');
    } finally {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, [paymentAmount]);

  // --- Accessibility Props and Content ---
  const biometryName = biometryType === BiometryTypes.FaceID ? 'Face ID' : 'Touch ID/Fingerprint';
  const authButtonLabel = `Authenticate with ${biometryName}`;

  const accessibilityProps: AccessibilityProps = {
    accessible: true,
    accessibilityRole: 'button',
    accessibilityLabel: authButtonLabel,
    accessibilityHint: 'Performs biometric authentication to log into the application.',
  };

  // --- Render Logic ---
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Biometric Authentication</Text>

      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Authenticating...</Text>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {isSupported && !isLoading && (
        <TouchableOpacity
          style={styles.authButton}
          onPress={handleBiometricAuth}
          disabled={isLoading}
          {...accessibilityProps}
        >
          <Text style={styles.buttonText}>{authButtonLabel}</Text>
        </TouchableOpacity>
      )}

      {!isSupported && !isLoading && (
        <Text style={styles.infoText}>
          Biometrics not available. Please use the standard login method.
        </Text>
      )}

      <TouchableOpacity
        style={styles.fallbackButton}
        onPress={handleFallback}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel="Fallback to password login"
      >
        <Text style={styles.fallbackButtonText}>Use Password Login</Text>
      </TouchableOpacity>

      {/* Payment Gateway Integration Example */}
      <View style={styles.paymentSection}>
        <Text style={styles.subheader}>Payment Gateway Demo</Text>
        <Text style={styles.label}>Enter Amount (₦):</Text>
        {/* Using TextInput for proper form input and validation */}
        <TextInput
          style={styles.inputPlaceholder}
          onChangeText={setPaymentAmount}
          value={paymentAmount}
          keyboardType="numeric"
          placeholder="e.g., 1000"
          accessibilityLabel="Payment amount input"
        />
        {paymentError && <Text style={styles.paymentErrorText}>{paymentError}</Text>}

        <View style={styles.paymentButtonsContainer}>
          <TouchableOpacity
            style={[styles.paymentButton, { backgroundColor: '#00C389' }]} // Paystack Green
            onPress={() => validateAndPay('paystack')}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Pay with Paystack</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.paymentButton, { backgroundColor: '#FF5733' }]} // Flutterwave Orange
            onPress={() => validateAndPay('flutterwave')}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Pay with Flutterwave</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Documentation Placeholder */}
      <View style={styles.documentation}>
        <Text style={styles.docHeader}>Documentation</Text>
        <Text style={styles.docText}>
          This screen handles biometric authentication using react-native-biometrics.
          It integrates with a mock API via axios, uses AsyncStorage for offline token storage,
          and includes placeholders for Paystack and Flutterwave payment integrations.
          State is managed via React hooks, and navigation uses React Navigation.
        </Text>
      </View>
    </View>
  );
};

// --- Styling ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#333',
  },
  subheader: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 10,
    color: '#555',
  },
  authButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fallbackButton: {
    padding: 10,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
  },
  fallbackButtonText: {
    color: '#007AFF',
    fontSize: 14,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    marginBottom: 15,
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#555',
  },
  errorText: {
    color: 'red',
    textAlign: 'center',
    marginBottom: 15,
    fontSize: 14,
  },
  infoText: {
    textAlign: 'center',
    marginBottom: 15,
    fontSize: 16,
    color: '#777',
  },
  paymentSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  label: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  inputPlaceholder: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 4,
    marginBottom: 15,
    backgroundColor: '#fff',
    color: '#000',
  },
  paymentErrorText: {
    color: 'red',
    marginBottom: 10,
    fontSize: 12,
  },
  paymentButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paymentButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  documentation: {
    marginTop: 40,
    padding: 15,
    backgroundColor: '#eee',
    borderRadius: 8,
  },
  docHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  docText: {
    fontSize: 12,
    color: '#555',
    lineHeight: 18,
  },
});

export default BiometricAuthScreen;
