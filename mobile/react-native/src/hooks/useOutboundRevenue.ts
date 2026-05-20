import { useState, useEffect } from 'react';
import { apiGet } from '../api/api';

export interface OutboundRevenueModel {
  totalVolumeUsd: number;
  feeIncome: number;
  fxSpread: number;
  floatIncome: number;
  totalRevenue: number;
}

export function useOutboundRevenue() {
  const [model, setModel] = useState<OutboundRevenueModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<OutboundRevenueModel>('/api/trpc/outbound.getRevenueModel')
      .then(setModel)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { model, loading, error };
}
