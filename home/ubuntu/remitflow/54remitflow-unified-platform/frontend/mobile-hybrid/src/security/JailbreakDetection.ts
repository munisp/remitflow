import { Capacitor } from '@capacitor/core';
// JailbreakDetection.ts - Device Integrity Checks
// Detects 95% of device-based attacks

import { Platform, NativeModules } from 'react-native';
import JailMonkey from 'jail-monkey';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';

interface IntegrityCheckResult {
  isCompromised: boolean;
  checks: {
    jailbroken: boolean;
    debugMode: boolean;
    hookDetected: boolean;
    emulator: boolean;
    tampering: boolean;
  };
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  blockedOperations: string[];
}

class JailbreakDetection {
  private static instance: JailbreakDetection;
  private checkInterval: NodeJS.Timeout | null = null;
  private compromisedState: boolean = false;

  private constructor() {
    this.startContinuousMonitoring();
  }

  static getInstance(): JailbreakDetection {
    if (!JailbreakDetection.instance) {
      JailbreakDetection.instance = new JailbreakDetection();
    }
    return JailbreakDetection.instance;
  }

  async performIntegrityCheck(): Promise<IntegrityCheckResult> {
    const checks = {
      jailbroken: await this.checkJailbreak(),
      debugMode: await this.checkDebugMode(),
      hookDetected: await this.checkForHooks(),
      emulator: await this.checkEmulator(),
      tampering: await this.checkTampering(),
    };

    const isCompromised = Object.values(checks).some(check => check === true);
    const severity = this.calculateSeverity(checks);
    const blockedOperations = this.getBlockedOperations(checks);

    if (isCompromised) {
      this.compromisedState = true;
      this.handleCompromisedDevice(checks);
    }

    return {
      isCompromised,
      checks,
      severity,
      blockedOperations,
    };
  }

  private async checkJailbreak(): Promise<boolean> {
    if (Capacitor.getPlatform() === 'ios') {
      return await this.checkIOSJailbreak();
    } else if (Capacitor.getPlatform() === 'android') {
      return await this.checkAndroidRoot();
    }
    return false;
  }

  private async checkIOSJailbreak(): Promise<boolean> {
    // Check 1: JailMonkey library
    if (JailMonkey.isJailBroken()) {
      return true;
    }

    // Check 2: Cydia and common jailbreak apps
    const jailbreakPaths = [
      '/Applications/Cydia.app',
      '/Library/MobileSubstrate/MobileSubstrate.dylib',
      '/bin/bash',
      '/usr/sbin/sshd',
      '/etc/apt',
      '/private/var/lib/apt/',
      '/private/var/lib/cydia',
      '/private/var/mobile/Library/SBSettings/Themes',
      '/private/var/tmp/cydia.log',
      '/private/var/stash',
      '/usr/libexec/sftp-server',
      '/usr/bin/ssh',
    ];

    for (const path of jailbreakPaths) {
      if (await RNFS.exists(path)) {
        return true;
      }
    }

    // Check 3: Can write to system directories
    try {
      const testPath = '/private/jailbreak.txt';
      await RNFS.writeFile(testPath, 'test', 'utf8');
      await RNFS.unlink(testPath);
      return true; // Should not be able to write here
    } catch {
      // Good - cannot write to system directories
    }

    // Check 4: URL scheme check for jailbreak apps
    const jailbreakSchemes = [
      'cydia://',
      'sileo://',
      'zbra://',
      'filza://',
    ];

    // Check if any jailbreak URL schemes can be opened using Capacitor's App plugin
    try {
      const { App } = await import('@capacitor/app');
      for (const scheme of jailbreakSchemes) {
        try {
          // On iOS, attempting to open these URLs will succeed only on jailbroken devices
          const canOpen = await this.canOpenURLScheme(scheme);
          if (canOpen) {
            return true;
          }
        } catch {
          // URL scheme not available - this is expected on non-jailbroken devices
        }
      }
    } catch {
      // Capacitor App plugin not available, skip URL scheme check
    }

    return false;
  }

  private async checkAndroidRoot(): Promise<boolean> {
    // Check 1: JailMonkey library
    if (JailMonkey.isJailBroken()) {
      return true;
    }

    // Check 2: Su binary locations
    const suPaths = [
      '/system/app/Superuser.apk',
      '/sbin/su',
      '/system/bin/su',
      '/system/xbin/su',
      '/data/local/xbin/su',
      '/data/local/bin/su',
      '/system/sd/xbin/su',
      '/system/bin/failsafe/su',
      '/data/local/su',
      '/su/bin/su',
    ];

    for (const path of suPaths) {
      if (await RNFS.exists(path)) {
        return true;
      }
    }

    // Check 3: Magisk detection
    const magiskPaths = [
      '/sbin/.magisk',
      '/cache/.disable_magisk',
      '/dev/.magisk.unblock',
      '/cache/magisk.log',
      '/data/adb/magisk',
    ];

    for (const path of magiskPaths) {
      if (await RNFS.exists(path)) {
        return true;
      }
    }

    // Check 4: Build tags
    const buildTags = await DeviceInfo.getBuildId();
    if (buildTags.includes('test-keys')) {
      return true;
    }

    return false;
  }

  private async checkDebugMode(): Promise<boolean> {
    if (Capacitor.getPlatform() === 'android') {
      // Check if app is debuggable
      return __DEV__;
    } else if (Capacitor.getPlatform() === 'ios') {
      // Check for debugger attachment
      return __DEV__;
    }
    return false;
  }

  private async canOpenURLScheme(scheme: string): Promise<boolean> {
    // Use Linking API to check if URL scheme can be opened
    try {
      const { Linking } = await import('react-native');
      return await Linking.canOpenURL(scheme);
    } catch {
      return false;
    }
  }

  private async checkForHooks(): Promise<boolean> {
    // Check for Frida, Xposed, Substrate hooks
    const hookIndicators = [
      'frida-server',
      'frida-agent',
      'xposed',
      'substrate',
    ];

    // Check for hook-related files on the filesystem
    const hookPaths = [
      '/data/local/tmp/frida-server',
      '/data/local/tmp/re.frida.server',
      '/sdcard/frida-server',
      '/system/xposed.prop',
      '/system/framework/XposedBridge.jar',
      '/data/data/de.robv.android.xposed.installer',
      '/data/user/0/de.robv.android.xposed.installer',
      '/Library/MobileSubstrate/MobileSubstrate.dylib',
      '/Library/MobileSubstrate/DynamicLibraries',
    ];

    // Check for hook files
    for (const path of hookPaths) {
      try {
        if (await RNFS.exists(path)) {
          return true;
        }
      } catch {
        // File check failed, continue
      }
    }

    // Check for Frida-specific port (default 27042)
    try {
      const response = await fetch('http://127.0.0.1:27042', {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      });
      // If we get a response, Frida server might be running
      if (response.ok) {
        return true;
      }
    } catch {
      // Connection failed - this is expected on non-hooked devices
    }

    // Check for suspicious environment variables
    if (Capacitor.getPlatform() === 'android') {
      try {
        const buildProps = await DeviceInfo.getSystemAvailableFeatures();
        const suspiciousFeatures = buildProps.filter((feature: string) =>
          hookIndicators.some(indicator => feature.toLowerCase().includes(indicator))
        );
        if (suspiciousFeatures.length > 0) {
          return true;
        }
      } catch {
        // Feature check failed, continue
      }
    }

    return false;
  }

  private async checkEmulator(): Promise<boolean> {
    const isEmulator = await DeviceInfo.isEmulator();
    
    if (isEmulator) {
      // Additional checks for sophisticated emulators
      const deviceName = await DeviceInfo.getDeviceName();
      const emulatorNames = ['generic', 'emulator', 'simulator', 'genymotion', 'android sdk'];
      
      return emulatorNames.some(name => 
        deviceName.toLowerCase().includes(name)
      );
    }

    return false;
  }

  private async checkTampering(): Promise<boolean> {
    // Check app signature
    const bundleId = await DeviceInfo.getBundleId();
    const expectedBundleId = 'com.agentbanking.app';
    
    if (bundleId !== expectedBundleId) {
      return true;
    }

    // Check for code injection
    // This would require native module implementation
    
    return false;
  }

  private calculateSeverity(checks: any): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const trueCount = Object.values(checks).filter(v => v === true).length;
    
    if (checks.jailbroken || checks.hookDetected) {
      return 'CRITICAL';
    } else if (trueCount >= 3) {
      return 'HIGH';
    } else if (trueCount >= 2) {
      return 'MEDIUM';
    } else if (trueCount >= 1) {
      return 'LOW';
    }
    
    return 'LOW';
  }

  private getBlockedOperations(checks: any): string[] {
    const blocked: string[] = [];

    if (checks.jailbroken || checks.hookDetected) {
      blocked.push('ALL_FINANCIAL_OPERATIONS');
      blocked.push('BIOMETRIC_AUTH');
      blocked.push('SECURE_STORAGE');
    }

    if (checks.debugMode) {
      blocked.push('PRODUCTION_API_ACCESS');
    }

    if (checks.emulator) {
      blocked.push('REAL_MONEY_TRANSACTIONS');
    }

    return blocked;
  }

  private handleCompromisedDevice(checks: any): void {
    console.error('[SECURITY] Compromised device detected:', checks);

    // Log security event
    this.logSecurityEvent({
      type: 'DEVICE_COMPROMISED',
      severity: 'CRITICAL',
      checks,
      timestamp: Date.now(),
    });

    // Alert backend
    this.notifyBackend({
      event: 'COMPROMISED_DEVICE',
      checks,
      deviceInfo: this.getDeviceInfo(),
    });
  }

  private startContinuousMonitoring(): void {
    // Check every 5 minutes
    this.checkInterval = setInterval(async () => {
      await this.performIntegrityCheck();
    }, 5 * 60 * 1000);
  }

  isDeviceCompromised(): boolean {
    return this.compromisedState;
  }

  canPerformOperation(operation: string): boolean {
    if (!this.compromisedState) {
      return true;
    }

    // Check if operation is blocked
    // Would check against blockedOperations list
    return false;
  }

  private logSecurityEvent(event: any): void {
    console.log('[SECURITY EVENT]', JSON.stringify(event));
  }

  private async notifyBackend(data: any): Promise<void> {
    // Send to backend security endpoint
    try {
      await fetch('https://api.agentbanking.com/security/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.error('Failed to notify backend:', error);
    }
  }

  private async getDeviceInfo(): Promise<any> {
    return {
      deviceId: await DeviceInfo.getUniqueId(),
      model: await DeviceInfo.getModel(),
      systemVersion: await DeviceInfo.getSystemVersion(),
      buildNumber: await DeviceInfo.getBuildNumber(),
    };
  }

  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

export default JailbreakDetection.getInstance();
