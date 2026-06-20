/**
 * Locale-aware currency formatting utilities.
 * Uses Intl.NumberFormat for proper symbol placement, grouping, and decimal handling.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦", USD: "$", GBP: "£", EUR: "€", KES: "KSh", GHS: "₵",
  ZAR: "R", TZS: "TSh", UGX: "USh", XOF: "CFA", XAF: "FCFA",
  EGP: "E£", MAD: "MAD", ETB: "Br", RWF: "FRw", MWK: "MK",
  CNY: "¥", CNH: "¥", BRL: "R$", INR: "₹", CAD: "C$", AUD: "A$",
  JPY: "¥", HKD: "HK$", SGD: "S$", CHF: "CHF", SEK: "kr", MXN: "$",
};

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: "en-NG", USD: "en-US", GBP: "en-GB", EUR: "de-DE", KES: "en-KE",
  GHS: "en-GH", ZAR: "en-ZA", XOF: "fr-SN", XAF: "fr-CM",
  CNY: "zh-CN", CNH: "zh-CN", BRL: "pt-BR", INR: "en-IN", CAD: "en-CA",
  AUD: "en-AU", JPY: "ja-JP", HKD: "zh-HK", SGD: "en-SG", MXN: "es-MX",
};

/**
 * Format a number as currency with proper locale and symbol placement.
 * @example formatCurrency(1500000, "NGN") → "₦1,500,000.00"
 * @example formatCurrency(1234.5, "USD") → "$1,234.50"
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string = "NGN",
  options?: { compact?: boolean; hideSymbol?: boolean; decimals?: number }
): string {
  const num = Number(amount ?? 0);
  if (isNaN(num)) return `${CURRENCY_SYMBOLS[currency] ?? currency} 0.00`;

  const locale = CURRENCY_LOCALES[currency] ?? "en-US";

  if (options?.compact && Math.abs(num) >= 1000) {
    const formatter = new Intl.NumberFormat(locale, {
      style: options.hideSymbol ? "decimal" : "currency",
      currency: currency,
      notation: "compact",
      maximumFractionDigits: 1,
    });
    return formatter.format(num);
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: options?.hideSymbol ? "decimal" : "currency",
    currency: currency,
    minimumFractionDigits: options?.decimals ?? 2,
    maximumFractionDigits: options?.decimals ?? 2,
  });
  return formatter.format(num);
}

/**
 * Get just the currency symbol.
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

/**
 * Format a number with locale-aware grouping (no currency symbol).
 */
export function formatNumber(
  amount: number | string | null | undefined,
  locale: string = "en-US"
): string {
  const num = Number(amount ?? 0);
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat(locale).format(num);
}
