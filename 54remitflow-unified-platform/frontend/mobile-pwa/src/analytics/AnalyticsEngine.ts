// AnalyticsEngine.ts - Comprehensive Analytics with Lakehouse Integration
// Tracks: acquisition, onboarding, features, retention, sessions, screens, clicks, errors

import localforage from 'localforage';
import { Platform } from 'react';

interface AnalyticsEvent {
  eventName: string;
  eventType: 'acquisition' | 'onboarding' | 'feature' | 'retention' | 'session' | 'screen' | 'click' | 'error' | 'crash';
  userId?: string;
  sessionId: string;
  timestamp: number;
  properties: Record<string, any>;
  platform: string;
  appVersion: string;
  deviceInfo: DeviceInfo;
}

interface DeviceInfo {
  deviceId: string;
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  locale: string;
  timezone: string;
}

interface UserAcquisition {
  userId: string;
  source: string;
  medium: string;
  campaign: string;
  referrer: string;
  timestamp: number;
}

interface OnboardingMetrics {
  userId: string;
  step: number;
  stepName: string;
  completed: boolean;
  timeSpent: number;
  timestamp: number;
}

interface FeatureAdoption {
  userId: string;
  featureName: string;
  firstUsed: number;
  usageCount: number;
  lastUsed: number;
}

interface RetentionMetrics {
  userId: string;
  installDate: number;
  day1Active: boolean;
  day7Active: boolean;
  day30Active: boolean;
  lastActiveDate: number;
}

interface SessionMetrics {
  sessionId: string;
  userId: string;
  startTime: number;
  endTime: number;
  duration: number;
  screenViews: number;
  clicks: number;
  errors: number;
}

class AnalyticsEngine {
  private static instance: AnalyticsEngine;
  private sessionId: string = '';
  private userId: string = '';
  private sessionStartTime: number = 0;
  private eventQueue: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private lakehouseEndpoint: string = 'https://api.agentbanking.com/lakehouse/events';
  private postgresEndpoint: string = 'https://api.agentbanking.com/analytics/postgres';
  private middlewareEndpoint: string = 'https://api.agentbanking.com/middleware/analytics';

  static getInstance(): AnalyticsEngine {
    if (!AnalyticsEngine.instance) {
      AnalyticsEngine.instance = new AnalyticsEngine();
    }
    return AnalyticsEngine.instance;
  }

  async initialize(userId: string): Promise<void> {
    this.userId = userId;
    this.sessionId = this.generateSessionId();
    this.sessionStartTime = Date.now();

    // Load or create device info
    const deviceInfo = await this.getDeviceInfo();

    // Track session start
    await this.trackEvent('session_start', 'session', {
      deviceInfo,
    });

    // Start auto-flush (every 30 seconds)
    this.startAutoFlush();

    // Track app open
    await this.trackEvent('app_open', 'session', {});

    console.log('[ANALYTICS] Engine initialized');
  }

  // Feature 1: User Acquisition Tracking
  async trackAcquisition(source: string, medium: string, campaign: string, referrer: string): Promise<void> {
    const acquisition: UserAcquisition = {
      userId: this.userId,
      source,
      medium,
      campaign,
      referrer,
      timestamp: Date.now(),
    };

    await this.trackEvent('user_acquisition', 'acquisition', acquisition);

    // Send to Postgres for immediate querying
    await this.sendToPostgres('user_acquisitions', acquisition);

    // Send to Lakehouse for long-term analytics
    await this.sendToLakehouse('acquisitions', acquisition);

    console.log('[ANALYTICS] Acquisition tracked:', source);
  }

  // Feature 2: Onboarding Completion Tracking
  async trackOnboardingStep(step: number, stepName: string, completed: boolean, timeSpent: number): Promise<void> {
    const metrics: OnboardingMetrics = {
      userId: this.userId,
      step,
      stepName,
      completed,
      timeSpent,
      timestamp: Date.now(),
    };

    await this.trackEvent('onboarding_step', 'onboarding', metrics);

    // Send to Postgres for real-time dashboards
    await this.sendToPostgres('onboarding_metrics', metrics);

    // Send to Lakehouse for funnel analysis
    await this.sendToLakehouse('onboarding', metrics);

    // Calculate completion rate
    if (completed && step === 9) {
      await this.trackEvent('onboarding_completed', 'onboarding', {
        totalTime: timeSpent,
      });
    }

    console.log('[ANALYTICS] Onboarding step tracked:', stepName);
  }

  async getOnboardingCompletionRate(): Promise<number> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/onboarding/completion-rate`);
      const data = await response.json();
      return data.completionRate;
    } catch (error) {
      console.error('[ANALYTICS] Failed to get completion rate:', error);
      return 0;
    }
  }

  // Feature 3: Feature Adoption Tracking
  async trackFeatureUsage(featureName: string): Promise<void> {
    const stored = await localforage.getItem(`feature_${featureName}`);
    const adoption: FeatureAdoption = stored
      ? JSON.parse(stored)
      : {
          userId: this.userId,
          featureName,
          firstUsed: Date.now(),
          usageCount: 0,
          lastUsed: Date.now(),
        };

    adoption.usageCount++;
    adoption.lastUsed = Date.now();

    await localforage.setItem(`feature_${featureName}`, JSON.stringify(adoption));

    await this.trackEvent('feature_used', 'feature', {
      featureName,
      usageCount: adoption.usageCount,
      isFirstUse: adoption.usageCount === 1,
    });

    // Send to Postgres for feature adoption dashboards
    await this.sendToPostgres('feature_adoption', adoption);

    // Send to Lakehouse for trend analysis
    await this.sendToLakehouse('features', adoption);

    console.log('[ANALYTICS] Feature usage tracked:', featureName);
  }

  async getFeatureAdoptionRate(featureName: string): Promise<number> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/features/${featureName}/adoption-rate`);
      const data = await response.json();
      return data.adoptionRate;
    } catch (error) {
      console.error('[ANALYTICS] Failed to get adoption rate:', error);
      return 0;
    }
  }

  // Feature 4: Retention Metrics Tracking
  async trackRetention(): Promise<void> {
    const installDateStr = await localforage.getItem('install_date');
    const installDate = installDateStr ? parseInt(installDateStr) : Date.now();

    if (!installDateStr) {
      await localforage.setItem('install_date', installDate.toString());
    }

    const now = Date.now();
    const daysSinceInstall = Math.floor((now - installDate) / (24 * 60 * 60 * 1000));

    const metrics: RetentionMetrics = {
      userId: this.userId,
      installDate,
      day1Active: daysSinceInstall >= 1,
      day7Active: daysSinceInstall >= 7,
      day30Active: daysSinceInstall >= 30,
      lastActiveDate: now,
    };

    await this.trackEvent('retention_check', 'retention', {
      daysSinceInstall,
      ...metrics,
    });

    // Send to Postgres for retention cohorts
    await this.sendToPostgres('retention_metrics', metrics);

    // Send to Lakehouse for cohort analysis
    await this.sendToLakehouse('retention', metrics);

    console.log('[ANALYTICS] Retention tracked:', daysSinceInstall, 'days');
  }

  async getRetentionRates(): Promise<{ day1: number; day7: number; day30: number }> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/retention/rates`);
      const data = await response.json();
      return {
        day1: data.day1Rate,
        day7: data.day7Rate,
        day30: data.day30Rate,
      };
    } catch (error) {
      console.error('[ANALYTICS] Failed to get retention rates:', error);
      return { day1: 0, day7: 0, day30: 0 };
    }
  }

  // Feature 5: Session Duration Tracking
  async trackSessionEnd(): Promise<void> {
    const endTime = Date.now();
    const duration = endTime - this.sessionStartTime;

    const metrics: SessionMetrics = {
      sessionId: this.sessionId,
      userId: this.userId,
      startTime: this.sessionStartTime,
      endTime,
      duration,
      screenViews: await this.getScreenViewCount(),
      clicks: await this.getClickCount(),
      errors: await this.getErrorCount(),
    };

    await this.trackEvent('session_end', 'session', metrics);

    // Send to Postgres for session analytics
    await this.sendToPostgres('session_metrics', metrics);

    // Send to Lakehouse for long-term analysis
    await this.sendToLakehouse('sessions', metrics);

    console.log('[ANALYTICS] Session ended:', duration, 'ms');
  }

  async getAverageSessionDuration(): Promise<number> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/sessions/average-duration`);
      const data = await response.json();
      return data.averageDuration;
    } catch (error) {
      console.error('[ANALYTICS] Failed to get average duration:', error);
      return 0;
    }
  }

  // Feature 6: Screen View Tracking
  async trackScreenView(screenName: string, params?: Record<string, any>): Promise<void> {
    await this.trackEvent('screen_view', 'screen', {
      screenName,
      params,
    });

    // Increment screen view count
    const count = await this.getScreenViewCount();
    await localforage.setItem(`session_${this.sessionId}_screens`, (count + 1).toString());

    // Send to middleware for real-time processing
    await this.sendToMiddleware('screen_views', {
      sessionId: this.sessionId,
      screenName,
      timestamp: Date.now(),
    });

    console.log('[ANALYTICS] Screen view:', screenName);
  }

  // Feature 7: Button Click Tracking
  async trackButtonClick(buttonName: string, screenName: string, metadata?: Record<string, any>): Promise<void> {
    await this.trackEvent('button_click', 'click', {
      buttonName,
      screenName,
      metadata,
    });

    // Increment click count
    const count = await this.getClickCount();
    await localforage.setItem(`session_${this.sessionId}_clicks`, (count + 1).toString());

    // Send to middleware for heatmap generation
    await this.sendToMiddleware('clicks', {
      sessionId: this.sessionId,
      buttonName,
      screenName,
      timestamp: Date.now(),
    });

    console.log('[ANALYTICS] Button click:', buttonName);
  }

  // Feature 8: Error Rate Tracking
  async trackError(errorType: string, errorMessage: string, stackTrace?: string): Promise<void> {
    await this.trackEvent('error', 'error', {
      errorType,
      errorMessage,
      stackTrace,
    });

    // Increment error count
    const count = await this.getErrorCount();
    await localforage.setItem(`session_${this.sessionId}_errors`, (count + 1).toString());

    // Send to Postgres for error analytics
    await this.sendToPostgres('errors', {
      sessionId: this.sessionId,
      userId: this.userId,
      errorType,
      errorMessage,
      stackTrace,
      timestamp: Date.now(),
    });

    console.log('[ANALYTICS] Error tracked:', errorType);
  }

  async getErrorRate(): Promise<number> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/errors/rate`);
      const data = await response.json();
      return data.errorRate;
    } catch (error) {
      console.error('[ANALYTICS] Failed to get error rate:', error);
      return 0;
    }
  }

  // Feature 9: Crash-Free Rate Tracking
  async trackCrash(crashType: string, crashMessage: string, stackTrace: string): Promise<void> {
    await this.trackEvent('crash', 'crash', {
      crashType,
      crashMessage,
      stackTrace,
    });

    // Send to Postgres for crash analytics
    await this.sendToPostgres('crashes', {
      sessionId: this.sessionId,
      userId: this.userId,
      crashType,
      crashMessage,
      stackTrace,
      timestamp: Date.now(),
    });

    // Send to Sentry (via middleware)
    await this.sendToMiddleware('crashes', {
      crashType,
      crashMessage,
      stackTrace,
      userId: this.userId,
    });

    console.log('[ANALYTICS] Crash tracked:', crashType);
  }

  async getCrashFreeRate(): Promise<number> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/crashes/crash-free-rate`);
      const data = await response.json();
      return data.crashFreeRate;
    } catch (error) {
      console.error('[ANALYTICS] Failed to get crash-free rate:', error);
      return 0;
    }
  }

  // Core tracking method
  private async trackEvent(eventName: string, eventType: AnalyticsEvent['eventType'], properties: Record<string, any>): Promise<void> {
    const event: AnalyticsEvent = {
      eventName,
      eventType,
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      properties,
      platform: 'web',
      appVersion: '3.0.0',
      deviceInfo: await this.getDeviceInfo(),
    };

    this.eventQueue.push(event);

    // Flush if queue is large
    if (this.eventQueue.length >= 10) {
      await this.flush();
    }
  }

  // Data pipeline methods
  private async sendToLakehouse(table: string, data: any): Promise<void> {
    try {
      await fetch(`${this.lakehouseEndpoint}/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.error('[ANALYTICS] Lakehouse send failed:', error);
    }
  }

  private async sendToPostgres(table: string, data: any): Promise<void> {
    try {
      await fetch(`${this.postgresEndpoint}/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.error('[ANALYTICS] Postgres send failed:', error);
    }
  }

  private async sendToMiddleware(endpoint: string, data: any): Promise<void> {
    try {
      await fetch(`${this.middlewareEndpoint}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.error('[ANALYTICS] Middleware send failed:', error);
    }
  }

  private async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      // Send batch to all destinations
      await Promise.all([
        this.sendToLakehouse('events', events),
        this.sendToPostgres('events', events),
        this.sendToMiddleware('events', events),
      ]);

      console.log('[ANALYTICS] Flushed', events.length, 'events');
    } catch (error) {
      console.error('[ANALYTICS] Flush failed:', error);
      // Re-queue events
      this.eventQueue.unshift(...events);
    }
  }

  private startAutoFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 30000); // 30 seconds
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      deviceId: await this.getDeviceId(),
      deviceModel: 'web' === 'ios' ? 'iPhone' : 'Android',
      osVersion: Platform.Version.toString(),
      appVersion: '3.0.0',
      locale: 'en-US',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  private async getDeviceId(): Promise<string> {
    let deviceId = await localforage.getItem('device_id');
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await localforage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  private async getScreenViewCount(): Promise<number> {
    const count = await localforage.getItem(`session_${this.sessionId}_screens`);
    return count ? parseInt(count) : 0;
  }

  private async getClickCount(): Promise<number> {
    const count = await localforage.getItem(`session_${this.sessionId}_clicks`);
    return count ? parseInt(count) : 0;
  }

  private async getErrorCount(): Promise<number> {
    const count = await localforage.getItem(`session_${this.sessionId}_errors`);
    return count ? parseInt(count) : 0;
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.trackSessionEnd();
    await this.flush();
  }
}

export default AnalyticsEngine.getInstance();
