/**
 * Deep Linking Configuration for React Native
 * 
 * Features:
 * - Universal Links (iOS) / App Links (Android)
 * - Custom URL schemes
 * - Marketing campaign tracking
 * - Deferred deep linking
 * - Branch.io / Firebase Dynamic Links support
 */

import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// URL Schemes
const URL_SCHEMES = {
  custom: 'agentbanking://',
  https: 'https://app.agentbanking.com',
  http: 'http://app.agentbanking.com'
};

// Deep link routes
export const DEEP_LINK_ROUTES = {
  // Authentication
  login: 'login',
  register: 'register',
  resetPassword: 'reset-password',
  verifyOtp: 'verify-otp',
  
  // Transactions
  cashIn: 'cash-in',
  cashOut: 'cash-out',
  transfer: 'transfer',
  billPayment: 'bill-payment',
  airtime: 'airtime',
  
  // Agents
  findAgent: 'find-agent',
  agentDetails: 'agent/:agentId',
  
  // Account
  profile: 'profile',
  settings: 'settings',
  security: 'security',
  notifications: 'notifications',
  
  // Transactions
  transactionHistory: 'transactions',
  transactionDetails: 'transaction/:transactionId',
  receipt: 'receipt/:receiptId',
  
  // Marketing
  promotion: 'promo/:promoCode',
  referral: 'refer/:referralCode',
  campaign: 'campaign/:campaignId',
  
  // Support
  help: 'help',
  faq: 'faq',
  contact: 'contact',
  chat: 'chat'
};

// Navigation config for React Navigation
export const linking = {
  prefixes: [
    URL_SCHEMES.custom,
    URL_SCHEMES.https,
    URL_SCHEMES.http
  ],
  
  config: {
    screens: {
      // Auth Stack
      Auth: {
        screens: {
          Login: DEEP_LINK_ROUTES.login,
          Register: DEEP_LINK_ROUTES.register,
          ResetPassword: DEEP_LINK_ROUTES.resetPassword,
          VerifyOtp: DEEP_LINK_ROUTES.verifyOtp
        }
      },
      
      // Main Stack
      Main: {
        screens: {
          // Home Tab
          HomeTab: {
            screens: {
              Home: 'home',
              CashIn: DEEP_LINK_ROUTES.cashIn,
              CashOut: DEEP_LINK_ROUTES.cashOut,
              Transfer: DEEP_LINK_ROUTES.transfer,
              BillPayment: DEEP_LINK_ROUTES.billPayment,
              Airtime: DEEP_LINK_ROUTES.airtime
            }
          },
          
          // Agent Tab
          AgentTab: {
            screens: {
              FindAgent: DEEP_LINK_ROUTES.findAgent,
              AgentDetails: DEEP_LINK_ROUTES.agentDetails
            }
          },
          
          // History Tab
          HistoryTab: {
            screens: {
              TransactionHistory: DEEP_LINK_ROUTES.transactionHistory,
              TransactionDetails: DEEP_LINK_ROUTES.transactionDetails,
              Receipt: DEEP_LINK_ROUTES.receipt
            }
          },
          
          // Profile Tab
          ProfileTab: {
            screens: {
              Profile: DEEP_LINK_ROUTES.profile,
              Settings: DEEP_LINK_ROUTES.settings,
              Security: DEEP_LINK_ROUTES.security,
              Notifications: DEEP_LINK_ROUTES.notifications
            }
          },
          
          // Marketing Screens
          Promotion: DEEP_LINK_ROUTES.promotion,
          Referral: DEEP_LINK_ROUTES.referral,
          Campaign: DEEP_LINK_ROUTES.campaign,
          
          // Support Screens
          Help: DEEP_LINK_ROUTES.help,
          FAQ: DEEP_LINK_ROUTES.faq,
          Contact: DEEP_LINK_ROUTES.contact,
          Chat: DEEP_LINK_ROUTES.chat
        }
      }
    }
  },
  
  // Custom URL parsing
  getStateFromPath: (path: string, options: any) => {
    // Track deep link for analytics
    trackDeepLink(path);
    
    // Default parsing
    return undefined;
  }
};

// Deep link tracking
interface DeepLinkData {
  url: string;
  path: string;
  params: Record<string, string>;
  source: string;
  campaign?: string;
  medium?: string;
  timestamp: number;
}

class DeepLinkingService {
  private static instance: DeepLinkingService;
  private pendingDeepLink: DeepLinkData | null = null;
  private handlers: ((data: DeepLinkData) => void)[] = [];
  private isAppReady = false;

  private constructor() {}

  static getInstance(): DeepLinkingService {
    if (!DeepLinkingService.instance) {
      DeepLinkingService.instance = new DeepLinkingService();
    }
    return DeepLinkingService.instance;
  }

  /**
   * Initialize deep linking
   */
  async initialize(): Promise<void> {
    console.log('[DEEPLINK] Initializing deep linking service...');

    // Handle initial URL (app opened via deep link)
    const initialUrl = await Linking.getInitialURL();
    if (initialUrl) {
      console.log('[DEEPLINK] Initial URL:', initialUrl);
      await this.handleDeepLink(initialUrl);
    }

    // Listen for incoming deep links
    Linking.addEventListener('url', this.handleUrlEvent.bind(this));

    // Check for deferred deep link
    await this.checkDeferredDeepLink();

    console.log('[DEEPLINK] Deep linking service initialized');
  }

  /**
   * Handle URL event
   */
  private handleUrlEvent(event: { url: string }): void {
    console.log('[DEEPLINK] URL event:', event.url);
    this.handleDeepLink(event.url);
  }

  /**
   * Handle deep link
   */
  async handleDeepLink(url: string): Promise<void> {
    const data = this.parseDeepLink(url);
    
    if (!data) {
      console.warn('[DEEPLINK] Invalid deep link:', url);
      return;
    }

    console.log('[DEEPLINK] Parsed deep link:', data);

    // Store for analytics
    await this.storeDeepLinkData(data);

    // If app is ready, notify handlers immediately
    if (this.isAppReady) {
      this.notifyHandlers(data);
    } else {
      // Store for later processing
      this.pendingDeepLink = data;
    }
  }

  /**
   * Parse deep link URL
   */
  private parseDeepLink(url: string): DeepLinkData | null {
    try {
      // Remove scheme prefix
      let path = url;
      for (const scheme of Object.values(URL_SCHEMES)) {
        if (url.startsWith(scheme)) {
          path = url.replace(scheme, '');
          break;
        }
      }

      // Remove leading slash
      path = path.replace(/^\//, '');

      // Parse query parameters
      const [pathPart, queryPart] = path.split('?');
      const params: Record<string, string> = {};

      if (queryPart) {
        const searchParams = new URLSearchParams(queryPart);
        searchParams.forEach((value, key) => {
          params[key] = value;
        });
      }

      // Extract UTM parameters
      const source = params.utm_source || params.source || 'direct';
      const campaign = params.utm_campaign || params.campaign;
      const medium = params.utm_medium || params.medium;

      return {
        url,
        path: pathPart,
        params,
        source,
        campaign,
        medium,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[DEEPLINK] Failed to parse URL:', error);
      return null;
    }
  }

  /**
   * Store deep link data for analytics
   */
  private async storeDeepLinkData(data: DeepLinkData): Promise<void> {
    try {
      // Store last deep link
      await AsyncStorage.setItem('last_deep_link', JSON.stringify(data));

      // Append to history
      const historyJson = await AsyncStorage.getItem('deep_link_history');
      const history: DeepLinkData[] = historyJson ? JSON.parse(historyJson) : [];
      history.push(data);

      // Keep only last 50 entries
      if (history.length > 50) {
        history.splice(0, history.length - 50);
      }

      await AsyncStorage.setItem('deep_link_history', JSON.stringify(history));
    } catch (error) {
      console.error('[DEEPLINK] Failed to store deep link data:', error);
    }
  }

  /**
   * Check for deferred deep link
   */
  private async checkDeferredDeepLink(): Promise<void> {
    try {
      // Check if this is first launch
      const hasLaunched = await AsyncStorage.getItem('has_launched');
      
      if (!hasLaunched) {
        // First launch - check for deferred deep link from install referrer
        await AsyncStorage.setItem('has_launched', 'true');
        
        // In production, integrate with Branch.io or Firebase Dynamic Links
        // to retrieve deferred deep link
        console.log('[DEEPLINK] First launch - checking for deferred deep link');
      }
    } catch (error) {
      console.error('[DEEPLINK] Failed to check deferred deep link:', error);
    }
  }

  /**
   * Mark app as ready to handle deep links
   */
  setAppReady(): void {
    this.isAppReady = true;

    // Process pending deep link
    if (this.pendingDeepLink) {
      this.notifyHandlers(this.pendingDeepLink);
      this.pendingDeepLink = null;
    }
  }

  /**
   * Add deep link handler
   */
  addHandler(handler: (data: DeepLinkData) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Remove deep link handler
   */
  removeHandler(handler: (data: DeepLinkData) => void): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Notify all handlers
   */
  private notifyHandlers(data: DeepLinkData): void {
    this.handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error('[DEEPLINK] Handler error:', error);
      }
    });
  }

  /**
   * Get last deep link
   */
  async getLastDeepLink(): Promise<DeepLinkData | null> {
    try {
      const json = await AsyncStorage.getItem('last_deep_link');
      return json ? JSON.parse(json) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get deep link history
   */
  async getDeepLinkHistory(): Promise<DeepLinkData[]> {
    try {
      const json = await AsyncStorage.getItem('deep_link_history');
      return json ? JSON.parse(json) : [];
    } catch {
      return [];
    }
  }

  /**
   * Create deep link URL
   */
  createDeepLink(
    path: string,
    params?: Record<string, string>,
    useUniversalLink = true
  ): string {
    const baseUrl = useUniversalLink ? URL_SCHEMES.https : URL_SCHEMES.custom;
    let url = `${baseUrl}/${path}`;

    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      url += `?${queryString}`;
    }

    return url;
  }

  /**
   * Create marketing deep link with UTM parameters
   */
  createMarketingLink(
    path: string,
    campaign: string,
    source: string,
    medium: string,
    additionalParams?: Record<string, string>
  ): string {
    const params: Record<string, string> = {
      utm_campaign: campaign,
      utm_source: source,
      utm_medium: medium,
      ...additionalParams
    };

    return this.createDeepLink(path, params, true);
  }

  /**
   * Create referral link
   */
  createReferralLink(referralCode: string, userId: string): string {
    return this.createMarketingLink(
      `refer/${referralCode}`,
      'referral',
      'user',
      'share',
      { referrer: userId }
    );
  }

  /**
   * Create promotion link
   */
  createPromotionLink(promoCode: string, campaign: string): string {
    return this.createMarketingLink(
      `promo/${promoCode}`,
      campaign,
      'promotion',
      'app'
    );
  }

  /**
   * Open URL in browser
   */
  async openUrl(url: string): Promise<boolean> {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[DEEPLINK] Failed to open URL:', error);
      return false;
    }
  }

  /**
   * Clean up
   */
  cleanup(): void {
    // Remove event listener is handled by React Navigation
    this.handlers = [];
    this.pendingDeepLink = null;
  }
}

// Track deep link for analytics
async function trackDeepLink(path: string): Promise<void> {
  try {
    // Send to analytics service
    const apiUrl = process.env.REACT_APP_API_URL || '';
    await fetch(`${apiUrl}/api/v1/analytics/deep-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        platform: Platform.OS,
        timestamp: Date.now()
      })
    });
  } catch (error) {
    console.error('[DEEPLINK] Failed to track deep link:', error);
  }
}

export default DeepLinkingService.getInstance();
