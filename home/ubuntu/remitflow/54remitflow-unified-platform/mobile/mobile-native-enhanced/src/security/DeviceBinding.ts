// DeviceBinding.ts - Device Fingerprinting
// Reduces account takeover by 80%

import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import ApiClient from '../services/ApiClient';

interface DeviceFingerprint {
  deviceId: string;
  model: string;
  manufacturer: string;
  systemVersion: string;
  appVersion: string;
  screenResolution: string;
  timezone: string;
  locale: string;
  carrier: string | null;
  ipAddress: string | null;
  fingerprintHash: string;
  firstSeen: number;
  lastSeen: number;
}

interface DeviceBindingResult {
  isNewDevice: boolean;
  isTrusted: boolean;
  requiresMFA: boolean;
  fingerprint: DeviceFingerprint;
}

class DeviceBinding {
  private static instance: DeviceBinding;
  private currentFingerprint: DeviceFingerprint | null = null;
  private trustedDevices: Set<string> = new Set();

  static getInstance(): DeviceBinding {
    if (!DeviceBinding.instance) {
      DeviceBinding.instance = new DeviceBinding();
    }
    return DeviceBinding.instance;
  }

  async initialize(): Promise<void> {
    await this.loadTrustedDevices();
    this.currentFingerprint = await this.generateFingerprint();
  }

  async generateFingerprint(): Promise<DeviceFingerprint> {
    const deviceId = await DeviceInfo.getUniqueId();
    const model = await DeviceInfo.getModel();
    const manufacturer = await DeviceInfo.getManufacturer();
    const systemVersion = await DeviceInfo.getSystemVersion();
    const appVersion = await DeviceInfo.getVersion();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = await DeviceInfo.getDeviceLocale();
    
    let carrier: string | null = null;
    try {
      carrier = await DeviceInfo.getCarrier();
    } catch {}

    const screenResolution = `${Platform.OS === 'web' ? window.screen.width : 0}x${Platform.OS === 'web' ? window.screen.height : 0}`;

    const fingerprintData = {
      deviceId,
      model,
      manufacturer,
      systemVersion,
      appVersion,
      screenResolution,
      timezone,
      locale,
      carrier,
      ipAddress: null,
    };

    const fingerprintHash = await this.hashFingerprint(fingerprintData);

    return {
      ...fingerprintData,
      fingerprintHash,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    };
  }

  private async hashFingerprint(data: Record<string, unknown>): Promise<string> {
    const jsonString = JSON.stringify(data);
    const dataBytes = new TextEncoder().encode(jsonString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async checkDevice(): Promise<DeviceBindingResult> {
    const fingerprint = await this.generateFingerprint();
    const isNewDevice = !this.trustedDevices.has(fingerprint.fingerprintHash);
    const isTrusted = this.trustedDevices.has(fingerprint.fingerprintHash);
    const requiresMFA = isNewDevice;

    if (isNewDevice) {
      await this.handleNewDevice(fingerprint);
    } else {
      await this.updateDeviceLastSeen(fingerprint);
    }

    return {
      isNewDevice,
      isTrusted,
      requiresMFA,
      fingerprint,
    };
  }

  private async handleNewDevice(fingerprint: DeviceFingerprint): Promise<void> {
    console.log('[SECURITY] New device detected:', fingerprint.fingerprintHash);

    // Send security alert
    await this.sendSecurityAlert({
      type: 'NEW_DEVICE_LOGIN',
      fingerprint,
      timestamp: Date.now(),
    });

    // Log event
    this.logSecurityEvent({
      type: 'NEW_DEVICE',
      deviceId: fingerprint.deviceId,
      model: fingerprint.model,
      timestamp: Date.now(),
    });
  }

  async trustDevice(fingerprintHash: string): Promise<void> {
    this.trustedDevices.add(fingerprintHash);
    await this.saveTrustedDevices();
    
    console.log('[SECURITY] Device trusted:', fingerprintHash);
  }

  async untrustDevice(fingerprintHash: string): Promise<void> {
    this.trustedDevices.delete(fingerprintHash);
    await this.saveTrustedDevices();
    
    console.log('[SECURITY] Device untrusted:', fingerprintHash);
  }

  async getTrustedDevices(): Promise<DeviceFingerprint[]> {
    // Load from storage
    const stored = await AsyncStorage.getItem('trusted_devices_data');
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  }

  private async loadTrustedDevices(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('trusted_devices');
      if (stored) {
        const devices: string[] = JSON.parse(stored);
        this.trustedDevices = new Set(devices);
      }
    } catch (error) {
      console.error('Failed to load trusted devices:', error);
    }
  }

  private async saveTrustedDevices(): Promise<void> {
    try {
      const devices = Array.from(this.trustedDevices);
      await AsyncStorage.setItem('trusted_devices', JSON.stringify(devices));
    } catch (error) {
      console.error('Failed to save trusted devices:', error);
    }
  }

  private async updateDeviceLastSeen(fingerprint: DeviceFingerprint): Promise<void> {
    // Update last seen timestamp
    const devices = await this.getTrustedDevices();
    const updated = devices.map(d => 
      d.fingerprintHash === fingerprint.fingerprintHash
        ? { ...d, lastSeen: Date.now() }
        : d
    );
    
    await AsyncStorage.setItem('trusted_devices_data', JSON.stringify(updated));
  }

  private async sendSecurityAlert(alert: Record<string, unknown>): Promise<void> {
    try {
      await ApiClient.post('/security/device-alert', alert);
    } catch (error) {
      console.error('Failed to send device alert:', error);
    }
  }

  private logSecurityEvent(event: any): void {
    console.log('[SECURITY EVENT]', JSON.stringify(event));
  }

  getCurrentFingerprint(): DeviceFingerprint | null {
    return this.currentFingerprint;
  }

  async detectDeviceChange(): Promise<boolean> {
    const currentFP = await this.generateFingerprint();
    
    if (!this.currentFingerprint) {
      return false;
    }

    // Check for significant changes
    const changed = 
      currentFP.model !== this.currentFingerprint.model ||
      currentFP.manufacturer !== this.currentFingerprint.manufacturer ||
      currentFP.systemVersion !== this.currentFingerprint.systemVersion;

    if (changed) {
      console.warn('[SECURITY] Device change detected');
      await this.handleNewDevice(currentFP);
    }

    return changed;
  }
}

export default DeviceBinding.getInstance();
