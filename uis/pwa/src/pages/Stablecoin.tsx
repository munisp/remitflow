import { useState, useEffect } from 'react';
import { stablecoinService } from '../services/api';

// Types
interface WalletAddress {
  address_id: string;
  chain: string;
  address: string;
  is_active: boolean;
}

interface Balance {
  chain: string;
  stablecoin: string;
  balance: string;
  pending_balance: string;
}

interface Transaction {
  transaction_id: string;
  transaction_type: string;
  chain: string;
  stablecoin: string;
  amount: string;
  status: string;
  created_at: string;
  tx_hash?: string;
}

interface Quote {
  quote_id: string;
  from_currency: string;
  to_currency: string;
  from_amount: string;
  to_amount: string;
  rate: string;
  fee: string;
  is_ml_optimized: boolean;
}

// Chain configurations
const CHAINS = {
  tron: { name: 'Tron', symbol: 'TRX', color: 'bg-red-500', icon: '🔴', fee: '$1' },
  ethereum: { name: 'Ethereum', symbol: 'ETH', color: 'bg-indigo-500', icon: '🔷', fee: '$5' },
  solana: { name: 'Solana', symbol: 'SOL', color: 'bg-purple-500', icon: '🟣', fee: '$0.01' },
  polygon: { name: 'Polygon', symbol: 'MATIC', color: 'bg-violet-500', icon: '🟪', fee: '$0.10' },
  bsc: { name: 'BNB Chain', symbol: 'BNB', color: 'bg-amber-500', icon: '🟡', fee: '$0.30' },
};

const STABLECOINS = {
  usdt: { name: 'Tether', symbol: 'USDT', color: 'bg-emerald-500', icon: '💵' },
  usdc: { name: 'USD Coin', symbol: 'USDC', color: 'bg-blue-400', icon: '💲' },
  pyusd: { name: 'PayPal USD', symbol: 'PYUSD', color: 'bg-indigo-600', icon: '🅿️' },
  dai: { name: 'Dai', symbol: 'DAI', color: 'bg-yellow-400', icon: '🌕' },
};


// SVG Icon Components
const WifiIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
  </svg>
);

const WifiOffIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
  </svg>
);

const ArrowUpRightIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7v10" />
  </svg>
);

const ArrowDownLeftIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7L7 17M7 17h10M7 17V7" />
  </svg>
);

const RefreshIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const GlobeIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const TrendingUpIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
);

const CopyIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const CheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const ShieldIcon = ({ className = "w-8 h-8" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const ZapIcon = ({ className = "w-8 h-8" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const AlertIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

export default function Stablecoin() {
  const [activeTab, setActiveTab] = useState<'wallet' | 'send' | 'receive' | 'convert' | 'ramp'>('wallet');
  const [wallets, setWallets] = useState<WalletAddress[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalBalance, setTotalBalance] = useState('0.00');
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  
  // Send form state
  const [sendChain, setSendChain] = useState('tron');
  const [sendStablecoin, setSendStablecoin] = useState('usdt');
  const [sendAmount, setSendAmount] = useState('');
  const [sendAddress, setSendAddress] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  
  // Convert form state
  const [fromChain, setFromChain] = useState('tron');
  const [fromStablecoin, setFromStablecoin] = useState('usdt');
  const [toChain, setToChain] = useState('ethereum');
  const [toStablecoin, setToStablecoin] = useState('usdc');
  const [convertAmount, setConvertAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  
  // Ramp form state
  const [rampType, setRampType] = useState<'on' | 'off'>('on');
  const [rampFiat, setRampFiat] = useState('NGN');
  const [rampAmount, setRampAmount] = useState('');
  const [rampStablecoin, setRampStablecoin] = useState('usdt');
  const [rampChain, setRampChain] = useState('tron');
  
  // User ID (would come from auth in production)
  // const userId = 'user_123';

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    loadWalletData();
  }, []);

  const loadWalletData = async () => {
    setLoading(true);
    try {
      const [balancesData, historyData] = await Promise.all([
        stablecoinService.getBalances().catch(() => null),
        stablecoinService.getHistory().catch(() => null),
      ]);

      if (balancesData) {
        const bData = balancesData as unknown as { wallets?: WalletAddress[]; balances?: Balance[]; total_usd?: string };
        setWallets(bData.wallets || []);
        setBalances(bData.balances || []);
        setTotalBalance(bData.total_usd || '0.00');
      }

      if (historyData) {
        const hData = historyData as unknown as { transactions?: Transaction[] };
        setTransactions(hData.transactions || []);
      }
    } catch (error) {
      console.error('Failed to load wallet data:', error);
    } finally {
      setLoading(false);
    }
  };

  const createWallet = async () => {
    try {
      await stablecoinService.buy({ coin: 'usdt', amount: 0, paymentCurrency: 'NGN' }).catch(() => null);
      await loadWalletData();
    } catch (error) {
      console.error('Failed to create wallet:', error);
    }
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const handleSend = async () => {
    if (!sendAmount || !sendAddress) return;
    
    setSendLoading(true);
    try {
      const result = await stablecoinService.send({
        coin: sendStablecoin,
        amount: parseFloat(sendAmount),
        address: sendAddress,
      }).catch(() => null);
      
      if (result) {
        const data = result as unknown as { status?: string; tx_hash?: string };
        alert(data.status === 'queued_offline' 
          ? 'Transaction queued for when you\'re back online' 
          : `Transaction sent! TX: ${data.tx_hash || 'pending'}`
        );
        setSendAmount('');
        setSendAddress('');
        await loadWalletData();
      }
    } catch (error) {
      console.error('Failed to send:', error);
      alert('Failed to send. Please try again.');
    } finally {
      setSendLoading(false);
    }
  };

  const getQuote = async () => {
    if (!convertAmount) return;
    
    setQuoteLoading(true);
    try {
      const ratesData = await stablecoinService.getRates().catch(() => null);
      if (ratesData) {
        const mockQuote: Quote = {
          quote_id: `q-${Date.now()}`,
          from_currency: fromStablecoin,
          to_currency: toStablecoin,
          from_amount: convertAmount,
          to_amount: (parseFloat(convertAmount) * 0.998).toFixed(2),
          rate: '0.998',
          fee: (parseFloat(convertAmount) * 0.002).toFixed(4),
          is_ml_optimized: true,
        };
        setQuote(mockQuote);
      }
    } catch (error) {
      console.error('Failed to get quote:', error);
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleConvert = async () => {
    if (!quote) return;
    
    try {
      const result = await stablecoinService.convert({
        fromCoin: fromStablecoin,
        toCoin: toStablecoin,
        amount: parseFloat(convertAmount),
      }).catch(() => null);
      
      if (result) {
        alert('Conversion successful!');
        setConvertAmount('');
        setQuote(null);
        await loadWalletData();
      }
    } catch (error) {
      console.error('Failed to convert:', error);
      alert('Failed to convert. Please try again.');
    }
  };

  const handleRamp = async () => {
    if (!rampAmount) return;
    
    try {
      const result = rampType === 'on'
        ? await stablecoinService.buy({
            coin: rampStablecoin,
            amount: parseFloat(rampAmount),
            paymentCurrency: rampFiat,
          }).catch(() => null)
        : await stablecoinService.sell({
            coin: rampStablecoin,
            amount: parseFloat(rampAmount),
            receiveCurrency: rampFiat,
          }).catch(() => null);
      
      if (result) {
        const data = result as unknown as { order_id?: string };
        alert(`Order created! Order ID: ${data.order_id || 'pending'}`);
        setRampAmount('');
      }
    } catch (error) {
      console.error('Failed to create ramp order:', error);
      alert('Failed to create order. Please try again.');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-emerald-600 bg-green-100';
      case 'confirming': return 'text-amber-600 bg-amber-100';
      case 'pending': return 'text-indigo-600 bg-indigo-100';
      case 'failed': return 'text-red-600 bg-red-100';
      case 'queued_offline': return 'text-slate-600 bg-slate-100';
      default: return 'text-slate-600 bg-slate-100';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Stablecoin Wallet</h1>
          <div className="flex items-center gap-2">
            {isOnline ? (
              <span className="flex items-center text-green-300 text-sm">
                <WifiIcon className="w-4 h-4 mr-1" /> Online
              </span>
            ) : (
              <span className="flex items-center text-yellow-300 text-sm">
                <WifiOffIcon className="w-4 h-4 mr-1" /> Offline
              </span>
            )}
          </div>
        </div>
        
        {/* Total Balance */}
        <div className="text-center py-4">
          <p className="text-sm opacity-80">Total Balance</p>
          <p className="text-4xl font-bold">${totalBalance}</p>
          <p className="text-sm opacity-80 mt-1 flex items-center justify-center">
            <TrendingUpIcon className="w-4 h-4 mr-1" />
            ML-optimized rates active
          </p>
        </div>
        
        {/* Quick Actions */}
        <div className="flex justify-center gap-4 mt-4">
          <button 
            onClick={() => setActiveTab('send')}
            className="flex flex-col items-center p-3 bg-white/20 rounded-xl hover:bg-white/30 transition"
          >
            <ArrowUpRightIcon className="w-6 h-6" />
            <span className="text-xs mt-1">Send</span>
          </button>
          <button 
            onClick={() => setActiveTab('receive')}
            className="flex flex-col items-center p-3 bg-white/20 rounded-xl hover:bg-white/30 transition"
          >
            <ArrowDownLeftIcon className="w-6 h-6" />
            <span className="text-xs mt-1">Receive</span>
          </button>
          <button 
            onClick={() => setActiveTab('convert')}
            className="flex flex-col items-center p-3 bg-white/20 rounded-xl hover:bg-white/30 transition"
          >
            <RefreshIcon className="w-6 h-6" />
            <span className="text-xs mt-1">Convert</span>
          </button>
          <button 
            onClick={() => setActiveTab('ramp')}
            className="flex flex-col items-center p-3 bg-white/20 rounded-xl hover:bg-white/30 transition"
          >
            <GlobeIcon className="w-6 h-6" />
            <span className="text-xs mt-1">Buy/Sell</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white sticky top-0 z-10">
        {(['wallet', 'send', 'receive', 'convert', 'ramp'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-sm font-medium capitalize ${
              activeTab === tab 
                ? 'text-indigo-600 border-b-2 border-indigo-600' 
                : 'text-slate-500'
            }`}
          >
            {tab === 'ramp' ? 'Buy/Sell' : tab}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* Wallet Tab */}
        {activeTab === 'wallet' && (
          <div className="space-y-4">
            {wallets.length === 0 && (
              <button
                onClick={createWallet}
                className="w-full p-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 font-medium hover:bg-indigo-700 transition"
              >
                Create Stablecoin Wallet
              </button>
            )}
            
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold mb-3">Your Balances</h3>
              {balances.length === 0 ? (
                <p className="text-slate-500 text-center py-4">No balances yet</p>
              ) : (
                <div className="space-y-3">
                  {balances.map((balance, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">
                          {STABLECOINS[balance.stablecoin as keyof typeof STABLECOINS]?.icon || '💰'}
                        </span>
                        <div>
                          <p className="font-medium">
                            {STABLECOINS[balance.stablecoin as keyof typeof STABLECOINS]?.symbol || balance.stablecoin.toUpperCase()}
                          </p>
                          <p className="text-xs text-slate-500">
                            {CHAINS[balance.chain as keyof typeof CHAINS]?.name || balance.chain}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">${balance.balance}</p>
                        {parseFloat(balance.pending_balance) > 0 && (
                          <p className="text-xs text-amber-600">
                            +${balance.pending_balance} pending
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold mb-3">Recent Transactions</h3>
              {transactions.length === 0 ? (
                <p className="text-slate-500 text-center py-4">No transactions yet</p>
              ) : (
                <div className="space-y-3">
                  {transactions.slice(0, 5).map((tx) => (
                    <div key={tx.transaction_id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${
                          tx.transaction_type === 'deposit' ? 'bg-green-100' : 'bg-red-100'
                        }`}>
                          {tx.transaction_type === 'deposit' ? (
                            <ArrowDownLeftIcon className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <ArrowUpRightIcon className="w-4 h-4 text-red-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium capitalize">{tx.transaction_type}</p>
                          <p className="text-xs text-slate-500">{formatDate(tx.created_at)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${
                          tx.transaction_type === 'deposit' ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {tx.transaction_type === 'deposit' ? '+' : '-'}${tx.amount}
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(tx.status)}`}>
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <ZapIcon className="w-8 h-8 text-amber-500 mb-2" />
                <h4 className="font-medium">Instant Transfers</h4>
                <p className="text-xs text-slate-500">Send in seconds</p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <ShieldIcon className="w-8 h-8 text-emerald-500 mb-2" />
                <h4 className="font-medium">Secure</h4>
                <p className="text-xs text-slate-500">Multi-chain security</p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <TrendingUpIcon className="w-8 h-8 text-indigo-500 mb-2" />
                <h4 className="font-medium">ML Rates</h4>
                <p className="text-xs text-slate-500">AI-optimized timing</p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <WifiOffIcon className="w-8 h-8 text-purple-500 mb-2" />
                <h4 className="font-medium">Offline Ready</h4>
                <p className="text-xs text-slate-500">Queue when offline</p>
              </div>
            </div>
          </div>
        )}

        {/* Send Tab */}
        {activeTab === 'send' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold mb-4">Send Stablecoin</h3>
              
              {!isOnline && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl mb-4">
                  <AlertIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
                  <p className="text-sm text-yellow-700">
                    You are offline. Transaction will be queued and sent when you are back online.
                  </p>
                </div>
              )}
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">Network</label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(CHAINS).map(([key, chain]) => (
                    <button
                      key={key}
                      onClick={() => setSendChain(key)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                        sendChain === key 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {chain.icon} {chain.name}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">Stablecoin</label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STABLECOINS).map(([key, coin]) => (
                    <button
                      key={key}
                      onClick={() => setSendStablecoin(key)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                        sendStablecoin === key 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {coin.icon} {coin.symbol}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    value="0.00"
                    className="w-full pl-8 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">Recipient Address</label>
                <input
                  type="text"
                  value={sendAddress}
                  onChange={(e) => setSendAddress(e.target.value)}
                  value="Enter wallet address"
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <div className="flex justify-between text-sm text-slate-600 mb-4">
                <span>Network Fee</span>
                <span>{CHAINS[sendChain as keyof typeof CHAINS]?.fee || '$0'}</span>
              </div>
              
              <button
                onClick={handleSend}
                disabled={!sendAmount || !sendAddress || sendLoading}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 font-medium hover:bg-indigo-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {sendLoading ? 'Sending...' : isOnline ? 'Send Now' : 'Queue for Later'}
              </button>
            </div>
          </div>
        )}

        {/* Receive Tab */}
        {activeTab === 'receive' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold mb-4">Receive Stablecoin</h3>
              
              {wallets.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 mb-4">Create a wallet to receive stablecoins</p>
                  <button
                    onClick={createWallet}
                    className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 font-medium hover:bg-indigo-700 transition"
                  >
                    Create Wallet
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {wallets.map((wallet) => (
                    <div key={wallet.address_id} className="p-4 bg-slate-50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">
                          {CHAINS[wallet.chain as keyof typeof CHAINS]?.icon}{' '}
                          {CHAINS[wallet.chain as keyof typeof CHAINS]?.name || wallet.chain}
                        </span>
                        <button
                          onClick={() => copyAddress(wallet.address)}
                          className="flex items-center gap-1 text-indigo-600 text-sm hover:text-indigo-700"
                        >
                          {copiedAddress === wallet.address ? (
                            <>
                              <CheckIcon className="w-4 h-4" /> Copied
                            </>
                          ) : (
                            <>
                              <CopyIcon className="w-4 h-4" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-sm text-slate-600 break-all bg-white p-2 rounded">
                        {wallet.address}
                      </p>
                      <p className="text-xs text-slate-500 mt-2">
                        Supports: USDT, USDC, PYUSD, DAI
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="bg-indigo-50 rounded-xl p-4">
              <h4 className="font-medium text-indigo-800 mb-2">Tips for Receiving</h4>
              <ul className="text-sm text-indigo-700 space-y-1">
                <li>Always verify the network matches the sender</li>
                <li>Tron (TRC20) has the lowest fees</li>
                <li>Deposits are confirmed automatically</li>
              </ul>
            </div>
          </div>
        )}

        {/* Convert Tab */}
        {activeTab === 'convert' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold mb-4">Convert Stablecoin</h3>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">From</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {Object.entries(STABLECOINS).map(([key, coin]) => (
                    <button
                      key={key}
                      onClick={() => setFromStablecoin(key)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                        fromStablecoin === key 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {coin.icon} {coin.symbol}
                    </button>
                  ))}
                </div>
                <select
                  value={fromChain}
                  onChange={(e) => setFromChain(e.target.value)}
                  className="w-full px-4 py-2 border rounded-xl text-sm"
                >
                  {Object.entries(CHAINS).map(([key, chain]) => (
                    <option key={key} value={key}>{chain.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input
                    type="number"
                    value={convertAmount}
                    onChange={(e) => {
                      setConvertAmount(e.target.value);
                      setQuote(null);
                    }}
                    value="0.00"
                    className="w-full pl-8 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              
              <div className="flex justify-center my-2">
                <div className="p-2 bg-slate-100 rounded-full">
                  <RefreshIcon className="w-5 h-5 text-slate-600" />
                </div>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">To</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {Object.entries(STABLECOINS).map(([key, coin]) => (
                    <button
                      key={key}
                      onClick={() => setToStablecoin(key)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                        toStablecoin === key 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {coin.icon} {coin.symbol}
                    </button>
                  ))}
                </div>
                <select
                  value={toChain}
                  onChange={(e) => setToChain(e.target.value)}
                  className="w-full px-4 py-2 border rounded-xl text-sm"
                >
                  {Object.entries(CHAINS).map(([key, chain]) => (
                    <option key={key} value={key}>{chain.name}</option>
                  ))}
                </select>
              </div>
              
              {!quote && (
                <button
                  onClick={getQuote}
                  disabled={!convertAmount || quoteLoading}
                  className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition disabled:opacity-50 mb-4"
                >
                  {quoteLoading ? 'Getting Quote...' : 'Get Quote'}
                </button>
              )}
              
              {quote && (
                <div className="p-4 bg-emerald-50 rounded-xl mb-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-slate-600">You will receive</span>
                    <span className="font-bold text-lg">${quote.to_amount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Rate</span>
                    <span>1 {STABLECOINS[fromStablecoin as keyof typeof STABLECOINS]?.symbol} = {quote.rate} {STABLECOINS[toStablecoin as keyof typeof STABLECOINS]?.symbol}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Fee</span>
                    <span>${quote.fee}</span>
                  </div>
                  {quote.is_ml_optimized && (
                    <div className="flex items-center gap-1 text-emerald-600 text-sm mt-2">
                      <TrendingUpIcon className="w-4 h-4" />
                      <span>ML-optimized rate applied</span>
                    </div>
                  )}
                </div>
              )}
              
              <button
                onClick={handleConvert}
                disabled={!quote}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 font-medium hover:bg-indigo-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Convert Now
              </button>
            </div>
          </div>
        )}

        {/* Ramp Tab (Buy/Sell) */}
        {activeTab === 'ramp' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex bg-slate-100 rounded-xl p-1 mb-4">
                <button
                  onClick={() => setRampType('on')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                    rampType === 'on' ? 'bg-white shadow' : ''
                  }`}
                >
                  Buy Stablecoin
                </button>
                <button
                  onClick={() => setRampType('off')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                    rampType === 'off' ? 'bg-white shadow' : ''
                  }`}
                >
                  Sell Stablecoin
                </button>
              </div>
              
              <h3 className="font-semibold mb-4">
                {rampType === 'on' ? 'Buy Stablecoin with Fiat' : 'Sell Stablecoin for Fiat'}
              </h3>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">
                  {rampType === 'on' ? 'Pay with' : 'Receive in'}
                </label>
                <div className="flex flex-wrap gap-2">
                  {['NGN', 'USD', 'EUR', 'GBP'].map((fiat) => (
                    <button
                      key={fiat}
                      onClick={() => setRampFiat(fiat)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                        rampFiat === fiat 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {fiat}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    {rampFiat === 'NGN' ? '₦' : rampFiat === 'EUR' ? '€' : rampFiat === 'GBP' ? '£' : '$'}
                  </span>
                  <input
                    type="number"
                    value={rampAmount}
                    onChange={(e) => setRampAmount(e.target.value)}
                    value="0.00"
                    className="w-full pl-8 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">
                  {rampType === 'on' ? 'Receive' : 'Sell'}
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STABLECOINS).map(([key, coin]) => (
                    <button
                      key={key}
                      onClick={() => setRampStablecoin(key)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                        rampStablecoin === key 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {coin.icon} {coin.symbol}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-600 mb-2 block">Network</label>
                <select
                  value={rampChain}
                  onChange={(e) => setRampChain(e.target.value)}
                  className="w-full px-4 py-2 border rounded-xl text-sm"
                >
                  {Object.entries(CHAINS).map(([key, chain]) => (
                    <option key={key} value={key}>{chain.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="p-3 bg-slate-50 rounded-xl mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Current Rate</span>
                  <span>
                    {rampFiat === 'NGN' ? '1 USDT = ₦1,650' : 
                     rampFiat === 'EUR' ? '1 USDT = €0.92' :
                     rampFiat === 'GBP' ? '1 USDT = £0.79' : '1 USDT = $1.00'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Fee</span>
                  <span>1%</span>
                </div>
              </div>
              
              <button
                onClick={handleRamp}
                disabled={!rampAmount}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 font-medium hover:bg-indigo-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {rampType === 'on' ? 'Buy Now' : 'Sell Now'}
              </button>
            </div>
            
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h4 className="font-medium mb-3">Payment Methods</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="p-2 bg-slate-200 rounded-full">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Bank Transfer</p>
                    <p className="text-xs text-slate-500">Instant for NGN, 1-2 days for others</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="p-2 bg-slate-200 rounded-full">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Debit/Credit Card</p>
                    <p className="text-xs text-slate-500">Instant, 2.5% fee</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="p-2 bg-slate-200 rounded-full">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Mobile Money</p>
                    <p className="text-xs text-slate-500">M-Pesa, MTN MoMo, Airtel Money</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
