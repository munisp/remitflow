import ApiService from './ApiService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  phone: string;
  password: string;
}

class AuthService {
  async login(credentials: LoginCredentials) {
    const response = await ApiService.post('/auth/login', credentials);
    if (response.data.token) {
      await AsyncStorage.setItem('auth_token', response.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  }

  async register(data: RegisterData) {
    const response = await ApiService.post('/auth/register', data);
    return response.data;
  }

  async logout() {
    await AsyncStorage.multiRemove(['auth_token', 'user', 'biometric_enabled']);
  }

  async checkBiometricSupport() {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return compatible && enrolled;
  }

  async authenticateWithBiometric() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to access your account',
      fallbackLabel: 'Use PIN',
    });
    return result.success;
  }

  async enableBiometric() {
    await AsyncStorage.setItem('biometric_enabled', 'true');
  }

  async isBiometricEnabled() {
    const enabled = await AsyncStorage.getItem('biometric_enabled');
    return enabled === 'true';
  }

  async getCurrentUser() {
    const userStr = await AsyncStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  }

  async refreshToken() {
    const response = await ApiService.post('/auth/refresh');
    if (response.data.token) {
      await AsyncStorage.setItem('auth_token', response.data.token);
    }
    return response.data;
  }

  async forgotPassword(email: string) {
    const response = await ApiService.post('/auth/forgot-password', { email });
    return response.data;
  }

  async resetPassword(token: string, newPassword: string) {
    const response = await ApiService.post('/auth/reset-password', {
      token,
      password: newPassword,
    });
    return response.data;
  }

  async verifyOTP(code: string) {
    const response = await ApiService.post('/auth/verify-otp', { code });
    return response.data;
  }

  async resendOTP() {
    const response = await ApiService.post('/auth/resend-otp', {});
    return response.data;
  }
}

export default new AuthService();
