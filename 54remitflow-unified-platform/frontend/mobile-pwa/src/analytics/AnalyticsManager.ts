// AnalyticsManager.ts - Tools 3-10 Consolidated
// Sentry, Performance, Feature Flags, Feedback, Recording, Heatmaps, Funnels, Revenue

import localforage from 'localforage';

interface CrashReport {
  crashId: string;
  userId: string;
  errorType: string;
  errorMessage: string;
  stackTrace: string;
  breadcrumbs: Breadcrumb[];
  deviceInfo: any;
  timestamp: number;
}

interface Breadcrumb {
  category: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  timestamp: number;
}

interface PerformanceMetric {
  metricName: string;
  value: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface FeatureFlag {
  flagId: string;
  name: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetUsers?: string[];
}

interface UserFeedback {
  feedbackId: string;
  userId: string;
  type: 'bug' | 'feature' | 'general';
  rating: number;
  comment: string;
  screenshot?: string;
  timestamp: number;
}

interface SessionRecording {
  sessionId: string;
  userId: string;
  events: RecordingEvent[];
  duration: number;
  timestamp: number;
}

interface RecordingEvent {
  type: 'screen' | 'click' | 'input' | 'scroll';
  data: any;
  timestamp: number;
}

interface HeatmapData {
  screenName: string;
  clicks: ClickData[];
  scrollDepth: number[];
  timestamp: number;
}

interface ClickData {
  x: number;
  y: number;
  elementName: string;
  timestamp: number;
}

interface FunnelStep {
  stepId: string;
  stepName: string;
  entered: number;
  completed: number;
  dropped: number;
  conversionRate: number;
}

interface RevenueEvent {
  eventId: string;
  userId: string;
  eventType: 'purchase' | 'subscription' | 'refund';
  amount: number;
  currency: string;
  productId: string;
  transactionId: string;
  timestamp: number;
}

class AnalyticsManager {
  private static instance: AnalyticsManager;
  private breadcrumbs: Breadcrumb[] = [];
  private recordingEvents: RecordingEvent[] = [];
  private heatmapClicks: ClickData[] = [];
  
  private postgresEndpoint: string = 'https://api.agentbanking.com/analytics/postgres';
  private middlewareEndpoint: string = 'https://api.agentbanking.com/middleware/analytics';
  private lakehouseEndpoint: string = 'https://api.agentbanking.com/lakehouse/events';
  private sentryEndpoint: string = 'https://api.agentbanking.com/middleware/sentry';
  private tigerBeetleEndpoint: string = 'https://api.agentbanking.com/tigerbeetle/revenue';

  static getInstance(): AnalyticsManager {
    if (!AnalyticsManager.instance) {
      AnalyticsManager.instance = new AnalyticsManager();
    }
    return AnalyticsManager.instance;
  }

  async initialize(): Promise<void> {
    await this.setupGlobalErrorHandler();
    await this.startPerformanceMonitoring();
    await this.startSessionRecording();
    console.log('[ANALYTICS_MGR] Manager initialized');
  }

  // Tool 3: Sentry Crash Reporting
  async reportCrash(error: Error, context?: Record<string, any>): Promise<void> {
    const report: CrashReport = {
      crashId: `crash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: await this.getUserId(),
      errorType: error.name,
      errorMessage: error.message,
      stackTrace: error.stack || '',
      breadcrumbs: this.breadcrumbs.slice(-20), // Last 20 breadcrumbs
      deviceInfo: await this.getDeviceInfo(),
      timestamp: Date.now(),
    };

    // Send to Sentry via middleware
    await fetch(`${this.sentryEndpoint}/crashes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });

    // Send to Postgres for crash analytics
    await fetch(`${this.postgresEndpoint}/crashes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });

    // Send to Lakehouse for long-term analysis
    await fetch(`${this.lakehouseEndpoint}/crashes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });

    console.log('[SENTRY] Crash reported:', report.crashId);
  }

  addBreadcrumb(category: string, message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    this.breadcrumbs.push({
      category,
      message,
      level,
      timestamp: Date.now(),
    });

    // Keep only last 100 breadcrumbs
    if (this.breadcrumbs.length > 100) {
      this.breadcrumbs = this.breadcrumbs.slice(-100);
    }
  }

  private async setupGlobalErrorHandler(): Promise<void> {
    const originalHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler(async (error, isFatal) => {
      await this.reportCrash(error);
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });
  }

  // Tool 4: Firebase Performance Monitoring
  async trackPerformance(metricName: string, value: number, metadata?: Record<string, any>): Promise<void> {
    const metric: PerformanceMetric = {
      metricName,
      value,
      timestamp: Date.now(),
      metadata,
    };

    // Send to Postgres for real-time dashboards
    await fetch(`${this.postgresEndpoint}/performance_metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metric),
    });

    // Send to Lakehouse for trend analysis
    await fetch(`${this.lakehouseEndpoint}/performance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metric),
    });

    console.log('[PERFORMANCE] Metric tracked:', metricName, value);
  }

  private async startPerformanceMonitoring(): Promise<void> {
    // Monitor key metrics every 10 seconds
    setInterval(async () => {
      await this.trackPerformance('memory_usage', await this.getMemoryUsage());
      await this.trackPerformance('fps', await this.getFPS());
    }, 10000);
  }

  // Tool 5: Feature Flags for Gradual Rollouts
  async getFeatureFlag(flagId: string, userId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.middlewareEndpoint}/feature-flags/${flagId}/${userId}`);
      const flag: FeatureFlag = await response.json();

      // Check if enabled globally
      if (!flag.enabled) return false;

      // Check if user is in target list
      if (flag.targetUsers && flag.targetUsers.includes(userId)) {
        return true;
      }

      // Check rollout percentage
      const hash = this.hashUserId(userId);
      return hash < flag.rolloutPercentage;

    } catch (error) {
      console.error('[FEATURE_FLAGS] Failed to get flag:', error);
      return false;
    }
  }

  async trackFeatureFlagUsage(flagId: string, userId: string, enabled: boolean): Promise<void> {
    await fetch(`${this.postgresEndpoint}/feature_flag_usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flagId,
        userId,
        enabled,
        timestamp: Date.now(),
      }),
    });
  }

  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash << 5) - hash + userId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 100);
  }

  // Tool 6: In-App User Feedback Surveys
  async submitFeedback(type: 'bug' | 'feature' | 'general', rating: number, comment: string, screenshot?: string): Promise<void> {
    const feedback: UserFeedback = {
      feedbackId: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: await this.getUserId(),
      type,
      rating,
      comment,
      screenshot,
      timestamp: Date.now(),
    };

    // Send to Postgres for feedback dashboard
    await fetch(`${this.postgresEndpoint}/user_feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback),
    });

    // Send to Lakehouse for sentiment analysis
    await fetch(`${this.lakehouseEndpoint}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback),
    });

    console.log('[FEEDBACK] Submitted:', feedback.feedbackId);
  }

  async getFeedbackStats(): Promise<{ averageRating: number; totalFeedback: number }> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/feedback/stats`);
      return await response.json();
    } catch (error) {
      console.error('[FEEDBACK] Failed to get stats:', error);
      return { averageRating: 0, totalFeedback: 0 };
    }
  }

  // Tool 7: Session Recording for Behavior Understanding
  async recordEvent(type: RecordingEvent['type'], data: any): Promise<void> {
    this.recordingEvents.push({
      type,
      data,
      timestamp: Date.now(),
    });

    // Flush if too many events
    if (this.recordingEvents.length >= 100) {
      await this.flushRecording();
    }
  }

  private async startSessionRecording(): Promise<void> {
    // Auto-flush every 60 seconds
    setInterval(() => {
      this.flushRecording();
    }, 60000);
  }

  private async flushRecording(): Promise<void> {
    if (this.recordingEvents.length === 0) return;

    const recording: SessionRecording = {
      sessionId: await this.getSessionId(),
      userId: await this.getUserId(),
      events: this.recordingEvents,
      duration: this.recordingEvents[this.recordingEvents.length - 1].timestamp - this.recordingEvents[0].timestamp,
      timestamp: Date.now(),
    };

    this.recordingEvents = [];

    // Send to Lakehouse for behavior analysis
    await fetch(`${this.lakehouseEndpoint}/recordings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recording),
    });

    console.log('[RECORDING] Flushed', recording.events.length, 'events');
  }

  // Tool 8: Heatmap Analysis for Visual Click Tracking
  async trackClick(screenName: string, x: number, y: number, elementName: string): Promise<void> {
    this.heatmapClicks.push({
      x,
      y,
      elementName,
      timestamp: Date.now(),
    });

    // Record for session replay
    await this.recordEvent('click', { screenName, x, y, elementName });

    // Flush if too many clicks
    if (this.heatmapClicks.length >= 50) {
      await this.flushHeatmap(screenName);
    }
  }

  private async flushHeatmap(screenName: string): Promise<void> {
    if (this.heatmapClicks.length === 0) return;

    const heatmap: HeatmapData = {
      screenName,
      clicks: this.heatmapClicks,
      scrollDepth: [], // Would be populated by scroll tracking
      timestamp: Date.now(),
    };

    this.heatmapClicks = [];

    // Send to Lakehouse for heatmap generation
    await fetch(`${this.lakehouseEndpoint}/heatmaps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(heatmap),
    });

    console.log('[HEATMAP] Flushed', heatmap.clicks.length, 'clicks');
  }

  // Tool 9: Funnel Tracking for Conversion Optimization
  async trackFunnelStep(funnelId: string, stepId: string, stepName: string, action: 'enter' | 'complete' | 'drop'): Promise<void> {
    await fetch(`${this.postgresEndpoint}/funnel_events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        funnelId,
        stepId,
        stepName,
        action,
        userId: await this.getUserId(),
        timestamp: Date.now(),
      }),
    });

    console.log('[FUNNEL] Step tracked:', stepName, action);
  }

  async getFunnelAnalysis(funnelId: string): Promise<FunnelStep[]> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/funnels/${funnelId}/analysis`);
      return await response.json();
    } catch (error) {
      console.error('[FUNNEL] Failed to get analysis:', error);
      return [];
    }
  }

  // Tool 10: Revenue Tracking for Monetization Monitoring
  async trackRevenue(eventType: 'purchase' | 'subscription' | 'refund', amount: number, currency: string, productId: string, transactionId: string): Promise<void> {
    const revenueEvent: RevenueEvent = {
      eventId: `revenue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: await this.getUserId(),
      eventType,
      amount,
      currency,
      productId,
      transactionId,
      timestamp: Date.now(),
    };

    // Send to TigerBeetle for financial ledger
    await fetch(`${this.tigerBeetleEndpoint}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revenueEvent),
    });

    // Send to Postgres for revenue analytics
    await fetch(`${this.postgresEndpoint}/revenue_events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revenueEvent),
    });

    // Send to Lakehouse for long-term analysis
    await fetch(`${this.lakehouseEndpoint}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revenueEvent),
    });

    console.log('[REVENUE] Event tracked:', eventType, amount);
  }

  async getRevenueMetrics(): Promise<{ totalRevenue: number; arpu: number; ltv: number }> {
    try {
      const response = await fetch(`${this.postgresEndpoint}/revenue/metrics`);
      return await response.json();
    } catch (error) {
      console.error('[REVENUE] Failed to get metrics:', error);
      return { totalRevenue: 0, arpu: 0, ltv: 0 };
    }
  }

  // Helper methods
  private async getUserId(): Promise<string> {
    const userId = await localforage.getItem('user_id');
    return userId || 'anonymous';
  }

  private async getSessionId(): Promise<string> {
    const sessionId = await localforage.getItem('session_id');
    return sessionId || 'unknown';
  }

  private async getDeviceInfo(): Promise<any> {
    return {
      platform: 'mobile',
      version: '3.0.0',
    };
  }

  private async getMemoryUsage(): Promise<number> {
    // Would use native module to get actual memory
    return 90; // MB
  }

  private async getFPS(): Promise<number> {
    // Would use native module to get actual FPS
    return 60;
  }
}

export default AnalyticsManager.getInstance();
