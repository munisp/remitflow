// SecureEnclave.ts - Hardware-backed Secure Storage
// Bank-grade data protection

import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';

interface SecureStorageOptions {
  service?: string;
  accessControl?: Keychain.ACCESS_CONTROL;
  accessible?: Keychain.ACCESSIBLE;
  securityLevel?: Keychain.SECURITY_LEVEL;
}

interface StoredCredentials {
  username: string;
  password: string;
  service: string;
}

class SecureEnclave {
  private static instance: SecureEnclave;

  static getInstance(): SecureEnclave {
    if (!SecureEnclave.instance) {
      SecureEnclave.instance = new SecureEnclave();
    }
    return SecureEnclave.instance;
  }

  async storeBiometricTemplate(userId: string, template: string): Promise<boolean> {
    return await this.store('biometric_template', template, {
      service: `biometric_${userId}`,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    });
  }

  async getBiometricTemplate(userId: string): Promise<string | null> {
    return await this.retrieve('biometric_template', {
      service: `biometric_${userId}`,
    });
  }

  async storeEncryptionKey(keyId: string, key: string): Promise<boolean> {
    return await this.store('encryption_key', key, {
      service: `encryption_${keyId}`,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    });
  }

  async getEncryptionKey(keyId: string): Promise<string | null> {
    return await this.retrieve('encryption_key', {
      service: `encryption_${keyId}`,
    });
  }

  async storeAuthToken(token: string): Promise<boolean> {
    return await this.store('auth_token', token, {
      service: 'authentication',
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    });
  }

  async getAuthToken(): Promise<string | null> {
    return await this.retrieve('auth_token', {
      service: 'authentication',
    });
  }

  async storePINHash(userId: string, pinHash: string): Promise<boolean> {
    return await this.store('pin_hash', pinHash, {
      service: `pin_${userId}`,
      accessControl: Keychain.ACCESS_CONTROL.DEVICE_PASSCODE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    });
  }

  async getPINHash(userId: string): Promise<string | null> {
    return await this.retrieve('pin_hash', {
      service: `pin_${userId}`,
    });
  }

  private async store(
    username: string,
    password: string,
    options: SecureStorageOptions = {}
  ): Promise<boolean> {
    try {
      const keychainOptions: Keychain.Options = {
        service: options.service || 'com.agentbanking.app',
        accessControl: options.accessControl,
        accessible: options.accessible || Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        securityLevel: options.securityLevel || Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
      };

      await Keychain.setGenericPassword(username, password, keychainOptions);
      return true;
    } catch (error) {
      console.error('[SECURE ENCLAVE] Storage failed:', error);
      return false;
    }
  }

  private async retrieve(
    username: string,
    options: SecureStorageOptions = {}
  ): Promise<string | null> {
    try {
      const keychainOptions: Keychain.Options = {
        service: options.service || 'com.agentbanking.app',
      };

      const credentials = await Keychain.getGenericPassword(keychainOptions);
      
      if (credentials && credentials.username === username) {
        return credentials.password;
      }
      
      return null;
    } catch (error) {
      console.error('[SECURE ENCLAVE] Retrieval failed:', error);
      return null;
    }
  }

  async deleteItem(username: string, service?: string): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({
        service: service || 'com.agentbanking.app',
      });
      return true;
    } catch (error) {
      console.error('[SECURE ENCLAVE] Deletion failed:', error);
      return false;
    }
  }

  async clearAll(): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword();
      return true;
    } catch (error) {
      console.error('[SECURE ENCLAVE] Clear all failed:', error);
      return false;
    }
  }

  async isSecureHardwareAvailable(): Promise<boolean> {
    try {
      const level = await Keychain.getSecurityLevel();
      return level === Keychain.SECURITY_LEVEL.SECURE_HARDWARE;
    } catch {
      return false;
    }
  }

  async getSupportedBiometryType(): Promise<string | null> {
    try {
      const biometryType = await Keychain.getSupportedBiometryType();
      return biometryType;
    } catch {
      return null;
    }
  }
}

export default SecureEnclave.getInstance();
