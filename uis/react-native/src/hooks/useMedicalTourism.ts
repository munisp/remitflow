import { useState, useEffect } from 'react';
import { apiGet } from '../api/api';

export interface MedicalTourismPayment {
  id: string;
  hospital: string;
  country: string;
  amountUsd: number;
  status: string;
  createdAt: string;
}

export function useMedicalTourism() {
  const [payments, setPayments] = useState<MedicalTourismPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<MedicalTourismPayment[]>('/api/trpc/outbound.getMedicalTourismPayments')
      .then(setPayments)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { payments, loading, error };
}
