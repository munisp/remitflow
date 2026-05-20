import { useState } from 'react';
import { apiPost } from '../api/api';

export interface QuoteResult {
  fromAmount: number;
  toAmount: number;
  fxRate: number;
  fee: number;
  deliveryTime: string;
  purposeCode: string;
}

export function useSendFromNigeria() {
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getQuote = async (params: {
    fromAmountNgn: number;
    toCurrency: string;
    purposeCode: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiPost<QuoteResult>('/api/trpc/outbound.getQuote', params);
      setQuote(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return { quote, loading, error, getQuote };
}
