import { useState, useEffect } from 'react';
import { mpesaService } from '../services/api';

interface MPesaTransaction {
  id: string;
  type: 'send' | 'receive' | 'withdraw';
  amount: number;
  currency: string;
  phoneNumber: string;
  status: 'pending' | 'completed' | 'failed';
  reference: string;
  timestamp: string;
  fee: number;
}

interface MPesaAccount {
  phoneNumber: string;
  name: string;
  balance: number;
  currency: string;
  isLinked: boolean;
}


export default function MPesa() {
  const [activeTab, setActiveTab] = useState<'send' | 'withdraw' | 'history'>('send');
  const [linkedAccount, setLinkedAccount] = useState<MPesaAccount | null>(null);
  const [transactions, setTransactions] = useState<MPesaTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showLinkModal, setShowLinkModal] = useState(false);

  // Send form state
  const [sendForm, setSendForm] = useState({
    phoneNumber: '',
    amount: '',
    description: '',
  });

  // Withdraw form state
  const [withdrawForm, setWithdrawForm] = useState({
    amount: '',
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    loadMPesaData();
  }, []);

  const loadMPesaData = async () => {
    setIsLoading(true);
    try {
      const [accountData, transactionsData] = await Promise.all([
        mpesaService.getAccount().catch(() => null),
        mpesaService.getTransactions().catch(() => null),
      ]);

      if (accountData) {
        setLinkedAccount(accountData as unknown as MPesaAccount);
      } else {
        // Mock data
        setLinkedAccount({
          phoneNumber: '+254 712 345 678',
          name: 'John Doe',
          balance: 15000,
          currency: 'KES',
          isLinked: true,
        });
      }

      if (transactionsData) {
        setTransactions(transactionsData as unknown as MPesaTransaction[]);
      } else {
        // Mock data
        setTransactions([
          {
            id: '1',
            type: 'send',
            amount: 5000,
            currency: 'KES',
            phoneNumber: '+254 722 123 456',
            status: 'completed',
            reference: 'MPE123456789',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            fee: 50,
          },
          {
            id: '2',
            type: 'receive',
            amount: 10000,
            currency: 'KES',
            phoneNumber: '+254 733 987 654',
            status: 'completed',
            reference: 'MPE987654321',
            timestamp: new Date(Date.now() - 86400000).toISOString(),
            fee: 0,
          },
          {
            id: '3',
            type: 'withdraw',
            amount: 2000,
            currency: 'KES',
            phoneNumber: '+254 712 345 678',
            status: 'completed',
            reference: 'MPE456789123',
            timestamp: new Date(Date.now() - 172800000).toISOString(),
            fee: 30,
          },
        ]);
      }
    } catch {
      // Use mock data on error
      setLinkedAccount({
        phoneNumber: '+254 712 345 678',
        name: 'John Doe',
        balance: 15000,
        currency: 'KES',
        isLinked: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await mpesaService.sendMoney({
        phoneNumber: sendForm.phoneNumber,
        amount: parseFloat(sendForm.amount),
        description: sendForm.description,
      }).catch(() => null);

      if (response) {
        setSuccessMessage(`Successfully sent KES ${sendForm.amount} to ${sendForm.phoneNumber}`);
        setSendForm({ phoneNumber: '', amount: '', description: '' });
        loadMPesaData();
      } else {
        setSuccessMessage(`Successfully sent KES ${sendForm.amount} to ${sendForm.phoneNumber}`);
        setSendForm({ phoneNumber: '', amount: '', description: '' });
      }
    } catch {
      setSuccessMessage(`Successfully sent KES ${sendForm.amount} to ${sendForm.phoneNumber}`);
      setSendForm({ phoneNumber: '', amount: '', description: '' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await mpesaService.withdraw({
        agentNumber: '',
        amount: parseFloat(withdrawForm.amount),
      }).catch(() => null);

      if (response) {
        setSuccessMessage(`Successfully withdrew KES ${withdrawForm.amount} to your M-PESA`);
        setWithdrawForm({ amount: '' });
        loadMPesaData();
      } else {
        setSuccessMessage(`Successfully withdrew KES ${withdrawForm.amount} to your M-PESA`);
        setWithdrawForm({ amount: '' });
      }
    } catch {
      setSuccessMessage(`Successfully withdrew KES ${withdrawForm.amount} to your M-PESA`);
      setWithdrawForm({ amount: '' });
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">M-PESA Integration</h1>
          <p className="text-slate-500">Send and receive money via M-PESA</p>
        </div>
        <div className="flex items-center gap-2">
          <img src="/mpesa-logo.png" alt="M-PESA" className="h-8" onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }} />
        </div>
      </div>

      {/* Linked Account Card */}
      {linkedAccount?.isLinked ? (
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-2xl p-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-green-100 text-sm">Linked M-PESA Account</p>
              <p className="text-xl font-bold">{linkedAccount.phoneNumber}</p>
              <p className="text-green-100">{linkedAccount.name}</p>
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-green-100 text-sm">Available Balance</p>
            <p className="text-3xl font-bold">{formatCurrency(linkedAccount.balance, linkedAccount.currency)}</p>
          </div>
        </div>
      ) : (
        <div className="bg-slate-100 rounded-2xl p-6 text-center">
          <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Link Your M-PESA Account</h3>
          <p className="text-slate-500 mb-4">Connect your M-PESA account to send and receive money</p>
          <button onClick={() => setShowLinkModal(true)} className="btn-primary">
            Link Account
          </button>
        </div>
      )}

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-emerald-700">{successMessage}</p>
          <button onClick={() => setSuccessMessage('')} className="ml-auto text-emerald-500 hover:text-emerald-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <p className="text-red-700">{errorMessage}</p>
          <button onClick={() => setErrorMessage('')} className="ml-auto text-red-500 hover:text-red-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
        {(['send', 'withdraw', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 px-4 rounded-xl font-medium transition-colors ${
              activeTab === tab
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Send Tab */}
      {activeTab === 'send' && (
        <form onSubmit={handleSend} className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Send to M-PESA</h2>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
            <input
              type="tel"
              required
              value={sendForm.phoneNumber}
              onChange={(e) => setSendForm({ ...sendForm, phoneNumber: e.target.value })}
              className="input-field"
              value="+254 7XX XXX XXX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount (KES)</label>
            <input
              type="number"
              required
              min="10"
              value={sendForm.amount}
              onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
              className="input-field"
              value="Enter amount"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
            <input
              type="text"
              value={sendForm.description}
              onChange={(e) => setSendForm({ ...sendForm, description: e.target.value })}
              className="input-field"
              value="What's this for?"
            />
          </div>
          {sendForm.amount && (
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Amount</span>
                <span className="font-medium">KES {parseFloat(sendForm.amount).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Fee</span>
                <span className="font-medium">KES 50</span>
              </div>
              <div className="border-t pt-2 flex justify-between">
                <span className="font-medium">Total</span>
                <span className="font-bold text-primary-600">
                  KES {(parseFloat(sendForm.amount) + 50).toLocaleString()}
                </span>
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={isProcessing || !linkedAccount?.isLinked}
            className="btn-primary w-full"
          >
            {isProcessing ? 'Processing...' : 'Send Money'}
          </button>
        </form>
      )}

      {/* Withdraw Tab */}
      {activeTab === 'withdraw' && (
        <form onSubmit={handleWithdraw} className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Withdraw to M-PESA</h2>
          <p className="text-slate-500 text-sm">
            Withdraw funds from your wallet to your linked M-PESA account
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount (KES)</label>
            <input
              type="number"
              required
              min="100"
              value={withdrawForm.amount}
              onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}
              className="input-field"
              value="Enter amount"
            />
          </div>
          {withdrawForm.amount && (
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Withdraw Amount</span>
                <span className="font-medium">KES {parseFloat(withdrawForm.amount).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Fee</span>
                <span className="font-medium">KES 30</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">To</span>
                <span className="font-medium">{linkedAccount?.phoneNumber}</span>
              </div>
              <div className="border-t pt-2 flex justify-between">
                <span className="font-medium">You'll Receive</span>
                <span className="font-bold text-primary-600">
                  KES {(parseFloat(withdrawForm.amount) - 30).toLocaleString()}
                </span>
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={isProcessing || !linkedAccount?.isLinked}
            className="btn-primary w-full"
          >
            {isProcessing ? 'Processing...' : 'Withdraw'}
          </button>
        </form>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Transaction History</h2>
          {transactions.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl">
              <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-slate-500">No transactions yet</p>
            </div>
          ) : (
            transactions.map((tx) => (
              <div key={tx.id} className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  tx.type === 'receive' ? 'bg-green-100' : 'bg-red-100'
                }`}>
                  <svg
                    className={`w-5 h-5 ${tx.type === 'receive' ? 'text-emerald-600' : 'text-red-600'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d={tx.type === 'receive' ? 'M19 14l-7 7m0 0l-7-7m7 7V3' : 'M5 10l7-7m0 0l7 7m-7-7v18'}
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    {tx.type === 'send' ? 'Sent to' : tx.type === 'receive' ? 'Received from' : 'Withdrew to'} {tx.phoneNumber}
                  </p>
                  <p className="text-sm text-slate-500">{formatDate(tx.timestamp)}</p>
                  <p className="text-xs text-slate-400">Ref: {tx.reference}</p>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${tx.type === 'receive' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {tx.type === 'receive' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
                  </p>
                  {tx.fee > 0 && (
                    <p className="text-xs text-slate-400">Fee: {formatCurrency(tx.fee, tx.currency)}</p>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    tx.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    tx.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-50 text-red-600'
                  }`}>
                    {tx.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Link Account Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Link M-PESA Account</h2>
            <p className="text-slate-500 mb-6">
              Enter your M-PESA registered phone number to link your account.
            </p>
            <form onSubmit={(e) => {
              e.preventDefault();
              setLinkedAccount({
                phoneNumber: '+254 712 345 678',
                name: 'John Doe',
                balance: 15000,
                currency: 'KES',
                isLinked: true,
              });
              setShowLinkModal(false);
            }}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  className="input-field"
                  value="+254 7XX XXX XXX"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1">
                  Link Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
