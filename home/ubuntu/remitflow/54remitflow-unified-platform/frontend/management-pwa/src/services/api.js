import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_data');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// API endpoints
export const agentApi = {
  list: (params) => api.get('/agents', { params }),
  get: (id) => api.get(`/agents/${id}`),
  create: (data) => api.post('/agents', data),
  update: (id, data) => api.put(`/agents/${id}`, data),
  delete: (id) => api.delete(`/agents/${id}`),
  hierarchy: (id) => api.get(`/agents/${id}/hierarchy`),
};

export const transactionApi = {
  list: (params) => api.get('/transactions', { params }),
  get: (id) => api.get(`/transactions/${id}`),
  stats: () => api.get('/transactions/stats'),
};

export const posApi = {
  list: (params) => api.get('/pos/terminals', { params }),
  get: (id) => api.get(`/pos/terminals/${id}`),
  transactions: (id, params) => api.get(`/pos/terminals/${id}/transactions`, { params }),
  status: () => api.get('/pos/status'),
};

export const qrApi = {
  list: (params) => api.get('/qr-codes', { params }),
  generate: (data) => api.post('/qr-codes/generate', data),
  validate: (code) => api.post('/qr-codes/validate', { code }),
  stats: () => api.get('/qr-codes/stats'),
};

export const tigerBeetleApi = {
  status: () => api.get('/tigerbeetle/status'),
  syncStatus: () => api.get('/tigerbeetle/sync/status'),
  accounts: (params) => api.get('/tigerbeetle/accounts', { params }),
  transfers: (params) => api.get('/tigerbeetle/transfers', { params }),
  triggerSync: () => api.post('/tigerbeetle/sync/trigger'),
};

export const fluvioApi = {
  status: () => api.get('/fluvio/status'),
  topics: () => api.get('/fluvio/topics'),
  consumers: () => api.get('/fluvio/consumers'),
  metrics: () => api.get('/fluvio/metrics'),
};

export const inventoryApi = {
  products: (params) => api.get('/inventory/products', { params }),
  warehouses: () => api.get('/inventory/warehouses'),
  stock: (productId) => api.get(`/inventory/products/${productId}/stock`),
  movements: (params) => api.get('/inventory/movements', { params }),
};

export const commissionApi = {
  rules: () => api.get('/commissions/rules'),
  calculate: (data) => api.post('/commissions/calculate', data),
  settlements: (params) => api.get('/commissions/settlements', { params }),
  stats: () => api.get('/commissions/stats'),
};

export const kycApi = {
  list: (params) => api.get('/kyc/applications', { params }),
  get: (id) => api.get(`/kyc/applications/${id}`),
  approve: (id) => api.post(`/kyc/applications/${id}/approve`),
  reject: (id, reason) => api.post(`/kyc/applications/${id}/reject`, { reason }),
  stats: () => api.get('/kyc/stats'),
};

export const analyticsApi = {
  overview: () => api.get('/analytics/overview'),
  transactions: (params) => api.get('/analytics/transactions', { params }),
  agents: (params) => api.get('/analytics/agents', { params }),
  revenue: (params) => api.get('/analytics/revenue', { params }),
};

export const healthApi = {
  status: () => api.get('/health'),
  services: () => api.get('/health/services'),
  metrics: () => api.get('/health/metrics'),
};
