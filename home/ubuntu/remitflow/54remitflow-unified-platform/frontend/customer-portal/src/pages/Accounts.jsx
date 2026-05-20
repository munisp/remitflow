import React, { useState, useEffect } from 'react';

const Accounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8111';

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const token = localStorage.getItem('customer_portal_token');
      const response = await fetch(`${apiUrl}/api/v1/customers/accounts`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My Accounts</h1>
        <button className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors">
          Open New Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <span className="material-icons text-gray-400 text-5xl mb-4">account_balance</span>
          <p className="text-gray-500">No accounts found</p>
          <p className="text-sm text-gray-400 mt-2">Contact your agent to open an account</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <div className={`p-3 rounded-full ${account.type === 'savings' ? 'bg-blue-100' : 'bg-green-100'}`}>
                    <span className={`material-icons ${account.type === 'savings' ? 'text-blue-600' : 'text-green-600'}`}>
                      {account.type === 'savings' ? 'savings' : 'account_balance_wallet'}
                    </span>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500 capitalize">{account.type} Account</p>
                    <p className="text-xs text-gray-400">{account.account_number}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${account.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {account.status}
                </span>
              </div>
              
              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-500">Available Balance</p>
                <p className="text-2xl font-bold text-gray-900">
                  ${account.balance?.toLocaleString() || '0.00'}
                </p>
              </div>

              <div className="mt-4 flex space-x-2">
                <button className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                  View Details
                </button>
                <button className="flex-1 px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors">
                  Transfer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Accounts;
