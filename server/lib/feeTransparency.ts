/**
 * Fee transparency and delivery speed options — P1 Business 9.3 + 9.4
 */

interface FeeBreakdown {
  transferFee: number;
  fxMarkup: number;
  fxMarkupPct: number;
  networkFee: number;
  totalFee: number;
  totalCost: number;
  savingsVsCompetitor: number;
  savingsPct: number;
  midMarketRate: number;
  appliedRate: number;
}

interface DeliveryOption {
  speed: "instant" | "standard" | "economy";
  label: string;
  estimatedMinutes: number;
  estimatedDisplay: string;
  additionalFee: number;
  totalFee: number;
  available: boolean;
}

const COMPETITOR_AVG_FEE_PCT: Record<string, number> = {
  "USD-NGN": 4.5,
  "GBP-NGN": 3.8,
  "EUR-NGN": 4.2,
  "USD-KES": 5.0,
  "GBP-KES": 4.5,
  "USD-GHS": 4.8,
  default: 5.0,
};

const DELIVERY_SPEEDS: Record<string, { instant: number; standard: number; economy: number }> = {
  "USD-NGN": { instant: 5, standard: 120, economy: 1440 },
  "GBP-NGN": { instant: 10, standard: 180, economy: 2880 },
  "EUR-NGN": { instant: 15, standard: 240, economy: 4320 },
  "USD-KES": { instant: 5, standard: 60, economy: 480 },
  "USD-GHS": { instant: 10, standard: 120, economy: 1440 },
  default: { instant: 15, standard: 240, economy: 4320 },
};

export function calculateFeeBreakdown(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  baseFee: number,
  midMarketRate: number,
  appliedRate: number
): FeeBreakdown {
  const fxMarkup = Math.abs(midMarketRate - appliedRate) / midMarketRate;
  const fxMarkupAmount = amount * fxMarkup;
  const networkFee = amount > 1000 ? 0 : 0.5;
  const totalFee = baseFee + fxMarkupAmount + networkFee;
  const totalCost = amount + totalFee;

  const corridor = `${fromCurrency}-${toCurrency}`;
  const competitorFeePct = COMPETITOR_AVG_FEE_PCT[corridor] ?? COMPETITOR_AVG_FEE_PCT.default;
  const competitorFee = amount * (competitorFeePct / 100);
  const savings = Math.max(0, competitorFee - totalFee);

  return {
    transferFee: Math.round(baseFee * 100) / 100,
    fxMarkup: Math.round(fxMarkupAmount * 100) / 100,
    fxMarkupPct: Math.round(fxMarkup * 10000) / 100,
    networkFee,
    totalFee: Math.round(totalFee * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    savingsVsCompetitor: Math.round(savings * 100) / 100,
    savingsPct: Math.round((savings / competitorFee) * 10000) / 100,
    midMarketRate,
    appliedRate,
  };
}

export function getDeliveryOptions(
  fromCurrency: string,
  toCurrency: string,
  baseFee: number
): DeliveryOption[] {
  const corridor = `${fromCurrency}-${toCurrency}`;
  const speeds = DELIVERY_SPEEDS[corridor] ?? DELIVERY_SPEEDS.default;

  function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} minutes`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} hours`;
    return `${Math.round(minutes / 1440)} days`;
  }

  return [
    {
      speed: "instant",
      label: "Instant",
      estimatedMinutes: speeds.instant,
      estimatedDisplay: formatDuration(speeds.instant),
      additionalFee: baseFee * 0.5,
      totalFee: Math.round(baseFee * 1.5 * 100) / 100,
      available: true,
    },
    {
      speed: "standard",
      label: "Standard",
      estimatedMinutes: speeds.standard,
      estimatedDisplay: formatDuration(speeds.standard),
      additionalFee: 0,
      totalFee: Math.round(baseFee * 100) / 100,
      available: true,
    },
    {
      speed: "economy",
      label: "Economy",
      estimatedMinutes: speeds.economy,
      estimatedDisplay: formatDuration(speeds.economy),
      additionalFee: -(baseFee * 0.3),
      totalFee: Math.round(baseFee * 0.7 * 100) / 100,
      available: true,
    },
  ];
}
