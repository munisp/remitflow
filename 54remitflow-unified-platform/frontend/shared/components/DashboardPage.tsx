/**
 * DashboardPage - Main dashboard with stats, charts, and recent activity
 * 
 * Features:
 * - Balance card with show/hide toggle
 * - Stats cards (sent, received, beneficiaries)
 * - Transaction volume chart
 * - Recent transactions list
 * - Quick actions
 */

import { useEffect } from 'react';
import { Link } from 'router-dom';
import { DashboardLayout } from '@/components/layout';
import { BalanceCard, StatsCard, QuickActions, RecentTransactions } from '@/components/dashboard';
import { useTransactions, useUser, useBeneficiaries } from '@/hooks';
import { Loading } from '@/components/ui/Loading';
import { Alert } from '@/components/ui/alert';
import {
  TrendingUp,
  TrendingDown,
  Users,
  ArrowRight,
  Send,
  Plus,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function DashboardPage() {
  const { transactions, isLoading: transactionsLoading, error: transactionsError, fetchTransactions } = useTransactions();
  const { user } = useUser();
  const { beneficiaries, fetchBeneficiaries } = useBeneficiaries();

  useEffect(() => {
    fetchTransactions();
    fetchBeneficiaries();
  }, []);

  // Calculate stats
  const totalSent = transactions
    .filter(t => t.type === 'sent' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalReceived = transactions
    .filter(t => t.type === 'received' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);

  const recentTransactions = transactions.slice(0, 5);

  if (transactionsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <Loading size="lg" text="Loading dashboard..." />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome back, {user?.firstName}!
            </h1>
            <p className="text-gray-600 mt-1">
              Here's what's happening with your account today.
            </p>
          </div>
          <div className="hidden sm:flex items-center space-x-3">
            <Link to="/send-money">
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Send className="w-4 h-4 mr-2" />
                Send Money
              </Button>
            </Link>
            <Button variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Error Alert */}
        {transactionsError && (
          <Alert variant="destructive">
            {transactionsError}
          </Alert>
        )}

        {/* Balance Card */}
        <BalanceCard
          balance={user?.balance || 0}
          trend={12.5}
          period="this month"
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatsCard
            title="Total Sent"
            value={totalSent}
            icon={TrendingDown}
            variant="default"
            trend={-5.2}
            description="vs last month"
          />
          <StatsCard
            title="Total Received"
            value={totalReceived}
            icon={TrendingUp}
            variant="success"
            trend={8.3}
            description="vs last month"
          />
          <StatsCard
            title="Beneficiaries"
            value={beneficiaries.length}
            icon={Users}
            variant="primary"
            description={`${beneficiaries.filter(b => b.isFavorite).length} favorites`}
          />
        </div>

        {/* Quick Actions */}
        <Card>
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Quick Actions
            </h2>
            <QuickActions
              actions={[
                { label: 'Send Money', icon: Send, href: '/send-money', variant: 'primary' },
                { label: 'Add Beneficiary', icon: Plus, href: '/beneficiaries', variant: 'secondary' },
                { label: 'View Transactions', icon: ArrowRight, href: '/transactions', variant: 'secondary' },
                { label: 'Get Help', icon: HelpCircle, href: '/help', variant: 'secondary' },
              ]}
            />
          </div>
        </Card>

        {/* Recent Transactions */}
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Recent Transactions
              </h2>
              <Link
                to="/transactions"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center"
              >
                View all
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
            <RecentTransactions
              transactions={recentTransactions}
              onViewDetails={(id) => window.location.href = `/transactions/${id}`}
            />
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

