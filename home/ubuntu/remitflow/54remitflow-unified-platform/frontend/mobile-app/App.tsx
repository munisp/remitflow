/**
 * Remittance Platform Mobile Application
 * Main App Component with Navigation and State Management
 */

import React, {useEffect, useState} from 'react';
import {
  StatusBar,
  StyleSheet,
  Alert,
  AppState,
  AppStateStatus,
} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {Provider} from 'react-redux';
import {PersistGate} from 'redux-persist/integration/react';
import Toast from 'react-native-toast-message';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

// Store and Navigation
import {store, persistor} from './src/store/store';
import AppNavigator from './src/navigation/AppNavigator';

// Services
import {AuthService} from './src/services/AuthService';
import {OfflineService} from './src/services/OfflineService';
import {NotificationService} from './src/services/NotificationService';
import {BiometricService} from './src/services/BiometricService';
import {SyncService} from './src/services/SyncService';

// Components
import LoadingScreen from './src/components/LoadingScreen';
import NetworkStatus from './src/components/NetworkStatus';

// Types
import {NetworkState} from './src/types/common';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [networkState, setNetworkState] = useState<NetworkState>({
    isConnected: true,
    isInternetReachable: true,
    type: 'unknown',
  });

  useEffect(() => {
    initializeApp();
    setupAppStateListener();
    setupNetworkListener();
    
    return () => {
      // Cleanup listeners
    };
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize services
      await AuthService.initialize();
      await OfflineService.initialize();
      await NotificationService.initialize();
      await BiometricService.initialize();
      await SyncService.initialize();

      // Check authentication status
      const isAuthenticated = await AuthService.isAuthenticated();
      if (isAuthenticated) {
        // Start background sync if authenticated
        SyncService.startBackgroundSync();
      }

      setIsLoading(false);
    } catch (error) {
      console.error('App initialization failed:', error);
      Alert.alert(
        'Initialization Error',
        'Failed to initialize the application. Please restart the app.',
        [{text: 'OK', onPress: () => setIsLoading(false)}]
      );
    }
  };

  const setupAppStateListener = () => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground
        SyncService.triggerSync();
      } else if (nextAppState === 'background') {
        // App went to background
        SyncService.pauseSync();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  };

  const setupNetworkListener = () => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const newNetworkState: NetworkState = {
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
        type: state.type,
      };

      setNetworkState(newNetworkState);

      // Handle network state changes
      if (newNetworkState.isConnected && newNetworkState.isInternetReachable) {
        // Network is available, start sync
        SyncService.triggerSync();
      } else {
        // Network is not available, switch to offline mode
        OfflineService.setOfflineMode(true);
      }
    });

    return unsubscribe;
  };

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <Provider store={store}>
        <PersistGate loading={<LoadingScreen />} persistor={persistor}>
          <SafeAreaProvider>
            <NavigationContainer>
              <StatusBar
                barStyle="dark-content"
                backgroundColor="#FFFFFF"
                translucent={false}
              />
              <NetworkStatus networkState={networkState} />
              <AppNavigator />
              <Toast />
            </NavigationContainer>
          </SafeAreaProvider>
        </PersistGate>
      </Provider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
