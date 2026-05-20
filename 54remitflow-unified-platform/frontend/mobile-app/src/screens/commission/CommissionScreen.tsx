import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Dimensions,
} from 'react-native';
import { Card, Button, Chip, Searchbar, FAB } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { LineChart, PieChart, BarChart } from 'react-native-chart-kit';
import { useSelector, useDispatch } from 'react-redux';

const { width: screenWidth } = Dimensions.get('window');

interface CommissionData {
  id: string;
  agent_id: string;
  agent_name: string;
  transaction_id: string;
  amount: number;
  commission_rate: number;
  commission_amount: number;
  status: string;
  created_at: string;
  paid_at: string | null;
}

interface CommissionSummary {
  total_earned: number;
  total_paid: number;
  pending_amount: number;
  this_month: number;
  last_month: number;
  growth_rate: number;
}

const CommissionScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [commissions, setCommissions] = useState<CommissionData[]>([]);
  const [summary, setSummary] = useState<CommissionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('month');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredCommissions, setFilteredCommissions] = useState<CommissionData[]>([]);

  const { user } = useSelector((state: any) => state.auth);

  useEffect(() => {
    loadCommissionData();
  }, [selectedPeriod]);

  useEffect(() => {
    filterCommissions();
  }, [searchQuery, commissions]);

  const loadCommissionData = async () => {
    setLoading(true);
    try {
      // Get API base URL from environment or use default
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://api.agentbanking.com';
      
      // Fetch commissions from the commission service
      const commissionsResponse = await fetch(
        `${API_BASE_URL}/api/v1/commissions?agent_id=${user?.agent_id}&period=${selectedPeriod}`,
        {
          headers: {
            'Authorization': `Bearer ${user?.token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (!commissionsResponse.ok) {
        throw new Error(`Failed to fetch commissions: ${commissionsResponse.status}`);
      }
      
      const commissionsData = await commissionsResponse.json();
      
      // Fetch commission summary
      const summaryResponse = await fetch(
        `${API_BASE_URL}/api/v1/commissions/summary?agent_id=${user?.agent_id}&period=${selectedPeriod}`,
        {
          headers: {
            'Authorization': `Bearer ${user?.token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (!summaryResponse.ok) {
        throw new Error(`Failed to fetch summary: ${summaryResponse.status}`);
      }
      
      const summaryData = await summaryResponse.json();

      setCommissions(commissionsData.commissions || []);
      setSummary(summaryData);
      setFilteredCommissions(commissionsData.commissions || []);
    } catch (error) {
      console.error('Commission data load error:', error);
      Alert.alert('Error', 'Failed to load commission data. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const filterCommissions = () => {
    if (!searchQuery.trim()) {
      setFilteredCommissions(commissions);
      return;
    }

    const filtered = commissions.filter(commission =>
      commission.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      commission.transaction_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      commission.status.toLowerCase().includes(searchQuery.toLowerCase())
    );

    setFilteredCommissions(filtered);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCommissionData();
    setRefreshing(false);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'paid': return '#2ECC71';
      case 'pending': return '#F39C12';
      case 'disputed': return '#E74C3C';
      case 'cancelled': return '#95A5A6';
      default: return '#3498DB';
    }
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const chartConfig = {
    backgroundGradientFrom: '#ffffff',
    backgroundGradientTo: '#ffffff',
    color: (opacity = 1) => `rgba(52, 152, 219, ${opacity})`,
    strokeWidth: 2,
    barPercentage: 0.5,
    useShadowColorFromDataset: false,
  };

  const lineChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        data: [1200, 1800, 2200, 1900, 2800, 3500],
        color: (opacity = 1) => `rgba(52, 152, 219, ${opacity})`,
        strokeWidth: 2,
      },
    ],
  };

  const pieChartData = [
    {
      name: 'Paid',
      population: summary?.total_paid || 0,
      color: '#2ECC71',
      legendFontColor: '#7F7F7F',
      legendFontSize: 15,
    },
    {
      name: 'Pending',
      population: summary?.pending_amount || 0,
      color: '#F39C12',
      legendFontColor: '#7F7F7F',
      legendFontSize: 15,
    },
  ];

  const renderCommissionCard = (commission: CommissionData) => (
    <Card key={commission.id} style={styles.commissionCard}>
      <TouchableOpacity
        onPress={() => navigation.navigate('CommissionDetails', { commissionId: commission.id })}
      >
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.agentInfo}>
              <Text style={styles.agentName}>{commission.agent_name}</Text>
              <Text style={styles.transactionId}>#{commission.transaction_id}</Text>
            </View>
            <Chip
              style={[styles.statusChip, { backgroundColor: getStatusColor(commission.status) }]}
              textStyle={styles.statusText}
            >
              {commission.status.toUpperCase()}
            </Chip>
          </View>

          <View style={styles.cardBody}>
            <View style={styles.amountSection}>
              <Text style={styles.label}>Transaction Amount</Text>
              <Text style={styles.transactionAmount}>
                ${commission.amount.toLocaleString()}
              </Text>
            </View>
            <View style={styles.commissionSection}>
              <Text style={styles.label}>Commission ({commission.commission_rate}%)</Text>
              <Text style={styles.commissionAmount}>
                ${commission.commission_amount.toLocaleString()}
              </Text>
            </View>
          </View>

          <View style={styles.cardFooter}>
            <View style={styles.dateInfo}>
              <Icon name="schedule" size={16} color="#7F8C8D" />
              <Text style={styles.dateText}>
                Created: {formatDate(commission.created_at)}
              </Text>
            </View>
            {commission.paid_at && (
              <View style={styles.dateInfo}>
                <Icon name="payment" size={16} color="#27AE60" />
                <Text style={styles.dateText}>
                  Paid: {formatDate(commission.paid_at)}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Card>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary Cards */}
        {summary && (
          <View style={styles.summaryContainer}>
            <View style={styles.summaryRow}>
              <Card style={[styles.summaryCard, styles.totalEarned]}>
                <View style={styles.summaryContent}>
                  <Icon name="account-balance-wallet" size={24} color="#FFF" />
                  <Text style={styles.summaryAmount}>
                    ${summary.total_earned.toLocaleString()}
                  </Text>
                  <Text style={styles.summaryLabel}>Total Earned</Text>
                </View>
              </Card>
              <Card style={[styles.summaryCard, styles.totalPaid]}>
                <View style={styles.summaryContent}>
                  <Icon name="payment" size={24} color="#FFF" />
                  <Text style={styles.summaryAmount}>
                    ${summary.total_paid.toLocaleString()}
                  </Text>
                  <Text style={styles.summaryLabel}>Total Paid</Text>
                </View>
              </Card>
            </View>
            <View style={styles.summaryRow}>
              <Card style={[styles.summaryCard, styles.pending]}>
                <View style={styles.summaryContent}>
                  <Icon name="hourglass-empty" size={24} color="#FFF" />
                  <Text style={styles.summaryAmount}>
                    ${summary.pending_amount.toLocaleString()}
                  </Text>
                  <Text style={styles.summaryLabel}>Pending</Text>
                </View>
              </Card>
              <Card style={[styles.summaryCard, styles.growth]}>
                <View style={styles.summaryContent}>
                  <Icon name="trending-up" size={24} color="#FFF" />
                  <Text style={styles.summaryAmount}>
                    {summary.growth_rate.toFixed(1)}%
                  </Text>
                  <Text style={styles.summaryLabel}>Growth</Text>
                </View>
              </Card>
            </View>
          </View>
        )}

        {/* Charts Section */}
        <Card style={styles.chartCard}>
          <Text style={styles.chartTitle}>Commission Trends</Text>
          <LineChart
            data={lineChartData}
            width={screenWidth - 60}
            height={220}
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={styles.chartTitle}>Commission Distribution</Text>
          <PieChart
            data={pieChartData}
            width={screenWidth - 60}
            height={220}
            chartConfig={chartConfig}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="15"
            center={[10, 50]}
            absolute
            style={styles.chart}
          />
        </Card>

        {/* Period Filter */}
        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {['week', 'month', 'quarter', 'year'].map((period) => (
              <Chip
                key={period}
                selected={selectedPeriod === period}
                onPress={() => setSelectedPeriod(period)}
                style={[
                  styles.periodChip,
                  selectedPeriod === period && styles.selectedPeriodChip
                ]}
                textStyle={[
                  styles.periodChipText,
                  selectedPeriod === period && styles.selectedPeriodChipText
                ]}
              >
                {period.charAt(0).toUpperCase() + period.slice(1)}
              </Chip>
            ))}
          </ScrollView>
        </View>

        {/* Search Bar */}
        <Searchbar
          placeholder="Search commissions..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />

        {/* Commission List */}
        <View style={styles.commissionList}>
          <Text style={styles.sectionTitle}>Recent Commissions</Text>
          {filteredCommissions.map(renderCommissionCard)}
        </View>
      </ScrollView>

      {/* Floating Action Button */}
      <FAB
        style={styles.fab}
        icon="add"
        onPress={() => navigation.navigate('CommissionRules')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  summaryContainer: {
    padding: 15,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  summaryCard: {
    flex: 1,
    marginHorizontal: 5,
    elevation: 3,
  },
  totalEarned: {
    backgroundColor: '#3498DB',
  },
  totalPaid: {
    backgroundColor: '#2ECC71',
  },
  pending: {
    backgroundColor: '#F39C12',
  },
  growth: {
    backgroundColor: '#E74C3C',
  },
  summaryContent: {
    padding: 20,
    alignItems: 'center',
  },
  summaryAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 10,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#FFF',
    marginTop: 5,
    opacity: 0.9,
  },
  chartCard: {
    margin: 15,
    padding: 20,
    elevation: 2,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2C3E50',
    marginBottom: 15,
    textAlign: 'center',
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  filterContainer: {
    paddingHorizontal: 15,
    marginBottom: 15,
  },
  periodChip: {
    marginRight: 10,
    backgroundColor: '#FFF',
  },
  selectedPeriodChip: {
    backgroundColor: '#3498DB',
  },
  periodChipText: {
    color: '#7F8C8D',
  },
  selectedPeriodChipText: {
    color: '#FFF',
  },
  searchBar: {
    margin: 15,
    elevation: 2,
  },
  commissionList: {
    padding: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2C3E50',
    marginBottom: 15,
  },
  commissionCard: {
    marginBottom: 15,
    elevation: 2,
  },
  cardContent: {
    padding: 15,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2C3E50',
  },
  transactionId: {
    fontSize: 14,
    color: '#7F8C8D',
    marginTop: 2,
  },
  statusChip: {
    height: 30,
  },
  statusText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  amountSection: {
    flex: 1,
  },
  commissionSection: {
    flex: 1,
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 12,
    color: '#7F8C8D',
    marginBottom: 5,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#34495E',
  },
  commissionAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#27AE60',
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
    paddingTop: 15,
  },
  dateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  dateText: {
    fontSize: 12,
    color: '#7F8C8D',
    marginLeft: 8,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: '#3498DB',
  },
});

export default CommissionScreen;
