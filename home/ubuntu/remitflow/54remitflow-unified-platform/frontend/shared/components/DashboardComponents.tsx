'use client';

import React from 'react';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Send,
  Users,
  ArrowRight,
  CheckCircle,
  Clock,
  XCircle,
  Eye,
  EyeOff,
} from 'lucide-react';

// ==================== BALANCECARD COMPONENT ====================

interface BalanceCardProps {
  balance: number;
  currency?: string;
  label?: string;
  trend?: {
    value: number;
    isPositive: boolean;
    period: string;
  };
  showBalance?: boolean;
  onToggleVisibility?: () => void;
  className?: string;
}

export const BalanceCard: React.FC<BalanceCardProps> = ({
  balance,
  currency = '₦',
  label = 'Available Balance',
  trend,
  showBalance = true,
  onToggleVisibility,
  className = '',
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <div className={`bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-6 text-white ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5" />
          <span className="text-sm font-medium opacity-90">{label}</span>
        </div>
        {onToggleVisibility && (
          <button
            onClick={onToggleVisibility}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            aria-label={showBalance ? 'Hide balance' : 'Show balance'}
          >
            {showBalance ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div className="mb-3">
        <div className="text-3xl font-bold">
          {showBalance ? (
            <>
              {currency}
              {formatCurrency(balance)}
            </>
          ) : (
            '••••••••'
          )}
        </div>
      </div>

      {trend && showBalance && (
        <div className="flex items-center gap-2">
          {trend.isPositive ? (
            <TrendingUp className="w-4 h-4 text-green-300" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-300" />
          )}
          <span className="text-sm">
            <span className={trend.isPositive ? 'text-green-300' : 'text-red-300'}>
              {trend.isPositive ? '+' : ''}
              {trend.value}%
            </span>
            <span className="opacity-75 ml-1">{trend.period}</span>
          </span>
        </div>
      )}
    </div>
  );
};

// ==================== STATSCARD COMPONENT ====================

interface StatsCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  className?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  icon,
  trend,
  description,
  variant = 'default',
  className = '',
}) => {
  const getVariantColors = () => {
    switch (variant) {
      case 'success':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'warning':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'error':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-white text-gray-900 border-gray-200';
    }
  };

  const getIconBg = () => {
    switch (variant) {
      case 'success':
        return 'bg-green-100';
      case 'warning':
        return 'bg-yellow-100';
      case 'error':
        return 'bg-red-100';
      default:
        return 'bg-blue-100';
    }
  };

  return (
    <div className={`border rounded-xl p-6 ${getVariantColors()} ${className}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-medium opacity-75 mb-1">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        {icon && (
          <div className={`p-3 rounded-lg ${getIconBg()}`}>
            {icon}
          </div>
        )}
      </div>

      {(trend || description) && (
        <div className="flex items-center gap-2">
          {trend && (
            <div className="flex items-center gap-1">
              {trend.isPositive ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-600" />
              )}
              <span className={`text-sm font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {trend.isPositive ? '+' : ''}
                {trend.value}%
              </span>
            </div>
          )}
          {description && (
            <span className="text-sm opacity-75">{description}</span>
          )}
        </div>
      )}
    </div>
  );
};

// ==================== QUICKACTIONS COMPONENT ====================

interface QuickAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

interface QuickActionsProps {
  actions: QuickAction[];
  title?: string;
  className?: string;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  actions,
  title = 'Quick Actions',
  className = '',
}) => {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-6 ${className}`}>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={action.onClick}
            disabled={action.disabled}
            className={`
              flex flex-col items-center gap-2 p-4 rounded-lg
              transition-all duration-200
              ${
                action.variant === 'primary'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-50 text-gray-900 hover:bg-gray-100'
              }
              ${action.disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <div className="text-2xl">{action.icon}</div>
            <span className="text-sm font-medium">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ==================== RECENTTRANSACTIONS COMPONENT ====================

interface Transaction {
  id: string;
  type: 'sent' | 'received';
  recipient: string;
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'failed';
  date: string;
}

interface RecentTransactionsProps {
  transactions: Transaction[];
  title?: string;
  onViewAll?: () => void;
  onViewTransaction?: (id: string) => void;
  className?: string;
}

export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  transactions,
  title = 'Recent Transactions',
  onViewAll,
  onViewTransaction,
  className = '',
}) => {
  const getStatusIcon = (status: Transaction['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
    }
  };

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-700 bg-green-50';
      case 'pending':
        return 'text-yellow-700 bg-yellow-50';
      case 'failed':
        return 'text-red-700 bg-red-50';
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            View All
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="space-y-3">
        {transactions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No recent transactions</p>
          </div>
        ) : (
          transactions.map((transaction) => (
            <div
              key={transaction.id}
              onClick={() => onViewTransaction?.(transaction.id)}
              className={`
                flex items-center justify-between p-3 rounded-lg
                border border-gray-100 hover:bg-gray-50
                transition-colors
                ${onViewTransaction ? 'cursor-pointer' : ''}
              `}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`p-2 rounded-lg ${transaction.type === 'sent' ? 'bg-red-50' : 'bg-green-50'}`}>
                  {transaction.type === 'sent' ? (
                    <Send className="w-4 h-4 text-red-600" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-green-600 transform rotate-180" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {transaction.type === 'sent' ? 'Sent to' : 'Received from'} {transaction.recipient}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {getStatusIcon(transaction.status)}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(transaction.status)}`}>
                      {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(transaction.date)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right ml-4">
                <p className={`text-sm font-semibold ${transaction.type === 'sent' ? 'text-red-600' : 'text-green-600'}`}>
                  {transaction.type === 'sent' ? '-' : '+'}
                  {transaction.currency}
                  {formatCurrency(transaction.amount, transaction.currency)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

