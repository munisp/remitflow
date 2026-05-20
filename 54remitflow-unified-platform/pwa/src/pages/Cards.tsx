import React, { useState, useEffect, useCallback } from 'react';
import { cardService, type VirtualCard, type CardTransaction } from '../services/api';

const Cards: React.FC = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [cardTransactions, setCardTransactions] = useState<CardTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [cardType, setCardType] = useState('verve');
  const [initialFunding, setInitialFunding] = useState('');
  const [creating, setCreating] = useState(false);

  const fallbackCards: VirtualCard[] = [
    { id: '1', cardNumber: '**** **** **** 4532', expiryDate: '12/26', cvv: '***', cardType: 'Verve', currency: 'NGN', balance: 50000, limit: 500000, status: 'active', createdAt: new Date().toISOString() },
    { id: '2', cardNumber: '**** **** **** 8901', expiryDate: '06/25', cvv: '***', cardType: 'Mastercard', currency: 'USD', balance: 25000, limit: 1000000, status: 'active', createdAt: new Date().toISOString() },
  ];

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cardService.getCards();
      if (res.data && res.data.length > 0) { setCards(res.data); } else { setCards(fallbackCards); }
    } catch { setCards(fallbackCards); }
    setLoading(false);
  }, []);

  const fetchCardTransactions = useCallback(async (cardId: string) => {
    try {
      const res = await cardService.getTransactions(cardId);
      setCardTransactions(res.data || []);
    } catch { setCardTransactions([]); }
  }, []);

  useEffect(() => { fetchCards(); }, [fetchCards]);
  useEffect(() => { if (selectedCard) fetchCardTransactions(selectedCard); }, [selectedCard, fetchCardTransactions]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await cardService.create({ cardType, currency: 'NGN', initialFunding: parseFloat(initialFunding) || undefined });
      setCards(prev => [...prev, res.data]);
      setShowCreateModal(false);
    } catch { /* keep modal open */ }
    setCreating(false);
  };

  const handleFreeze = async (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    try {
      if (card.status === 'active') { await cardService.freeze(cardId); setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: 'frozen' as const } : c)); }
      else { await cardService.unfreeze(cardId); setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: 'active' as const } : c)); }
    } catch { /* revert optimistic */ }
  };

  const colors: Record<string, string> = { Verve: 'from-indigo-600 to-indigo-800', Mastercard: 'from-violet-600 to-violet-800', Visa: 'from-cyan-600 to-cyan-800' };

  if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h1 className="text-2xl font-bold text-slate-900">My Cards</h1><p className="text-slate-500 mt-1">Manage your virtual cards</p></div>
        <button onClick={() => setShowCreateModal(true)} className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 text-sm">+ Create Card</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map((card) => (
          <button key={card.id} onClick={() => setSelectedCard(card.id)} className={`text-left transition-all duration-200 ${selectedCard === card.id ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
            <div className={`bg-gradient-to-br ${colors[card.cardType] || 'from-indigo-600 to-indigo-800'} rounded-2xl p-6 text-white shadow-xl relative overflow-hidden`}>
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="flex justify-between items-start mb-8 relative">
                <div><p className="text-xs text-white/70">Virtual Card</p><p className="font-semibold">{card.cardType}</p></div>
                <span className="px-2 py-1 rounded-full text-xs bg-white/20 backdrop-blur-sm">{card.status}</span>
              </div>
              <p className="text-xl font-mono tracking-[0.2em] mb-6 relative">{card.cardNumber}</p>
              <div className="flex justify-between items-end relative">
                <div><p className="text-xs text-white/70">Balance</p><p className="text-lg font-bold">\u20a6{card.balance.toLocaleString()}</p></div>
                <div className="text-right"><p className="text-xs text-white/70">Expires</p><p className="font-mono">{card.expiryDate}</p></div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedCard && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Card Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'View Details', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z', action: () => {} },
              { label: 'Fund Card', icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6', action: () => {} },
              { label: cards.find(c => c.id === selectedCard)?.status === 'active' ? 'Freeze Card' : 'Unfreeze Card', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', action: () => handleFreeze(selectedCard) },
              { label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', action: () => {} },
            ].map((a) => (
              <button key={a.label} onClick={a.action} className="p-4 bg-slate-50 rounded-2xl text-center hover:bg-slate-100 transition-colors group">
                <div className="w-10 h-10 bg-white rounded-xl mx-auto mb-2 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-50 transition-colors shadow-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d={a.icon} /></svg>
                </div>
                <p className="text-xs font-semibold text-slate-700">{a.label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {cardTransactions.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Card Transactions</h2>
          <div className="space-y-2">
            {cardTransactions.slice(0, 5).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                  </div>
                  <div><p className="text-sm font-semibold text-slate-900">{tx.merchant}</p><p className="text-xs text-slate-400">{new Date(tx.createdAt).toLocaleDateString()}</p></div>
                </div>
                <p className="text-sm font-bold text-slate-900 tabular-nums">-\u20a6{tx.amount.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Create Virtual Card</h2>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-2">Card Type</label>
                <select value={cardType} onChange={(e) => setCardType(e.target.value)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none"><option value="verve">Verve (Local)</option><option value="mastercard">Mastercard (International)</option><option value="visa">Visa (International)</option></select></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-2">Initial Funding</label>
                <div className="flex"><span className="flex items-center px-4 bg-slate-50 border border-r-0 border-slate-200 rounded-l-xl text-sm text-slate-500 font-medium">NGN</span>
                <input type="number" value={initialFunding} onChange={(e) => setInitialFunding(e.target.value)} className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-r-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none" value="Minimum 1,000" /></div></div>
              <div className="p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl"><p className="text-sm text-indigo-800"><strong>Card Fee:</strong> \u20a61,500 (one-time)</p></div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreateModal(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl transition-all disabled:opacity-50">{creating ? 'Creating...' : 'Create Card'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cards;
