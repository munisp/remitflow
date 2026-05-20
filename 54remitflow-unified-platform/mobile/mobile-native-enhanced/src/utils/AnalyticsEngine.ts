// AnalyticsEngine.ts - AI-Powered Spending Insights
// Transaction categorization, trends, and savings recommendations

import { Transaction } from '../types';

export enum TransactionCategory {
  FOOD = 'Food & Dining',
  TRANSPORT = 'Transportation',
  SHOPPING = 'Shopping',
  BILLS = 'Bills & Utilities',
  ENTERTAINMENT = 'Entertainment',
  HEALTH = 'Health & Fitness',
  TRANSFER = 'Money Transfer',
  OTHER = 'Other',
}

export interface SpendingInsight {
  category: TransactionCategory;
  amount: number;
  percentage: number;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
}

export interface SavingsOpportunity {
  title: string;
  description: string;
  potentialSavings: number;
  category: TransactionCategory;
}

export interface UnusualSpendingAlert {
  transaction: Transaction;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

class AnalyticsEngine {
  private static instance: AnalyticsEngine;

  static getInstance(): AnalyticsEngine {
    if (!AnalyticsEngine.instance) {
      AnalyticsEngine.instance = new AnalyticsEngine();
    }
    return AnalyticsEngine.instance;
  }

  // AI-powered transaction categorization
  categorizeTransaction(transaction: Transaction): TransactionCategory {
    const description = transaction.description.toLowerCase();
    
    // Simple keyword-based categorization (in production, use ML model)
    if (description.includes('restaurant') || description.includes('food')) {
      return TransactionCategory.FOOD;
    } else if (description.includes('uber') || description.includes('taxi')) {
      return TransactionCategory.TRANSPORT;
    } else if (description.includes('shop') || description.includes('store')) {
      return TransactionCategory.SHOPPING;
    } else if (description.includes('electric') || description.includes('water')) {
      return TransactionCategory.BILLS;
    } else if (description.includes('movie') || description.includes('game')) {
      return TransactionCategory.ENTERTAINMENT;
    } else if (description.includes('gym') || description.includes('doctor')) {
      return TransactionCategory.HEALTH;
    } else if (description.includes('transfer') || description.includes('send')) {
      return TransactionCategory.TRANSFER;
    }
    
    return TransactionCategory.OTHER;
  }

  // Calculate spending insights
  calculateSpendingInsights(
    transactions: Transaction[],
    previousTransactions: Transaction[]
  ): SpendingInsight[] {
    const insights: SpendingInsight[] = [];
    const categoryTotals = new Map<TransactionCategory, number>();
    const previousCategoryTotals = new Map<TransactionCategory, number>();
    
    // Calculate current period totals
    let totalSpending = 0;
    transactions.forEach(tx => {
      const category = this.categorizeTransaction(tx);
      const current = categoryTotals.get(category) || 0;
      categoryTotals.set(category, current + tx.amount);
      totalSpending += tx.amount;
    });
    
    // Calculate previous period totals
    previousTransactions.forEach(tx => {
      const category = this.categorizeTransaction(tx);
      const current = previousCategoryTotals.get(category) || 0;
      previousCategoryTotals.set(category, current + tx.amount);
    });
    
    // Generate insights
    Object.values(TransactionCategory).forEach(category => {
      const amount = categoryTotals.get(category) || 0;
      const previousAmount = previousCategoryTotals.get(category) || 0;
      const percentage = totalSpending > 0 ? (amount / totalSpending) * 100 : 0;
      
      let trend: 'up' | 'down' | 'stable' = 'stable';
      let trendPercentage = 0;
      
      if (previousAmount > 0) {
        trendPercentage = ((amount - previousAmount) / previousAmount) * 100;
        if (trendPercentage > 5) trend = 'up';
        else if (trendPercentage < -5) trend = 'down';
      }
      
      if (amount > 0) {
        insights.push({
          category,
          amount,
          percentage,
          trend,
          trendPercentage,
        });
      }
    });
    
    return insights.sort((a, b) => b.amount - a.amount);
  }

  // Detect unusual spending
  detectUnusualSpending(
    transactions: Transaction[],
    historicalTransactions: Transaction[]
  ): UnusualSpendingAlert[] {
    const alerts: UnusualSpendingAlert[] = [];
    
    // Calculate average transaction amount per category
    const categoryAverages = new Map<TransactionCategory, number>();
    const categoryCounts = new Map<TransactionCategory, number>();
    
    historicalTransactions.forEach(tx => {
      const category = this.categorizeTransaction(tx);
      const current = categoryAverages.get(category) || 0;
      const count = categoryCounts.get(category) || 0;
      categoryAverages.set(category, current + tx.amount);
      categoryCounts.set(category, count + 1);
    });
    
    // Check recent transactions against averages
    transactions.forEach(tx => {
      const category = this.categorizeTransaction(tx);
      const average = categoryAverages.get(category) || 0;
      const count = categoryCounts.get(category) || 1;
      const avgAmount = average / count;
      
      if (tx.amount > avgAmount * 2) {
        alerts.push({
          transaction: tx,
          reason: `This ${category} transaction is ${Math.round((tx.amount / avgAmount) * 100)}% higher than usual`,
          severity: tx.amount > avgAmount * 3 ? 'high' : 'medium',
        });
      }
    });
    
    return alerts;
  }

  // Generate savings opportunities
  generateSavingsOpportunities(insights: SpendingInsight[]): SavingsOpportunity[] {
    const opportunities: SavingsOpportunity[] = [];
    
    insights.forEach(insight => {
      if (insight.trend === 'up' && insight.trendPercentage > 20) {
        opportunities.push({
          title: `Reduce ${insight.category} spending`,
          description: `Your ${insight.category} spending increased by ${Math.round(insight.trendPercentage)}% this month`,
          potentialSavings: insight.amount * 0.15,
          category: insight.category,
        });
      }
    });
    
    return opportunities;
  }
}

export default AnalyticsEngine.getInstance();
