/**
 * Main Tab Navigator
 * Bottom tab navigation for authenticated users
 */

import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createStackNavigator} from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSelector} from 'react-redux';

// Screens
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import TransactionListScreen from '../screens/transactions/TransactionListScreen';
import TransactionDetailScreen from '../screens/transactions/TransactionDetailScreen';
import NewTransactionScreen from '../screens/transactions/NewTransactionScreen';
import CustomerListScreen from '../screens/customers/CustomerListScreen';
import CustomerDetailScreen from '../screens/customers/CustomerDetailScreen';
import NewCustomerScreen from '../screens/customers/NewCustomerScreen';
import QRScannerScreen from '../screens/scanner/QRScannerScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import OfflineStatusScreen from '../screens/offline/OfflineStatusScreen';

// Selectors
import {selectUser} from '../store/slices/authSlice';

// Types
export type MainTabParamList = {
  Dashboard: undefined;
  Transactions: undefined;
  Customers: undefined;
  Scanner: undefined;
  More: undefined;
};

export type DashboardStackParamList = {
  DashboardMain: undefined;
  Notifications: undefined;
  Reports: undefined;
  OfflineStatus: undefined;
};

export type TransactionStackParamList = {
  TransactionList: undefined;
  TransactionDetail: {transactionId: string};
  NewTransaction: {customerId?: string};
};

export type CustomerStackParamList = {
  CustomerList: undefined;
  CustomerDetail: {customerId: string};
  NewCustomer: undefined;
};

export type MoreStackParamList = {
  MoreMain: undefined;
  Profile: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const DashboardStack = createStackNavigator<DashboardStackParamList>();
const TransactionStack = createStackNavigator<TransactionStackParamList>();
const CustomerStack = createStackNavigator<CustomerStackParamList>();
const MoreStack = createStackNavigator<MoreStackParamList>();

// Stack Navigators
const DashboardStackNavigator: React.FC = () => (
  <DashboardStack.Navigator
    screenOptions={{
      headerStyle: {backgroundColor: '#2E7D32'},
      headerTintColor: '#FFFFFF',
      headerTitleStyle: {fontWeight: 'bold'},
    }}>
    <DashboardStack.Screen
      name="DashboardMain"
      component={DashboardScreen}
      options={{title: 'Dashboard'}}
    />
    <DashboardStack.Screen
      name="Notifications"
      component={NotificationsScreen}
      options={{title: 'Notifications'}}
    />
    <DashboardStack.Screen
      name="Reports"
      component={ReportsScreen}
      options={{title: 'Reports'}}
    />
    <DashboardStack.Screen
      name="OfflineStatus"
      component={OfflineStatusScreen}
      options={{title: 'Offline Status'}}
    />
  </DashboardStack.Navigator>
);

const TransactionStackNavigator: React.FC = () => (
  <TransactionStack.Navigator
    screenOptions={{
      headerStyle: {backgroundColor: '#2E7D32'},
      headerTintColor: '#FFFFFF',
      headerTitleStyle: {fontWeight: 'bold'},
    }}>
    <TransactionStack.Screen
      name="TransactionList"
      component={TransactionListScreen}
      options={{title: 'Transactions'}}
    />
    <TransactionStack.Screen
      name="TransactionDetail"
      component={TransactionDetailScreen}
      options={{title: 'Transaction Details'}}
    />
    <TransactionStack.Screen
      name="NewTransaction"
      component={NewTransactionScreen}
      options={{title: 'New Transaction'}}
    />
  </TransactionStack.Navigator>
);

const CustomerStackNavigator: React.FC = () => (
  <CustomerStack.Navigator
    screenOptions={{
      headerStyle: {backgroundColor: '#2E7D32'},
      headerTintColor: '#FFFFFF',
      headerTitleStyle: {fontWeight: 'bold'},
    }}>
    <CustomerStack.Screen
      name="CustomerList"
      component={CustomerListScreen}
      options={{title: 'Customers'}}
    />
    <CustomerStack.Screen
      name="CustomerDetail"
      component={CustomerDetailScreen}
      options={{title: 'Customer Details'}}
    />
    <CustomerStack.Screen
      name="NewCustomer"
      component={NewCustomerScreen}
      options={{title: 'New Customer'}}
    />
  </CustomerStack.Navigator>
);

const MoreStackNavigator: React.FC = () => (
  <MoreStack.Navigator
    screenOptions={{
      headerStyle: {backgroundColor: '#2E7D32'},
      headerTintColor: '#FFFFFF',
      headerTitleStyle: {fontWeight: 'bold'},
    }}>
    <MoreStack.Screen
      name="MoreMain"
      component={SettingsScreen}
      options={{title: 'More'}}
    />
    <MoreStack.Screen
      name="Profile"
      component={ProfileScreen}
      options={{title: 'Profile'}}
    />
    <MoreStack.Screen
      name="Settings"
      component={SettingsScreen}
      options={{title: 'Settings'}}
    />
  </MoreStack.Navigator>
);

const MainTabNavigator: React.FC = () => {
  const user = useSelector(selectUser);

  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        headerShown: false,
        tabBarIcon: ({focused, color, size}) => {
          let iconName: string;

          switch (route.name) {
            case 'Dashboard':
              iconName = focused ? 'view-dashboard' : 'view-dashboard-outline';
              break;
            case 'Transactions':
              iconName = focused ? 'credit-card' : 'credit-card-outline';
              break;
            case 'Customers':
              iconName = focused ? 'account-group' : 'account-group-outline';
              break;
            case 'Scanner':
              iconName = 'qrcode-scan';
              break;
            case 'More':
              iconName = focused ? 'menu' : 'menu';
              break;
            default:
              iconName = 'help-circle';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#2E7D32',
        tabBarInactiveTintColor: '#757575',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E0E0E0',
          borderTopWidth: 1,
          paddingBottom: 5,
          paddingTop: 5,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      })}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardStackNavigator}
        options={{
          tabBarLabel: 'Dashboard',
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionStackNavigator}
        options={{
          tabBarLabel: 'Transactions',
        }}
      />
      <Tab.Screen
        name="Customers"
        component={CustomerStackNavigator}
        options={{
          tabBarLabel: 'Customers',
        }}
      />
      <Tab.Screen
        name="Scanner"
        component={QRScannerScreen}
        options={{
          tabBarLabel: 'Scan QR',
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreStackNavigator}
        options={{
          tabBarLabel: 'More',
        }}
      />
    </Tab.Navigator>
  );
};

export default MainTabNavigator;
