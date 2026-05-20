/**
 * Transaction List Component
 * Nigerian Remittance Platform
 */

import React from 'react';
import { Transaction, TransactionStatus } from '../../types/dashboard';
import { formatCurrency, formatDate, getStatusColor, getStatusIcon } from '../../utils/formatters';

interface TransactionListProps {
  transactions: Transaction[];
  loading?: boolean;
  onTransactionClick?: (transaction: Transaction) => void;
}

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  loading = false,
  onTransactionClick
}) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white p-4 rounded-lg shadow animate-pulse">
            <div className="flex justify-between">
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
              <div className="text-right">
                <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-16"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-white p-8 rounded-lg shadow text-center">
        <p className="text-gray-500">No transactions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {transactions.map((transaction) => (
        <div
          key={transaction.id}
          onClick={() => onTransactionClick?.(transaction)}
          className={`bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow ${
            onTransactionClick ? 'cursor-pointer' : ''
          }`}
        >
          <div className="flex justify-between items-start">
            {/* Left side - Transaction info */}
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(transaction.status)}`}>
                  <span className="mr-1">{getStatusIcon(transaction.status)}</span>
                  {transaction.status}
                </span>
                <span className="text-xs text-gray-500">{transaction.type}</span>
              </div>
              
              <p className="text-sm font-medium text-gray-900 mb-1">
                {transaction.sender.full_name} → {transaction.recipient.full_name}
              </p>
              
              <p className="text-xs text-gray-500">
                {transaction.description || transaction.reference}
              </p>
              
              <p className="text-xs text-gray-400 mt-1">
                {formatDate(transaction.created_at)}
              </p>
            </div>

            {/* Right side - Amount */}
            <div className="text-right ml-4">
              <p className="text-lg font-bold text-gray-900">
                {formatCurrency(transaction.amount, transaction.currency)}
              </p>
              <p className="text-xs text-gray-500">{transaction.payment_method}</p>
            </div>
          </div>

          {/* Progress bar for processing transactions */}
          {transaction.status === TransactionStatus.PROCESSING && (
            <div className="mt-3">
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div className="bg-blue-600 h-1.5 rounded-full animate-pulse" style={{ width: '60%' }}></div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
