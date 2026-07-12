import { useState, useEffect } from 'react';
import { apiGet } from '../api/api';

export interface EducationPayment {
  id: string;
  institution: string;
  amountUsd: number;
  currency: string;
  status: string;
  createdAt: string;
}

export function useEducationPayments() {
  const [payments, setPayments] = useState<EducationPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<EducationPayment[]>('/api/trpc/outbound.getEducationPayments')
      .then(setPayments)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { payments, loading, error };
}
