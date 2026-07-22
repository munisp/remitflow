import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cardService, CardStatus, CardType, type Card } from "../services/cardService";

const Cards: React.FC = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const response = await cardService.getCustomerCards();
      if (response.success && response.data) {
        setCards(response.data);
      } else {
        setCards([]);
      }
    } catch (error) {
      console.error("Failed to fetch cards:", error);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const getCardTypeColor = (type: CardType) => {
    switch (type) {
      case CardType.DEBIT:
        return "from-blue-500 to-blue-700";
      case CardType.CREDIT:
        return "from-purple-500 to-purple-700";
      case CardType.VIRTUAL:
        return "from-emerald-500 to-emerald-700";
      default:
        return "from-slate-500 to-slate-700";
    }
  };

  const getStatusBadge = (status: CardStatus) => {
    switch (status) {
      case CardStatus.ACTIVE:
        return (
          <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-lg">
            Active
          </span>
        );
      case CardStatus.BLOCKED:
        return (
          <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-lg">
            Blocked
          </span>
        );
      case CardStatus.LOST:
        return (
          <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-lg">
            Lost
          </span>
        );
      default:
        return null;
    }
  };

  const handleBlockCard = async (cardId: string) => {
    if (window.confirm("Are you sure you want to block this card?")) {
      try {
        const response = await cardService.blockCard(cardId, "User requested");
        if (response.success) {
          await fetchCards();
          alert(response.message || "Card blocked successfully");
        } else {
          alert(response.message || "Failed to block card");
        }
      } catch (error) {
        alert("Failed to block card");
      }
    }
  };

  const handleUnblockCard = async (cardId: string) => {
    if (window.confirm("Are you sure you want to unblock this card?")) {
      try {
        const response = await cardService.unblockCard(cardId);
        if (response.success) {
          await fetchCards();
          alert(response.message || "Card unblocked successfully");
        } else {
          alert(response.message || "Failed to unblock card");
        }
      } catch (error) {
        alert("Failed to unblock card");
      }
    }
  };

  const formatCardNumber = (cardNumber: string) => {
    // Format: **** **** **** 1234
    return cardNumber.replace(/(.{4})/g, "$1 ").trim();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Cards</h1>
          <p className="text-slate-500 mt-1">
            Manage your debit and credit cards
          </p>
        </div>

      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-56 bg-white rounded-2xl border border-slate-100 animate-pulse"
            />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-slate-100 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-slate-900 mb-2">
            No Cards Yet
          </h3>
          <p className="text-slate-500 mb-6">
            Issue your first card to start making transactions
          </p>

        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((card) => (
            <div key={card.id} className="group">
              {/* Card Visual */}
              <div
                className={`relative h-56 rounded-2xl bg-gradient-to-br ${getCardTypeColor(card.cardType as CardType)} p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden`}
              >
                {/* Card Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-32 translate-x-32" />
                  <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-24 -translate-x-24" />
                </div>

                {/* Card Content */}
                <div className="relative h-full flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium opacity-90 uppercase">
                        {card.cardType}
                      </p>
                      {getStatusBadge(card.status as CardStatus)}
                    </div>
                    <svg
                      className="w-10 h-10 opacity-80"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                      />
                    </svg>
                  </div>

                  <div>
                    <p className="text-xl font-mono tracking-wider mb-4">
                      {formatCardNumber(card.cardNumber)}
                    </p>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-xs opacity-75 mb-1">Card Holder</p>
                        <p className="text-sm font-semibold uppercase">
                          {card.nameOnCard}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs opacity-75 mb-1">Expires</p>
                        <p className="text-sm font-semibold">
                          {new Date(card.expiryDate).toLocaleDateString(
                            "en-US",
                            { month: "2-digit", year: "2-digit" },
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Actions */}
              <div className="mt-4 flex gap-2">
                {card.status === CardStatus.ACTIVE ? (
                  <button
                    onClick={() => handleBlockCard(card.id)}
                    className="flex-1 px-4 py-2.5 bg-red-50 text-red-700 rounded-xl font-medium hover:bg-red-100 transition-colors text-sm"
                  >
                    Block Card
                  </button>
                ) : card.status === CardStatus.BLOCKED ? (
                  <button
                    onClick={() => handleUnblockCard(card.id)}
                    className="flex-1 px-4 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl font-medium hover:bg-emerald-100 transition-colors text-sm"
                  >
                    Unblock Card
                  </button>
                ) : null}
                <Link
                  to={`/cards/${card.id}`}
                  className="flex-1 px-4 py-2.5 bg-slate-50 text-slate-700 rounded-xl font-medium hover:bg-slate-100 transition-colors text-sm text-center"
                >
                  View Details
                </Link>
              </div>

              {/* Spending Limits */}
              {card.dailyLimit && (
                <div className="mt-4 p-4 bg-white rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Daily Limit</span>
                    <span className="font-semibold text-slate-900">
                      ₦{card.dailyLimit.toLocaleString()}
                    </span>
                  </div>
                  {card.monthlyLimit && (
                    <div className="flex items-center justify-between text-sm mt-2">
                      <span className="text-slate-500">Monthly Limit</span>
                      <span className="font-semibold text-slate-900">
                        ₦{card.monthlyLimit.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick Stats */}
      {cards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <p className="text-sm text-slate-500 mb-1">Total Cards</p>
            <p className="text-2xl font-bold text-slate-900">{cards.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <p className="text-sm text-slate-500 mb-1">Active Cards</p>
            <p className="text-2xl font-bold text-emerald-600">
              {cards.filter((c) => c.status === CardStatus.ACTIVE).length}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <p className="text-sm text-slate-500 mb-1">Blocked Cards</p>
            <p className="text-2xl font-bold text-red-600">
              {cards.filter((c) => c.status === CardStatus.BLOCKED).length}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <p className="text-sm text-slate-500 mb-1">Total Daily Limit</p>
            <p className="text-2xl font-bold text-slate-900">
              ₦
              {cards
                .reduce((sum, c) => sum + (c.dailyLimit ?? 0), 0)
                .toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cards;
