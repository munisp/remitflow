/**
 * Main App Navigator
 * Handles authentication flow and main app navigation
 */

import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import {useSelector} from 'react-redux';

// Navigators
import AuthNavigator from './AuthNavigator';
import MainTabNavigator from './MainTabNavigator';

// Screens
import SplashScreen from '../screens/SplashScreen';
import MFAScreen from '../screens/auth/MFAScreen';

// Selectors
import {selectIsAuthenticated, selectMFARequired} from '../store/slices/authSlice';

// Types
export type RootStackParamList = {
  Splash: undefined;
  Auth: undefined;
  MFA: undefined;
  Main: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const mfaRequired = useSelector(selectMFARequired);

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
      }}>
      {!isAuthenticated ? (
        <>
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Auth" component={AuthNavigator} />
        </>
      ) : mfaRequired ? (
        <Stack.Screen name="MFA" component={MFAScreen} />
      ) : (
        <Stack.Screen name="Main" component={MainTabNavigator} />
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;
