import { useState, useEffect } from 'react';
import { apiGet } from '../api/api';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  kycTier: number;
  role: string;
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<UserProfile>('/api/trpc/user.getProfile')
      .then(setProfile)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { profile, loading, error };
}
