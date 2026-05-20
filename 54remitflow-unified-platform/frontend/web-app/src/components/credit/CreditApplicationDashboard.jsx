import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  DollarSign, TrendingUp, Users, CheckCircle, XCircle, Clock,
  Search, Eye, Download, FileText, AlertTriangle, Activity, Network
} from 'lucide-react';
import api from '@/lib/api';

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Pending' },
  approved: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: 'Approved' },
  rejected: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Rejected' },
  disbursed: { icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Disbursed' }
};

const CREDIT_SCORE_RANGES = {
  excellent: { min: 750, max: 850, color: 'text-green-600', label: 'Excellent' },
  good: { min: 650, max: 749, color: 'text-blue-600', label: 'Good' },
  fair: { min: 550, max: 649, color: 'text-yellow-600', label: 'Fair' },
  poor: { min: 300, max: 549, color: 'text-red-600', label: 'Poor' }
};

export default function CreditApplicationDashboard() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedApplication, setSelectedApplication] = useState(null);
  
  const [stats, setStats] = useState({
    total_applications: 0,
    pending_applications: 0,
    approved_applications: 0,
    rejected_applications: 0,
    total_disbursed: 0,
    average_credit_score: 0,
    approval_rate: 0,
    default_rate: 0
  });

  const [applications, setApplications] = useState([]);
  const [creditScores, setCreditScores] = useState({});
  const [networkAnalysis, setNetworkAnalysis] = useState({});

  useEffect(() => {
    fetchCreditData();
    const interval = setInterval(fetchCreditData, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchCreditData = async () => {
    try {
      setLoading(true);
      
      const [statsRes, applicationsRes] = await Promise.all([
        api.credit.getStats(),
        api.credit.getApplications({ limit: 100 })
      ]);

      setStats(statsRes);
      setApplications(applicationsRes.applications || []);
    } catch (error) {
      console.error('Error fetching credit data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCreditScore = async (agentId) => {
    try {
      const scoreRes = await api.credit.calculateCreditScore(agentId);
      setCreditScores(prev => ({ ...prev, [agentId]: scoreRes }));
      return scoreRes;
    } catch (error) {
      console.error('Error fetching credit score:', error);
      return null;
    }
  };

  const fetchNetworkAnalysis = async (agentId) => {
    try {
      const networkRes = await api.credit.analyzeNetwork(agentId);
      setNetworkAnalysis(prev => ({ ...prev, [agentId]: networkRes }));
      return networkRes;
    } catch (error) {
      console.error('Error fetching network analysis:', error);
      return null;
    }
  };

  const handleViewApplication = async (application) => {
    setSelectedApplication(application);
    
    // Fetch credit score and network analysis if not already loaded
    if (!creditScores[application.agent_id]) {
      await fetchCreditScore(application.agent_id);
    }
    if (!networkAnalysis[application.agent_id]) {
      await fetchNetworkAnalysis(application.agent_id);
    }
  };

  const handleApproveApplication = async (applicationId) => {
    try {
      await api.credit.approveApplication(applicationId, {
        approved_by: 'admin',
        notes: 'Approved based on credit score and network analysis'
      });
      await fetchCreditData();
      setSelectedApplication(null);
    } catch (error) {
      console.error('Error approving application:', error);
    }
  };

  const handleRejectApplication = async (applicationId, reason) => {
    try {
      await api.credit.rejectApplication(applicationId, {
        rejected_by: 'admin',
        reason: reason || 'Does not meet credit requirements'
      });
      await fetchCreditData();
      setSelectedApplication(null);
    } catch (error) {
      console.error('Error rejecting application:', error);
    }
  };

  const handleDisburseCredit = async (applicationId) => {
    try {
      // First create TigerBeetle accounts and record transaction
      await api.tigerbeetle.createCreditDisbursement({
        application_id: applicationId,
        agent_id: selectedApplication.agent_id,
        amount: selectedApplication.amount
      });
      
      // Then update application status
      await api.credit.disburseCredit(applicationId);
      await fetchCreditData();
      setSelectedApplication(null);
    } catch (error) {
      console.error('Error disbursing credit:', error);
    }
  };

  const getCreditScoreCategory = (score) => {
    for (const [category, range] of Object.entries(CREDIT_SCORE_RANGES)) {
      if (score >= range.min && score <= range.max) {
        return { category, ...range };
      }
    }
    return CREDIT_SCORE_RANGES.poor;
  };

  const filteredApplications = applications.filter(app => {
    const matchesSearch = searchQuery === '' ||
      app.agent_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.business_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || app.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  if (loading && applications.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Activity className="h-12 w-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-gray-600">Loading credit applications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <DollarSign className="h-8 w-8 text-purple-600" />
            Credit Management
          </h1>
          <p className="text-gray-600 mt-1">ML-powered credit scoring with GNN network analysis</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchCreditData}>
            <Activity className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Applications</p>
                <p className="text-3xl font-bold">{stats.total_applications}</p>
              </div>
              <FileText className="h-10 w-10 text-purple-600" />
            </div>
            <div className="mt-4 flex gap-2 text-xs">
              <span className="text-yellow-600">Pending: {stats.pending_applications}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Approval Rate</p>
                <p className="text-3xl font-bold text-green-600">{stats.approval_rate}%</p>
              </div>
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              Approved: {stats.approved_applications}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Disbursed</p>
                <p className="text-3xl font-bold text-blue-600">${(stats.total_disbursed / 1000).toFixed(1)}K</p>
              </div>
              <DollarSign className="h-10 w-10 text-blue-600" />
            </div>
            <div className="mt-4 text-xs text-blue-600">
              ↑ 12% from last month
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Credit Score</p>
                <p className="text-3xl font-bold">{stats.average_credit_score}</p>
              </div>
              <TrendingUp className="h-10 w-10 text-orange-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              Default Rate: {stats.default_rate}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by agent ID or business name..."
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
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="disbursed">Disbursed</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Applications List */}
      <Card>
        <CardHeader>
          <CardTitle>Credit Applications</CardTitle>
          <CardDescription>Review and manage credit applications</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredApplications.map((application) => {
              const StatusIcon = STATUS_CONFIG[application.status]?.icon || Clock;
              const statusConfig = STATUS_CONFIG[application.status] || STATUS_CONFIG.pending;
              
              return (
                <div key={application.id} className="p-4 border rounded-lg hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
                        <span className="font-medium">{application.business_name}</span>
                        <Badge className={statusConfig.bg}>{statusConfig.label}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-sm text-gray-600 mb-2">
                        <div>Agent ID: {application.agent_id}</div>
                        <div>Amount: ${application.amount.toLocaleString()}</div>
                        <div>Term: {application.term_months} months</div>
                        <div>Purpose: {application.purpose}</div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Applied: {new Date(application.created_at).toLocaleDateString()}</span>
                        {application.interest_rate && (
                          <span>Interest Rate: {application.interest_rate}%</span>
                        )}
                        {application.monthly_payment && (
                          <span>Monthly Payment: ${application.monthly_payment}</span>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleViewApplication(application)}>
                      <Eye className="h-4 w-4 mr-1" />
                      Review
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Application Detail Modal */}
      {selectedApplication && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b sticky top-0 bg-white">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Credit Application Review</h2>
                <Button variant="ghost" onClick={() => setSelectedApplication(null)}>✕</Button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Application Details */}
              <Card>
                <CardHeader>
                  <CardTitle>Application Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Business Name</p>
                      <p className="font-medium">{selectedApplication.business_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Agent ID</p>
                      <p className="font-medium">{selectedApplication.agent_id}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Requested Amount</p>
                      <p className="font-medium text-lg">${selectedApplication.amount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Term</p>
                      <p className="font-medium">{selectedApplication.term_months} months</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Purpose</p>
                      <p className="font-medium">{selectedApplication.purpose}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Application Date</p>
                      <p className="font-medium">{new Date(selectedApplication.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ML Credit Score */}
              {creditScores[selectedApplication.agent_id] && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      ML Credit Score Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600">Credit Score</p>
                          <p className={`text-4xl font-bold ${getCreditScoreCategory(creditScores[selectedApplication.agent_id].credit_score).color}`}>
                            {creditScores[selectedApplication.agent_id].credit_score}
                          </p>
                          <p className="text-sm text-gray-600">
                            {getCreditScoreCategory(creditScores[selectedApplication.agent_id].credit_score).label}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Default Probability</p>
                          <p className="text-2xl font-bold text-red-600">
                            {(creditScores[selectedApplication.agent_id].default_probability * 100).toFixed(2)}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Recommended Rate</p>
                          <p className="text-2xl font-bold text-blue-600">
                            {creditScores[selectedApplication.agent_id].recommended_interest_rate}%
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium mb-2">Score Factors</p>
                        <div className="space-y-2">
                          {Object.entries(creditScores[selectedApplication.agent_id].factors || {}).map(([factor, value]) => (
                            <div key={factor} className="flex items-center justify-between">
                              <span className="text-sm capitalize">{factor.replace(/_/g, ' ')}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-32 bg-gray-200 rounded-full h-2">
                                  <div 
                                    className="bg-purple-600 h-2 rounded-full" 
                                    style={{ width: `${(value / 100) * 100}%` }}
                                  />
                                </div>
                                <span className="text-sm font-medium w-12 text-right">{value}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">Confidence:</span>
                        <span>{creditScores[selectedApplication.agent_id].confidence}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* GNN Network Analysis */}
              {networkAnalysis[selectedApplication.agent_id] && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Network className="h-5 w-5" />
                      GNN Network Risk Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm text-gray-600">Network Risk Score</p>
                          <p className="text-2xl font-bold">{networkAnalysis[selectedApplication.agent_id].network_risk_score}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Connected Agents</p>
                          <p className="text-2xl font-bold">{networkAnalysis[selectedApplication.agent_id].connected_agents}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Defaulted Connections</p>
                          <p className="text-2xl font-bold text-red-600">{networkAnalysis[selectedApplication.agent_id].defaulted_connections}</p>
                        </div>
                      </div>

                      {networkAnalysis[selectedApplication.agent_id].risk_factors && (
                        <div>
                          <p className="text-sm font-medium mb-2">Network Risk Factors</p>
                          <div className="space-y-1">
                            {networkAnalysis[selectedApplication.agent_id].risk_factors.map((factor, index) => (
                              <div key={index} className="flex items-center gap-2 text-sm">
                                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                <span>{factor}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Action Buttons */}
              {selectedApplication.status === 'pending' && (
                <div className="flex gap-4 justify-end">
                  <Button variant="outline" onClick={() => handleRejectApplication(selectedApplication.id)}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject Application
                  </Button>
                  <Button onClick={() => handleApproveApplication(selectedApplication.id)}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve Application
                  </Button>
                </div>
              )}

              {selectedApplication.status === 'approved' && (
                <div className="flex gap-4 justify-end">
                  <Button onClick={() => handleDisburseCredit(selectedApplication.id)}>
                    <DollarSign className="h-4 w-4 mr-2" />
                    Disburse Credit
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

