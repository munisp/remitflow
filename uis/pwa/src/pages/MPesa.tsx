import React, { useEffect, useState } from 'react';
import { mpesaService } from '../services/api';

type MPesaTransaction = {
  id: string;
  type: 'send' | 'receive' | 'withdraw';
  amount: number;
  currency: string;
  phoneNumber: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: string;
};

type MPesaAccount = {
  phoneNumber: string;
  name: string;
  balance: number;
  currency: string;
  isLinked: boolean;
};

export default function MPesa() {
  const [activeTab, setActiveTab] = useState<'send' | 'withdraw' | 'history'>('send');
  const [linkedAccount, setLinkedAccount] = useState<MPesaAccount | null>(null);
  const [transactions, setTransactions] = useState<MPesaTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [sendForm, setSendForm] = useState({ phoneNumber: '', amount: '', description: '' });
  const [withdrawForm, setWithdrawForm] = useState({ amount: '', agentNumber: '' });

  const loadMPesaData = async () => {
    setIsLoading(true);
    setErrorMessage('');
    const [accountResult, transactionsResult] = await Promise.allSettled([
      mpesaService.getAccount(),
      mpesaService.getTransactions(),
    ]);
    if (accountResult.status === 'fulfilled') {
      const account = accountResult.value.data;
      setLinkedAccount({
        phoneNumber: account.phoneNumber,
        name: account.name,
        balance: account.balance,
        currency: account.currency,
        isLinked: true,
      });
    } else {
      setLinkedAccount(null);
      setErrorMessage('Unable to load the linked M-PESA account from the backend.');
    }
    if (transactionsResult.status === 'fulfilled') {
      setTransactions(transactionsResult.value.data.map((transaction) => ({
        id: transaction.id,
        type: transaction.type === 'receive' || transaction.type === 'withdraw' ? transaction.type : 'send',
        amount: transaction.amount,
        currency: transaction.currency,
        phoneNumber: transaction.recipient,
        status: transaction.status === 'completed' || transaction.status === 'failed' ? transaction.status : 'pending',
        timestamp: transaction.date,
      })));
    } else {
      setTransactions([]);
      setErrorMessage((current) => current || 'Unable to load M-PESA transaction history from the backend.');
    }
    setIsLoading(false);
  };

  useEffect(() => { void loadMPesaData(); }, []);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsProcessing(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await mpesaService.sendMoney({
        phoneNumber: sendForm.phoneNumber,
        amount: Number(sendForm.amount),
        description: sendForm.description || undefined,
      });
      setSuccessMessage('Payment submission was accepted by the M-PESA backend.');
      setSendForm({ phoneNumber: '', amount: '', description: '' });
      await loadMPesaData();
    } catch {
      setErrorMessage('The M-PESA backend did not accept the payment submission.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsProcessing(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await mpesaService.withdraw({ agentNumber: withdrawForm.agentNumber, amount: Number(withdrawForm.amount) });
      setSuccessMessage('Withdrawal submission was accepted by the M-PESA backend.');
      setWithdrawForm({ amount: '', agentNumber: '' });
      await loadMPesaData();
    } catch {
      setErrorMessage('The M-PESA backend did not accept the withdrawal submission.');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDate = (dateString: string) => new Date(dateString).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatCurrency = (amount: number, currency: string) => new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount);

  if (isLoading) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" /></div>;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">M-PESA Integration</h1><p className="text-slate-500">Live mobile-money account and transaction data.</p></div>
      {errorMessage && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{errorMessage}</div>}
      {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">{successMessage}</div>}
      {linkedAccount ? (
        <section className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-2xl p-6 text-white"><p className="text-green-100 text-sm">Linked M-PESA Account</p><p className="text-xl font-bold">{linkedAccount.phoneNumber}</p><p className="text-green-100">{linkedAccount.name}</p><p className="mt-4 text-green-100 text-sm">Available Balance</p><p className="text-3xl font-bold">{formatCurrency(linkedAccount.balance, linkedAccount.currency)}</p></section>
      ) : <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">No linked M-PESA account was returned by the configured backend. Account linking must be completed through the deployed core-banking service.</section>}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">{(['send', 'withdraw', 'history'] as const).map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 rounded-xl px-4 py-2 font-medium capitalize ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>{tab}</button>)}</div>
      {activeTab === 'send' && <form onSubmit={handleSend} className="bg-white rounded-2xl p-6 shadow-sm space-y-4"><h2 className="text-lg font-semibold text-slate-900">Send to M-PESA</h2><label className="block text-sm font-medium text-slate-700">Phone Number<input type="tel" required value={sendForm.phoneNumber} onChange={(event) => setSendForm({ ...sendForm, phoneNumber: event.target.value })} className="input-field mt-1" placeholder="+254 7XX XXX XXX" /></label><label className="block text-sm font-medium text-slate-700">Amount<input type="number" required min="10" step="0.01" value={sendForm.amount} onChange={(event) => setSendForm({ ...sendForm, amount: event.target.value })} className="input-field mt-1" placeholder="Enter amount" /></label><label className="block text-sm font-medium text-slate-700">Description (optional)<input type="text" value={sendForm.description} onChange={(event) => setSendForm({ ...sendForm, description: event.target.value })} className="input-field mt-1" placeholder="What is this payment for?" /></label><button type="submit" disabled={isProcessing || !linkedAccount} className="btn-primary w-full">{isProcessing ? 'Submitting…' : 'Send Money'}</button></form>}
      {activeTab === 'withdraw' && <form onSubmit={handleWithdraw} className="bg-white rounded-2xl p-6 shadow-sm space-y-4"><h2 className="text-lg font-semibold text-slate-900">Withdraw to M-PESA</h2><p className="text-sm text-slate-500">The backend determines all fees and final settlement details.</p><label className="block text-sm font-medium text-slate-700">Agent Number<input type="text" required value={withdrawForm.agentNumber} onChange={(event) => setWithdrawForm({ ...withdrawForm, agentNumber: event.target.value })} className="input-field mt-1" placeholder="Enter M-PESA agent number" /></label><label className="block text-sm font-medium text-slate-700">Amount<input type="number" required min="100" step="0.01" value={withdrawForm.amount} onChange={(event) => setWithdrawForm({ ...withdrawForm, amount: event.target.value })} className="input-field mt-1" placeholder="Enter amount" /></label><button type="submit" disabled={isProcessing || !linkedAccount} className="btn-primary w-full">{isProcessing ? 'Submitting…' : 'Withdraw'}</button></form>}
      {activeTab === 'history' && <section className="space-y-3"><h2 className="text-lg font-semibold text-slate-900">Transaction History</h2>{transactions.length === 0 ? <div className="rounded-2xl bg-white py-12 text-center text-slate-500">No backend-issued M-PESA transactions are available.</div> : transactions.map((transaction) => <div key={transaction.id} className="rounded-xl bg-white p-4 shadow-sm flex items-center justify-between gap-4"><div><p className="font-medium text-slate-900 capitalize">{transaction.type} · {transaction.phoneNumber}</p><p className="text-sm text-slate-500">{formatDate(transaction.timestamp)}</p></div><div className="text-right"><p className="font-bold text-slate-900">{formatCurrency(transaction.amount, transaction.currency)}</p><p className="text-xs capitalize text-slate-500">{transaction.status}</p></div></div>)}</section>}
    </div>
  );
}
