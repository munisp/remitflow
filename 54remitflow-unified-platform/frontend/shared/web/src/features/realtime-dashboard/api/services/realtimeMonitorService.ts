/**
 * Real-time Monitor API Service
 * Nigerian Remittance Platform
 */

import axios from 'axios';
import {
  DashboardMetrics,
  Transaction,
  Alert,
  PaginatedResponse,
  ApiResponse,
  DashboardFilters
} from '../../types/dashboard';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired, redirect to login
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const realtimeMonitorService = {
  /**
   * Get current dashboard metrics
   */
  getMetrics: async (): Promise<DashboardMetrics> => {
    const response = await apiClient.get<ApiResponse<DashboardMetrics>>(
      '/api/v1/realtime-monitor/stats'
    );
    return response.data.data;
  },

  /**
   * Get active transactions
   */
  getActiveTransactions: async (
    page: number = 1,
    pageSize: number = 20
  ): Promise<PaginatedResponse<Transaction>> => {
    const response = await apiClient.get<PaginatedResponse<Transaction>>(
      '/api/v1/realtime-monitor',
      {
        params: {
          status: 'active',
          page,
          page_size: pageSize
        }
      }
    );
    return response.data;
  },

  /**
   * Get recent transactions with filters
   */
  getRecentTransactions: async (
    filters?: DashboardFilters,
    page: number = 1,
    pageSize: number = 50
  ): Promise<PaginatedResponse<Transaction>> => {
    const response = await apiClient.get<PaginatedResponse<Transaction>>(
      '/api/v1/realtime-monitor',
      {
        params: {
          ...filters,
          page,
          page_size: pageSize,
          sort: '-created_at' // Sort by newest first
        }
      }
    );
    return response.data;
  },

  /**
   * Get transaction by ID
   */
  getTransaction: async (id: string): Promise<Transaction> => {
    const response = await apiClient.get<ApiResponse<Transaction>>(
      `/api/v1/realtime-monitor/${id}`
    );
    return response.data.data;
  },

  /**
   * Get active alerts
   */
  getAlerts: async (
    acknowledged: boolean = false,
    page: number = 1,
    pageSize: number = 20
  ): Promise<PaginatedResponse<Alert>> => {
    const response = await apiClient.get<PaginatedResponse<Alert>>(
      '/api/v1/realtime-monitor/alerts',
      {
        params: {
          acknowledged,
          page,
          page_size: pageSize,
          sort: '-timestamp'
        }
      }
    );
    return response.data;
  },

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert: async (alertId: string): Promise<Alert> => {
    const response = await apiClient.put<ApiResponse<Alert>>(
      `/api/v1/realtime-monitor/alerts/${alertId}/acknowledge`
    );
    return response.data.data;
  },

  /**
   * Get system health status
   */
  getSystemHealth: async (): Promise<any> => {
    const response = await apiClient.get('/api/v1/realtime-monitor/health');
    return response.data;
  },

  /**
   * Export transactions to CSV
   */
  exportTransactions: async (filters?: DashboardFilters): Promise<Blob> => {
    const response = await apiClient.get(
      '/api/v1/realtime-monitor/export',
      {
        params: filters,
        responseType: 'blob'
      }
    );
    return response.data;
  }
};
