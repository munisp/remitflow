'use client';

import React, { useState } from 'react';
import {
  Send,
  Download,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  TrendingUp,
  Info,
  Calendar,
  DollarSign,
  Filter,
  X,
} from 'lucide-react';

// ==================== TRANSACTIONITEM COMPONENT ====================

interface TransactionItemProps {
  id: string;
  type: 'sent' | 'received';
  recipient: string;
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'processing' | 'failed' | 'cancelled';
  date: string;
  reference?: string;
  onClick?: (id: string) => void;
  className?: string;
}

export const TransactionItem: React.FC<TransactionItemProps> = ({
  id,
  type,
  recipient,
  amount,
  currency,
  status,
  date,
  reference,
  onClick,
  className = '',
}) => {
  const getTypeIcon = () => {
    return type === 'sent' ? (
      <Send className="w-5 h-5 text-red-600" />
    ) : (
      <Download className="w-5 h-5 text-green-600" />
    );
  };

  const getTypeColor = () => {
    return type === 'sent' ? 'bg-red-50' : 'bg-green-50';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      onClick={() => onClick?.(id)}
      className={`
        flex items-center justify-between p-4 border border-gray-200 rounded-lg
        hover:bg-gray-50 transition-colors
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className={`p-3 rounded-lg ${getTypeColor()}`}>
          {getTypeIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {type === 'sent' ? 'Sent to' : 'Received from'} {recipient}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <TransactionStatus status={status} size="sm" />
            {reference && (
              <span className="text-xs text-gray-500">Ref: {reference}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">{formatDate(date)}</p>
        </div>
      </div>
      <div className="text-right ml-4">
        <p className={`text-lg font-bold ${type === 'sent' ? 'text-red-600' : 'text-green-600'}`}>
          {type === 'sent' ? '-' : '+'}
          {currency}
          {formatCurrency(amount)}
        </p>
      </div>
    </div>
  );
};

// ==================== TRANSACTIONFILTER COMPONENT ====================

interface TransactionFilterProps {
  onFilterChange?: (filters: FilterValues) => void;
  onReset?: () => void;
  className?: string;
}

interface FilterValues {
  status?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
}

export const TransactionFilter: React.FC<TransactionFilterProps> = ({
  onFilterChange,
  onReset,
  className = '',
}) => {
  const [filters, setFilters] = useState<FilterValues>({});
  const [isOpen, setIsOpen] = useState(false);

  const handleFilterChange = (key: keyof FilterValues, value: any) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange?.(newFilters);
  };

  const handleReset = () => {
    setFilters({});
    onReset?.();
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Filter className="w-4 h-4" />
        <span className="font-medium">Filters</span>
        {activeFilterCount > 0 && (
          <span className="px-2 py-0.5 text-xs font-semibold text-white bg-blue-600 rounded-full">
            {activeFilterCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Filters</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={filters.status || ''}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={filters.type || ''}
                onChange={(e) => handleFilterChange('type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="sent">Sent</option>
                <option value="received">Received</option>
              </select>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date Range
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={filters.dateFrom || ''}
                  onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={filters.dateTo || ''}
                  onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Amount Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount Range
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.minAmount || ''}
                  onChange={(e) => handleFilterChange('minAmount', Number(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.maxAmount || ''}
                  onChange={(e) => handleFilterChange('maxAmount', Number(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-4 pt-4 border-t">
            <button
              onClick={handleReset}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== TRANSACTIONSTATUS COMPONENT ====================

interface TransactionStatusProps {
  status: 'completed' | 'pending' | 'processing' | 'failed' | 'cancelled';
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

export const TransactionStatus: React.FC<TransactionStatusProps> = ({
  status,
  size = 'md',
  showIcon = true,
  className = '',
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'completed':
        return {
          icon: <CheckCircle className="w-4 h-4" />,
          label: 'Completed',
          color: 'bg-green-100 text-green-800 border-green-200',
        };
      case 'pending':
        return {
          icon: <Clock className="w-4 h-4" />,
          label: 'Pending',
          color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        };
      case 'processing':
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          label: 'Processing',
          color: 'bg-blue-100 text-blue-800 border-blue-200',
        };
      case 'failed':
        return {
          icon: <XCircle className="w-4 h-4" />,
          label: 'Failed',
          color: 'bg-red-100 text-red-800 border-red-200',
        };
      case 'cancelled':
        return {
          icon: <XCircle className="w-4 h-4" />,
          label: 'Cancelled',
          color: 'bg-gray-100 text-gray-800 border-gray-200',
        };
    }
  };

  const getSizeClass = () => {
    switch (size) {
      case 'sm':
        return 'px-2 py-0.5 text-xs';
      case 'md':
        return 'px-2.5 py-1 text-sm';
      case 'lg':
        return 'px-3 py-1.5 text-base';
    }
  };

  const config = getStatusConfig();

  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        ${getSizeClass()}
        ${config.color}
        border rounded-full font-medium
        ${className}
      `}
    >
      {showIcon && config.icon}
      <span>{config.label}</span>
    </span>
  );
};

// ==================== EXCHANGERATEDISPLAY COMPONENT ====================

interface ExchangeRateDisplayProps {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  lastUpdated?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

export const ExchangeRateDisplay: React.FC<ExchangeRateDisplayProps> = ({
  fromCurrency,
  toCurrency,
  rate,
  lastUpdated,
  trend,
  className = '',
}) => {
  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <span className="text-sm font-medium text-blue-900">Exchange Rate</span>
        </div>
        {lastUpdated && (
          <span className="text-xs text-blue-700">
            Updated {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-blue-900">
          1 {fromCurrency} = {rate.toFixed(4)} {toCurrency}
        </span>
        {trend && (
          <span className={`text-sm font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? '+' : ''}
            {trend.value}%
          </span>
        )}
      </div>
    </div>
  );
};

// ==================== FEEBREAKDOWN COMPONENT ====================

interface FeeItem {
  label: string;
  amount: number;
  description?: string;
}

interface FeeBreakdownProps {
  fees: FeeItem[];
  total: number;
  currency?: string;
  className?: string;
}

export const FeeBreakdown: React.FC<FeeBreakdownProps> = ({
  fees,
  total,
  currency = '₦',
  className = '',
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Info className="w-4 h-4 text-gray-600" />
        <h4 className="text-sm font-semibold text-gray-900">Fee Breakdown</h4>
      </div>

      <div className="space-y-2">
        {fees.map((fee, index) => (
          <div key={index} className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-gray-700">{fee.label}</p>
              {fee.description && (
                <p className="text-xs text-gray-500 mt-0.5">{fee.description}</p>
              )}
            </div>
            <span className="text-sm font-medium text-gray-900 ml-4">
              {currency}
              {formatCurrency(fee.amount)}
            </span>
          </div>
        ))}

        <div className="border-t border-gray-300 pt-2 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Total Fees</span>
            <span className="text-base font-bold text-gray-900">
              {currency}
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

