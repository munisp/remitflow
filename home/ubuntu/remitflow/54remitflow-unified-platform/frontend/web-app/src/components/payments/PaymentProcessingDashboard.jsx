import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  CreditCard, DollarSign, TrendingUp, RefreshCw, CheckCircle,
  XCircle, Clock, Search, Download, Eye, AlertTriangle, Activity
} from 'lucide-react';
import api from '@/lib/api';

const PAYMENT_PROVIDERS = {
  stripe: { name: 'Stripe', icon: '💳', color: 'text-blue-600' },
  paypal: { name: 'PayPal', icon: '🅿️', color: 'text-blue-700' },
  mobile_money: { name: 'Mobile Money', icon: '📱', color: 'text-green-600' },
  bank_transfer: { name: 'Bank Transfer', icon: '🏦', color: 'text-purple-600' }
};

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Pending' },
  processing: { icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Processing' },
  completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
  refunded: { icon: RefreshCw, color: 'text-orange-600', bg: 'bg-orange-50', label: 'Refunded' }
};

export default function PaymentProcessingDashboard() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterProvider, setFilterProvider] = useState('all');
  const [selectedPayment, setSelectedPayment] = useState(null);
  
  const [stats, setStats] = useState({
    total_payments: 0,
    total_volume: 0,
    successful_payments: 0,
    failed_payments: 0,
    pending_payments: 0,
    refunded_amount: 0,
    success_rate: 0,
    average_transaction_value: 0
  });

  const [payments, setPayments] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [exchangeRates, setExchangeRates] = useState({});
  const [anomalies, setAnomalies] = useState([]);

  useEffect(() => {
    fetchPaymentData();
    const interval = setInterval(fetchPaymentData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchPaymentData = async () => {
    try {
      setLoading(true);
      
      const [statsRes, paymentsRes, transactionsRes, refundsRes, ratesRes] = await Promise.all([
        api.payments.getStats(),
        api.payments.getPayments({ limit: 100 }),
        api.payments.getTransactions({ limit: 100 }),
        api.payments.getRefunds({ limit: 50 }),
        api.payments.getExchangeRates()
      ]);

      setStats(statsRes);
      setPayments(paymentsRes.payments || []);
      setTransactions(transactionsRes.transactions || []);
      setRefunds(refundsRes.refunds || []);
      setExchangeRates(ratesRes.rates || {});

      // Check for anomalies
      const anomalyRes = await api.anomaly.detectTransactionAnomalies({
        transactions: transactionsRes.transactions.slice(0, 20)
      });
      setAnomalies(anomalyRes.anomalies || []);
    } catch (error) {
      console.error('Error fetching payment data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessPayment = async (paymentData) => {
    try {
      // Process payment through gateway
      const paymentRes = await api.payments.processPayment(paymentData);
      
      // Record in TigerBeetle ledger
      await api.tigerbeetle.recordPayment({
        payment_id: paymentRes.payment_id,
        from_account: paymentData.from_account,
        to_account: paymentData.to_account,
        amount: paymentData.amount,
        currency: paymentData.currency
      });
      
      await fetchPaymentData();
      return paymentRes;
    } catch (error) {
      console.error('Error processing payment:', error);
      throw error;
    }
  };

  const handleRefundPayment = async (paymentId, amount, reason) => {
    try {
      // Process refund
      const refundRes = await api.payments.refundPayment(paymentId, {
        amount: amount,
        reason: reason
      });
      
      // Record refund in TigerBeetle
      await api.tigerbeetle.recordRefund({
        payment_id: paymentId,
        refund_id: refundRes.refund_id,
        amount: amount
      });
      
      await fetchPaymentData();
      setSelectedPayment(null);
    } catch (error) {
      console.error('Error processing refund:', error);
    }
  };

  const handleViewPayment = async (payment) => {
    setSelectedPayment(payment);
    
    // Fetch additional details
    try {
      const detailsRes = await api.payments.getPaymentDetails(payment.id);
      setSelectedPayment({ ...payment, ...detailsRes });
    } catch (error) {
      console.error('Error fetching payment details:', error);
    }
  };

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = searchQuery === '' ||
      payment.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.merchant_id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || payment.status === filterStatus;
    const matchesProvider = filterProvider === 'all' || payment.provider === filterProvider;
    return matchesSearch && matchesStatus && matchesProvider;
  });

  const convertCurrency = (amount, fromCurrency, toCurrency) => {
    if (fromCurrency === toCurrency) return amount;
    const rate = exchangeRates[`${fromCurrency}_${toCurrency}`] || 1;
    return (amount * rate).toFixed(2);
  };

  if (loading && payments.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Activity className="h-12 w-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-gray-600">Loading payment data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CreditCard className="h-8 w-8 text-purple-600" />
            Payment Processing
          </h1>
          <p className="text-gray-600 mt-1">Multi-provider payment gateway with anomaly detection</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchPaymentData}>
            <Activity className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Anomaly Alerts */}
      {anomalies.length > 0 && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertDescription>
            <strong>{anomalies.length} anomalies detected</strong> in recent transactions. Review flagged payments.
          </AlertDescription>
        </Alert>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Volume</p>
                <p className="text-3xl font-bold">${(stats.total_volume / 1000).toFixed(1)}K</p>
              </div>
              <DollarSign className="h-10 w-10 text-purple-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              {stats.total_payments} transactions
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Success Rate</p>
                <p className="text-3xl font-bold text-green-600">{stats.success_rate}%</p>
              </div>
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              {stats.successful_payments} successful
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Failed Payments</p>
                <p className="text-3xl font-bold text-red-600">{stats.failed_payments}</p>
              </div>
              <XCircle className="h-10 w-10 text-red-600" />
            </div>
            <div className="mt-4 text-xs text-red-600">
              {((stats.failed_payments / stats.total_payments) * 100).toFixed(1)}% failure rate
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Transaction</p>
                <p className="text-3xl font-bold">${stats.average_transaction_value}</p>
              </div>
              <TrendingUp className="h-10 w-10 text-blue-600" />
            </div>
            <div className="mt-4 text-xs text-blue-600">
              ↑ 8% from last month
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Providers</CardTitle>
          <CardDescription>Transaction volume by provider</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            {Object.entries(PAYMENT_PROVIDERS).map(([key, provider]) => {
              const providerPayments = payments.filter(p => p.provider === key);
              const providerVolume = providerPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
              
              return (
                <div key={key} className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{provider.icon}</span>
                    <span className="font-semibold">{provider.name}</span>
                  </div>
                  <p className="text-2xl font-bold">${(providerVolume / 1000).toFixed(1)}K</p>
                  <p className="text-sm text-gray-600">{providerPayments.length} transactions</p>
                </div>
              );
            })}
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
                  placeholder="Search by payment ID or merchant ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border rounded-md px-4 py-2"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              className="border rounded-md px-4 py-2"
            >
              <option value="all">All Providers</option>
              {Object.entries(PAYMENT_PROVIDERS).map(([key, provider]) => (
                <option key={key} value={key}>{provider.name}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
          <TabsTrigger value="refunds">Refunds ({refunds.length})</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies ({anomalies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Payments</CardTitle>
              <CardDescription>Latest payment transactions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredPayments.slice(0, 10).map((payment) => {
                  const StatusIcon = STATUS_CONFIG[payment.status]?.icon || Clock;
                  const statusConfig = STATUS_CONFIG[payment.status] || STATUS_CONFIG.pending;
                  const provider = PAYMENT_PROVIDERS[payment.provider] || {};
                  const isAnomaly = anomalies.some(a => a.transaction_id === payment.id);
                  
                  return (
                    <div key={payment.id} className={`p-4 border rounded-lg hover:bg-gray-50 ${isAnomaly ? 'border-orange-300 bg-orange-50' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <span className="text-2xl">{provider.icon}</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <StatusIcon className={`h-4 w-4 ${statusConfig.color}`} />
                              <Badge className={statusConfig.bg}>{statusConfig.label}</Badge>
                              <span className="font-medium">#{payment.id}</span>
                              {isAnomaly && <Badge variant="destructive">Anomaly</Badge>}
                            </div>
                            <div className="text-sm text-gray-600">
                              {payment.merchant_id} • ${payment.amount} {payment.currency} • 
                              {new Date(payment.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleViewPayment(payment)}>
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Payments</CardTitle>
              <CardDescription>Complete payment transaction history</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredPayments.map((payment) => {
                  const StatusIcon = STATUS_CONFIG[payment.status]?.icon || Clock;
                  const statusConfig = STATUS_CONFIG[payment.status] || STATUS_CONFIG.pending;
                  const provider = PAYMENT_PROVIDERS[payment.provider] || {};
                  
                  return (
                    <div key={payment.id} className="p-4 border rounded-lg hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xl">{provider.icon}</span>
                            <span className="font-medium">{provider.name}</span>
                            <Badge className={statusConfig.bg}>{statusConfig.label}</Badge>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-sm text-gray-600">
                            <div>ID: {payment.id}</div>
                            <div>Merchant: {payment.merchant_id}</div>
                            <div>Amount: ${payment.amount} {payment.currency}</div>
                            <div>Fee: ${payment.fee || 0}</div>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {new Date(payment.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleViewPayment(payment)}>
                            View Details
                          </Button>
                          {payment.status === 'completed' && (
                            <Button size="sm" variant="outline" onClick={() => handleRefundPayment(payment.id, payment.amount, 'Customer request')}>
                              <RefreshCw className="h-4 w-4 mr-1" />
                              Refund
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="refunds" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Refunds</CardTitle>
              <CardDescription>Processed refund transactions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {refunds.map((refund) => (
                  <div key={refund.id} className="p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <RefreshCw className="h-4 w-4 text-orange-600" />
                          <span className="font-medium">Refund #{refund.id}</span>
                          <Badge className="bg-orange-50">Refunded</Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm text-gray-600">
                          <div>Payment ID: {refund.payment_id}</div>
                          <div>Amount: ${refund.amount}</div>
                          <div>Reason: {refund.reason}</div>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Processed: {new Date(refund.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="anomalies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Payment Anomalies</CardTitle>
              <CardDescription>Transactions flagged by anomaly detection</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {anomalies.map((anomaly, index) => (
                  <div key={index} className="p-4 border border-orange-300 rounded-lg bg-orange-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-5 w-5 text-orange-600" />
                          <span className="font-medium">Transaction #{anomaly.transaction_id}</span>
                          <Badge variant="destructive">{anomaly.risk_level}</Badge>
                        </div>
                        <div className="text-sm mb-2">
                          <strong>Anomaly Score:</strong> {anomaly.anomaly_score}
                        </div>
                        <div className="text-sm mb-2">
                          <strong>Detection Methods:</strong> {anomaly.detection_methods?.join(', ')}
                        </div>
                        <div className="text-sm">
                          <strong>Recommended Action:</strong> {anomaly.recommended_action}
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        Investigate
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment Detail Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b sticky top-0 bg-white">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Payment Details</h2>
                <Button variant="ghost" onClick={() => setSelectedPayment(null)}>✕</Button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Payment ID</p>
                  <p className="font-medium">{selectedPayment.id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <Badge className={STATUS_CONFIG[selectedPayment.status]?.bg}>
                    {STATUS_CONFIG[selectedPayment.status]?.label}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Provider</p>
                  <p className="font-medium">{PAYMENT_PROVIDERS[selectedPayment.provider]?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Amount</p>
                  <p className="font-medium text-lg">${selectedPayment.amount} {selectedPayment.currency}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Merchant ID</p>
                  <p className="font-medium">{selectedPayment.merchant_id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Created</p>
                  <p className="font-medium">{new Date(selectedPayment.created_at).toLocaleString()}</p>
                </div>
              </div>

              {selectedPayment.status === 'completed' && (
                <div className="flex gap-2 justify-end pt-4">
                  <Button variant="outline" onClick={() => handleRefundPayment(selectedPayment.id, selectedPayment.amount, 'Full refund')}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Process Refund
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

