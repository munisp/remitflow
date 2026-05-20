/**
 * Crash Reporting Service for PWA and Mobile
 * 
 * Features:
 * - Sentry integration for error tracking
 * - Custom error boundaries
 * - Performance monitoring
 * - User feedback collection
 * - Breadcrumb tracking
 */

import * as Sentry from '@sentry/react';
import { BrowserTracing } from '@sentry/tracing';

export interface ErrorContext {
  userId?: string;
  agentId?: string;
  transactionId?: string;
  screen?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface UserFeedback {
  name: string;
  email: string;
  comments: string;
  eventId?: string;
}

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

class CrashReportingService {
  private static instance: CrashReportingService;
  private initialized = false;
  private userId: string | null = null;
  private sessionId: string;

  private constructor() {
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  static getInstance(): CrashReportingService {
    if (!CrashReportingService.instance) {
      CrashReportingService.instance = new CrashReportingService();
    }
    return CrashReportingService.instance;
  }

  /**
   * Initialize crash reporting
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    const dsn = process.env.REACT_APP_SENTRY_DSN;
    const environment = process.env.REACT_APP_ENV || 'development';
    const release = process.env.REACT_APP_VERSION || '1.0.0';

    if (!dsn) {
      console.warn('[CRASH] Sentry DSN not configured, crash reporting disabled');
      return;
    }

    try {
      Sentry.init({
        dsn,
        environment,
        release: `remittance@${release}`,
        
        // Performance monitoring
        integrations: [
          new BrowserTracing({
            tracingOrigins: [
              'localhost',
              /^https:\/\/.*\.remittance\.com/,
              /^https:\/\/api\.remittance\.com/
            ],
            routingInstrumentation: Sentry.reactRouterV6Instrumentation
          })
        ],
        
        // Sample rates
        tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        
        // Before send hook
        beforeSend: (event, hint) => {
          return this.beforeSend(event, hint);
        },
        
        // Before breadcrumb hook
        beforeBreadcrumb: (breadcrumb) => {
          return this.beforeBreadcrumb(breadcrumb);
        },
        
        // Ignore specific errors
        ignoreErrors: [
          'ResizeObserver loop limit exceeded',
          'ResizeObserver loop completed with undelivered notifications',
          'Non-Error promise rejection captured',
          /Loading chunk \d+ failed/,
          /Network request failed/,
          'AbortError'
        ],
        
        // Deny URLs
        denyUrls: [
          /extensions\//i,
          /^chrome:\/\//i,
          /^chrome-extension:\/\//i,
          /^moz-extension:\/\//i
        ]
      });

      // Set initial context
      Sentry.setTag('session_id', this.sessionId);
      Sentry.setTag('platform', this.getPlatform());
      Sentry.setContext('app', {
        version: release,
        environment,
        platform: this.getPlatform()
      });

      this.initialized = true;
      console.log('[CRASH] Crash reporting initialized');
    } catch (error) {
      console.error('[CRASH] Failed to initialize Sentry:', error);
    }
  }

  /**
   * Set user context
   */
  setUser(userId: string, email?: string, username?: string): void {
    this.userId = userId;
    
    Sentry.setUser({
      id: userId,
      email,
      username
    });

    console.log('[CRASH] User context set:', userId);
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    this.userId = null;
    Sentry.setUser(null);
    console.log('[CRASH] User context cleared');
  }

  /**
   * Capture an exception
   */
  captureException(error: Error, context?: ErrorContext): string {
    if (!this.initialized) {
      console.error('[CRASH] Not initialized, error not reported:', error);
      return '';
    }

    const eventId = Sentry.captureException(error, {
      tags: {
        screen: context?.screen,
        action: context?.action
      },
      extra: {
        userId: context?.userId || this.userId,
        agentId: context?.agentId,
        transactionId: context?.transactionId,
        ...context?.metadata
      }
    });

    console.log('[CRASH] Exception captured:', eventId);
    return eventId;
  }

  /**
   * Capture a message
   */
  captureMessage(message: string, severity: ErrorSeverity = 'info', context?: ErrorContext): string {
    if (!this.initialized) {
      console.log('[CRASH] Not initialized, message not reported:', message);
      return '';
    }

    const eventId = Sentry.captureMessage(message, {
      level: severity,
      tags: {
        screen: context?.screen,
        action: context?.action
      },
      extra: {
        userId: context?.userId || this.userId,
        agentId: context?.agentId,
        transactionId: context?.transactionId,
        ...context?.metadata
      }
    });

    console.log('[CRASH] Message captured:', eventId);
    return eventId;
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(
    message: string,
    category: string,
    data?: Record<string, unknown>,
    level: ErrorSeverity = 'info'
  ): void {
    Sentry.addBreadcrumb({
      message,
      category,
      data,
      level,
      timestamp: Date.now() / 1000
    });
  }

  /**
   * Start a transaction for performance monitoring
   */
  startTransaction(name: string, op: string): ReturnType<typeof Sentry.startTransaction> {
    return Sentry.startTransaction({
      name,
      op
    });
  }

  /**
   * Set extra context
   */
  setContext(name: string, context: Record<string, unknown>): void {
    Sentry.setContext(name, context);
  }

  /**
   * Set tag
   */
  setTag(key: string, value: string): void {
    Sentry.setTag(key, value);
  }

  /**
   * Submit user feedback
   */
  submitFeedback(feedback: UserFeedback): void {
    if (!this.initialized) {
      console.warn('[CRASH] Not initialized, feedback not submitted');
      return;
    }

    const eventId = feedback.eventId || Sentry.lastEventId();
    
    if (eventId) {
      Sentry.captureUserFeedback({
        event_id: eventId,
        name: feedback.name,
        email: feedback.email,
        comments: feedback.comments
      });
      console.log('[CRASH] User feedback submitted for event:', eventId);
    }
  }

  /**
   * Show feedback dialog
   */
  showFeedbackDialog(eventId?: string): void {
    if (!this.initialized) {
      return;
    }

    Sentry.showReportDialog({
      eventId: eventId || Sentry.lastEventId(),
      title: 'Something went wrong',
      subtitle: 'Our team has been notified.',
      subtitle2: 'If you\'d like to help, tell us what happened below.',
      labelName: 'Name',
      labelEmail: 'Email',
      labelComments: 'What happened?',
      labelClose: 'Close',
      labelSubmit: 'Submit',
      successMessage: 'Thank you for your feedback!'
    });
  }

  /**
   * Create error boundary wrapper
   */
  createErrorBoundary(fallback: React.ReactNode): React.ComponentType {
    return Sentry.withErrorBoundary(
      ({ children }: { children: React.ReactNode }) => <>{children}</>,
      {
        fallback,
        showDialog: true,
        onError: (error, componentStack) => {
          console.error('[CRASH] Error boundary caught:', error);
          this.addBreadcrumb(
            'Error boundary triggered',
            'error',
            { componentStack },
            'error'
          );
        }
      }
    );
  }

  /**
   * Wrap component with profiler
   */
  withProfiler<P extends object>(
    Component: React.ComponentType<P>,
    name: string
  ): React.ComponentType<P> {
    return Sentry.withProfiler(Component, { name });
  }

  /**
   * Before send hook - filter/modify events
   */
  private beforeSend(
    event: Sentry.Event,
    hint: Sentry.EventHint
  ): Sentry.Event | null {
    // Filter out certain errors
    const error = hint.originalException;
    
    if (error instanceof Error) {
      // Don't report network errors in offline mode
      if (!navigator.onLine && error.message.includes('network')) {
        return null;
      }
      
      // Don't report user-cancelled operations
      if (error.name === 'AbortError') {
        return null;
      }
    }

    // Sanitize sensitive data
    if (event.request?.data) {
      event.request.data = this.sanitizeData(event.request.data);
    }

    // Add device info
    event.contexts = {
      ...event.contexts,
      device: {
        online: navigator.onLine,
        memory: (navigator as any).deviceMemory,
        cores: navigator.hardwareConcurrency
      }
    };

    return event;
  }

  /**
   * Before breadcrumb hook - filter/modify breadcrumbs
   */
  private beforeBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
    // Filter out noisy breadcrumbs
    if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
      return null;
    }

    // Sanitize URLs
    if (breadcrumb.data?.url) {
      breadcrumb.data.url = this.sanitizeUrl(breadcrumb.data.url);
    }

    return breadcrumb;
  }

  /**
   * Sanitize sensitive data
   */
  private sanitizeData(data: string | Record<string, unknown>): string | Record<string, unknown> {
    const sensitiveKeys = ['password', 'pin', 'token', 'secret', 'key', 'auth'];
    
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return JSON.stringify(this.sanitizeObject(parsed, sensitiveKeys));
      } catch {
        return data;
      }
    }
    
    return this.sanitizeObject(data, sensitiveKeys);
  }

  /**
   * Sanitize object by removing sensitive keys
   */
  private sanitizeObject(
    obj: Record<string, unknown>,
    sensitiveKeys: string[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitizeObject(value as Record<string, unknown>, sensitiveKeys);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Sanitize URL by removing sensitive query params
   */
  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const sensitiveParams = ['token', 'key', 'secret', 'auth', 'password'];
      
      sensitiveParams.forEach(param => {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.set(param, '[REDACTED]');
        }
      });
      
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Get platform info
   */
  private getPlatform(): string {
    const ua = navigator.userAgent;
    
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac/.test(ua)) return 'macos';
    if (/Linux/.test(ua)) return 'linux';
    
    return 'web';
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get last event ID
   */
  getLastEventId(): string | undefined {
    return Sentry.lastEventId();
  }

  /**
   * Flush pending events
   */
  async flush(timeout = 2000): Promise<boolean> {
    return Sentry.flush(timeout);
  }

  /**
   * Close Sentry client
   */
  async close(timeout = 2000): Promise<boolean> {
    return Sentry.close(timeout);
  }
}

// Export singleton instance
export default CrashReportingService.getInstance();

// Export Sentry error boundary for React
export const ErrorBoundary = Sentry.ErrorBoundary;

// Export profiler HOC
export const withProfiler = Sentry.withProfiler;
