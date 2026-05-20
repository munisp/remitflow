/**
 * Dashboard Screen
 * Main dashboard for remittance operations
 */

import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {useSelector, useDispatch} from 'react-redux';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {LineChart, PieChart} from 'react-native-chart-kit';
import {Dimensions} from 'react-native';

// Components
import NetworkStatus from '../../components/NetworkStatus';
import QuickActionCard from '../../components/QuickActionCard';
import StatCard from '../../components/StatCard';
import RecentTransactionCard from '../../components/RecentTransactionCard';

// Services
import OfflineService from '../../services/OfflineService';
import {SyncService} from '../../services/SyncService';

// Selectors
import {selectUser} from '../../store/slices/authSlice';

// Types
import {DashboardStackParamList} from '../../navigation/MainTabNavigator';
import {StackNavigationProp} from '@react-navigation/stack';

type DashboardScreenNavigationProp = StackNavigationProp<
  DashboardStackParamList,
  'DashboardMain'
>;

interface DashboardStats {
  todayTransactions: number;
  todayAmount: number;
  weekTransactions: number;
  weekAmount: number;
  monthTransactions: number;
  monthAmount: number;
  pendingTransactions: number;
  activeCustomers: number;
}

interface RecentTransaction {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment';
  status: 'completed' | 'pending' | 'failed';
  timestamp: number;
  synced: boolean;
}

const screenWidth = Dimensions.get('window').width;

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<DashboardScreenNavigationProp>();
  const dispatch = useDispatch();
  const user = useSelector(selectUser);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    todayTransactions: 0,
    todayAmount: 0,
    weekTransactions: 0,
    weekAmount: 0,
    monthTransactions: 0,
    monthAmount: 0,
    pendingTransactions: 0,
    activeCustomers: 0,
  });
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
  const [offlineInfo, setOfflineInfo] = useState({
    pendingOperations: 0,
    cachedTransactions: 0,
    lastSync: null as number | null,
  });

  useEffect(() => {
    loadDashboardData();
    loadOfflineInfo();
    
    // Set up periodic refresh
    const interval = setInterval(() => {
      loadDashboardData();
      loadOfflineInfo();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const loadDashboardData = async () => {
    try {
      // Load cached data first for immediate display
      const cachedTransactions = await OfflineService.getCachedTransactions();
      
      // Calculate stats from cached data
      const now = Date.now();
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const weekStart = now - 7 * 24 * 60 * 60 * 1000;
      const monthStart = now - 30 * 24 * 60 * 60 * 1000;

      const todayTxns = cachedTransactions.filter(t => t.createdAt >= todayStart);
      const weekTxns = cachedTransactions.filter(t => t.createdAt >= weekStart);
      const monthTxns = cachedTransactions.filter(t => t.createdAt >= monthStart);
      const pendingTxns = cachedTransactions.filter(t => t.status === 'pending');

      setStats({
        todayTransactions: todayTxns.length,
        todayAmount: todayTxns.reduce((sum, t) => sum + t.amount, 0),
        weekTransactions: weekTxns.length,
        weekAmount: weekTxns.reduce((sum, t) => sum + t.amount, 0),
        monthTransactions: monthTxns.length,
        monthAmount: monthTxns.reduce((sum, t) => sum + t.amount, 0),
        pendingTransactions: pendingTxns.length,
        activeCustomers: await getActiveCustomersCount(),
      });

      // Set recent transactions
      const recent = cachedTransactions
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map(t => ({
          id: t.id,
          customerId: t.customerId,
          customerName: t.customerName || 'Unknown Customer',
          amount: t.amount,
          type: t.type,
          status: t.status,
          timestamp: t.createdAt,
          synced: t.synced,
        }));

      setRecentTransactions(recent);

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      Alert.alert('Error', 'Failed to load dashboard data');
    }
  };

  const loadOfflineInfo = async () => {
    try {
      const info = await OfflineService.getStorageInfo();
      setOfflineInfo({
        pendingOperations: info.pendingOperations,
        cachedTransactions: info.cachedTransactions,
        lastSync: info.lastSync,
      });
    } catch (error) {
      console.error('Failed to load offline info:', error);
    }
  };

  const getActiveCustomersCount = async (): Promise<number> => {
    try {
      const customers = await OfflineService.getCachedCustomers();
      return customers.length;
    } catch (error) {
      console.error('Failed to get customers count:', error);
      return 0;
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Trigger sync if online
      if (!OfflineService.isOfflineMode()) {
        await SyncService.triggerSync();
      }
      await loadDashboardData();
      await loadOfflineInfo();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'new_transaction':
        navigation.navigate('Transactions', {
          screen: 'NewTransaction',
        });
        break;
      case 'new_customer':
        navigation.navigate('Customers', {
          screen: 'NewCustomer',
        });
        break;
      case 'scan_qr':
        navigation.navigate('Scanner');
        break;
      case 'reports':
        navigation.navigate('Reports');
        break;
      case 'notifications':
        navigation.navigate('Notifications');
        break;
      case 'offline_status':
        navigation.navigate('OfflineStatus');
        break;
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatLastSync = (timestamp: number | null): string => {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Chart data
  const transactionChartData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        data: [20, 45, 28, 80, 99, 43, 50], // Mock data - replace with real data
        color: (opacity = 1) => `rgba(46, 125, 50, ${opacity})`,
        strokeWidth: 2,
      },
    ],
  };

  const transactionTypeData = [
    {
      name: 'Deposits',
      population: 40,
      color: '#4CAF50',
      legendFontColor: '#7F7F7F',
      legendFontSize: 12,
    },
    {
      name: 'Withdrawals',
      population: 30,
      color: '#FF9800',
      legendFontColor: '#7F7F7F',
      legendFontSize: 12,
    },
    {
      name: 'Transfers',
      population: 20,
      color: '#2196F3',
      legendFontColor: '#7F7F7F',
      legendFontSize: 12,
    },
    {
      name: 'Payments',
      population: 10,
      color: '#9C27B0',
      legendFontColor: '#7F7F7F',
      legendFontSize: 12,
    },
  ];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
      }>
      
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning,</Text>
          <Text style={styles.userName}>{user?.firstName || 'Agent'}</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Notifications')}
          style={styles.notificationButton}>
          <Icon name="bell-outline" size={24} color="#2E7D32" />
          {offlineInfo.pendingOperations > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{offlineInfo.pendingOperations}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Network Status */}
      <NetworkStatus />

      {/* Offline Status Card */}
      {(offlineInfo.pendingOperations > 0 || OfflineService.isOfflineMode()) && (
        <TouchableOpacity
          style={styles.offlineCard}
          onPress={() => handleQuickAction('offline_status')}>
          <Icon name="cloud-off-outline" size={24} color="#FF9800" />
          <View style={styles.offlineInfo}>
            <Text style={styles.offlineTitle}>
              {OfflineService.isOfflineMode() ? 'Working Offline' : 'Sync Pending'}
            </Text>
            <Text style={styles.offlineSubtitle}>
              {offlineInfo.pendingOperations} operations pending • Last sync: {formatLastSync(offlineInfo.lastSync)}
            </Text>
          </View>
          <Icon name="chevron-right" size={24} color="#FF9800" />
        </TouchableOpacity>
      )}

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <StatCard
          title="Today"
          transactions={stats.todayTransactions}
          amount={stats.todayAmount}
          icon="calendar-today"
          color="#4CAF50"
        />
        <StatCard
          title="This Week"
          transactions={stats.weekTransactions}
          amount={stats.weekAmount}
          icon="calendar-week"
          color="#2196F3"
        />
      </View>

      <View style={styles.statsContainer}>
        <StatCard
          title="This Month"
          transactions={stats.monthTransactions}
          amount={stats.monthAmount}
          icon="calendar-month"
          color="#FF9800"
        />
        <StatCard
          title="Pending"
          transactions={stats.pendingTransactions}
          amount={0}
          icon="clock-outline"
          color="#F44336"
        />
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActionsContainer}>
          <QuickActionCard
            title="New Transaction"
            icon="plus-circle"
            color="#4CAF50"
            onPress={() => handleQuickAction('new_transaction')}
          />
          <QuickActionCard
            title="New Customer"
            icon="account-plus"
            color="#2196F3"
            onPress={() => handleQuickAction('new_customer')}
          />
          <QuickActionCard
            title="Scan QR"
            icon="qrcode-scan"
            color="#FF9800"
            onPress={() => handleQuickAction('scan_qr')}
          />
          <QuickActionCard
            title="Reports"
            icon="chart-line"
            color="#9C27B0"
            onPress={() => handleQuickAction('reports')}
          />
        </View>
      </View>

      {/* Transaction Trend Chart */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transaction Trend (7 Days)</Text>
        <View style={styles.chartContainer}>
          <LineChart
            data={transactionChartData}
            width={screenWidth - 40}
            height={200}
            chartConfig={{
              backgroundColor: '#FFFFFF',
              backgroundGradientFrom: '#FFFFFF',
              backgroundGradientTo: '#FFFFFF',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(46, 125, 50, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              style: {
                borderRadius: 16,
              },
              propsForDots: {
                r: '4',
                strokeWidth: '2',
                stroke: '#2E7D32',
              },
            }}
            bezier
            style={styles.chart}
          />
        </View>
      </View>

      {/* Transaction Types */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transaction Types</Text>
        <View style={styles.chartContainer}>
          <PieChart
            data={transactionTypeData}
            width={screenWidth - 40}
            height={200}
            chartConfig={{
              color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
            }}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="15"
            center={[10, 0]}
          />
        </View>
      </View>

      {/* Recent Transactions */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Transactions')}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>
        {recentTransactions.map(transaction => (
          <RecentTransactionCard
            key={transaction.id}
            transaction={transaction}
            onPress={() =>
              navigation.navigate('Transactions', {
                screen: 'TransactionDetail',
                params: {transactionId: transaction.id},
              })
            }
          />
        ))}
        {recentTransactions.length === 0 && (
          <View style={styles.emptyState}>
            <Icon name="credit-card-off-outline" size={48} color="#BDBDBD" />
            <Text style={styles.emptyStateText}>No recent transactions</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFFFFF',
  },
  greeting: {
    fontSize: 16,
    color: '#757575',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  notificationButton: {
    position: 'relative',
    padding: 8,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#F44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  offlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    margin: 20,
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  offlineInfo: {
    flex: 1,
    marginLeft: 12,
  },
  offlineTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E65100',
  },
  offlineSubtitle: {
    fontSize: 14,
    color: '#BF360C',
    marginTop: 2,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  section: {
    backgroundColor: '#FFFFFF',
    margin: 20,
    borderRadius: 12,
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#212121',
  },
  viewAllText: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '500',
  },
  quickActionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  chartContainer: {
    alignItems: 'center',
    marginTop: 10,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#BDBDBD',
    marginTop: 12,
  },
});

export default DashboardScreen;
