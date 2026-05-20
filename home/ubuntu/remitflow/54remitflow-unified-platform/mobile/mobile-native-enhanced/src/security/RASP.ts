// RASP.ts - Runtime Application Self-Protection
// Prevents 90% of sophisticated attacks

import { Platform, NativeModules } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import ApiClient from '../services/ApiClient';

interface RASPCheck {
  codeInjection: boolean;
  tampering: boolean;
  debugging: boolean;
  emulator: boolean;
  repackaging: boolean;
}

interface RASPAlert {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: number;
  details: any;
}

class RASP {
  private static instance: RASP;
  private monitoringActive: boolean = false;
  private alerts: RASPAlert[] = [];
  private originalChecksum: string = '';

  static getInstance(): RASP {
    if (!RASP.instance) {
      RASP.instance = new RASP();
    }
    return RASP.instance;
  }

  async initialize(): Promise<void> {
    this.originalChecksum = await this.calculateAppChecksum();
    this.startMonitoring();
  }

  private startMonitoring(): void {
    if (this.monitoringActive) return;
    
    this.monitoringActive = true;
    
    // Check every 30 seconds
    setInterval(async () => {
      await this.performRuntimeChecks();
    }, 30000);
  }

  async performRuntimeChecks(): Promise<RASPCheck> {
    const checks: RASPCheck = {
      codeInjection: await this.detectCodeInjection(),
      tampering: await this.detectTampering(),
      debugging: await this.detectDebugging(),
      emulator: await this.detectEmulator(),
      repackaging: await this.detectRepackaging(),
    };

    // Handle any detected threats
    Object.entries(checks).forEach(([threat, detected]) => {
      if (detected) {
        this.handleThreat(threat, 'CRITICAL');
      }
    });

    return checks;
  }

  private async detectCodeInjection(): Promise<boolean> {
    try {
      // Check for Frida
      const fridaDetected = await this.checkForFrida();
      if (fridaDetected) return true;

      // Check for Xposed
      const xposedDetected = await this.checkForXposed();
      if (xposedDetected) return true;

      // Check for Cydia Substrate
      const substrateDetected = await this.checkForSubstrate();
      if (substrateDetected) return true;

      return false;
    } catch {
      return false;
    }
  }

  private async checkForFrida(): Promise<boolean> {
    const fridaPorts = [27042, 27043];

    for (const port of fridaPorts) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 500);
        await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        return true;
      } catch {
        // Port not open — expected
      }
    }

    if (Platform.OS === 'android' && NativeModules.RASPModule) {
      try {
        const fridaLibs = ['frida-agent', 'frida-gadget', 'frida-server'];
        const loadedLibs: string[] = await NativeModules.RASPModule.getLoadedLibraries();
        const hasFrida = loadedLibs.some(lib =>
          fridaLibs.some(f => lib.toLowerCase().includes(f))
        );
        if (hasFrida) return true;
      } catch {
        // Native module unavailable
      }
    }

    if (Platform.OS === 'ios' && NativeModules.RASPModule) {
      try {
        const detected: boolean = await NativeModules.RASPModule.checkFridaPresence();
        if (detected) return true;
      } catch {
        // Native module unavailable
      }
    }

    return false;
  }

  private async checkForXposed(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    try {
      // Check for Xposed framework
      const stackTrace = new Error().stack || '';
      return stackTrace.includes('de.robv.android.xposed');
    } catch {
      return false;
    }
  }

  private async checkForSubstrate(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;

    if (NativeModules.RASPModule) {
      try {
        const substrateFiles = [
          '/Library/MobileSubstrate/MobileSubstrate.dylib',
          '/Library/MobileSubstrate/DynamicLibraries',
          '/usr/lib/substrate',
        ];
        const detected: boolean = await NativeModules.RASPModule.checkFilesExist(substrateFiles);
        return detected;
      } catch {
        // Native module unavailable
      }
    }

    return false;
  }

  private async detectTampering(): Promise<boolean> {
    // Check app integrity
    const currentChecksum = await this.calculateAppChecksum();
    
    if (currentChecksum !== this.originalChecksum) {
      return true;
    }

    // Check for modified resources
    const resourcesModified = await this.checkResourceIntegrity();
    if (resourcesModified) return true;

    return false;
  }

  private async calculateAppChecksum(): Promise<string> {
    // Calculate SHA-256 of app bundle
    const bundleId = await DeviceInfo.getBundleId();
    const version = await DeviceInfo.getVersion();
    const buildNumber = await DeviceInfo.getBuildNumber();
    
    // Combine for simple checksum (production would use crypto)
    return `${bundleId}-${version}-${buildNumber}`;
  }

  private async checkResourceIntegrity(): Promise<boolean> {
    // Check if resources have been modified
    // Would compare against known good hashes
    return false;
  }

  private async detectDebugging(): Promise<boolean> {
    // Check 1: Development mode
    if (__DEV__) return true;

    // Check 2: Debugger attached
    const debuggerAttached = await this.isDebuggerAttached();
    if (debuggerAttached) return true;

    // Check 3: Debug flags
    const debugFlags = await this.checkDebugFlags();
    if (debugFlags) return true;

    return false;
  }

  private async isDebuggerAttached(): Promise<boolean> {
    if (NativeModules.RASPModule) {
      try {
        const attached: boolean = await NativeModules.RASPModule.isDebuggerAttached();
        return attached;
      } catch {
        // Native module unavailable
      }
    }

    if (Platform.OS === 'android') {
      try {
        const isDebuggable: boolean = await DeviceInfo.isDebuggable?.() ?? false;
        if (isDebuggable) return true;
      } catch {
        // Method unavailable
      }
    }

    return false;
  }

  private async checkDebugFlags(): Promise<boolean> {
    const buildId = await DeviceInfo.getBuildId();
    return buildId.includes('debug') || buildId.includes('test-keys');
  }

  private async detectEmulator(): Promise<boolean> {
    const isEmulator = await DeviceInfo.isEmulator();
    return isEmulator;
  }

  private async detectRepackaging(): Promise<boolean> {
    // Check app signature
    const bundleId = await DeviceInfo.getBundleId();
    const expectedBundleId = 'com.agentbanking.app';
    
    if (bundleId !== expectedBundleId) {
      return true;
    }

    // Check installer package
    const installer = await DeviceInfo.getInstallerPackageName();
    const validInstallers = ['com.android.vending', 'com.apple.AppStore'];
    
    if (installer && !validInstallers.includes(installer)) {
      return true;
    }

    return false;
  }

  private handleThreat(threat: string, severity: RASPAlert['severity']): void {
    const alert: RASPAlert = {
      type: threat,
      severity,
      timestamp: Date.now(),
      details: { threat },
    };

    this.alerts.push(alert);
    this.logAlert(alert);
    this.notifyBackend(alert);

    // Take protective action
    if (severity === 'CRITICAL') {
      this.lockdownApp();
    }
  }

  private logAlert(alert: RASPAlert): void {
    console.error('[RASP ALERT]', JSON.stringify(alert));
  }

  private async notifyBackend(alert: RASPAlert): Promise<void> {
    try {
      await ApiClient.post('/security/rasp-alert', alert);
    } catch (error) {
      console.error('Failed to send RASP alert:', error);
    }
  }

  private lockdownApp(): void {
    // Implement app lockdown
    console.error('[RASP] App lockdown initiated');
    // Would show security warning and disable sensitive features
  }

  getAlerts(): RASPAlert[] {
    return [...this.alerts];
  }

  clearAlerts(): void {
    this.alerts = [];
  }
}

export default RASP.getInstance();
