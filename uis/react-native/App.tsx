/**
 * RemitFlow React Native App
 * Cross-border remittance mobile application
 */
import React from 'react';
import { AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { trpc, trpcClient } from './src/services/trpc';
import { AuthProvider } from './src/contexts/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';

/**
 * wave14 perf (H6): react-native-paper was removed (unused beyond this
 * provider). These are the 4 theme color constants the MD3DarkTheme override
 * used to carry, kept here as the canonical app palette — every screen
 * already references these exact hex values via inline styles.
 */
export const THEME_COLORS = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  background: '#0f0f1a',
  surface: '#1a1a2e',
} as const;

/**
 * wave14 perf (L6): never retry client errors — a 4xx will fail again on
 * retry, so retrying only adds latency and duplicate load. Network errors
 * and 5xx get up to 2 retries (previous behavior).
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const httpStatus = (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
  if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) return false;
  return failureCount < 2;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry, staleTime: 30000 },
    mutations: { retry: 0 },
  },
});

// wave14 perf (L6): react-query's default focus manager listens to window
// events that don't exist in RN; wire it to AppState so queries refocus-
// refetch exactly when the app returns to the foreground.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <NavigationContainer>
                <RootNavigator />
              </NavigationContainer>
            </AuthProvider>
          </QueryClientProvider>
        </trpc.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
