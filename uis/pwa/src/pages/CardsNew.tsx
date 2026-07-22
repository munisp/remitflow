import { useCallback, useEffect, useRef, useState } from "react";
import { accountService } from "../services/accountService";
import { cardService, type Card } from "../services/cardService";

interface CardDisplay {
  id: string;
  cardNumber: string;
  cardHolder: string;
  expiryDate: string;
  cvv?: string;
  cardType: "visa" | "mastercard" | "verve";
  status: string;
}

const CardsNew = () => {
  const [showDetails, setShowDetails] = useState(false);
  const [selectedCard, setSelectedCard] = useState(0);
  const [cards, setCards] = useState<CardDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [cardType, setCardType] = useState("virtual");
  const [nameOnCard, setNameOnCard] = useState("");
  const [cardPin, setCardPin] = useState("");
  const [confirmCardPin, setConfirmCardPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  useEffect(() => {
    loadCards();
    loadUserName();
  }, []);

  const loadUserName = async () => {
    try {
      const account = await accountService.getAccountByKeycloakId();
      if (account && account.name) {
        setNameOnCard(account.name);
      }
    } catch (error) {
      console.error("Failed to load user name:", error);
    }
  };

  const handlePreviousCard = useCallback(() => {
    if (cards.length <= 1) return;
    setShowDetails(false);
    setSelectedCard((prev) => (prev === 0 ? cards.length - 1 : prev - 1));
  }, [cards.length]);

  const handleNextCard = useCallback(() => {
    if (cards.length <= 1) return;
    setShowDetails(false);
    setSelectedCard((prev) => (prev === cards.length - 1 ? 0 : prev + 1));
  }, [cards.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (cards.length <= 1) return;
      if (e.key === "ArrowLeft") handlePreviousCard();
      else if (e.key === "ArrowRight") handleNextCard();
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [handlePreviousCard, handleNextCard, cards.length]);

  // Swipe gesture handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!touchStartX.current || !touchEndX.current) return;
    const distance = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;
    if (Math.abs(distance) > minSwipeDistance) {
      if (distance > 0) handleNextCard();
      else handlePreviousCard();
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  const formatCardNumber = (cardNumber: string): string => {
    const cleaned = cardNumber.replace(/\s/g, "");
    return cleaned.replace(/(.{4})/g, "$1 ").trim();
  };

  const getLastFourDigits = (cardNumber: string): string => {
    const cleaned = cardNumber.replace(/\s/g, "").replace(/\*/g, "");
    return cleaned.length >= 4 ? cleaned.slice(-4) : "";
  };

  const getDisplayCardNumber = (
    cardNumber: string,
    showDetails: boolean,
  ): string => {
    if (!showDetails) {
      const lastFour = getLastFourDigits(cardNumber);
      return lastFour ? `**** **** **** ${lastFour}` : "**** **** **** ****";
    }
    return formatCardNumber(cardNumber);
  };

  const detectCardType = (
    cardNumber: string,
  ): "visa" | "mastercard" | "verve" => {
    const cleanNumber = cardNumber.replace(/\s/g, "").replace(/\*/g, "");
    if (cleanNumber.length > 0) {
      const firstDigit = cleanNumber.charAt(0);
      if (firstDigit === "4") return "visa";
      if (firstDigit === "5") return "mastercard";
    }
    return "verve";
  };

  const loadCards = async () => {
    try {
      setLoading(true);
      const response = await cardService.getCustomerCards();

      if (response.success && response.data) {
        const formattedCards = response.data.map((card: Card) => {
          const cardNumber =
            card.maskedCardNumber || card.cardNumber || "**** **** **** ****";
          let expiryDate = card.expiryDate || "MM/YY";

          if (
            typeof expiryDate === "string" &&
            expiryDate.match(/^\d{4}-\d{2}-\d{2}/)
          ) {
            const [year, month] = expiryDate.split("-");
            expiryDate = `${month}/${year.slice(-2)}`;
          }

          const cardHolder =
            card.nameOnCard || card.name_on_card || nameOnCard || "Card Holder";
          const formattedCardNumber = formatCardNumber(String(cardNumber));

          return {
            id: String(card.id),
            cardNumber: formattedCardNumber,
            cardHolder: String(cardHolder),
            expiryDate: String(expiryDate),
            cvv: card.cvv || undefined,
            cardType: detectCardType(String(cardNumber)),
            status: (card.status || "active").toLowerCase(),
          };
        });

        setCards(formattedCards);
        if (
          formattedCards.length > 0 &&
          selectedCard >= formattedCards.length
        ) {
          setSelectedCard(0);
        }
      }
    } catch (error) {
      console.error("Failed to load cards:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFreeze = async () => {
    if (!cards[selectedCard]) return;
    const currentCard = cards[selectedCard];
    const isFrozen =
      currentCard.status === "frozen" || currentCard.status === "freeze";

    try {
      setActionLoading(true);
      const response = isFrozen
        ? await cardService.unfreezeCard(currentCard.id)
        : await cardService.freezeCard(currentCard.id);

      if (response.success) {
        alert(response.message);
        loadCards();
      } else {
        alert(response.message);
      }
    } catch (error) {
      console.error("Failed to freeze/unfreeze card:", error);
      alert(isFrozen ? "Failed to unfreeze card" : "Failed to freeze card");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestNew = () => {
    setShowRequestModal(true);
  };

  const handleIssueCard = async () => {
    setRequestError(null);

    if (!nameOnCard.trim()) {
      setRequestError("Please enter the name on card");
      return;
    }

    if (!cardPin || cardPin.length !== 4) {
      setPinError("PIN must be 4 digits");
      return;
    }

    if (cardPin !== confirmCardPin) {
      setPinError("PINs do not match");
      return;
    }

    try {
      setActionLoading(true);
      setPinError(null);

      // Get account ID
      const account = await accountService.getAccountByKeycloakId();
      if (!account) {
        const accounts = await accountService.getAccounts();
        if (accounts.length === 0) {
          setRequestError("No account found. Please create an account first.");
          return;
        }
      }

      const accountId = String(
        account?.id || localStorage.getItem("account_id") || "",
      );
      if (!accountId) {
        setRequestError("Account ID not found.");
        return;
      }

      // Issue the card
      const response = await cardService.issueCard({
        accountId,
        cardType,
        nameOnCard: nameOnCard.trim(),
      });

      if (response.success && response.data) {
        const cardId = response.data.id;

        if (cardId) {
          try {
            const pinResponse = await cardService.setCardPin(
              String(cardId),
              cardPin,
            );
            if (pinResponse.success) {
              alert("Card issued and PIN set successfully!");
            } else {
              setRequestError(
                `Card issued, but failed to set PIN: ${pinResponse.message}`,
              );
            }
          } catch (pinError) {
            console.error("Failed to set PIN:", pinError);
            setRequestError(
              "Card issued, but failed to set PIN. Please set it manually later.",
            );
          }
        }

        setShowRequestModal(false);
        setNameOnCard("");
        setCardPin("");
        setConfirmCardPin("");
        loadCards();
      } else {
        setRequestError(response.message || "Failed to issue card");
      }
    } catch (error) {
      console.error("Failed to issue card:", error);
      setRequestError("Failed to issue card. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const renderRequestModal = () => {
    if (!showRequestModal) return null;

    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowRequestModal(false);
        }}
      >
        <div
          className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-xl font-bold text-slate-900 mb-4">
            Request New Card
          </h2>

          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Card Type
              </label>
              <select
                value={cardType}
                onChange={(e) => setCardType(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-900"
              >
                <option value="virtual">Virtual Card</option>
                <option value="debit">Debit Card</option>
                <option value="credit">Credit Card</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Name on Card *
              </label>
              <input
                type="text"
                value={nameOnCard}
                onChange={(e) => setNameOnCard(e.target.value)}
                placeholder="Enter name as it should appear on card"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Card PIN (4 digits) *
              </label>
              <input
                type="password"
                value={cardPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setCardPin(value);
                  setPinError(null);
                }}
                placeholder="0000"
                maxLength={4}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-center text-2xl tracking-widest"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Confirm PIN *
              </label>
              <input
                type="password"
                value={confirmCardPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setConfirmCardPin(value);
                  setPinError(null);
                }}
                placeholder="0000"
                maxLength={4}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-center text-2xl tracking-widest"
              />
            </div>

            {pinError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                {pinError}
              </div>
            )}
            {requestError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                {requestError}
              </div>
            )}
          </div>

          {cardType !== "virtual" && (
            <div className="bg-blue-50 rounded-xl p-4 mb-6 border border-blue-200">
              <p className="text-sm text-slate-800">
                Your new card will be delivered within 5-7 business days. You
                will receive a notification once it's ready.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setShowRequestModal(false)}
              className="flex-1 px-6 py-3 border-2 border-slate-300 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              disabled={actionLoading}
            >
              Cancel
            </button>
            <button
              onClick={handleIssueCard}
              disabled={actionLoading}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-semibold transition-all hover:shadow-lg disabled:opacity-50"
            >
              {actionLoading ? "Processing..." : "Request Card"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const currentCard = cards[selectedCard];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <>
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center px-4 py-20">
            <div className="bg-slate-100 p-8 rounded-full mb-6">
              <svg
                className="w-16 h-16 text-slate-400"
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
            <h2 className="text-2xl font-bold text-slate-900 mb-3">
              No Cards Yet
            </h2>
            <p className="text-slate-600 text-center mb-8 max-w-sm">
              You don't have any cards yet. Request a new card to start making
              payments.
            </p>
            <button
              onClick={handleRequestNew}
              className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-8 py-3 rounded-xl font-semibold transition-all hover:shadow-lg flex items-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Request New Card
            </button>
          </div>
        </div>
        {renderRequestModal()}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Cards</h1>
          <p className="text-slate-500 mt-1">Manage your payment cards</p>
        </div>
        <button
          onClick={handleRequestNew}
          className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl transition-all text-sm flex items-center gap-2"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          Request New Card
        </button>
      </div>

      {/* Card Display */}
      <div className="relative">
        <div
          ref={cardContainerRef}
          className="relative w-full max-w-md mx-auto"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {currentCard && (
            <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 text-white shadow-2xl aspect-[1.586/1] flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2" />

              <div className="flex justify-between items-start relative z-10">
                <div>
                  <p className="text-xs text-white/70">Card Type</p>
                  <p className="font-semibold capitalize">
                    {currentCard.cardType}
                  </p>
                </div>
                <span className="px-2 py-1 rounded-full text-xs bg-white/20 backdrop-blur-sm capitalize">
                  {currentCard.status}
                </span>
              </div>

              <div className="relative z-10">
                <p className="text-xl font-mono tracking-[0.2em] mb-4">
                  {getDisplayCardNumber(currentCard.cardNumber, showDetails)}
                </p>

                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs text-white/70">Card Holder</p>
                    <p className="font-semibold">{currentCard.cardHolder}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white/70">Expires</p>
                    <p className="font-mono">{currentCard.expiryDate}</p>
                  </div>
                  {showDetails && currentCard.cvv && (
                    <div className="text-right">
                      <p className="text-xs text-white/70">CVV</p>
                      <p className="font-mono">{currentCard.cvv}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          {cards.length > 1 && (
            <>
              <button
                onClick={handlePreviousCard}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 bg-white rounded-full p-2 shadow-lg hover:bg-slate-50 transition-colors"
                aria-label="Previous card"
              >
                <svg
                  className="w-6 h-6 text-slate-700"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <button
                onClick={handleNextCard}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 bg-white rounded-full p-2 shadow-lg hover:bg-slate-50 transition-colors"
                aria-label="Next card"
              >
                <svg
                  className="w-6 h-6 text-slate-700"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </>
          )}
        </div>

        {cards.length > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            {cards.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setSelectedCard(index);
                  setShowDetails(false);
                }}
                className={`w-2 h-2 rounded-full transition-all ${
                  index === selectedCard ? "bg-indigo-600 w-8" : "bg-slate-300"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Card Actions */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">
          Card Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="p-4 bg-slate-50 rounded-2xl text-center hover:bg-slate-100 transition-colors group"
          >
            <div className="w-10 h-10 bg-white rounded-xl mx-auto mb-2 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-50 transition-colors shadow-sm">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={
                    showDetails
                      ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                      : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  }
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-700">
              {showDetails ? "Hide" : "View"} Details
            </p>
          </button>

          <button
            onClick={handleFreeze}
            disabled={actionLoading}
            className="p-4 bg-slate-50 rounded-2xl text-center hover:bg-slate-100 transition-colors group disabled:opacity-50"
          >
            <div className="w-10 h-10 bg-white rounded-xl mx-auto mb-2 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-50 transition-colors shadow-sm">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-700">
              {currentCard?.status === "frozen" ? "Unfreeze" : "Freeze"}
            </p>
          </button>

          <button className="p-4 bg-slate-50 rounded-2xl text-center hover:bg-slate-100 transition-colors group">
            <div className="w-10 h-10 bg-white rounded-xl mx-auto mb-2 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-50 transition-colors shadow-sm">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-700">Settings</p>
          </button>

          <button className="p-4 bg-slate-50 rounded-2xl text-center hover:bg-slate-100 transition-colors group">
            <div className="w-10 h-10 bg-white rounded-xl mx-auto mb-2 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-50 transition-colors shadow-sm">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-700">Statement</p>
          </button>
        </div>
      </div>

      {renderRequestModal()}
    </div>
  );
};

export default CardsNew;
