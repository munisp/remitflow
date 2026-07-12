/**
 * Transaction Service - Integration with Core Banking Transaction Ledger
 * Fetches transaction history from ledger service by account number
 */

import { api } from "./api";

export interface Transaction {
  id: string;
  transaction_id?: string;
  payer: string;
  payer_account_number: string | null;
  payer_name: string | null;
  payee: string;
  payee_account_number: string | null;
  payee_name: string | null;
  amount: string;
  currency: string;
  status: "success" | "pending" | "failed" | "PENDING" | "COMPLETED" | "FAILED";
  completed_at?: string;
  note?: string;
  tag?: string;
  tenant_id: string;
  ledger_id: string;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface TransactionHistory {
  transactions: Transaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface GetTransactionsParams {
  page?: number;
  limit?: number;
  accountNumber?: string; // Changed from accountId to accountNumber
}

// Transaction Service
export const transactionServiceCore = {
  /**
   * Get transaction history for an account by account number
   * Uses ledger endpoint: /ledger/txn/account-number/{account_number}
   */
  async getTransactions(
    accountNumber: string,
    params: GetTransactionsParams = {},
  ): Promise<TransactionHistory> {
    const { page = 1, limit = 20 } = params;

    try {
      // Use ledger service endpoint
      // Pattern: /ledger/txn/account-number/{account_number}?limit={limit}&page={page}
      const response = await api.get<{
        message: string;
        transactions: Transaction[];
      }>(
        `/ledger/txn/account-number/${accountNumber}?limit=${limit}&page=${page}`,
      );

      const transactions = response.data.transactions || [];

      return {
        transactions,
        total: transactions.length, // API doesn't return total count
        page,
        limit,
        hasMore: transactions.length === limit,
      };
    } catch (error) {
      console.error("Failed to fetch transactions:", error);
      return {
        transactions: [],
        total: 0,
        page,
        limit,
        hasMore: false,
      };
    }
  },

  /**
   * Get transaction by ID
   * Note: This endpoint may not be available in ledger service
   */
  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    try {
      const response = await api.get<{
        message: string;
        transaction: Transaction;
      }>(`/ledger/txn/${transactionId}`);
      return response.data.transaction;
    } catch (error) {
      console.error("Failed to fetch transaction:", error);
      return null;
    }
  },

  /**
   * Get recent transactions for an account (last N transactions)
   */
  async getRecentTransactions(
    accountNumber: string,
    limit: number = 10,
  ): Promise<Transaction[]> {
    try {
      const result = await this.getTransactions(accountNumber, {
        page: 1,
        limit,
      });
      return result.transactions;
    } catch (error) {
      console.error("Failed to fetch recent transactions:", error);
      return [];
    }
  },

  /**
   * Helper to format transaction for display
   * Determines if transaction is debit or credit based on account number
   */
  formatTransaction(
    transaction: Transaction,
    userAccountNumber: string,
  ): {
    type: "debit" | "credit";
    amount: number;
    description: string;
    otherParty: string;
  } {
    const isDebit = transaction.payer_account_number === userAccountNumber;
    const amount = parseFloat(transaction.amount);
    const status = transaction.status.toLowerCase();

    return {
      type: isDebit ? "debit" : "credit",
      amount,
      description:
        transaction.note ||
        transaction.tag ||
        (status === "success" ? "Transaction" : `Transaction (${status})`),
      otherParty: isDebit
        ? transaction.payee_name ||
          transaction.payee_account_number ||
          "Unknown"
        : transaction.payer_name ||
          transaction.payer_account_number ||
          "Unknown",
    };
  },
};

export default transactionServiceCore;
