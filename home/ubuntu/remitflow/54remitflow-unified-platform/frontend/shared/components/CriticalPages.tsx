'use client';

import React, { useState } from 'react';
import {
  Shield,
  CheckCircle,
  Clock,
  AlertCircle,
  Upload,
  Camera,
  FileText,
  Lock,
  Smartphone,
  Key,
  Bell,
  Mail,
  MessageSquare,
  Send,
  Paperclip,
  Search,
  Filter,
  X,
} from 'lucide-react';

// ==================== KYC VERIFICATION PAGE ====================

type KYCStatus = 'not_started' | 'pending' | 'approved' | 'rejected';
type KYCTier = 1 | 2 | 3;

interface KYCVerificationPageProps {
  currentStatus?: KYCStatus;
  currentTier?: KYCTier;
  onSubmitKYC?: (data: any) => Promise<void>;
}

export const KYCVerificationPage: React.FC<KYCVerificationPageProps> = ({
  currentStatus = 'not_started',
  currentTier = 1,
  onSubmitKYC,
}) => {
  const [activeStep, setActiveStep] = useState(1);

  const tierLimits = {
    1: { daily: 50000, monthly: 500000, features: ['Basic transfers', 'View transactions'] },
    2: { daily: 200000, monthly: 2000000, features: ['All Tier 1', 'International transfers', 'Bill payments'] },
    3: { daily: 1000000, monthly: 10000000, features: ['All Tier 2', 'Business accounts', 'API access', 'Priority support'] },
  };

  const getStatusBadge = (status: KYCStatus) => {
    const configs = {
      not_started: { icon: AlertCircle, label: 'Not Started', color: 'bg-gray-100 text-gray-800' },
      pending: { icon: Clock, label: 'Under Review', color: 'bg-yellow-100 text-yellow-800' },
      approved: { icon: CheckCircle, label: 'Verified', color: 'bg-green-100 text-green-800' },
      rejected: { icon: AlertCircle, label: 'Rejected', color: 'bg-red-100 text-red-800' },
    };

    const config = configs[status];
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${config.color}`}>
        <Icon className="w-4 h-4" />
        {config.label}
      </span>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">KYC Verification</h1>
          <p className="text-gray-600 mt-1">Complete your verification to unlock higher transaction limits</p>
        </div>
        {getStatusBadge(currentStatus)}
      </div>

      {/* Current Tier Card */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8" />
            <div>
              <div className="text-sm opacity-90">Current Tier</div>
              <div className="text-2xl font-bold">Tier {currentTier}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm opacity-90">Daily Limit</div>
            <div className="text-xl font-bold">₦{tierLimits[currentTier].daily.toLocaleString()}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/20">
          <div>
            <div className="text-sm opacity-75">Monthly Limit</div>
            <div className="font-semibold">₦{tierLimits[currentTier].monthly.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-sm opacity-75">Features</div>
            <div className="font-semibold">{tierLimits[currentTier].features.length} available</div>
          </div>
        </div>
      </div>

      {/* Tier Comparison */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Verification Tiers</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {([1, 2, 3] as KYCTier[]).map((tier) => (
            <div
              key={tier}
              className={`border-2 rounded-lg p-4 ${
                tier === currentTier ? 'border-blue-600 bg-blue-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Tier {tier}</h3>
                {tier === currentTier && (
                  <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">Current</span>
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-600">Daily:</span>
                  <span className="font-medium ml-1">₦{tierLimits[tier].daily.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-600">Monthly:</span>
                  <span className="font-medium ml-1">₦{tierLimits[tier].monthly.toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t">
                  <ul className="space-y-1">
                    {tierLimits[tier].features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Verification Steps */}
      {currentStatus === 'not_started' && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Verification Process</h2>
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="space-y-4">
              {[
                { step: 1, title: 'Personal Information', description: 'Provide your basic details and contact information', icon: FileText },
                { step: 2, title: 'Document Upload', description: 'Upload a valid government-issued ID (NIN, BVN, Passport)', icon: Upload },
                { step: 3, title: 'Selfie Verification', description: 'Take a selfie for identity confirmation', icon: Camera },
                { step: 4, title: 'Review & Submit', description: 'Review your information and submit for approval', icon: CheckCircle },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.step} className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      activeStep >= item.step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {activeStep > item.step ? <CheckCircle className="w-5 h-5" /> : item.step}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{item.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                    </div>
                    <Icon className="w-6 h-6 text-gray-400" />
                  </div>
                );
              })}
            </div>

            <div className="mt-6 pt-6 border-t">
              <button
                onClick={() => onSubmitKYC?.({})}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Start Verification Process
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Status */}
      {currentStatus === 'pending' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <Clock className="w-8 h-8 text-yellow-600 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-yellow-900 mb-2">Verification Under Review</h3>
              <p className="text-yellow-800 mb-4">
                Your KYC documents are being reviewed by our team. This typically takes 24-48 hours.
                We'll notify you via email once the review is complete.
              </p>
              <div className="text-sm text-yellow-700">
                <p>Submitted: October 24, 2025 at 2:30 PM</p>
                <p>Expected completion: October 26, 2025</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rejected Status */}
      {currentStatus === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-8 h-8 text-red-600 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900 mb-2">Verification Rejected</h3>
              <p className="text-red-800 mb-4">
                Unfortunately, we couldn't verify your documents. Please review the reasons below and resubmit.
              </p>
              <div className="bg-white rounded-lg p-4 mb-4">
                <h4 className="font-medium text-gray-900 mb-2">Reasons for Rejection:</h4>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-red-600">•</span>
                    <span>Document image is blurry or unclear</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-600">•</span>
                    <span>Information mismatch between document and profile</span>
                  </li>
                </ul>
              </div>
              <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                Resubmit Verification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integration Note */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-gray-600 mt-0.5" />
          <div className="text-sm text-gray-700">
            <p className="font-medium mb-1">Powered by Open-Source KYB</p>
            <p>
              This platform uses an open-source solution,
              an open-source identity and risk orchestration platform for secure KYC verification.
              Document verification is enhanced with <a href="https://olmocr.allenai.org/blog" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OLMOCR</a> and{' '}
              <a href="https://github.com/Ucas-HaoranWei/GOT-OCR2.0" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">GOT-OCR2.0</a> for accurate text extraction.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== SECURITY SETTINGS PAGE ====================

export const SecuritySettingsPage: React.FC = () => {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);

  const securityActivities = [
    { action: 'Password changed', date: 'Oct 24, 2025 at 2:30 PM', location: 'Lagos, Nigeria', device: 'Chrome on Windows' },
    { action: 'Login from new device', date: 'Oct 23, 2025 at 10:15 AM', location: 'Abuja, Nigeria', device: 'Safari on iPhone' },
    { action: 'Account created', date: 'Oct 20, 2025 at 9:00 AM', location: 'Lagos, Nigeria', device: 'Chrome on Windows' },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Security Settings</h1>
        <p className="text-gray-600 mt-1">Manage your account security and privacy preferences</p>
      </div>

      {/* Password Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <Lock className="w-6 h-6 text-gray-600 mt-1" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Password</h2>
              <p className="text-sm text-gray-600 mt-1">Change your password regularly to keep your account secure</p>
            </div>
          </div>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Change Password
          </button>
        </div>
        <div className="text-sm text-gray-600">
          Last changed: October 24, 2025
        </div>
      </div>

      {/* Two-Factor Authentication */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <Smartphone className="w-6 h-6 text-gray-600 mt-1" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Two-Factor Authentication (2FA)</h2>
              <p className="text-sm text-gray-600 mt-1">
                Add an extra layer of security by requiring a code from your phone in addition to your password
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={twoFactorEnabled}
              onChange={(e) => setTwoFactorEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
        {twoFactorEnabled && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">2FA is enabled</span>
            </div>
            <p className="text-sm text-green-700 mt-2">
              Your account is protected with two-factor authentication via SMS to +234 801 234 5678
            </p>
            <button className="mt-3 text-sm text-green-700 hover:text-green-800 font-medium">
              Change phone number
            </button>
          </div>
        )}
      </div>

      {/* Notification Preferences */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start gap-3 mb-4">
          <Bell className="w-6 h-6 text-gray-600 mt-1" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Security Notifications</h2>
            <p className="text-sm text-gray-600 mt-1">Get notified about important security events</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-gray-600" />
              <div>
                <div className="font-medium text-gray-900">Email Notifications</div>
                <div className="text-sm text-gray-600">Receive security alerts via email</div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <MessageSquare className="w-5 h-5 text-gray-600" />
              <div>
                <div className="font-medium text-gray-900">SMS Notifications</div>
                <div className="text-sm text-gray-600">Receive security alerts via SMS</div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={smsNotifications}
                onChange={(e) => setSmsNotifications(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <Key className="w-6 h-6 text-gray-600 mt-1" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
              <p className="text-sm text-gray-600 mt-1">Manage API keys for programmatic access (Tier 3 only)</p>
            </div>
          </div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Generate New Key
          </button>
        </div>
        <div className="text-sm text-gray-500">
          No API keys generated yet
        </div>
      </div>

      {/* Security Activity */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Security Activity</h2>
        <div className="space-y-4">
          {securityActivities.map((activity, index) => (
            <div key={index} className="flex items-start gap-4 pb-4 border-b last:border-0">
              <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">{activity.action}</div>
                <div className="text-sm text-gray-600 mt-1">{activity.date}</div>
                <div className="text-sm text-gray-500 mt-1">
                  {activity.location} • {activity.device}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==================== SUPPORT TICKETS PAGE ====================

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  created: string;
  updated: string;
  messages: number;
}

export const SupportTicketsPage: React.FC = () => {
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<TicketStatus | 'all'>('all');

  const tickets: Ticket[] = [
    {
      id: 'TKT-001',
      subject: 'Transaction failed but amount was deducted',
      status: 'in_progress',
      priority: 'high',
      category: 'Transactions',
      created: 'Oct 24, 2025',
      updated: '2 hours ago',
      messages: 3,
    },
    {
      id: 'TKT-002',
      subject: 'Unable to add beneficiary',
      status: 'resolved',
      priority: 'medium',
      category: 'Technical',
      created: 'Oct 23, 2025',
      updated: '1 day ago',
      messages: 5,
    },
  ];

  const getStatusBadge = (status: TicketStatus) => {
    const configs = {
      open: { label: 'Open', color: 'bg-blue-100 text-blue-800' },
      in_progress: { label: 'In Progress', color: 'bg-yellow-100 text-yellow-800' },
      resolved: { label: 'Resolved', color: 'bg-green-100 text-green-800' },
      closed: { label: 'Closed', color: 'bg-gray-100 text-gray-800' },
    };

    const config = configs[status];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const getPriorityBadge = (priority: TicketPriority) => {
    const configs = {
      low: { label: 'Low', color: 'text-gray-600' },
      medium: { label: 'Medium', color: 'text-blue-600' },
      high: { label: 'High', color: 'text-orange-600' },
      urgent: { label: 'Urgent', color: 'text-red-600' },
    };

    const config = configs[priority];
    return <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-gray-600 mt-1">View and manage your support requests</p>
        </div>
        <button
          onClick={() => setShowNewTicket(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create New Ticket
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tickets..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as TicketStatus | 'all')}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* Tickets List */}
      <div className="bg-white border border-gray-200 rounded-lg divide-y">
        {tickets.map((ticket) => (
          <div key={ticket.id} className="p-6 hover:bg-gray-50 transition-colors cursor-pointer">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-mono text-gray-500">{ticket.id}</span>
                  {getStatusBadge(ticket.status)}
                  {getPriorityBadge(ticket.priority)}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{ticket.subject}</h3>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span>{ticket.category}</span>
                  <span>•</span>
                  <span>Created {ticket.created}</span>
                  <span>•</span>
                  <span>Updated {ticket.updated}</span>
                  <span>•</span>
                  <span>{ticket.messages} messages</span>
                </div>
              </div>
              <button className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                View Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {tickets.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <MessageSquare className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No support tickets</h3>
          <p className="text-gray-600 mb-6">You haven't created any support tickets yet</p>
          <button
            onClick={() => setShowNewTicket(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Your First Ticket
          </button>
        </div>
      )}
    </div>
  );
};

