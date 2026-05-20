import { Capacitor } from '@capacitor/core';
// SearchSystem.ts - Universal Smart Search with Voice Support
// Search across transactions, beneficiaries, settings

import Voice from '@react-native-voice/voice';

export interface SearchResult {
  id: string;
  type: 'transaction' | 'beneficiary' | 'setting';
  title: string;
  subtitle: string;
  data: any;
  relevance: number;
}

class SearchSystem {
  private static instance: SearchSystem;
  private isListening: boolean = false;
  private searchIndex: Map<string, any[]> = new Map();

  private constructor() {
    this.initializeVoice();
    this.buildSearchIndex();
  }

  static getInstance(): SearchSystem {
    if (!SearchSystem.instance) {
      SearchSystem.instance = new SearchSystem();
    }
    return SearchSystem.instance;
  }

  private initializeVoice() {
    Voice.onSpeechStart = () => {
      this.isListening = true;
    };

    Voice.onSpeechEnd = () => {
      this.isListening = false;
    };

    Voice.onSpeechResults = (event) => {
      if (event.value && event.value.length > 0) {
        const query = event.value[0];
        this.search(query);
      }
    };
  }

  private async buildSearchIndex() {
    // Build search index from app data stored in AsyncStorage
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      
      // Load transactions from local storage
      const transactionsData = await AsyncStorage.getItem('user_transactions');
      if (transactionsData) {
        this.searchIndex.set('transactions', JSON.parse(transactionsData));
      }

      // Load beneficiaries from local storage
      const beneficiariesData = await AsyncStorage.getItem('user_beneficiaries');
      if (beneficiariesData) {
        this.searchIndex.set('beneficiaries', JSON.parse(beneficiariesData));
      }

      // Subscribe to storage changes to keep index updated
      this.subscribeToDataChanges();
    } catch (error) {
      console.error('[SEARCH] Failed to build search index:', error);
    }
  }

  private subscribeToDataChanges() {
    // Re-index when data changes (called from other parts of the app)
    // This is a simple polling mechanism - in production, use event-based updates
    setInterval(async () => {
      await this.refreshIndex();
    }, 60000); // Refresh every minute
  }

  async refreshIndex() {
    await this.buildSearchIndex();
  }

  // Method to update index when new data is added
  async updateTransactions(transactions: any[]) {
    this.searchIndex.set('transactions', transactions);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem('user_transactions', JSON.stringify(transactions));
    } catch (error) {
      console.error('[SEARCH] Failed to save transactions:', error);
    }
  }

  async updateBeneficiaries(beneficiaries: any[]) {
    this.searchIndex.set('beneficiaries', beneficiaries);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem('user_beneficiaries', JSON.stringify(beneficiaries));
    } catch (error) {
      console.error('[SEARCH] Failed to save beneficiaries:', error);
    }
  }

  async startVoiceSearch(): Promise<void> {
    try {
      await Voice.start('en-US');
    } catch (error) {
      console.error('Voice search error:', error);
    }
  }

  async stopVoiceSearch(): Promise<void> {
    try {
      await Voice.stop();
    } catch (error) {
      console.error('Voice stop error:', error);
    }
  }

  search(query: string): SearchResult[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // Search transactions
    const transactions = this.searchTransactions(lowerQuery);
    results.push(...transactions);

    // Search beneficiaries
    const beneficiaries = this.searchBeneficiaries(lowerQuery);
    results.push(...beneficiaries);

    // Search settings
    const settings = this.searchSettings(lowerQuery);
    results.push(...settings);

    // Sort by relevance
    return results.sort((a, b) => b.relevance - a.relevance);
  }

  private searchTransactions(query: string): SearchResult[] {
    // Search through indexed transactions from local storage
    const transactions = this.searchIndex.get('transactions') || [];
    return transactions
      .filter((tx: any) => {
        const searchableText = `${tx.description || ''} ${tx.reference || ''} ${tx.amount || ''} ${tx.recipient || ''} ${tx.type || ''}`.toLowerCase();
        return searchableText.includes(query);
      })
      .map((tx: any) => ({
        id: tx.id || tx.reference,
        type: 'transaction' as const,
        title: tx.description || `${tx.type} - ${tx.amount}`,
        subtitle: `${tx.date || 'Unknown date'} - ${tx.status || 'Unknown status'}`,
        data: tx,
        relevance: this.calculateRelevance(tx.description || tx.type || '', query),
      }))
      .slice(0, 20); // Limit results
  }

  private searchBeneficiaries(query: string): SearchResult[] {
    // Search through indexed beneficiaries from local storage
    const beneficiaries = this.searchIndex.get('beneficiaries') || [];
    return beneficiaries
      .filter((ben: any) => {
        const searchableText = `${ben.name || ''} ${ben.accountNumber || ''} ${ben.bankName || ''} ${ben.nickname || ''} ${ben.phone || ''}`.toLowerCase();
        return searchableText.includes(query);
      })
      .map((ben: any) => ({
        id: ben.id || ben.accountNumber,
        type: 'beneficiary' as const,
        title: ben.name || ben.nickname || 'Unknown',
        subtitle: `${ben.bankName || 'Unknown bank'} - ${ben.accountNumber || ''}`,
        data: ben,
        relevance: this.calculateRelevance(ben.name || ben.nickname || '', query),
      }))
      .slice(0, 20); // Limit results
  }

  private searchSettings(query: string): SearchResult[] {
    // Search through available settings options
    const settingsOptions = [
      { id: 'profile', name: 'Profile Settings', description: 'Update your personal information', path: '/settings/profile' },
      { id: 'security', name: 'Security Settings', description: 'Manage passwords, biometrics, and 2FA', path: '/settings/security' },
      { id: 'notifications', name: 'Notification Preferences', description: 'Configure push, SMS, and email alerts', path: '/settings/notifications' },
      { id: 'language', name: 'Language & Region', description: 'Change app language and regional settings', path: '/settings/language' },
      { id: 'limits', name: 'Transaction Limits', description: 'View and request limit changes', path: '/settings/limits' },
      { id: 'beneficiaries', name: 'Manage Beneficiaries', description: 'Add, edit, or remove saved beneficiaries', path: '/settings/beneficiaries' },
      { id: 'statements', name: 'Account Statements', description: 'Download or request account statements', path: '/settings/statements' },
      { id: 'cards', name: 'Card Management', description: 'Manage debit and virtual cards', path: '/settings/cards' },
      { id: 'privacy', name: 'Privacy Settings', description: 'Control data sharing and privacy options', path: '/settings/privacy' },
      { id: 'help', name: 'Help & Support', description: 'FAQs, contact support, and feedback', path: '/settings/help' },
      { id: 'about', name: 'About App', description: 'App version, terms, and licenses', path: '/settings/about' },
      { id: 'logout', name: 'Logout', description: 'Sign out of your account', path: '/logout' },
    ];

    return settingsOptions
      .filter(setting => {
        const searchableText = `${setting.name} ${setting.description}`.toLowerCase();
        return searchableText.includes(query);
      })
      .map(setting => ({
        id: setting.id,
        type: 'setting' as const,
        title: setting.name,
        subtitle: setting.description,
        data: setting,
        relevance: this.calculateRelevance(setting.name, query),
      }));
  }

  private calculateRelevance(item: string, query: string): number {
    const lowerItem = item.toLowerCase();
    const lowerQuery = query.toLowerCase();

    if (lowerItem === lowerQuery) return 100;
    if (lowerItem.startsWith(lowerQuery)) return 90;
    if (lowerItem.includes(lowerQuery)) return 70;

    // Fuzzy matching
    let matches = 0;
    for (const char of lowerQuery) {
      if (lowerItem.includes(char)) matches++;
    }
    return (matches / lowerQuery.length) * 50;
  }
}

export default SearchSystem.getInstance();
