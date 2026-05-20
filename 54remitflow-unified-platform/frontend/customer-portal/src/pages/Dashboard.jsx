import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

const Dashboard = () => {
  const { user } = useAuth();
  const [accountSummary, setAccountSummary] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8111';

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const token = localStorage.getItem('customer_portal_token');
      
      // Fetch account summary
      const accountResponse = await fetch(`${apiUrl}/api/v1/customers/accounts/summary`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        setAccountSummary(accountData);
      }

      // Fetch recent transactions
      const txResponse = await fetch(`${apiUrl}/api/v1/customers/transactions?limit=5`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (txResponse.ok) {
        const txData = await txResponse.json();
        setRecentTransactions(txData.transactions || []);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.name || 'Customer'}</h1>
        <p className="text-gray-600">Here's your account overview</p>
      </div>

      {/* Account Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100">
              <span className="material-icons text-green-600">account_balance_wallet</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Available Balance</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${accountSummary?.available_balance?.toLocaleString() || '0.00'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100">
              <span className="material-icons text-blue-600">savings</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Savings Balance</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${accountSummary?.savings_balance?.toLocaleString() || '0.00'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100">
              <span className="material-icons text-purple-600">trending_up</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">This Month</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${accountSummary?.monthly_transactions?.toLocaleString() || '0.00'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button className="flex flex-col items-center p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <span className="material-icons text-green-600 text-3xl mb-2">send</span>
            <span className="text-sm font-medium text-gray-700">Send Money</span>
          </button>
          <button className="flex flex-col items-center p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <span className="material-icons text-blue-600 text-3xl mb-2">receipt</span>
            <span className="text-sm font-medium text-gray-700">Pay Bills</span>
          </button>
          <button className="flex flex-col items-center p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <span className="material-icons text-purple-600 text-3xl mb-2">phone_android</span>
            <span className="text-sm font-medium text-gray-700">Buy Airtime</span>
          </button>
          <button className="flex flex-col items-center p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <span className="material-icons text-orange-600 text-3xl mb-2">qr_code_scanner</span>
            <span className="text-sm font-medium text-gray-700">Scan QR</span>
          </button>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Transactions</h2>
          <a href="/transactions" className="text-sm text-green-600 hover:text-green-700">View all</a>
        </div>
        
        {recentTransactions.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No recent transactions</p>
        ) : (
          <div className="space-y-4">
            {recentTransactions.map((tx, index) => (
              <div key={tx.id || index} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <div className="flex items-center">
                  <div className={`p-2 rounded-full ${tx.type === 'credit' ? 'bg-green-100' : 'bg-red-100'}`}>
                    <span className={`material-icons ${tx.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.type === 'credit' ? 'arrow_downward' : 'arrow_upward'}
                    </span>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-900">{tx.description || tx.type}</p>
                    <p className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                  {tx.type === 'credit' ? '+' : '-'}${Math.abs(tx.amount).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
