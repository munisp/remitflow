import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, AlertTriangle, TrendingDown, DollarSign, Users,
  Search, Eye, Ban, CheckCircle, XCircle, Activity
} from 'lucide-react';
import api from '@/lib/api';

const RISK_LEVELS = {
  critical: { color: 'bg-red-500', label: 'Critical', variant: 'destructive' },
  high: { color: 'bg-orange-500', label: 'High', variant: 'destructive' },
  medium: { color: 'bg-yellow-500', label: 'Medium', variant: 'warning' },
  low: { color: 'bg-blue-500', label: 'Low', variant: 'secondary' }
};

export default function FraudDetectionDashboard() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRisk, setFilterRisk] = useState('all');
  
  const [stats, setStats] = useState({
    total_transactions: 0,
    flagged_transactions: 0,
    blocked_transactions: 0,
    false_positives: 0,
    total_amount_saved: 0,
    fraud_rate: 0
  });

  const [fraudAlerts, setFraudAlerts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [modelInsights, setModelInsights] = useState({
    rule_based: { accuracy: 0, alerts: 0 },
    ml_model: { accuracy: 0, alerts: 0 },
    deep_learning: { accuracy: 0, alerts: 0 },
    gnn_model: { accuracy: 0, alerts: 0 }
  });

  useEffect(() => {
    fetchFraudData();
    const interval = setInterval(fetchFraudData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchFraudData = async () => {
    try {
      setLoading(true);
      
      const [statsRes, alertsRes, transactionsRes, insightsRes] = await Promise.all([
        api.fraud.getStats(),
        api.fraud.getAlerts({ limit: 50 }),
        api.fraud.getTransactions({ flagged: true, limit: 50 }),
        api.fraud.getModelInsights()
      ]);

      setStats(statsRes);
      setFraudAlerts(alertsRes.alerts || []);
      setTransactions(transactionsRes.transactions || []);
      setModelInsights(insightsRes);
    } catch (error) {
      console.error('Error fetching fraud data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReviewTransaction = async (transactionId, action) => {
    try {
      await api.fraud.reviewTransaction(transactionId, {
        action: action, // 'approve', 'block', 'investigate'
        reviewed_by: 'admin',
        notes: `Transaction ${action}ed via dashboard`
      });
      await fetchFraudData();
    } catch (error) {
      console.error('Error reviewing transaction:', error);
    }
  };

  const handleBlockUser = async (userId) => {
    try {
      await api.fraud.blockUser(userId, {
        reason: 'Suspicious activity detected',
        duration: 'permanent'
      });
      await fetchFraudData();
    } catch (error) {
      console.error('Error blocking user:', error);
    }
  };

  const filteredAlerts = fraudAlerts.filter(alert => {
    const matchesSearch = searchQuery === '' ||
      alert.transaction_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.user_id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRisk = filterRisk === 'all' || alert.risk_level === filterRisk;
    return matchesSearch && matchesRisk;
  });

  const getRiskBadge = (riskLevel) => {
    const risk = RISK_LEVELS[riskLevel] || RISK_LEVELS.low;
    return <Badge variant={risk.variant}>{risk.label}</Badge>;
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'blocked': return <Ban className="h-4 w-4 text-red-500" />;
      case 'approved': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'investigating': return <Eye className="h-4 w-4 text-yellow-500" />;
      default: return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    }
  };

  if (loading && fraudAlerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Activity className="h-12 w-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-gray-600">Loading fraud detection data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-purple-600" />
            Fraud Detection
          </h1>
          <p className="text-gray-600 mt-1">Real-time fraud monitoring with ML/DL/GNN models</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchFraudData}>
            <Activity className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button>
            <TrendingDown className="h-4 w-4 mr-2" />
            View Reports
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Flagged Transactions</p>
                <p className="text-3xl font-bold">{stats.flagged_transactions}</p>
              </div>
              <AlertTriangle className="h-10 w-10 text-orange-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              {((stats.flagged_transactions / stats.total_transactions) * 100).toFixed(2)}% of total
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Blocked Transactions</p>
                <p className="text-3xl font-bold text-red-600">{stats.blocked_transactions}</p>
              </div>
              <Ban className="h-10 w-10 text-red-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              Prevented fraud
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Amount Saved</p>
                <p className="text-3xl font-bold text-green-600">${(stats.total_amount_saved / 1000).toFixed(1)}K</p>
              </div>
              <DollarSign className="h-10 w-10 text-green-600" />
            </div>
            <div className="mt-4 text-xs text-green-600">
              ↑ 15% from last month
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Fraud Rate</p>
                <p className="text-3xl font-bold">{stats.fraud_rate}%</p>
              </div>
              <TrendingDown className="h-10 w-10 text-blue-600" />
            </div>
            <div className="mt-4 text-xs text-blue-600">
              ↓ 0.3% from last month
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ML Model Performance */}
      <Card>
        <CardHeader>
          <CardTitle>ML Model Performance</CardTitle>
          <CardDescription>5-layer hybrid fraud detection system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">Rule-Based</h4>
                <Badge variant="outline">Layer 1</Badge>
              </div>
              <p className="text-2xl font-bold text-purple-600">{modelInsights.rule_based.accuracy}%</p>
              <p className="text-sm text-gray-600 mt-1">{modelInsights.rule_based.alerts} alerts</p>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">ML Model</h4>
                <Badge variant="outline">Layer 2</Badge>
              </div>
              <p className="text-2xl font-bold text-blue-600">{modelInsights.ml_model.accuracy}%</p>
              <p className="text-sm text-gray-600 mt-1">{modelInsights.ml_model.alerts} alerts</p>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">Deep Learning</h4>
                <Badge variant="outline">Layer 3</Badge>
              </div>
              <p className="text-2xl font-bold text-green-600">{modelInsights.deep_learning.accuracy}%</p>
              <p className="text-sm text-gray-600 mt-1">{modelInsights.deep_learning.alerts} alerts</p>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">GNN Model</h4>
                <Badge variant="outline">Layer 4</Badge>
              </div>
              <p className="text-2xl font-bold text-orange-600">{modelInsights.gnn_model.accuracy}%</p>
              <p className="text-sm text-gray-600 mt-1">{modelInsights.gnn_model.alerts} alerts</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by transaction ID or user ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <select
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
              className="border rounded-md px-4 py-2"
            >
              <option value="all">All Risk Levels</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="alerts">Fraud Alerts ({fraudAlerts.length})</TabsTrigger>
          <TabsTrigger value="transactions">Flagged Transactions ({transactions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Fraud Alerts</CardTitle>
              <CardDescription>Latest fraud detection alerts requiring review</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredAlerts.slice(0, 10).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`w-3 h-3 rounded-full ${RISK_LEVELS[alert.risk_level]?.color || 'bg-gray-500'}`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {getRiskBadge(alert.risk_level)}
                          <span className="font-medium">Transaction #{alert.transaction_id}</span>
                          <Badge variant="outline">{alert.fraud_type}</Badge>
                        </div>
                        <div className="text-sm text-gray-600">
                          User: {alert.user_id} • Amount: ${alert.amount} • Score: {alert.fraud_score}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Detected by: {alert.detection_layer} • {new Date(alert.timestamp).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleReviewTransaction(alert.transaction_id, 'approve')}>
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleReviewTransaction(alert.transaction_id, 'block')}>
                        <Ban className="h-4 w-4 mr-1" />
                        Block
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Fraud Alerts</CardTitle>
              <CardDescription>Complete list of fraud detection alerts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredAlerts.map((alert) => (
                  <div key={alert.id} className="p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getRiskBadge(alert.risk_level)}
                          <Badge variant="outline">{alert.fraud_type}</Badge>
                          <span className="font-medium">Transaction #{alert.transaction_id}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm text-gray-600 mb-2">
                          <div>User ID: {alert.user_id}</div>
                          <div>Amount: ${alert.amount}</div>
                          <div>Fraud Score: {alert.fraud_score}</div>
                        </div>
                        <div className="text-sm mb-2">
                          <strong>Reasons:</strong> {alert.reasons?.join(', ') || 'N/A'}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Layer: {alert.detection_layer}</span>
                          <span>Model: {alert.model_name}</span>
                          <span>Confidence: {alert.confidence}%</span>
                          <span>{new Date(alert.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleReviewTransaction(alert.transaction_id, 'investigate')}>
                          <Eye className="h-4 w-4 mr-1" />
                          Investigate
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleBlockUser(alert.user_id)}>
                          <Ban className="h-4 w-4 mr-1" />
                          Block User
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Flagged Transactions</CardTitle>
              <CardDescription>Transactions flagged for potential fraud</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {transactions.map((transaction) => (
                  <div key={transaction.id} className="p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getActionIcon(transaction.status)}
                          <span className="font-medium">Transaction #{transaction.id}</span>
                          <Badge>{transaction.status}</Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-sm text-gray-600">
                          <div>From: {transaction.from_account}</div>
                          <div>To: {transaction.to_account}</div>
                          <div>Amount: ${transaction.amount}</div>
                          <div>Time: {new Date(transaction.timestamp).toLocaleString()}</div>
                        </div>
                        {transaction.review_notes && (
                          <div className="mt-2 p-2 bg-gray-100 rounded text-sm">
                            <strong>Review Notes:</strong> {transaction.review_notes}
                          </div>
                        )}
                      </div>
                      {transaction.status === 'pending_review' && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleReviewTransaction(transaction.id, 'approve')}>
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleReviewTransaction(transaction.id, 'block')}>
                            Block
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

