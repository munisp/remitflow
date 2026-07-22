import React, { useCallback, useEffect, useState } from "react";
import { cardService, type Card } from "../services/cardService";

const Cards: React.FC = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ accountId: "", cardType: "virtual", nameOnCard: "" });

  const loadCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await cardService.getCustomerCards();
    if (!response.success) {
      setCards([]);
      setError(response.message ?? "The card service could not load cards.");
    } else {
      setCards(response.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadCards(); }, [loadCards]);

  const issueCard = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssuing(true);
    setError(null);
    const response = await cardService.issueCard(form);
    setIssuing(false);
    if (!response.success || !response.data) {
      setError(response.message || "The card service did not issue a card.");
      return;
    }
    setCards((current) => [...current, response.data!]);
    setSelectedCardId(response.data.id);
    setShowIssueForm(false);
    setForm({ accountId: "", cardType: "virtual", nameOnCard: "" });
  };

  const toggleFreeze = async (card: Card) => {
    setError(null);
    const response = card.status.toLowerCase() === "frozen"
      ? await cardService.unfreezeCard(card.id)
      : await cardService.freezeCard(card.id);
    if (!response.success) {
      setError(response.message);
      return;
    }
    setCards((current) => current.map((candidate) => candidate.id === card.id
      ? { ...candidate, status: card.status.toLowerCase() === "frozen" ? "active" : "frozen" }
      : candidate));
  };

  if (loading) {
    return <div className="flex min-h-[360px] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" /></div>;
  }

  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">My Cards</h1><p className="mt-1 text-slate-500">Manage cards issued by the configured card service.</p></div>
        <button type="button" onClick={() => setShowIssueForm(true)} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Issue Card</button>
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!error && cards.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">No cards are currently available from the backend.</div>}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {cards.map((card) => <button key={card.id} type="button" onClick={() => setSelectedCardId(card.id)} className={`rounded-2xl p-6 text-left text-white shadow-lg transition ${selectedCardId === card.id ? "ring-4 ring-indigo-200" : "hover:scale-[1.01]"} bg-gradient-to-br from-indigo-600 to-violet-800`}>
          <div className="mb-8 flex justify-between gap-4"><div><p className="text-xs text-white/70">{card.cardType}</p><p className="font-semibold">{card.nameOnCard ?? "Cardholder"}</p></div><span className="rounded-full bg-white/20 px-2 py-1 text-xs">{card.status}</span></div>
          <p className="mb-6 font-mono text-xl tracking-[0.16em]">{card.maskedCardNumber || card.cardNumber}</p>
          <div className="flex justify-between text-sm"><span>Expires {card.expiryDate}</span><span>{card.dailyLimit != null ? `Daily limit ${card.dailyLimit.toLocaleString()}` : "Limits unavailable"}</span></div>
        </button>)}
      </div>
      {selectedCard && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-2 text-lg font-semibold text-slate-900">Card controls</h2><p className="mb-4 text-sm text-slate-500">The card status is changed only after the backend confirms the operation.</p><button type="button" onClick={() => void toggleFreeze(selectedCard)} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">{selectedCard.status.toLowerCase() === "frozen" ? "Unfreeze card" : "Freeze card"}</button></section>}
      {showIssueForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"><form onSubmit={issueCard} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">Issue card</h2><button type="button" onClick={() => setShowIssueForm(false)} className="text-sm text-slate-500">Close</button></div><label className="block text-sm font-medium text-slate-700">Funding account ID<input required value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Backend account identifier" /></label><label className="block text-sm font-medium text-slate-700">Name on card<input required value={form.nameOnCard} onChange={(event) => setForm({ ...form, nameOnCard: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Cardholder name" /></label><label className="block text-sm font-medium text-slate-700">Card type<select value={form.cardType} onChange={(event) => setForm({ ...form, cardType: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"><option value="virtual">Virtual</option><option value="debit">Debit</option><option value="credit">Credit</option></select></label><button disabled={issuing} className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{issuing ? "Issuing…" : "Issue card"}</button></form></div>}
    </div>
  );
};

export default Cards;
