/**
 * Push Notification Service for PWA
 * 
 * Features:
 * - Web Push API integration
 * - FCM (Firebase Cloud Messaging) support
 * - Permission management
 * - Subscription management
 * - Notification preferences
 */

import { getMessaging, getToken, onMessage, MessagePayload } from 'firebase/messaging';
import { initializeApp, FirebaseApp } from 'firebase/app';

// Firebase configuration - should be loaded from environment
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || '',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || ''
};

// VAPID key for Web Push
const VAPID_KEY = process.env.REACT_APP_VAPID_KEY || '';

export interface NotificationPreferences {
  transactions: boolean;
  promotions: boolean;
  security: boolean;
  agents: boolean;
  news: boolean;
}

export interface PushSubscription {
  endpoint: string;
  token: string;
  deviceId: string;
  platform: 'web' | 'ios' | 'android';
  createdAt: Date;
}

export type NotificationHandler = (payload: MessagePayload) => void;

class PushNotificationService {
  private static instance: PushNotificationService;
  private firebaseApp: FirebaseApp | null = null;
  private messaging: ReturnType<typeof getMessaging> | null = null;
  private token: string | null = null;
  private handlers: NotificationHandler[] = [];
  private preferences: NotificationPreferences = {
    transactions: true,
    promotions: true,
    security: true,
    agents: true,
    news: false
  };

  private constructor() {}

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  /**
   * Initialize push notification service
   */
  async initialize(): Promise<boolean> {
    console.log('[PUSH] Initializing push notification service...');

    // Check browser support
    if (!this.isSupported()) {
      console.warn('[PUSH] Push notifications not supported');
      return false;
    }

    try {
      // Initialize Firebase
      if (firebaseConfig.apiKey) {
        this.firebaseApp = initializeApp(firebaseConfig);
        this.messaging = getMessaging(this.firebaseApp);
        
        // Set up foreground message handler
        onMessage(this.messaging, (payload) => {
          console.log('[PUSH] Foreground message received:', payload);
          this.handleForegroundMessage(payload);
        });
      }

      // Load saved preferences
      await this.loadPreferences();

      console.log('[PUSH] Push notification service initialized');
      return true;
    } catch (error) {
      console.error('[PUSH] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Check if push notifications are supported
   */
  isSupported(): boolean {
    return 'Notification' in window && 
           'serviceWorker' in navigator && 
           'PushManager' in window;
  }

  /**
   * Request notification permission
   */
  async requestPermission(): Promise<NotificationPermission> {
    console.log('[PUSH] Requesting notification permission...');

    if (!this.isSupported()) {
      return 'denied';
    }

    const permission = await Notification.requestPermission();
    console.log('[PUSH] Permission result:', permission);

    if (permission === 'granted') {
      await this.subscribe();
    }

    return permission;
  }

  /**
   * Get current permission status
   */
  getPermissionStatus(): NotificationPermission {
    if (!this.isSupported()) {
      return 'denied';
    }
    return Notification.permission;
  }

  /**
   * Subscribe to push notifications
   */
  async subscribe(): Promise<string | null> {
    console.log('[PUSH] Subscribing to push notifications...');

    try {
      // Get FCM token if Firebase is configured
      if (this.messaging && VAPID_KEY) {
        const registration = await navigator.serviceWorker.ready;
        
        this.token = await getToken(this.messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration
        });

        if (this.token) {
          console.log('[PUSH] FCM token obtained');
          await this.registerTokenWithServer(this.token);
          return this.token;
        }
      }

      // Fallback to native Web Push
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(VAPID_KEY)
      });

      const subscriptionJson = subscription.toJSON();
      this.token = subscriptionJson.endpoint || null;
      
      if (this.token) {
        await this.registerSubscriptionWithServer(subscription);
      }

      return this.token;
    } catch (error) {
      console.error('[PUSH] Subscription failed:', error);
      return null;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe(): Promise<boolean> {
    console.log('[PUSH] Unsubscribing from push notifications...');

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        await this.unregisterTokenFromServer();
        this.token = null;
        console.log('[PUSH] Unsubscribed successfully');
        return true;
      }

      return false;
    } catch (error) {
      console.error('[PUSH] Unsubscribe failed:', error);
      return false;
    }
  }

  /**
   * Register FCM token with backend
   */
  private async registerTokenWithServer(token: string): Promise<void> {
    const apiUrl = process.env.REACT_APP_API_URL || '';
    
    try {
      await fetch(`${apiUrl}/api/v1/notifications/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          token,
          platform: 'web',
          deviceId: this.getDeviceId(),
          preferences: this.preferences
        })
      });
      console.log('[PUSH] Token registered with server');
    } catch (error) {
      console.error('[PUSH] Failed to register token:', error);
    }
  }

  /**
   * Register Web Push subscription with backend
   */
  private async registerSubscriptionWithServer(subscription: globalThis.PushSubscription): Promise<void> {
    const apiUrl = process.env.REACT_APP_API_URL || '';
    
    try {
      await fetch(`${apiUrl}/api/v1/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          platform: 'web',
          deviceId: this.getDeviceId(),
          preferences: this.preferences
        })
      });
      console.log('[PUSH] Subscription registered with server');
    } catch (error) {
      console.error('[PUSH] Failed to register subscription:', error);
    }
  }

  /**
   * Unregister token from backend
   */
  private async unregisterTokenFromServer(): Promise<void> {
    const apiUrl = process.env.REACT_APP_API_URL || '';
    
    try {
      await fetch(`${apiUrl}/api/v1/notifications/unregister`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          deviceId: this.getDeviceId()
        })
      });
      console.log('[PUSH] Token unregistered from server');
    } catch (error) {
      console.error('[PUSH] Failed to unregister token:', error);
    }
  }

  /**
   * Handle foreground messages
   */
  private handleForegroundMessage(payload: MessagePayload): void {
    // Check preferences
    const notificationType = payload.data?.type as keyof NotificationPreferences;
    if (notificationType && !this.preferences[notificationType]) {
      console.log('[PUSH] Notification filtered by preferences:', notificationType);
      return;
    }

    // Show notification
    if (payload.notification) {
      this.showNotification(
        payload.notification.title || 'Remittance Platform',
        {
          body: payload.notification.body,
          icon: payload.notification.icon || '/icons/icon-192x192.png',
          data: payload.data
        }
      );
    }

    // Notify handlers
    this.handlers.forEach(handler => handler(payload));
  }

  /**
   * Show a local notification
   */
  showNotification(title: string, options?: NotificationOptions): void {
    if (Notification.permission === 'granted') {
      new Notification(title, {
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        ...options
      });
    }
  }

  /**
   * Add notification handler
   */
  addHandler(handler: NotificationHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove notification handler
   */
  removeHandler(handler: NotificationHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Update notification preferences
   */
  async updatePreferences(preferences: Partial<NotificationPreferences>): Promise<void> {
    this.preferences = { ...this.preferences, ...preferences };
    await this.savePreferences();
    
    // Sync with server
    const apiUrl = process.env.REACT_APP_API_URL || '';
    try {
      await fetch(`${apiUrl}/api/v1/notifications/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          deviceId: this.getDeviceId(),
          preferences: this.preferences
        })
      });
    } catch (error) {
      console.error('[PUSH] Failed to sync preferences:', error);
    }
  }

  /**
   * Get current preferences
   */
  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  /**
   * Save preferences to local storage
   */
  private async savePreferences(): Promise<void> {
    try {
      localStorage.setItem('notification_preferences', JSON.stringify(this.preferences));
    } catch (error) {
      console.error('[PUSH] Failed to save preferences:', error);
    }
  }

  /**
   * Load preferences from local storage
   */
  private async loadPreferences(): Promise<void> {
    try {
      const saved = localStorage.getItem('notification_preferences');
      if (saved) {
        this.preferences = { ...this.preferences, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.error('[PUSH] Failed to load preferences:', error);
    }
  }

  /**
   * Get current token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Check if subscribed
   */
  async isSubscribed(): Promise<boolean> {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription !== null;
    } catch {
      return false;
    }
  }

  /**
   * Convert VAPID key to Uint8Array
   */
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /**
   * Get device ID
   */
  private getDeviceId(): string {
    let deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = `web_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  /**
   * Get auth token
   */
  private getAuthToken(): string {
    return localStorage.getItem('auth_token') || '';
  }
}

export default PushNotificationService.getInstance();
