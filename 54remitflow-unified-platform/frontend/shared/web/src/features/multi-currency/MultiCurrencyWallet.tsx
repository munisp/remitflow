import React from 'react';
import { useMulticurrencyaccountsService } from '../../hooks/useMulticurrencyaccountsService';

export const MultiCurrencyWallet: React.FC = () => {
  const { useList } = useMulticurrencyaccountsService();
  const { data: accounts, isLoading } = useList(1, 10);

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="multi-currency-wallet p-6">
      <h2 className="text-2xl font-bold mb-6">Multi-Currency Wallet</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts?.data.map((account: any) => (
          <div key={account.id} className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-semibold">{account.currency}</h3>
            <p className="text-3xl font-bold mt-2">{account.balance}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
