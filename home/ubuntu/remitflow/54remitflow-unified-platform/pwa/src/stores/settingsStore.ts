/**
 * Settings Store - User preferences including weak network mode
 * 
 * Weak network mode optimizations:
 * - Disable auto-refresh of data
 * - Skip charts and heavy visualizations
 * - Use cached data preferentially
 * - Reduce image quality
 * - Disable animations
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SettingsState {
  // Weak Network Mode
  weakNetworkMode: boolean;
  autoRefreshEnabled: boolean;
  showCharts: boolean;
  imageQuality: 'low' | 'medium' | 'high';
  animationsEnabled: boolean;
  prefetchEnabled: boolean;
  
  // Data Saver
  dataSaverMode: boolean;
  
  // Offline Preferences
  offlineDataRetentionDays: number;
  autoSyncEnabled: boolean;
  syncOnWifiOnly: boolean;
  
  // Display
  darkMode: boolean;
  language: string;
  currency: string;
  
  // Notifications
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  
  // Security
  biometricEnabled: boolean;
  sessionTimeoutMinutes: number;
  
  // Actions
  setWeakNetworkMode: (enabled: boolean) => void;
  setDataSaverMode: (enabled: boolean) => void;
  setAutoRefresh: (enabled: boolean) => void;
  setShowCharts: (enabled: boolean) => void;
  setImageQuality: (quality: 'low' | 'medium' | 'high') => void;
  setAnimationsEnabled: (enabled: boolean) => void;
  setPrefetchEnabled: (enabled: boolean) => void;
  setOfflineDataRetention: (days: number) => void;
  setAutoSync: (enabled: boolean) => void;
  setSyncOnWifiOnly: (enabled: boolean) => void;
  setDarkMode: (enabled: boolean) => void;
  setLanguage: (language: string) => void;
  setCurrency: (currency: string) => void;
  setPushNotifications: (enabled: boolean) => void;
  setEmailNotifications: (enabled: boolean) => void;
  setSmsNotifications: (enabled: boolean) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  setSessionTimeout: (minutes: number) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  // Weak Network Mode - disabled by default
  weakNetworkMode: false,
  autoRefreshEnabled: true,
  showCharts: true,
  imageQuality: 'high' as const,
  animationsEnabled: true,
  prefetchEnabled: true,
  
  // Data Saver
  dataSaverMode: false,
  
  // Offline Preferences
  offlineDataRetentionDays: 7,
  autoSyncEnabled: true,
  syncOnWifiOnly: false,
  
  // Display
  darkMode: false,
  language: 'en',
  currency: 'NGN',
  
  // Notifications
  pushNotificationsEnabled: true,
  emailNotificationsEnabled: true,
  smsNotificationsEnabled: true,
  
  // Security
  biometricEnabled: false,
  sessionTimeoutMinutes: 30,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setWeakNetworkMode: (enabled: boolean) => {
        // When enabling weak network mode, also adjust related settings
        if (enabled) {
          set({
            weakNetworkMode: true,
            autoRefreshEnabled: false,
            showCharts: false,
            imageQuality: 'low',
            animationsEnabled: false,
            prefetchEnabled: false,
          });
        } else {
          // When disabling, restore defaults for related settings
          set({
            weakNetworkMode: false,
            autoRefreshEnabled: true,
            showCharts: true,
            imageQuality: 'high',
            animationsEnabled: true,
            prefetchEnabled: true,
          });
        }
      },

      setDataSaverMode: (enabled: boolean) => {
        set((state) => {
          if (enabled) {
            return {
              dataSaverMode: true,
              imageQuality: 'low',
              prefetchEnabled: false,
            };
          } else {
            return {
              dataSaverMode: false,
              imageQuality: state.weakNetworkMode ? 'low' : 'high',
              prefetchEnabled: !state.weakNetworkMode,
            };
          }
        });
      },

      setAutoRefresh: (enabled: boolean) => set({ autoRefreshEnabled: enabled }),
      setShowCharts: (enabled: boolean) => set({ showCharts: enabled }),
      setImageQuality: (quality: 'low' | 'medium' | 'high') => set({ imageQuality: quality }),
      setAnimationsEnabled: (enabled: boolean) => set({ animationsEnabled: enabled }),
      setPrefetchEnabled: (enabled: boolean) => set({ prefetchEnabled: enabled }),
      setOfflineDataRetention: (days: number) => set({ offlineDataRetentionDays: days }),
      setAutoSync: (enabled: boolean) => set({ autoSyncEnabled: enabled }),
      setSyncOnWifiOnly: (enabled: boolean) => set({ syncOnWifiOnly: enabled }),
      setDarkMode: (enabled: boolean) => set({ darkMode: enabled }),
      setLanguage: (language: string) => set({ language }),
      setCurrency: (currency: string) => set({ currency }),
      setPushNotifications: (enabled: boolean) => set({ pushNotificationsEnabled: enabled }),
      setEmailNotifications: (enabled: boolean) => set({ emailNotificationsEnabled: enabled }),
      setSmsNotifications: (enabled: boolean) => set({ smsNotificationsEnabled: enabled }),
      setBiometricEnabled: (enabled: boolean) => set({ biometricEnabled: enabled }),
      setSessionTimeout: (minutes: number) => set({ sessionTimeoutMinutes: minutes }),

      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// Convenience hooks
export const useWeakNetworkMode = () => useSettingsStore((state) => state.weakNetworkMode);
export const useDataSaverMode = () => useSettingsStore((state) => state.dataSaverMode);
export const useAutoRefresh = () => useSettingsStore((state) => state.autoRefreshEnabled);
export const useShowCharts = () => useSettingsStore((state) => state.showCharts);
export const useAnimationsEnabled = () => useSettingsStore((state) => state.animationsEnabled);
export const useDarkMode = () => useSettingsStore((state) => state.darkMode);
