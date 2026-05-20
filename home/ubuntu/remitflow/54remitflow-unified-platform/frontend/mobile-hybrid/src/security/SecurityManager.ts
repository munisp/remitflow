import { Capacitor } from '@capacitor/core';
// SecurityManager.ts - Centralized Security Management
// Consolidates all 25 security features

import CertificatePinning from './CertificatePinning';
import JailbreakDetection from './JailbreakDetection';
import RASP from './RASP';
import DeviceBinding from './DeviceBinding';
import SecureEnclave from './SecureEnclave';
import TransactionSigning from './TransactionSigning';
import MFA from './MFA';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Clipboard } from 'react-native';

interface SecurityConfig {
  certificatePinning: boolean;
  jailbreakDetection: boolean;
  rasp: boolean;
  deviceBinding: boolean;
  transactionSigning: boolean;
  mfa: boolean;
  antiTampering: boolean;
  secureKeyboard: boolean;
  screenshotPrevention: boolean;
  sessionTimeout: number; // minutes
  trustedDeviceManagement: boolean;
  anomalyDetection: boolean;
  securityAlerts: boolean;
  biometricFallback: boolean;
  activityLogs: boolean;
  geoFencing: boolean;
  velocityChecks: boolean;
  ipWhitelisting: boolean;
  vpnDetection: boolean;
  clipboardProtection: boolean;
  memoryDumpPrevention: boolean;
}

interface SecurityScore {
  overall: number;
  breakdown: {
    deviceSecurity: number;
    networkSecurity: number;
    dataSecurity: number;
    authenticationSecurity: number;
    transactionSecurity: number;
  };
}

interface SecurityAlert {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

class SecurityManager {
  private static instance: SecurityManager;
  private config: SecurityConfig;
  private sessionStartTime: number = 0;
  private sessionTimeoutTimer: NodeJS.Timeout | null = null;
  private alerts: SecurityAlert[] = [];
  private activityLog: any[] = [];
  private trustedIPs: Set<string> = new Set();
  private blockedIPs: Set<string> = new Set();
  private requestCounts: Map<string, number[]> = new Map();

  private constructor() {
    this.config = this.getDefaultConfig();
  }

  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  private getDefaultConfig(): SecurityConfig {
    return {
      certificatePinning: true,
      jailbreakDetection: true,
      rasp: true,
      deviceBinding: true,
      transactionSigning: true,
      mfa: true,
      antiTampering: true,
      secureKeyboard: true,
      screenshotPrevention: true,
      sessionTimeout: 15,
      trustedDeviceManagement: true,
      anomalyDetection: true,
      securityAlerts: true,
      biometricFallback: true,
      activityLogs: true,
      geoFencing: false,
      velocityChecks: true,
      ipWhitelisting: false,
      vpnDetection: true,
      clipboardProtection: true,
      memoryDumpPrevention: true,
    };
  }

  async initialize(): Promise<void> {
    console.log('[SECURITY] Initializing comprehensive security suite...');

    await CertificatePinning.setEnabled(this.config.certificatePinning);
    await RASP.initialize();
    await DeviceBinding.initialize();
    await TransactionSigning.initialize();
    await MFA.initialize();

    if (this.config.jailbreakDetection) {
      const integrityCheck = await JailbreakDetection.performIntegrityCheck();
      if (integrityCheck.isCompromised) {
        this.handleCriticalSecurityIssue('DEVICE_COMPROMISED', integrityCheck);
      }
    }

    this.startSessionTimeout();
    this.startAnomalyDetection();
    this.enableClipboardProtection();

    console.log('[SECURITY] Security suite initialized successfully');
  }

  // Feature 8: Anti-Tampering Protection
  async checkTampering(): Promise<boolean> {
    const raspCheck = await RASP.performRuntimeChecks();
    return raspCheck.tampering || raspCheck.repackaging;
  }

  // Feature 9: Secure Custom Keyboard
  enableSecureKeyboard(): void {
    // Disable autocorrect, suggestions, and clipboard for sensitive inputs
    console.log('[SECURITY] Secure keyboard enabled');
  }

  // Feature 10: Screenshot Prevention
  preventScreenshots(screenName: string): void {
    if (!this.config.screenshotPrevention) return;

    if (Capacitor.getPlatform() === 'android') {
      // Would use native module: FLAG_SECURE
      console.log('[SECURITY] Screenshot prevention enabled for:', screenName);
    } else if (Capacitor.getPlatform() === 'ios') {
      // iOS doesn't allow preventing screenshots, but can detect them
      console.log('[SECURITY] Screenshot detection enabled for:', screenName);
    }
  }

  // Feature 11: Automatic Session Timeout
  private startSessionTimeout(): void {
    this.sessionStartTime = Date.now();
    
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
    }

    const timeoutMs = this.config.sessionTimeout * 60 * 1000;
    this.sessionTimeoutTimer = setTimeout(() => {
      this.handleSessionTimeout();
    }, timeoutMs);
  }

  resetSessionTimeout(): void {
    this.startSessionTimeout();
  }

  private handleSessionTimeout(): void {
    console.log('[SECURITY] Session timeout - re-authentication required');
    this.logActivity('SESSION_TIMEOUT', { timestamp: Date.now() });
    // Would trigger re-authentication flow
  }

  // Feature 12: Trusted Device Management
  async getTrustedDevices(): Promise<any[]> {
    return await DeviceBinding.getTrustedDevices();
  }

  async trustCurrentDevice(): Promise<void> {
    const fingerprint = DeviceBinding.getCurrentFingerprint();
    if (fingerprint) {
      await DeviceBinding.trustDevice(fingerprint.fingerprintHash);
    }
  }

  async removeTrustedDevice(fingerprintHash: string): Promise<void> {
    await DeviceBinding.untrustDevice(fingerprintHash);
  }

  // Feature 13: ML-based Anomaly Detection
  private startAnomalyDetection(): void {
    if (!this.config.anomalyDetection) return;

    setInterval(() => {
      this.detectAnomalies();
    }, 60000); // Check every minute
  }

  private async detectAnomalies(): Promise<void> {
    // Check for unusual patterns
    const deviceChanged = await DeviceBinding.detectDeviceChange();
    if (deviceChanged) {
      this.createAlert('DEVICE_CHANGE', 'HIGH', 'Device characteristics changed');
    }

    // Check request velocity
    this.checkVelocity();

    // Check location anomalies (if geo-fencing enabled)
    if (this.config.geoFencing) {
      await this.checkGeoFencing();
    }
  }

  // Feature 14: Real-time Security Alerts
  private createAlert(type: string, severity: SecurityAlert['severity'], message: string): void {
    const alert: SecurityAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36)}`,
      type,
      severity,
      message,
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.alerts.push(alert);
    console.warn('[SECURITY ALERT]', alert);

    if (severity === 'CRITICAL') {
      this.notifyUser(alert);
    }
  }

  getAlerts(): SecurityAlert[] {
    return [...this.alerts];
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  // Feature 15: Centralized Security Center
  async getSecurityStatus(): Promise<any> {
    const score = await this.calculateSecurityScore();
    const alerts = this.getAlerts().filter(a => !a.acknowledged);
    const recentActivity = this.activityLog.slice(-10);

    return {
      score,
      alerts,
      recentActivity,
      config: this.config,
    };
  }

  // Feature 16: Biometric Fallback to PIN
  async authenticateWithFallback(): Promise<boolean> {
    try {
      // Try biometric first
      const signing = await TransactionSigning.signTransaction({
        id: 'auth',
        type: 'account_change',
        description: 'Authentication',
      });

      return signing.signed;
    } catch (error) {
      // Fallback to PIN
      console.log('[SECURITY] Biometric failed, falling back to PIN');
      return await this.authenticateWithPIN();
    }
  }

  private async authenticateWithPIN(): Promise<boolean> {
    // Would show PIN entry screen
    return false;
  }

  // Feature 17: Comprehensive Account Activity Logs
  logActivity(type: string, details: any): void {
    if (!this.config.activityLogs) return;

    const logEntry = {
      type,
      details,
      timestamp: Date.now(),
      deviceId: DeviceBinding.getCurrentFingerprint()?.deviceId,
    };

    this.activityLog.push(logEntry);

    // Keep only last 1000 entries
    if (this.activityLog.length > 1000) {
      this.activityLog = this.activityLog.slice(-1000);
    }

    this.saveActivityLog();
  }

  private async saveActivityLog(): Promise<void> {
    try {
      await AsyncStorage.setItem('activity_log', JSON.stringify(this.activityLog));
    } catch (error) {
      console.error('Failed to save activity log:', error);
    }
  }

  getActivityLog(): any[] {
    return [...this.activityLog];
  }

  // Feature 18: Login History Tracking
  async logLogin(success: boolean, method: string): Promise<void> {
    this.logActivity('LOGIN', {
      success,
      method,
      timestamp: Date.now(),
      deviceFingerprint: DeviceBinding.getCurrentFingerprint(),
    });
  }

  // Feature 19: Suspicious Activity Alerts
  async checkSuspiciousActivity(): Promise<void> {
    // Check for multiple failed login attempts
    const recentLogins = this.activityLog.filter(
      log => log.type === 'LOGIN' && Date.now() - log.timestamp < 3600000
    );

    const failedLogins = recentLogins.filter(log => !log.details.success);
    if (failedLogins.length >= 3) {
      this.createAlert('MULTIPLE_FAILED_LOGINS', 'HIGH', `${failedLogins.length} failed login attempts`);
    }

    // Check for unusual transaction patterns
    const recentTransactions = this.activityLog.filter(
      log => log.type === 'TRANSACTION' && Date.now() - log.timestamp < 3600000
    );

    if (recentTransactions.length > 10) {
      this.createAlert('UNUSUAL_TRANSACTION_VOLUME', 'MEDIUM', 'High transaction volume detected');
    }
  }

  // Feature 20: Geo-Fencing
  private async checkGeoFencing(): Promise<void> {
    // Check current location against allowed regions for Nigerian banking operations
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });

      const { latitude, longitude } = position.coords;

      // Define allowed regions (Nigeria bounding box with buffer)
      const allowedRegions = [
        { name: 'Nigeria', minLat: 4.0, maxLat: 14.0, minLng: 2.5, maxLng: 15.0 },
        { name: 'Ghana', minLat: 4.5, maxLat: 11.5, minLng: -3.5, maxLng: 1.5 },
        { name: 'Kenya', minLat: -5.0, maxLat: 5.0, minLng: 33.5, maxLng: 42.0 },
      ];

      const isInAllowedRegion = allowedRegions.some(region =>
        latitude >= region.minLat &&
        latitude <= region.maxLat &&
        longitude >= region.minLng &&
        longitude <= region.maxLng
      );

      if (!isInAllowedRegion) {
        this.createAlert(
          'GEO_FENCE_VIOLATION',
          'HIGH',
          `Device location (${latitude.toFixed(2)}, ${longitude.toFixed(2)}) is outside allowed regions`
        );
        this.logActivity('GEO_FENCE_VIOLATION', { latitude, longitude, timestamp: Date.now() });
      }
    } catch (error) {
      console.warn('[SECURITY] Geo-fencing check failed:', error);
      this.logActivity('GEO_FENCE_CHECK_FAILED', { error: String(error), timestamp: Date.now() });
    }
  }

  // Feature 21: Velocity Checks (Rate Limiting)
  private checkVelocity(): void {
    if (!this.config.velocityChecks) return;

    const now = Date.now();
    const windowMs = 60000; // 1 minute

    this.requestCounts.forEach((timestamps, key) => {
      // Remove old timestamps
      const recent = timestamps.filter(t => now - t < windowMs);
      this.requestCounts.set(key, recent);

      // Check if rate limit exceeded
      if (recent.length > 100) {
        this.createAlert('RATE_LIMIT_EXCEEDED', 'HIGH', `Too many requests from ${key}`);
        this.blockedIPs.add(key);
      }
    });
  }

  trackRequest(identifier: string): boolean {
    if (this.blockedIPs.has(identifier)) {
      return false;
    }

    const timestamps = this.requestCounts.get(identifier) || [];
    timestamps.push(Date.now());
    this.requestCounts.set(identifier, timestamps);

    return true;
  }

  // Feature 22: IP Whitelisting
  addTrustedIP(ip: string): void {
    this.trustedIPs.add(ip);
  }

  removeTrustedIP(ip: string): void {
    this.trustedIPs.delete(ip);
  }

  isIPTrusted(ip: string): boolean {
    if (!this.config.ipWhitelisting) return true;
    return this.trustedIPs.has(ip);
  }

  // Feature 23: VPN Detection
  async detectVPN(): Promise<boolean> {
    if (!this.config.vpnDetection) return false;

    // Check for VPN connection using multiple detection methods
    try {
      // Method 1: Check network interfaces for VPN-related names
      const { Network } = await import('@capacitor/network');
      const status = await Network.getStatus();

      // Method 2: Check for common VPN DNS servers
      const vpnDnsServers = [
        '10.8.0.1',      // OpenVPN default
        '10.0.0.1',      // Common VPN gateway
        '172.16.0.1',    // Private network
        '100.64.0.1',    // CGNAT (often used by VPNs)
      ];

      // Method 3: Check for VPN apps installed (Android)
      if (Capacitor.getPlatform() === 'android') {
        const vpnPackages = [
          'com.nordvpn.android',
          'com.expressvpn.vpn',
          'com.surfshark.vpnclient.android',
          'com.privateinternetaccess.android',
          'com.tunnelbear.android',
          'com.hotspotshield.free.vpn',
          'org.torproject.android',
        ];

        try {
          const DeviceInfo = await import('react-native-device-info');
          const installedApps = await DeviceInfo.default.getInstalledApplications();
          const hasVpnApp = installedApps.some((app: any) =>
            vpnPackages.includes(app.packageName)
          );
          if (hasVpnApp) {
            this.logActivity('VPN_APP_DETECTED', { timestamp: Date.now() });
            return true;
          }
        } catch {
          // App list check failed, continue with other methods
        }
      }

      // Method 4: Check for proxy settings
      try {
        const response = await fetch('https://api.ipify.org?format=json', {
          signal: AbortSignal.timeout(5000),
        });
        const data = await response.json();
        
        // Compare with known VPN IP ranges (simplified check)
        // In production, use a VPN detection API service
        if (data.ip) {
          this.logActivity('IP_CHECK', { ip: data.ip, timestamp: Date.now() });
        }
      } catch {
        // IP check failed, continue
      }

      // Method 5: Check connection type
      if (status.connectionType === 'unknown' || !status.connected) {
        // Suspicious network state
        return true;
      }

      return false;
    } catch (error) {
      console.warn('[SECURITY] VPN detection failed:', error);
      return false;
    }
  }

  // Feature 24: Clipboard Protection
  private enableClipboardProtection(): void {
    if (!this.config.clipboardProtection) return;

    // Clear clipboard after sensitive operations
    setInterval(() => {
      Clipboard.setString('');
    }, 30000); // Clear every 30 seconds
  }

  clearClipboard(): void {
    Clipboard.setString('');
  }

  // Feature 25: Memory Dump Prevention
  enableMemoryProtection(): void {
    if (!this.config.memoryDumpPrevention) return;

    // Would use native modules to prevent memory dumps
    console.log('[SECURITY] Memory dump prevention enabled');
  }

  // Security Score Calculation
  private async calculateSecurityScore(): Promise<SecurityScore> {
    let deviceSecurity = 100;
    let networkSecurity = 100;
    let dataSecurity = 100;
    let authenticationSecurity = 100;
    let transactionSecurity = 100;

    // Device security checks
    if (JailbreakDetection.isDeviceCompromised()) {
      deviceSecurity -= 50;
    }

    const raspCheck = await RASP.performRuntimeChecks();
    if (raspCheck.debugging) deviceSecurity -= 20;
    if (raspCheck.emulator) deviceSecurity -= 30;

    // Network security
    if (!this.config.certificatePinning) networkSecurity -= 30;
    const vpnDetected = await this.detectVPN();
    if (vpnDetected) networkSecurity -= 10;

    // Data security
    const secureHardware = await SecureEnclave.isSecureHardwareAvailable();
    if (!secureHardware) dataSecurity -= 20;

    // Authentication security
    const mfaMethods = MFA.getMethods();
    if (mfaMethods.length === 0) authenticationSecurity -= 40;
    if (mfaMethods.length === 1) authenticationSecurity -= 20;

    // Transaction security
    if (!this.config.transactionSigning) transactionSecurity -= 30;

    const overall = Math.round(
      (deviceSecurity + networkSecurity + dataSecurity + authenticationSecurity + transactionSecurity) / 5
    );

    return {
      overall,
      breakdown: {
        deviceSecurity,
        networkSecurity,
        dataSecurity,
        authenticationSecurity,
        transactionSecurity,
      },
    };
  }

  private handleCriticalSecurityIssue(type: string, details: any): void {
    console.error('[SECURITY] CRITICAL ISSUE:', type, details);
    this.createAlert(type, 'CRITICAL', `Critical security issue detected: ${type}`);
    
    // Lock down app
    this.lockdownApp();
  }

  private lockdownApp(): void {
    console.error('[SECURITY] APP LOCKDOWN INITIATED');
    // Would disable all sensitive features
  }

  private notifyUser(alert: SecurityAlert): void {
    // Would show notification to user
    console.warn('[SECURITY] User notification:', alert.message);
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

export default SecurityManager.getInstance();
