import { useState, useEffect } from 'react';
import { apiGet } from '../api/api';

export interface FormalizationStats {
  totalInformalUsers: number;
  formalizedThisMonth: number;
  conversionRate: number;
  pendingKyc: number;
}

export function useFormalizationDashboard() {
  const [stats, setStats] = useState<FormalizationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<FormalizationStats>('/api/trpc/formalization.getDashboard')
      .then(setStats)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { stats, loading, error };
}
