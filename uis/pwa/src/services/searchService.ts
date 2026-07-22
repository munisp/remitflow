/**
 * OpenSearch Integration Service
 * Connects PWA frontend to the unified search service endpoints
 */

import { api } from './api';

// Search Configuration
const SEARCH_BASE_URL = import.meta.env.VITE_SEARCH_API_URL || '/api/search';

// Search Types
export type SearchIndex = 
  | 'transactions'
  | 'users'
  | 'beneficiaries'
  | 'disputes'
  | 'audit_logs'
  | 'kyc'
  | 'wallets'
  | 'cards'
  | 'bills'
  | 'airtime';

export interface SearchQuery {
  query: string;
  index?: SearchIndex | SearchIndex[];
  filters?: SearchFilters;
  sort?: SearchSort;
  pagination?: SearchPagination;
  highlight?: boolean;
  aggregations?: string[];
}

export interface SearchFilters {
  dateRange?: {
    field: string;
    from?: string;
    to?: string;
  };
  status?: string | string[];
  type?: string | string[];
  currency?: string;
  amountRange?: {
    min?: number;
    max?: number;
  };
  userId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

export interface SearchSort {
  field: string;
  order: 'asc' | 'desc';
}

export interface SearchPagination {
  page: number;
  size: number;
}

export interface SearchHit<T = unknown> {
  id: string;
  index: string;
  score: number;
  source: T;
  highlight?: Record<string, string[]>;
}

export interface SearchAggregation {
  key: string;
  doc_count: number;
}

export interface SearchResponse<T = unknown> {
  hits: SearchHit<T>[];
  total: number;
  took: number;
  aggregations?: Record<string, SearchAggregation[]>;
  suggestions?: string[];
}

// Transaction Search Types
export interface TransactionSearchResult {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  reference: string;
  description?: string;
  recipient?: string;
  sender?: string;
  createdAt: string;
  completedAt?: string;
}

// User Search Types
export interface UserSearchResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  kycTier: string;
  createdAt: string;
}

// Beneficiary Search Types
export interface BeneficiarySearchResult {
  id: string;
  name: string;
  type: 'phone' | 'email' | 'bank';
  identifier: string;
  bank?: string;
  accountNumber?: string;
  country: string;
  currency: string;
  lastUsed?: string;
}

// Dispute Search Types
export interface DisputeSearchResult {
  id: string;
  transactionId: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  createdAt: string;
  resolvedAt?: string;
}

// Audit Log Search Types
export interface AuditLogSearchResult {
  id: string;
  eventType: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

// KYC Search Types
export interface KYCSearchResult {
  id: string;
  userId: string;
  tier: string;
  status: string;
  firstName?: string;
  lastName?: string;
  bvnVerified: boolean;
  documentStatus: string;
  createdAt: string;
  updatedAt: string;
}

// Search Service
export const searchService = {
  /**
   * Unified search across all indices
   */
  search: async <T = unknown>(query: SearchQuery): Promise<SearchResponse<T>> => {
    const response = await api.post<SearchResponse<T>>(`${SEARCH_BASE_URL}/unified`, query);
    return response.data;
  },

  /**
   * Search transactions
   */
  searchTransactions: async (
    query: string,
    filters?: SearchFilters,
    pagination?: SearchPagination
  ): Promise<SearchResponse<TransactionSearchResult>> => {
    const response = await api.post<SearchResponse<TransactionSearchResult>>(
      `${SEARCH_BASE_URL}/transactions`,
      { query, filters, pagination }
    );
    return response.data;
  },

  /**
   * Search users (admin only)
   */
  searchUsers: async (
    query: string,
    filters?: SearchFilters,
    pagination?: SearchPagination
  ): Promise<SearchResponse<UserSearchResult>> => {
    const response = await api.post<SearchResponse<UserSearchResult>>(
      `${SEARCH_BASE_URL}/users`,
      { query, filters, pagination }
    );
    return response.data;
  },

  /**
   * Search beneficiaries
   */
  searchBeneficiaries: async (
    query: string,
    filters?: SearchFilters,
    pagination?: SearchPagination
  ): Promise<SearchResponse<BeneficiarySearchResult>> => {
    const response = await api.post<SearchResponse<BeneficiarySearchResult>>(
      `${SEARCH_BASE_URL}/beneficiaries`,
      { query, filters, pagination }
    );
    return response.data;
  },

  /**
   * Search disputes
   */
  searchDisputes: async (
    query: string,
    filters?: SearchFilters,
    pagination?: SearchPagination
  ): Promise<SearchResponse<DisputeSearchResult>> => {
    const response = await api.post<SearchResponse<DisputeSearchResult>>(
      `${SEARCH_BASE_URL}/disputes`,
      { query, filters, pagination }
    );
    return response.data;
  },

  /**
   * Search audit logs (admin/compliance only)
   */
  searchAuditLogs: async (
    query: string,
    filters?: SearchFilters,
    pagination?: SearchPagination
  ): Promise<SearchResponse<AuditLogSearchResult>> => {
    const response = await api.post<SearchResponse<AuditLogSearchResult>>(
      `${SEARCH_BASE_URL}/audit-logs`,
      { query, filters, pagination }
    );
    return response.data;
  },

  /**
   * Search KYC records (admin/compliance only)
   */
  searchKYC: async (
    query: string,
    filters?: SearchFilters,
    pagination?: SearchPagination
  ): Promise<SearchResponse<KYCSearchResult>> => {
    const response = await api.post<SearchResponse<KYCSearchResult>>(
      `${SEARCH_BASE_URL}/kyc`,
      { query, filters, pagination }
    );
    return response.data;
  },

  /**
   * Get search suggestions (autocomplete)
   */
  getSuggestions: async (
    query: string,
    index?: SearchIndex | SearchIndex[]
  ): Promise<string[]> => {
    const response = await api.get<{ suggestions: string[] }>(
      `${SEARCH_BASE_URL}/suggestions?q=${encodeURIComponent(query)}${index ? `&index=${Array.isArray(index) ? index.join(',') : index}` : ''}`
    );
    return response.data.suggestions;
  },

  /**
   * Get recent searches for current user
   */
  getRecentSearches: async (): Promise<string[]> => {
    const response = await api.get<{ searches: string[] }>(`${SEARCH_BASE_URL}/recent`);
    return response.data.searches;
  },

  /**
   * Save a search to recent searches
   */
  saveRecentSearch: async (query: string, index?: SearchIndex): Promise<void> => {
    await api.post(`${SEARCH_BASE_URL}/recent`, { query, index });
  },

  /**
   * Clear recent searches
   */
  clearRecentSearches: async (): Promise<void> => {
    await api.delete(`${SEARCH_BASE_URL}/recent`);
  },

  /**
   * Get search analytics (admin only)
   */
  getSearchAnalytics: async (
    dateRange?: { from: string; to: string }
  ): Promise<{
    totalSearches: number;
    topQueries: Array<{ query: string; count: number }>;
    searchesByIndex: Record<string, number>;
    averageResponseTime: number;
  }> => {
    const params = dateRange
      ? `?from=${dateRange.from}&to=${dateRange.to}`
      : '';
    const response = await api.get<{
      totalSearches: number;
      topQueries: Array<{ query: string; count: number }>;
      searchesByIndex: Record<string, number>;
      averageResponseTime: number;
    }>(`${SEARCH_BASE_URL}/analytics${params}`);
    return response.data;
  },
};

// Search Hooks for React components
import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseSearchOptions {
  index?: SearchIndex | SearchIndex[];
  debounceMs?: number;
  minQueryLength?: number;
  initialFilters?: SearchFilters;
  pageSize?: number;
}

export interface UseSearchResult<T> {
  query: string;
  setQuery: (query: string) => void;
  results: SearchHit<T>[];
  total: number;
  isLoading: boolean;
  error: Error | null;
  page: number;
  setPage: (page: number) => void;
  filters: SearchFilters;
  setFilters: (filters: SearchFilters) => void;
  suggestions: string[];
  aggregations: Record<string, SearchAggregation[]>;
  search: () => Promise<void>;
  reset: () => void;
}

export function useSearch<T = unknown>(
  options: UseSearchOptions = {}
): UseSearchResult<T> {
  const {
    index,
    debounceMs = 300,
    minQueryLength = 2,
    initialFilters = {},
    pageSize = 20,
  } = options;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit<T>[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [aggregations, setAggregations] = useState<Record<string, SearchAggregation[]>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async () => {
    if (query.length < minQueryLength) {
      setResults([]);
      setTotal(0);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await searchService.search<T>({
        query,
        index,
        filters,
        pagination: { page, size: pageSize },
        highlight: true,
      });

      setResults(response.hits);
      setTotal(response.total);
      setAggregations(response.aggregations || {});

      // Save to recent searches
      await searchService.saveRecentSearch(query, Array.isArray(index) ? index[0] : index);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Search failed'));
      setResults([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [query, index, filters, page, pageSize, minQueryLength]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length >= minQueryLength) {
      debounceRef.current = setTimeout(() => {
        search();
      }, debounceMs);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, search, debounceMs, minQueryLength]);

  // Fetch suggestions
  useEffect(() => {
    if (query.length >= 2) {
      searchService.getSuggestions(query, index).then(setSuggestions).catch(() => {});
    } else {
      setSuggestions([]);
    }
  }, [query, index]);

  const reset = useCallback(() => {
    setQuery('');
    setResults([]);
    setTotal(0);
    setPage(1);
    setFilters(initialFilters);
    setSuggestions([]);
    setAggregations({});
    setError(null);
  }, [initialFilters]);

  return {
    query,
    setQuery,
    results,
    total,
    isLoading,
    error,
    page,
    setPage,
    filters,
    setFilters,
    suggestions,
    aggregations,
    search,
    reset,
  };
}

// Transaction-specific search hook
export function useTransactionSearch(initialFilters?: SearchFilters) {
  return useSearch<TransactionSearchResult>({
    index: 'transactions',
    initialFilters,
    pageSize: 20,
  });
}

// Beneficiary-specific search hook
export function useBeneficiarySearch(initialFilters?: SearchFilters) {
  return useSearch<BeneficiarySearchResult>({
    index: 'beneficiaries',
    initialFilters,
    pageSize: 50,
  });
}

// Dispute-specific search hook
export function useDisputeSearch(initialFilters?: SearchFilters) {
  return useSearch<DisputeSearchResult>({
    index: 'disputes',
    initialFilters,
    pageSize: 20,
  });
}

// Audit log-specific search hook
export function useAuditLogSearch(initialFilters?: SearchFilters) {
  return useSearch<AuditLogSearchResult>({
    index: 'audit_logs',
    initialFilters,
    pageSize: 50,
  });
}

export default searchService;
