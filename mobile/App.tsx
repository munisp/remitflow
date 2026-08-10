import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/context/ThemeContext';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SendMoneyScreen from './src/screens/SendMoneyScreen';
import TransactionHistoryScreen from './src/screens/TransactionHistoryScreen';
import KYCVerificationScreen from './src/screens/KYCVerificationScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ComplianceScreen from './src/screens/ComplianceScreen';

const Stack = createNativeStackNavigator();
const queryClient = new QueryClient();

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <NavigationContainer>
              <Stack.Navigator
                initialRouteName="Login"
                screenOptions={{
                  headerStyle: { backgroundColor: '#0A2540' },
                  headerTintColor: '#fff',
                  headerTitleStyle: { fontWeight: 'bold' },
                }}
              >
                <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
                <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'RemitFlow' }} />
                <Stack.Screen name="SendMoney" component={SendMoneyScreen} options={{ title: 'Send Money' }} />
                <Stack.Screen name="History" component={TransactionHistoryScreen} options={{ title: 'Transactions' }} />
                <Stack.Screen name="KYC" component={KYCVerificationScreen} options={{ title: 'Verify Identity' }} />
                <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
                <Stack.Screen name="Compliance" component={ComplianceScreen} options={{ title: 'Compliance' }} />
              </Stack.Navigator>
            </NavigationContainer>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
