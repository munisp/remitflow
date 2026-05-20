import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';
import {
  User, Users, CreditCard, TrendingUp, Shield, Bell, Settings,
  DollarSign, Activity, ArrowUpRight, ArrowDownRight, Eye, EyeOff,
  Search, Filter, Download, Plus, Edit, Trash2, CheckCircle,
  AlertTriangle, XCircle, Clock, MapPin, Phone, Mail, Building,
  Smartphone, Laptop, Globe, Lock, Unlock, RefreshCw, Send,
  Receipt, FileText, PieChart as PieChartIcon, BarChart3,
  Calendar, MessageSquare, HelpCircle, LogOut, Menu, X,
  UserPlus, UserCheck, UserX, Briefcase, Target, Award,
  TrendingDown, AlertCircle, Star, Crown, Zap
} from 'lucide-react';
import './App.css';

// Enhanced Remittance Platform with Complete Agent Management
const AgentBankingPlatform = () => {
  // State management
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [agents, setAgents] = useState([]);
  const [commissionRules, setCommissionRules] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);

  // Mock data initialization
  useEffect(() => {
    initializeMockData();
  }, []);

  const initializeMockData = () => {
    // Enhanced mock agents with complete hierarchy
    const mockAgents = [
      {
        id: 'AGT001',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@bank.com',
        phone: '+1234567890',
        tier: 'super_agent',
        status: 'active',
        territory: 'North Region',
        parentAgentId: null,
        subAgents: ['AGT002', 'AGT003', 'AGT005'],
        commissionBalance: 25420.50,
        totalTransactions: 2150,
        monthlyVolume: 285000.00,
        joinDate: '2023-01-15',
        lastActive: '2024-10-07T10:30:00Z',
        performanceRating: 4.9,
        kycStatus: 'verified',
        documents: ['id_card', 'bank_statement', 'tax_certificate', 'business_license'],
        address: '123 Main St, Lagos, Nigeria',
        bankAccount: '1234567890',
        emergencyContact: '+1234567899',
        commissionRate: 2.5,
        hierarchyLevel: 1,
        maxSubAgents: 10,
        currentSubAgents: 3,
        totalEarnings: 125000.00,
        thisMonthEarnings: 8500.00,
        lastMonthEarnings: 7200.00,
        averageTransactionValue: 1325.58,
        customerSatisfactionScore: 4.8,
        complianceScore: 98,
        riskScore: 'low'
      },
      {
        id: 'AGT002',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@bank.com',
        phone: '+1234567891',
        tier: 'senior_agent',
        status: 'active',
        territory: 'North Region',
        parentAgentId: 'AGT001',
        subAgents: ['AGT004', 'AGT006'],
        commissionBalance: 18750.25,
        totalTransactions: 1650,
        monthlyVolume: 195000.00,
        joinDate: '2023-03-20',
        lastActive: '2024-10-07T09:15:00Z',
        performanceRating: 4.7,
        kycStatus: 'verified',
        documents: ['id_card', 'bank_statement', 'tax_certificate'],
        address: '456 Oak Ave, Lagos, Nigeria',
        bankAccount: '2345678901',
        emergencyContact: '+1234567898',
        commissionRate: 2.0,
        hierarchyLevel: 2,
        maxSubAgents: 5,
        currentSubAgents: 2,
        totalEarnings: 89000.00,
        thisMonthEarnings: 6200.00,
        lastMonthEarnings: 5800.00,
        averageTransactionValue: 1181.82,
        customerSatisfactionScore: 4.6,
        complianceScore: 95,
        riskScore: 'low'
      },
      {
        id: 'AGT003',
        firstName: 'Mike',
        lastName: 'Johnson',
        email: 'mike.johnson@bank.com',
        phone: '+1234567892',
        tier: 'agent',
        status: 'active',
        territory: 'North Region',
        parentAgentId: 'AGT001',
        subAgents: ['AGT007'],
        commissionBalance: 12230.75,
        totalTransactions: 1120,
        monthlyVolume: 142000.00,
        joinDate: '2023-06-10',
        lastActive: '2024-10-07T08:45:00Z',
        performanceRating: 4.5,
        kycStatus: 'verified',
        documents: ['id_card', 'bank_statement'],
        address: '789 Pine St, Lagos, Nigeria',
        bankAccount: '3456789012',
        emergencyContact: '+1234567897',
        commissionRate: 1.8,
        hierarchyLevel: 2,
        maxSubAgents: 3,
        currentSubAgents: 1,
        totalEarnings: 65000.00,
        thisMonthEarnings: 4800.00,
        lastMonthEarnings: 4200.00,
        averageTransactionValue: 1267.86,
        customerSatisfactionScore: 4.4,
        complianceScore: 92,
        riskScore: 'low'
      },
      {
        id: 'AGT004',
        firstName: 'Sarah',
        lastName: 'Wilson',
        email: 'sarah.wilson@bank.com',
        phone: '+1234567893',
        tier: 'sub_agent',
        status: 'active',
        territory: 'North Region',
        parentAgentId: 'AGT002',
        subAgents: [],
        commissionBalance: 8450.00,
        totalTransactions: 820,
        monthlyVolume: 98000.00,
        joinDate: '2023-08-05',
        lastActive: '2024-10-07T11:20:00Z',
        performanceRating: 4.3,
        kycStatus: 'verified',
        documents: ['id_card', 'bank_statement'],
        address: '321 Elm St, Lagos, Nigeria',
        bankAccount: '4567890123',
        emergencyContact: '+1234567896',
        commissionRate: 1.5,
        hierarchyLevel: 3,
        maxSubAgents: 0,
        currentSubAgents: 0,
        totalEarnings: 42000.00,
        thisMonthEarnings: 3200.00,
        lastMonthEarnings: 2800.00,
        averageTransactionValue: 1195.12,
        customerSatisfactionScore: 4.2,
        complianceScore: 89,
        riskScore: 'low'
      },
      {
        id: 'AGT005',
        firstName: 'David',
        lastName: 'Brown',
        email: 'david.brown@bank.com',
        phone: '+1234567894',
        tier: 'agent',
        status: 'pending',
        territory: 'North Region',
        parentAgentId: 'AGT001',
        subAgents: [],
        commissionBalance: 0.00,
        totalTransactions: 0,
        monthlyVolume: 0.00,
        joinDate: '2024-10-01',
        lastActive: '2024-10-07T07:30:00Z',
        performanceRating: 0,
        kycStatus: 'pending',
        documents: ['id_card'],
        address: '654 Maple Ave, Lagos, Nigeria',
        bankAccount: '5678901234',
        emergencyContact: '+1234567895',
        commissionRate: 1.8,
        hierarchyLevel: 2,
        maxSubAgents: 3,
        currentSubAgents: 0,
        totalEarnings: 0.00,
        thisMonthEarnings: 0.00,
        lastMonthEarnings: 0.00,
        averageTransactionValue: 0,
        customerSatisfactionScore: 0,
        complianceScore: 0,
        riskScore: 'pending'
      }
    ];

    // Enhanced commission rules
    const mockCommissionRules = [
      {
        id: 'CR001',
        ruleName: 'Super Agent Transaction Commission',
        agentTier: 'super_agent',
        transactionType: 'all',
        commissionType: 'percentage',
        percentageRate: 0.025,
        fixedAmount: null,
        minAmount: 100,
        maxAmount: null,
        hierarchyCommissionEnabled: true,
        hierarchyCommissionRate: 0.005,
        isActive: true,
        priority: 100,
        description: 'Base commission for super agents on all transactions',
        effectiveDate: '2024-01-01',
        expiryDate: null,
        conditions: ['minimum_volume_50000', 'kyc_verified'],
        bonusMultiplier: 1.2
      },
      {
        id: 'CR002',
        ruleName: 'Agent Deposit Commission',
        agentTier: 'agent',
        transactionType: 'deposit',
        commissionType: 'percentage',
        percentageRate: 0.018,
        fixedAmount: null,
        minAmount: 50,
        maxAmount: 10000,
        hierarchyCommissionEnabled: true,
        hierarchyCommissionRate: 0.003,
        isActive: true,
        priority: 90,
        description: 'Commission for regular agents on deposit transactions',
        effectiveDate: '2024-01-01',
        expiryDate: null,
        conditions: ['kyc_verified'],
        bonusMultiplier: 1.0
      },
      {
        id: 'CR003',
        ruleName: 'High Volume Bonus',
        agentTier: 'all',
        transactionType: 'all',
        commissionType: 'percentage',
        percentageRate: 0.005,
        fixedAmount: null,
        minAmount: 100000,
        maxAmount: null,
        hierarchyCommissionEnabled: false,
        hierarchyCommissionRate: null,
        isActive: true,
        priority: 110,
        description: 'Bonus commission for high volume agents',
        effectiveDate: '2024-01-01',
        expiryDate: null,
        conditions: ['monthly_volume_100000', 'performance_rating_4_5'],
        bonusMultiplier: 1.5
      }
    ];

    // Enhanced payouts
    const mockPayouts = [
      {
        id: 'PO001',
        agentId: 'AGT001',
        agentName: 'John Doe',
        periodStart: '2024-09-01',
        periodEnd: '2024-09-30',
        grossCommission: 8500.00,
        taxDeduction: 850.00,
        serviceCharges: 85.00,
        netAmount: 7565.00,
        payoutMethod: 'bank_transfer',
        status: 'completed',
        processedAt: '2024-10-01T10:00:00Z',
        processedBy: 'SYSTEM',
        bankAccount: '1234567890',
        transactionReference: 'TXN001234567',
        notes: 'Monthly commission payout - September 2024'
      },
      {
        id: 'PO002',
        agentId: 'AGT002',
        agentName: 'Jane Smith',
        periodStart: '2024-09-01',
        periodEnd: '2024-09-30',
        grossCommission: 6200.00,
        taxDeduction: 620.00,
        serviceCharges: 62.00,
        netAmount: 5518.00,
        payoutMethod: 'mobile_money',
        status: 'pending',
        processedAt: null,
        processedBy: null,
        bankAccount: '2345678901',
        transactionReference: null,
        notes: 'Monthly commission payout - September 2024'
      },
      {
        id: 'PO003',
        agentId: 'AGT003',
        agentName: 'Mike Johnson',
        periodStart: '2024-09-01',
        periodEnd: '2024-09-30',
        grossCommission: 4800.00,
        taxDeduction: 480.00,
        serviceCharges: 48.00,
        netAmount: 4272.00,
        payoutMethod: 'bank_transfer',
        status: 'processing',
        processedAt: null,
        processedBy: 'ADM001',
        bankAccount: '3456789012',
        transactionReference: 'TXN001234568',
        notes: 'Monthly commission payout - September 2024'
      }
    ];

    // Enhanced disputes
    const mockDisputes = [
      {
        id: 'DS001',
        agentId: 'AGT003',
        agentName: 'Mike Johnson',
        disputeType: 'calculation_error',
        subject: 'Incorrect commission calculation for September',
        description: 'My commission for September seems to be calculated incorrectly. Expected 5200 based on my transaction volume but received 4800.',
        status: 'open',
        priority: 'high',
        disputedAmount: 400.00,
        createdAt: '2024-10-05T14:30:00Z',
        updatedAt: '2024-10-05T14:30:00Z',
        assignedTo: 'SUPPORT_TEAM_1',
        category: 'commission',
        attachments: ['september_statement.pdf', 'transaction_log.xlsx'],
        comments: [
          {
            id: 1,
            author: 'Mike Johnson',
            message: 'I have attached my transaction log for verification.',
            timestamp: '2024-10-05T14:35:00Z'
          }
        ],
        expectedResolutionDate: '2024-10-12T00:00:00Z'
      },
      {
        id: 'DS002',
        agentId: 'AGT004',
        agentName: 'Sarah Wilson',
        disputeType: 'missing_commission',
        subject: 'Missing commission for large transaction',
        description: 'Commission for transaction TX12345 (amount: $15000) is missing from my September statement. This was a verified deposit transaction.',
        status: 'under_review',
        priority: 'high',
        disputedAmount: 225.00,
        createdAt: '2024-10-03T09:15:00Z',
        updatedAt: '2024-10-06T16:20:00Z',
        assignedTo: 'SUPPORT_TEAM_2',
        category: 'missing_transaction',
        attachments: ['transaction_receipt.pdf'],
        comments: [
          {
            id: 1,
            author: 'Sarah Wilson',
            message: 'Transaction was completed successfully on September 28th.',
            timestamp: '2024-10-03T09:20:00Z'
          },
          {
            id: 2,
            author: 'Support Team',
            message: 'We are investigating this transaction. Initial review shows the transaction was processed.',
            timestamp: '2024-10-06T16:20:00Z'
          }
        ],
        expectedResolutionDate: '2024-10-10T00:00:00Z'
      },
      {
        id: 'DS003',
        agentId: 'AGT002',
        agentName: 'Jane Smith',
        disputeType: 'hierarchy_commission',
        subject: 'Hierarchy commission not received',
        description: 'I should have received hierarchy commission from my sub-agents transactions but it is not reflected in my September payout.',
        status: 'resolved',
        priority: 'medium',
        disputedAmount: 150.00,
        createdAt: '2024-09-28T11:45:00Z',
        updatedAt: '2024-10-02T14:30:00Z',
        assignedTo: 'SUPPORT_TEAM_1',
        category: 'hierarchy',
        attachments: ['hierarchy_report.pdf'],
        comments: [
          {
            id: 1,
            author: 'Jane Smith',
            message: 'My sub-agents completed transactions worth $50000 in September.',
            timestamp: '2024-09-28T11:50:00Z'
          },
          {
            id: 2,
            author: 'Support Team',
            message: 'Issue resolved. Hierarchy commission has been added to your October payout.',
            timestamp: '2024-10-02T14:30:00Z'
          }
        ],
        expectedResolutionDate: '2024-10-05T00:00:00Z',
        resolvedAt: '2024-10-02T14:30:00Z',
        resolution: 'Commission added to next payout cycle'
      }
    ];

    setAgents(mockAgents);
    setCommissionRules(mockCommissionRules);
    setPayouts(mockPayouts);
    setDisputes(mockDisputes);
    
    // Set current user
    setCurrentUser({
      id: 'USR001',
      name: 'Admin User',
      role: 'admin',
      agentId: 'AGT001',
      permissions: ['view_all_agents', 'manage_agents', 'manage_commissions', 'process_payouts', 'resolve_disputes']
    });
  };

  // Login handler
  const handleLogin = (username, password) => {
    if (username === 'admin' && password === 'admin123') {
      setCurrentUser({
        id: 'USR001',
        name: 'Admin User',
        role: 'admin',
        agentId: 'AGT001',
        permissions: ['view_all_agents', 'manage_agents', 'manage_commissions', 'process_payouts', 'resolve_disputes']
      });
      return true;
    }
    return false;
  };

  // Modal handlers
  const openModal = (type, agent = null) => {
    setModalType(type);
    setSelectedAgent(agent);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalType('');
    setSelectedAgent(null);
  };

  // Agent hierarchy helpers
  const getAgentHierarchy = (agentId) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return [];
    
    const hierarchy = [agent];
    let currentAgent = agent;
    
    // Get parent hierarchy
    while (currentAgent.parentAgentId) {
      const parent = agents.find(a => a.id === currentAgent.parentAgentId);
      if (parent) {
        hierarchy.unshift(parent);
        currentAgent = parent;
      } else {
        break;
      }
    }
    
    return hierarchy;
  };

  const getSubAgents = (agentId) => {
    return agents.filter(agent => agent.parentAgentId === agentId);
  };

  const getAllSubAgents = (agentId) => {
    const directSubs = getSubAgents(agentId);
    let allSubs = [...directSubs];
    
    directSubs.forEach(sub => {
      allSubs = [...allSubs, ...getAllSubAgents(sub.id)];
    });
    
    return allSubs;
  };

  const getTierIcon = (tier) => {
    switch (tier) {
      case 'super_agent': return <Crown className="w-4 h-4" />;
      case 'senior_agent': return <Star className="w-4 h-4" />;
      case 'agent': return <User className="w-4 h-4" />;
      case 'sub_agent': return <UserCheck className="w-4 h-4" />;
      default: return <User className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'inactive': return 'text-gray-600 bg-gray-100';
      case 'suspended': return 'text-red-600 bg-red-100';
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getRiskColor = (risk) => {
    switch (risk) {
      case 'low': return 'text-green-600 bg-green-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'high': return 'text-red-600 bg-red-100';
      case 'pending': return 'text-gray-600 bg-gray-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  // Login Component
  const LoginForm = () => {
    const [credentials, setCredentials] = useState({ username: '', password: '' });
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
      e.preventDefault();
      setIsLoading(true);
      setError('');
      
      // Simulate API call
      setTimeout(() => {
        if (handleLogin(credentials.username, credentials.password)) {
          setError('');
        } else {
          setError('Invalid credentials. Use admin/admin123');
        }
        setIsLoading(false);
      }, 1000);
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Card className="shadow-2xl border-0">
            <CardHeader className="text-center pb-8">
              <div className="mx-auto w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full flex items-center justify-center mb-4">
                <Building className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Remittance Platform
              </CardTitle>
              <CardDescription>
                Complete Agent Management System
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Enter your username"
                    value={credentials.username}
                    onChange={(e) => setCredentials({...credentials, username: e.target.value})}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={credentials.password}
                      onChange={(e) => setCredentials({...credentials, password: e.target.value})}
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                {error && (
                  <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md border border-red-200">
                    {error}
                  </div>
                )}
                <Button 
                  type="submit" 
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4 mr-2" />
                  )}
                  {isLoading ? 'Signing In...' : 'Sign In'}
                </Button>
              </form>
              <div className="text-center text-sm text-gray-600 bg-gray-50 p-4 rounded-md">
                <p><strong>Demo Credentials:</strong></p>
                <p>Username: <code className="bg-gray-200 px-1 rounded">admin</code></p>
                <p>Password: <code className="bg-gray-200 px-1 rounded">admin123</code></p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  };

  // Enhanced Dashboard Component
  const Dashboard = () => {
    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === 'active').length;
    const pendingAgents = agents.filter(a => a.status === 'pending').length;
    const totalCommissions = agents.reduce((sum, agent) => sum + agent.commissionBalance, 0);
    const totalEarnings = agents.reduce((sum, agent) => sum + agent.totalEarnings, 0);
    const thisMonthEarnings = agents.reduce((sum, agent) => sum + agent.thisMonthEarnings, 0);
    const pendingPayouts = payouts.filter(p => p.status === 'pending').length;
    const openDisputes = disputes.filter(d => d.status === 'open').length;
    const averagePerformance = agents.reduce((sum, agent) => sum + agent.performanceRating, 0) / agents.length;

    const stats = [
      { 
        title: 'Total Agents', 
        value: totalAgents.toString(), 
        change: '+12%', 
        icon: Users, 
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        description: `${activeAgents} active, ${pendingAgents} pending`
      },
      { 
        title: 'Commission Balance', 
        value: `$${totalCommissions.toLocaleString()}`, 
        change: '+18%', 
        icon: DollarSign, 
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        description: 'Available for payout'
      },
      { 
        title: 'This Month Earnings', 
        value: `$${thisMonthEarnings.toLocaleString()}`, 
        change: '+22%', 
        icon: TrendingUp, 
        color: 'text-purple-600',
        bgColor: 'bg-purple-100',
        description: 'October 2024'
      },
      { 
        title: 'Pending Payouts', 
        value: pendingPayouts.toString(), 
        change: '-8%', 
        icon: Clock, 
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
        description: 'Awaiting processing'
      },
      { 
        title: 'Open Disputes', 
        value: openDisputes.toString(), 
        change: '-15%', 
        icon: AlertTriangle, 
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        description: 'Require attention'
      },
      { 
        title: 'Avg Performance', 
        value: averagePerformance.toFixed(1), 
        change: '+5%', 
        icon: Award, 
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-100',
        description: 'Out of 5.0'
      }
    ];

    return (
      <div className="space-y-6">
        {/* Welcome Section */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Welcome back, {currentUser?.name}!</h1>
              <p className="text-blue-100 mt-1">Here's your remittance overview for today</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-blue-100">Today's Date</p>
              <p className="text-lg font-semibold">{new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="hover:shadow-lg transition-all duration-200 border-0 shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                      <div className="flex items-center mt-2">
                        <span className={`text-sm ${stat.color} flex items-center`}>
                          <ArrowUpRight className="w-4 h-4 mr-1" />
                          {stat.change}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">{stat.description}</span>
                      </div>
                    </div>
                    <div className={`p-3 rounded-full ${stat.bgColor}`}>
                      <stat.icon className={`w-6 h-6 ${stat.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Charts and Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent Performance Chart */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center">
                <BarChart3 className="w-5 h-5 mr-2" />
                Top Performing Agents
              </CardTitle>
              <CardDescription>Performance ratings and commission earnings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {agents
                  .filter(agent => agent.status === 'active')
                  .sort((a, b) => b.performanceRating - a.performanceRating)
                  .slice(0, 5)
                  .map((agent, index) => (
                    <div key={agent.id} className="flex items-center space-x-4">
                      <div className="flex items-center space-x-3 flex-1">
                        <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                          {index + 1}
                        </div>
                        <Avatar className="w-10 h-10">
                          <AvatarFallback className="bg-gray-100">
                            {agent.firstName[0]}{agent.lastName[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {agent.firstName} {agent.lastName}
                          </p>
                          <div className="flex items-center space-x-2">
                            {getTierIcon(agent.tier)}
                            <span className="text-xs text-gray-500 capitalize">
                              {agent.tier.replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          {agent.performanceRating}/5.0
                        </p>
                        <p className="text-xs text-gray-500">
                          ${agent.thisMonthEarnings.toLocaleString()}
                        </p>
                      </div>
                      <div className="w-20">
                        <Progress 
                          value={(agent.performanceRating / 5) * 100} 
                          className="h-2"
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Agent Hierarchy Overview */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="w-5 h-5 mr-2" />
                Agent Hierarchy Overview
              </CardTitle>
              <CardDescription>Distribution across agent tiers</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {['super_agent', 'senior_agent', 'agent', 'sub_agent'].map(tier => {
                  const tierAgents = agents.filter(agent => agent.tier === tier);
                  const tierCount = tierAgents.length;
                  const tierEarnings = tierAgents.reduce((sum, agent) => sum + agent.thisMonthEarnings, 0);
                  const percentage = totalAgents > 0 ? (tierCount / totalAgents) * 100 : 0;
                  
                  return (
                    <div key={tier} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {getTierIcon(tier)}
                          <span className="text-sm font-medium capitalize">
                            {tier.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold">{tierCount} agents</span>
                          <p className="text-xs text-gray-500">
                            ${tierEarnings.toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Progress value={percentage} className="h-2" />
                      <p className="text-xs text-gray-500">
                        {percentage.toFixed(1)}% of total agents
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Payouts */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Receipt className="w-5 h-5 mr-2" />
                Recent Payouts
              </CardTitle>
              <CardDescription>Latest commission payouts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {payouts.slice(0, 4).map(payout => (
                  <div key={payout.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-full ${
                        payout.status === 'completed' ? 'bg-green-100 text-green-600' :
                        payout.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                        'bg-blue-100 text-blue-600'
                      }`}>
                        {payout.status === 'completed' ? <CheckCircle className="w-4 h-4" /> :
                         payout.status === 'pending' ? <Clock className="w-4 h-4" /> :
                         <RefreshCw className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{payout.agentName}</p>
                        <p className="text-xs text-gray-500">{payout.id}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">${payout.netAmount.toLocaleString()}</p>
                      <Badge variant={
                        payout.status === 'completed' ? 'default' :
                        payout.status === 'pending' ? 'secondary' : 'outline'
                      } className="text-xs">
                        {payout.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Disputes */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlertTriangle className="w-5 h-5 mr-2" />
                Recent Disputes
              </CardTitle>
              <CardDescription>Latest dispute reports</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {disputes.slice(0, 4).map(dispute => (
                  <div key={dispute.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-full ${
                        dispute.status === 'resolved' ? 'bg-green-100 text-green-600' :
                        dispute.status === 'under_review' ? 'bg-blue-100 text-blue-600' :
                        'bg-red-100 text-red-600'
                      }`}>
                        {dispute.status === 'resolved' ? <CheckCircle className="w-4 h-4" /> :
                         dispute.status === 'under_review' ? <Eye className="w-4 h-4" /> :
                         <AlertCircle className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{dispute.subject}</p>
                        <p className="text-xs text-gray-500">{dispute.agentName}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">${dispute.disputedAmount.toLocaleString()}</p>
                      <Badge variant={
                        dispute.priority === 'high' ? 'destructive' :
                        dispute.priority === 'medium' ? 'secondary' : 'outline'
                      } className="text-xs">
                        {dispute.priority}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Zap className="w-5 h-5 mr-2" />
              Quick Actions
            </CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Button 
                variant="outline" 
                className="h-20 flex flex-col space-y-2"
                onClick={() => openModal('create-agent')}
              >
                <UserPlus className="w-6 h-6" />
                <span className="text-sm">Add Agent</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-20 flex flex-col space-y-2"
                onClick={() => setActiveTab('payouts')}
              >
                <DollarSign className="w-6 h-6" />
                <span className="text-sm">Process Payout</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-20 flex flex-col space-y-2"
                onClick={() => setActiveTab('disputes')}
              >
                <MessageSquare className="w-6 h-6" />
                <span className="text-sm">Review Disputes</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-20 flex flex-col space-y-2"
                onClick={() => openModal('create-rule')}
              >
                <Settings className="w-6 h-6" />
                <span className="text-sm">Create Rule</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // Enhanced Agent Management Component
  const AgentManagement = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterTier, setFilterTier] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [sortBy, setSortBy] = useState('name');
    const [viewMode, setViewMode] = useState('grid'); // grid or list

    const filteredAgents = agents.filter(agent => {
      const matchesSearch = agent.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           agent.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           agent.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           agent.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTier = filterTier === 'all' || agent.tier === filterTier;
      const matchesStatus = filterStatus === 'all' || agent.status === filterStatus;
      
      return matchesSearch && matchesTier && matchesStatus;
    }).sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
        case 'performance':
          return b.performanceRating - a.performanceRating;
        case 'earnings':
          return b.thisMonthEarnings - a.thisMonthEarnings;
        case 'joinDate':
          return new Date(b.joinDate) - new Date(a.joinDate);
        default:
          return 0;
      }
    });

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Agent Management</h2>
            <p className="text-gray-600">Manage your agent network and hierarchy</p>
          </div>
          <div className="flex items-center space-x-3">
            <Button variant="outline" onClick={() => openModal('bulk-actions')}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button onClick={() => openModal('create-agent')}>
              <Plus className="w-4 h-4 mr-2" />
              Add Agent
            </Button>
          </div>
        </div>

        {/* Filters and Search */}
        <Card className="border-0 shadow-md">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
              <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search agents..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                
                <select 
                  value={filterTier} 
                  onChange={(e) => setFilterTier(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="all">All Tiers</option>
                  <option value="super_agent">Super Agent</option>
                  <option value="senior_agent">Senior Agent</option>
                  <option value="agent">Agent</option>
                  <option value="sub_agent">Sub Agent</option>
                </select>
                
                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                  <option value="pending">Pending</option>
                </select>

                <select 
                  value={sortBy} 
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="name">Sort by Name</option>
                  <option value="performance">Sort by Performance</option>
                  <option value="earnings">Sort by Earnings</option>
                  <option value="joinDate">Sort by Join Date</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                >
                  <BarChart3 className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                >
                  <FileText className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agent Grid/List */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAgents.map(agent => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="group"
              >
                <Card className="border-0 shadow-md hover:shadow-lg transition-all duration-200 group-hover:scale-105">
                  <CardContent className="p-6">
                    {/* Agent Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <Avatar className="w-12 h-12">
                          <AvatarFallback className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white">
                            {agent.firstName[0]}{agent.lastName[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold text-gray-900">
                            {agent.firstName} {agent.lastName}
                          </h3>
                          <p className="text-sm text-gray-500">{agent.id}</p>
                          <div className="flex items-center space-x-2 mt-1">
                            {getTierIcon(agent.tier)}
                            <span className="text-xs text-gray-600 capitalize">
                              {agent.tier.replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end space-y-1">
                        <Badge className={getStatusColor(agent.status)}>
                          {agent.status}
                        </Badge>
                        <Badge className={getRiskColor(agent.riskScore)}>
                          {agent.riskScore} risk
                        </Badge>
                      </div>
                    </div>

                    {/* Performance Metrics */}
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Performance</span>
                        <div className="flex items-center space-x-2">
                          <Progress value={(agent.performanceRating / 5) * 100} className="w-16 h-2" />
                          <span className="text-sm font-medium">{agent.performanceRating}/5.0</span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-600">Commission</p>
                          <p className="font-semibold">${agent.commissionBalance.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">This Month</p>
                          <p className="font-semibold">${agent.thisMonthEarnings.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Transactions</p>
                          <p className="font-semibold">{agent.totalTransactions}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Sub Agents</p>
                          <p className="font-semibold">{agent.currentSubAgents}/{agent.maxSubAgents}</p>
                        </div>
                      </div>
                    </div>

                    {/* Hierarchy Info */}
                    {agent.parentAgentId && (
                      <div className="mb-4 p-2 bg-gray-50 rounded-md">
                        <p className="text-xs text-gray-600">Reports to:</p>
                        <p className="text-sm font-medium">
                          {agents.find(a => a.id === agent.parentAgentId)?.firstName} 
                          {' '}
                          {agents.find(a => a.id === agent.parentAgentId)?.lastName}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openModal('view-agent', agent)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openModal('agent-hierarchy', agent)}
                      >
                        <Users className="w-4 h-4 mr-1" />
                        Hierarchy
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openModal('edit-agent', agent)}
                      >
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        ) : (
          <Card className="border-0 shadow-md">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Agent
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tier & Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Performance
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Commission
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Hierarchy
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredAgents.map(agent => (
                      <tr key={agent.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <Avatar className="w-10 h-10">
                              <AvatarFallback className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white">
                                {agent.firstName[0]}{agent.lastName[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {agent.firstName} {agent.lastName}
                              </div>
                              <div className="text-sm text-gray-500">{agent.email}</div>
                              <div className="text-xs text-gray-400">{agent.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col space-y-1">
                            <div className="flex items-center space-x-2">
                              {getTierIcon(agent.tier)}
                              <span className="text-sm capitalize">
                                {agent.tier.replace('_', ' ')}
                              </span>
                            </div>
                            <Badge className={getStatusColor(agent.status)}>
                              {agent.status}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <Progress value={(agent.performanceRating / 5) * 100} className="w-16 h-2" />
                            <span className="text-sm font-medium">{agent.performanceRating}/5.0</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {agent.totalTransactions} transactions
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            ${agent.commissionBalance.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500">
                            This month: ${agent.thisMonthEarnings.toLocaleString()}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            Level {agent.hierarchyLevel}
                          </div>
                          <div className="text-xs text-gray-500">
                            {agent.currentSubAgents}/{agent.maxSubAgents} sub agents
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center space-x-2">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => openModal('view-agent', agent)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => openModal('edit-agent', agent)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        <div className="text-center text-sm text-gray-500">
          Showing {filteredAgents.length} of {agents.length} agents
        </div>
      </div>
    );
  };

  // Continue with other components... (Commission Rules, Payouts, Disputes, etc.)
  // Due to length constraints, I'll create the remaining components in the next part

  // Modal Component (Enhanced)
  const Modal = () => {
    if (!showModal) return null;

    const renderModalContent = () => {
      switch (modalType) {
        case 'view-agent':
          return (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Agent Details</h3>
                <Button variant="outline" size="sm" onClick={() => openModal('edit-agent', selectedAgent)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Agent
                </Button>
              </div>
              
              {selectedAgent && (
                <div className="space-y-6">
                  {/* Personal Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Personal Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Full Name</Label>
                          <p className="text-sm">{selectedAgent.firstName} {selectedAgent.lastName}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Agent ID</Label>
                          <p className="text-sm font-mono">{selectedAgent.id}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Email</Label>
                          <p className="text-sm">{selectedAgent.email}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Phone</Label>
                          <p className="text-sm">{selectedAgent.phone}</p>
                        </div>
                        <div className="col-span-2">
                          <Label className="text-sm font-medium text-gray-600">Address</Label>
                          <p className="text-sm">{selectedAgent.address}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Agent Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Agent Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Tier</Label>
                          <div className="flex items-center space-x-2 mt-1">
                            {getTierIcon(selectedAgent.tier)}
                            <span className="text-sm capitalize">{selectedAgent.tier.replace('_', ' ')}</span>
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Status</Label>
                          <Badge className={`${getStatusColor(selectedAgent.status)} mt-1`}>
                            {selectedAgent.status}
                          </Badge>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Territory</Label>
                          <p className="text-sm">{selectedAgent.territory}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Join Date</Label>
                          <p className="text-sm">{new Date(selectedAgent.joinDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Commission Rate</Label>
                          <p className="text-sm">{selectedAgent.commissionRate}%</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Risk Score</Label>
                          <Badge className={getRiskColor(selectedAgent.riskScore)}>
                            {selectedAgent.riskScore}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Performance Metrics */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Performance Metrics</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Performance Rating</Label>
                          <div className="flex items-center space-x-2 mt-1">
                            <Progress value={(selectedAgent.performanceRating / 5) * 100} className="flex-1 h-2" />
                            <span className="text-sm font-medium">{selectedAgent.performanceRating}/5.0</span>
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Customer Satisfaction</Label>
                          <div className="flex items-center space-x-2 mt-1">
                            <Progress value={(selectedAgent.customerSatisfactionScore / 5) * 100} className="flex-1 h-2" />
                            <span className="text-sm font-medium">{selectedAgent.customerSatisfactionScore}/5.0</span>
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Total Transactions</Label>
                          <p className="text-sm font-semibold">{selectedAgent.totalTransactions.toLocaleString()}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Monthly Volume</Label>
                          <p className="text-sm font-semibold">${selectedAgent.monthlyVolume.toLocaleString()}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Commission Balance</Label>
                          <p className="text-sm font-semibold text-green-600">${selectedAgent.commissionBalance.toLocaleString()}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">This Month Earnings</Label>
                          <p className="text-sm font-semibold text-blue-600">${selectedAgent.thisMonthEarnings.toLocaleString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Hierarchy Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Hierarchy Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Hierarchy Level</Label>
                          <p className="text-sm">Level {selectedAgent.hierarchyLevel}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Sub Agents</Label>
                          <p className="text-sm">{selectedAgent.currentSubAgents} / {selectedAgent.maxSubAgents}</p>
                        </div>
                      </div>
                      
                      {selectedAgent.parentAgentId && (
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Reports To</Label>
                          <div className="mt-2 p-3 bg-gray-50 rounded-md">
                            <p className="text-sm font-medium">
                              {agents.find(a => a.id === selectedAgent.parentAgentId)?.firstName} 
                              {' '}
                              {agents.find(a => a.id === selectedAgent.parentAgentId)?.lastName}
                            </p>
                            <p className="text-xs text-gray-500">
                              {agents.find(a => a.id === selectedAgent.parentAgentId)?.id}
                            </p>
                          </div>
                        </div>
                      )}

                      {selectedAgent.subAgents.length > 0 && (
                        <div>
                          <Label className="text-sm font-medium text-gray-600">Sub Agents</Label>
                          <div className="mt-2 space-y-2">
                            {getSubAgents(selectedAgent.id).map(subAgent => (
                              <div key={subAgent.id} className="p-3 bg-gray-50 rounded-md">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium">
                                      {subAgent.firstName} {subAgent.lastName}
                                    </p>
                                    <p className="text-xs text-gray-500">{subAgent.id}</p>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    {getTierIcon(subAgent.tier)}
                                    <span className="text-xs capitalize">{subAgent.tier.replace('_', ' ')}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          );

        case 'agent-hierarchy':
          return (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">
                Agent Hierarchy - {selectedAgent?.firstName} {selectedAgent?.lastName}
              </h3>
              
              {selectedAgent && (
                <div className="space-y-6">
                  {/* Hierarchy Tree */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Hierarchy Path</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {getAgentHierarchy(selectedAgent.id).map((agent, index) => (
                          <div key={agent.id} className={`flex items-center space-x-4 p-4 rounded-lg ${
                            agent.id === selectedAgent.id ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
                          }`}>
                            <div className="flex items-center space-x-3">
                              <Avatar className="w-10 h-10">
                                <AvatarFallback className={
                                  agent.id === selectedAgent.id 
                                    ? 'bg-blue-500 text-white' 
                                    : 'bg-gray-500 text-white'
                                }>
                                  {agent.firstName[0]}{agent.lastName[0]}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium">{agent.firstName} {agent.lastName}</p>
                                <p className="text-sm text-gray-500">{agent.id}</p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {getTierIcon(agent.tier)}
                              <span className="text-sm capitalize">{agent.tier.replace('_', ' ')}</span>
                            </div>
                            <div className="ml-auto text-right">
                              <p className="text-sm font-medium">${agent.commissionBalance.toLocaleString()}</p>
                              <p className="text-xs text-gray-500">Commission Balance</p>
                            </div>
                            {agent.id === selectedAgent.id && (
                              <Badge className="bg-blue-100 text-blue-800">Current</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Sub Agents */}
                  {selectedAgent.subAgents.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Sub Agents ({selectedAgent.subAgents.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {getSubAgents(selectedAgent.id).map(subAgent => (
                            <div key={subAgent.id} className="p-4 border rounded-lg">
                              <div className="flex items-center space-x-3 mb-3">
                                <Avatar className="w-10 h-10">
                                  <AvatarFallback className="bg-gray-500 text-white">
                                    {subAgent.firstName[0]}{subAgent.lastName[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium">{subAgent.firstName} {subAgent.lastName}</p>
                                  <p className="text-sm text-gray-500">{subAgent.id}</p>
                                </div>
                              </div>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Tier:</span>
                                  <div className="flex items-center space-x-1">
                                    {getTierIcon(subAgent.tier)}
                                    <span className="capitalize">{subAgent.tier.replace('_', ' ')}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Performance:</span>
                                  <span>{subAgent.performanceRating}/5.0</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Commission:</span>
                                  <span className="font-medium">${subAgent.commissionBalance.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Status:</span>
                                  <Badge className={getStatusColor(subAgent.status)}>
                                    {subAgent.status}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-3 pt-3 border-t">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="w-full"
                                  onClick={() => openModal('view-agent', subAgent)}
                                >
                                  View Details
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Hierarchy Statistics */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Hierarchy Statistics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-blue-600">
                            {getAllSubAgents(selectedAgent.id).length}
                          </p>
                          <p className="text-sm text-gray-600">Total Sub Agents</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-green-600">
                            ${getAllSubAgents(selectedAgent.id).reduce((sum, agent) => sum + agent.commissionBalance, 0).toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-600">Total Commission</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-purple-600">
                            {getAllSubAgents(selectedAgent.id).reduce((sum, agent) => sum + agent.totalTransactions, 0).toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-600">Total Transactions</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-orange-600">
                            {(getAllSubAgents(selectedAgent.id).reduce((sum, agent) => sum + agent.performanceRating, 0) / getAllSubAgents(selectedAgent.id).length || 0).toFixed(1)}
                          </p>
                          <p className="text-sm text-gray-600">Avg Performance</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          );

        default:
          return (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Settings className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Feature Coming Soon</h3>
              <p className="text-gray-600">This feature is currently under development and will be available soon.</p>
            </div>
          );
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
        >
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
            <Button variant="ghost" size="sm" onClick={closeModal}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {renderModalContent()}
          </div>
          <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50">
            <Button variant="outline" onClick={closeModal}>
              Close
            </Button>
            {modalType === 'view-agent' && selectedAgent && (
              <Button onClick={() => openModal('edit-agent', selectedAgent)}>
                <Edit className="w-4 h-4 mr-2" />
                Edit Agent
              </Button>
            )}
          </div>
        </motion.div>
      </div>
    );
  };

  // Navigation Component
  const Navigation = () => {
    const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: BarChart3, description: 'Overview & Analytics' },
      { id: 'agents', label: 'Agent Management', icon: Users, description: 'Manage Agents & Hierarchy' },
      { id: 'commission-rules', label: 'Commission Rules', icon: Settings, description: 'Configure Commission Rules' },
      { id: 'payouts', label: 'Payouts', icon: DollarSign, description: 'Process Commission Payouts' },
      { id: 'disputes', label: 'Disputes', icon: AlertTriangle, description: 'Resolve Agent Disputes' },
      { id: 'analytics', label: 'Analytics', icon: PieChartIcon, description: 'Advanced Analytics' },
      { id: 'settings', label: 'Settings', icon: Settings, description: 'System Configuration' }
    ];

    return (
      <motion.div
        initial={false}
        animate={{ width: sidebarOpen ? 280 : 80 }}
        className="bg-white shadow-lg border-r border-gray-200 flex flex-col"
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <motion.div
              animate={{ opacity: sidebarOpen ? 1 : 0 }}
              className="flex items-center space-x-3"
            >
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <Building className="w-6 h-6 text-white" />
              </div>
              {sidebarOpen && (
                <div>
                  <h1 className="text-lg font-bold text-gray-900">Remittance Platform</h1>
                  <p className="text-sm text-gray-500">Management Platform</p>
                </div>
              )}
            </motion.div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={activeTab === item.id ? 'default' : 'ghost'}
              className={`w-full justify-start ${!sidebarOpen && 'px-3'} ${
                activeTab === item.id 
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' 
                  : 'hover:bg-gray-100'
              }`}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon className="w-4 h-4" />
              {sidebarOpen && (
                <div className="ml-3 text-left">
                  <div className="text-sm font-medium">{item.label}</div>
                  {activeTab !== item.id && (
                    <div className="text-xs text-gray-500">{item.description}</div>
                  )}
                </div>
              )}
            </Button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center space-x-3">
            <Avatar>
              <AvatarFallback className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                {currentUser?.name?.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{currentUser?.name}</p>
                <p className="text-xs text-gray-500 truncate">{currentUser?.role}</p>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentUser(null)}
              className="text-gray-500 hover:text-red-600"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    );
  };

  // Main render
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'agents':
        return <AgentManagement />;
      case 'commission-rules':
        return (
          <div className="text-center py-16">
            <Settings className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Commission Rules Management</h2>
            <p className="text-gray-600">Configure and manage commission rules for different agent tiers.</p>
          </div>
        );
      case 'payouts':
        return (
          <div className="text-center py-16">
            <DollarSign className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Commission Payouts</h2>
            <p className="text-gray-600">Process and manage commission payouts for agents.</p>
          </div>
        );
      case 'disputes':
        return (
          <div className="text-center py-16">
            <AlertTriangle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Dispute Management</h2>
            <p className="text-gray-600">Review and resolve agent commission disputes.</p>
          </div>
        );
      default:
        return (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Settings className="w-8 h-8 text-gray-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">🚧 Feature Coming Soon</h2>
            <p className="text-gray-600">This section is currently under development.</p>
          </div>
        );
    }
  };

  if (!currentUser) {
    return <LoginForm />;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Navigation />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 capitalize">
                {activeTab.replace('-', ' ')}
              </h2>
              <p className="text-gray-600">
                {activeTab === 'dashboard' && 'Welcome back to your remittance dashboard'}
                {activeTab === 'agents' && 'Manage your agent network and hierarchy'}
                {activeTab === 'commission-rules' && 'Configure commission rules and rates'}
                {activeTab === 'payouts' && 'Process and track commission payouts'}
                {activeTab === 'disputes' && 'Review and resolve agent disputes'}
                {activeTab === 'analytics' && 'Advanced analytics and reporting'}
                {activeTab === 'settings' && 'System configuration and preferences'}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" size="sm">
                <Bell className="w-4 h-4 mr-2" />
                Notifications
                <Badge className="ml-2 bg-red-500 text-white">3</Badge>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentUser(null)}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      
      <AnimatePresence>
        {showModal && <Modal />}
      </AnimatePresence>
    </div>
  );
};

export default AgentBankingPlatform;
