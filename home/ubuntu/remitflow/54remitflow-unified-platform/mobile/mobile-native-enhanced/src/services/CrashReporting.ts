// CrashReporting.ts - Production-grade Crash Reporting Integration
// Integrates Sentry for comprehensive error tracking and performance monitoring

import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

// Configuration
const SENTRY_DSN = process.env.SENTRY_DSN || 'https://your-sentry-dsn@sentry.io/project-id';
const ENVIRONMENT = process.env.NODE_ENV || 'development';
const APP_VERSION = DeviceInfo.getVersion();
const BUILD_NUMBER = DeviceInfo.getBuildNumber();

// User context interface
interface UserContext {
  id: string;
  email?: string;
  username?: string;
  agentId?: string;
  tier?: string;
}

// Transaction context for financial operations
interface TransactionContext {
  transactionId: string;
  type: 'cash_in' | 'cash_out' | 'transfer' | 'bill_payment' | 'airtime';
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * CrashReportingService - Centralized crash reporting and error tracking
 * 
 * Features:
 * - Automatic crash detection and reporting
 * - Performance monitoring with custom transactions
 * - User context tracking (anonymized)
 * - Financial transaction tracking
 * - Breadcrumb logging for debugging
 * - Release health monitoring
 */
class CrashReportingService {
  private static instance: CrashReportingService;
  private initialized: boolean = false;
  private currentUser: UserContext | null = null;

  private constructor() {}

  static getInstance(): CrashReportingService {
    if (!CrashReportingService.instance) {
      CrashReportingService.instance = new CrashReportingService();
    }
    return CrashReportingService.instance;
  }

  /**
   * Initialize Sentry with production configuration
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[CRASH_REPORTING] Already initialized');
      return;
    }

    try {
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: ENVIRONMENT,
        release: `com.agentbanking.app@${APP_VERSION}+${BUILD_NUMBER}`,
        dist: BUILD_NUMBER,
        
        // Enable performance monitoring
        tracesSampleRate: ENVIRONMENT === 'production' ? 0.2 : 1.0,
        
        // Enable profiling for performance insights
        profilesSampleRate: ENVIRONMENT === 'production' ? 0.1 : 1.0,
        
        // Capture unhandled promise rejections
        enableAutoPerformanceTracing: true,
        
        // Enable native crash reporting
        enableNative: true,
        enableNativeCrashHandling: true,
        
        // Auto session tracking for release health
        enableAutoSessionTracking: true,
        sessionTrackingIntervalMillis: 30000,
        
        // Attach stack traces to all messages
        attachStacktrace: true,
        
        // Maximum breadcrumbs to keep
        maxBreadcrumbs: 100,
        
        // Debug mode for development
        debug: ENVIRONMENT !== 'production',
        
        // Before send hook for PII scrubbing
        beforeSend: (event, hint) => {
          return this.scrubPII(event);
        },
        
        // Before breadcrumb hook
        beforeBreadcrumb: (breadcrumb, hint) => {
          // Filter out sensitive breadcrumbs
          if (breadcrumb.category === 'xhr' && breadcrumb.data?.url?.includes('password')) {
            return null;
          }
          return breadcrumb;
        },
        
        // Integrations
        integrations: [
          new Sentry.ReactNativeTracing({
            // Trace all fetch requests
            traceFetch: true,
            // Trace XHR requests
            traceXHR: true,
            // Routing instrumentation
            routingInstrumentation: Sentry.reactNavigationIntegration,
            // Enable user interaction tracing
            enableUserInteractionTracing: true,
          }),
        ],
      });

      // Set default tags
      Sentry.setTag('platform', Platform.OS);
      Sentry.setTag('platform_version', Platform.Version.toString());
      Sentry.setTag('app_version', APP_VERSION);
      Sentry.setTag('build_number', BUILD_NUMBER);

      // Set device context
      await this.setDeviceContext();

      this.initialized = true;
      console.log('[CRASH_REPORTING] Sentry initialized successfully');
    } catch (error) {
      console.error('[CRASH_REPORTING] Failed to initialize Sentry:', error);
    }
  }

  /**
   * Set device context for better debugging
   */
  private async setDeviceContext(): Promise<void> {
    try {
      const deviceId = await DeviceInfo.getUniqueId();
      const deviceName = await DeviceInfo.getDeviceName();
      const systemVersion = DeviceInfo.getSystemVersion();
      const brand = DeviceInfo.getBrand();
      const model = DeviceInfo.getModel();
      const isEmulator = await DeviceInfo.isEmulator();
      const hasNotch = DeviceInfo.hasNotch();
      const totalMemory = await DeviceInfo.getTotalMemory();
      const usedMemory = await DeviceInfo.getUsedMemory();

      Sentry.setContext('device_info', {
        device_id_hash: this.hashString(deviceId), // Hash for privacy
        device_name: deviceName,
        system_version: systemVersion,
        brand: brand,
        model: model,
        is_emulator: isEmulator,
        has_notch: hasNotch,
        total_memory_mb: Math.round(totalMemory / 1024 / 1024),
        used_memory_mb: Math.round(usedMemory / 1024 / 1024),
      });
    } catch (error) {
      console.warn('[CRASH_REPORTING] Failed to set device context:', error);
    }
  }

  /**
   * Set user context (anonymized)
   */
  setUser(user: UserContext): void {
    this.currentUser = user;
    
    Sentry.setUser({
      id: this.hashString(user.id), // Hash user ID for privacy
      username: user.username ? this.maskString(user.username) : undefined,
      email: user.email ? this.maskEmail(user.email) : undefined,
    });

    // Set additional user context
    Sentry.setContext('user_context', {
      agent_id_hash: user.agentId ? this.hashString(user.agentId) : undefined,
      tier: user.tier,
    });

    console.log('[CRASH_REPORTING] User context set');
  }

  /**
   * Clear user context on logout
   */
  clearUser(): void {
    this.currentUser = null;
    Sentry.setUser(null);
    console.log('[CRASH_REPORTING] User context cleared');
  }

  /**
   * Capture an exception with context
   */
  captureException(error: Error, context?: Record<string, any>): string {
    const eventId = Sentry.captureException(error, {
      extra: context,
    });

    console.log('[CRASH_REPORTING] Exception captured:', eventId);
    return eventId;
  }

  /**
   * Capture a message with level
   */
  captureMessage(
    message: string,
    level: Sentry.SeverityLevel = 'info',
    context?: Record<string, any>
  ): string {
    const eventId = Sentry.captureMessage(message, {
      level,
      extra: context,
    });

    console.log('[CRASH_REPORTING] Message captured:', eventId);
    return eventId;
  }

  /**
   * Add a breadcrumb for debugging
   */
  addBreadcrumb(
    category: string,
    message: string,
    level: Sentry.SeverityLevel = 'info',
    data?: Record<string, any>
  ): void {
    Sentry.addBreadcrumb({
      category,
      message,
      level,
      data,
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Start a performance transaction
   */
  startTransaction(
    name: string,
    operation: string,
    data?: Record<string, any>
  ): Sentry.Transaction {
    const transaction = Sentry.startTransaction({
      name,
      op: operation,
      data,
    });

    Sentry.getCurrentHub().configureScope((scope) => {
      scope.setSpan(transaction);
    });

    return transaction;
  }

  /**
   * Track a financial transaction
   */
  trackFinancialTransaction(context: TransactionContext): Sentry.Transaction {
    const transaction = this.startTransaction(
      `financial.${context.type}`,
      'financial_transaction',
      {
        transaction_id_hash: this.hashString(context.transactionId),
        type: context.type,
        amount_range: this.getAmountRange(context.amount),
        currency: context.currency,
        status: context.status,
      }
    );

    // Add breadcrumb
    this.addBreadcrumb('financial', `${context.type} transaction started`, 'info', {
      transaction_id_hash: this.hashString(context.transactionId),
      status: context.status,
    });

    return transaction;
  }

  /**
   * Update financial transaction status
   */
  updateFinancialTransaction(
    transaction: Sentry.Transaction,
    status: TransactionContext['status'],
    error?: Error
  ): void {
    transaction.setData('status', status);
    
    if (error) {
      transaction.setStatus('internal_error');
      this.captureException(error, {
        transaction_name: transaction.name,
      });
    } else if (status === 'completed') {
      transaction.setStatus('ok');
    } else if (status === 'failed') {
      transaction.setStatus('internal_error');
    }

    transaction.finish();

    this.addBreadcrumb('financial', `Transaction ${status}`, 
      status === 'failed' ? 'error' : 'info');
  }

  /**
   * Track screen navigation
   */
  trackScreenView(screenName: string, params?: Record<string, any>): void {
    this.addBreadcrumb('navigation', `Viewed ${screenName}`, 'info', params);
    
    Sentry.setContext('current_screen', {
      name: screenName,
      params: params ? this.scrubParams(params) : undefined,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track user action
   */
  trackUserAction(action: string, category: string, data?: Record<string, any>): void {
    this.addBreadcrumb(category, action, 'info', data);
  }

  /**
   * Track API call
   */
  trackAPICall(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number
  ): void {
    this.addBreadcrumb('api', `${method} ${endpoint}`, 
      statusCode >= 400 ? 'error' : 'info', {
        status_code: statusCode,
        duration_ms: duration,
      });
  }

  /**
   * Set custom tag
   */
  setTag(key: string, value: string): void {
    Sentry.setTag(key, value);
  }

  /**
   * Set custom context
   */
  setContext(name: string, context: Record<string, any>): void {
    Sentry.setContext(name, context);
  }

  /**
   * Flush pending events
   */
  async flush(timeout: number = 2000): Promise<boolean> {
    return Sentry.flush(timeout);
  }

  /**
   * Close Sentry client
   */
  async close(): Promise<void> {
    await Sentry.close();
    this.initialized = false;
    console.log('[CRASH_REPORTING] Sentry closed');
  }

  // MARK: - Privacy Helpers

  /**
   * Scrub PII from event before sending
   */
  private scrubPII(event: Sentry.Event): Sentry.Event {
    // Scrub request data
    if (event.request?.data) {
      event.request.data = this.scrubObject(event.request.data);
    }

    // Scrub extra data
    if (event.extra) {
      event.extra = this.scrubObject(event.extra);
    }

    // Scrub breadcrumb data
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
        ...breadcrumb,
        data: breadcrumb.data ? this.scrubObject(breadcrumb.data) : undefined,
      }));
    }

    return event;
  }

  /**
   * Scrub sensitive fields from object
   */
  private scrubObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const sensitiveFields = [
      'password', 'pin', 'token', 'secret', 'key', 'auth',
      'phone', 'email', 'bvn', 'nin', 'account_number',
      'card_number', 'cvv', 'expiry', 'otp'
    ];

    const scrubbed: any = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      if (sensitiveFields.some(field => lowerKey.includes(field))) {
        scrubbed[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        scrubbed[key] = this.scrubObject(value);
      } else {
        scrubbed[key] = value;
      }
    }

    return scrubbed;
  }

  /**
   * Scrub navigation params
   */
  private scrubParams(params: Record<string, any>): Record<string, any> {
    return this.scrubObject(params);
  }

  /**
   * Hash a string for privacy
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Mask a string (show first and last 2 chars)
   */
  private maskString(str: string): string {
    if (str.length <= 4) {
      return '****';
    }
    return `${str.slice(0, 2)}${'*'.repeat(str.length - 4)}${str.slice(-2)}`;
  }

  /**
   * Mask an email address
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '****@****.***';
    
    const maskedLocal = this.maskString(local);
    const [domainName, tld] = domain.split('.');
    const maskedDomain = domainName ? `${domainName[0]}***` : '***';
    
    return `${maskedLocal}@${maskedDomain}.${tld || '***'}`;
  }

  /**
   * Get amount range for privacy (don't log exact amounts)
   */
  private getAmountRange(amount: number): string {
    if (amount < 1000) return '0-1000';
    if (amount < 5000) return '1000-5000';
    if (amount < 10000) return '5000-10000';
    if (amount < 50000) return '10000-50000';
    if (amount < 100000) return '50000-100000';
    if (amount < 500000) return '100000-500000';
    return '500000+';
  }
}

// Export singleton instance
export const crashReporting = CrashReportingService.getInstance();

// Export Sentry error boundary for React components
export { Sentry };

// Error boundary wrapper
export const withErrorBoundary = Sentry.withErrorBoundary;

// Touch event tracking
export const withTouchEventBoundary = Sentry.withTouchEventBoundary;
