/**
 * Real API Service - Wires PWA to actual backend endpoints
 * Replaces all mock/placeholder data with real API calls
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api';
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL || 'http://localhost:8080/auth';

// Token management
let accessToken = localStorage.getItem('access_token');
let refreshToken = localStorage.getItem('refresh_token');

const setTokens = (access, refresh) => {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
};

const clearTokens = () => {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
};

// Base fetch with authentication and error handling
const apiFetch = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    // Handle 401 - try to refresh token
    if (response.status === 401 && refreshToken) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${accessToken}`;
        return fetch(url, { ...options, headers });
      }
    }
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `API Error: ${response.status}`);
    }
    
    return response.json();
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
};

const refreshAccessToken = async () => {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    
    if (response.ok) {
      const data = await response.json();
      setTokens(data.access_token, data.refresh_token);
      return true;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }
  
  clearTokens();
  window.location.href = '/login';
  return false;
};

// ============================================
// Authentication API
// ============================================

export const authApi = {
  login: async (email, password) => {
    const response = await fetch(`${AUTH_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Login failed');
    }
    
    const data = await response.json();
    setTokens(data.access_token, data.refresh_token);
    return data;
  },
  
  logout: async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      clearTokens();
    }
  },
  
  getCurrentUser: () => apiFetch('/auth/me'),
  
  changePassword: (currentPassword, newPassword) =>
    apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
};

// ============================================
// Dashboard API
// ============================================

export const dashboardApi = {
  getStats: () => apiFetch('/dashboard/stats'),
  
  getRecentTransactions: (limit = 10) =>
    apiFetch(`/dashboard/transactions/recent?limit=${limit}`),
  
  getAlerts: () => apiFetch('/dashboard/alerts'),
  
  getPerformanceMetrics: (period = '24h') =>
    apiFetch(`/dashboard/metrics?period=${period}`),
  
  getAgentActivity: () => apiFetch('/dashboard/agent-activity'),
};

// ============================================
// Agent Management API
// ============================================

export const agentApi = {
  list: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/agents?${query}`);
  },
  
  get: (agentId) => apiFetch(`/agents/${agentId}`),
  
  create: (agentData) =>
    apiFetch('/agents', {
      method: 'POST',
      body: JSON.stringify(agentData),
    }),
  
  update: (agentId, agentData) =>
    apiFetch(`/agents/${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(agentData),
    }),
  
  delete: (agentId) =>
    apiFetch(`/agents/${agentId}`, { method: 'DELETE' }),
  
  activate: (agentId) =>
    apiFetch(`/agents/${agentId}/activate`, { method: 'POST' }),
  
  suspend: (agentId, reason) =>
    apiFetch(`/agents/${agentId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  getHierarchy: (agentId) =>
    apiFetch(`/agents/${agentId}/hierarchy`),
  
  getPerformance: (agentId, period = '30d') =>
    apiFetch(`/agents/${agentId}/performance?period=${period}`),
  
  updateLimits: (agentId, limits) =>
    apiFetch(`/agents/${agentId}/limits`, {
      method: 'PUT',
      body: JSON.stringify(limits),
    }),
};

// ============================================
// Transaction API
// ============================================

export const transactionApi = {
  list: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/transactions?${query}`);
  },
  
  get: (transactionId) => apiFetch(`/transactions/${transactionId}`),
  
  getByAgent: (agentId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/agents/${agentId}/transactions?${query}`);
  },
  
  reverse: (transactionId, reason) =>
    apiFetch(`/transactions/${transactionId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  getStats: (period = '24h') =>
    apiFetch(`/transactions/stats?period=${period}`),
  
  export: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/transactions/export?${query}`);
  },
};

// ============================================
// POS Management API
// ============================================

export const posApi = {
  listTerminals: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/pos/terminals?${query}`);
  },
  
  getTerminal: (terminalId) => apiFetch(`/pos/terminals/${terminalId}`),
  
  registerTerminal: (terminalData) =>
    apiFetch('/pos/terminals', {
      method: 'POST',
      body: JSON.stringify(terminalData),
    }),
  
  updateTerminal: (terminalId, terminalData) =>
    apiFetch(`/pos/terminals/${terminalId}`, {
      method: 'PUT',
      body: JSON.stringify(terminalData),
    }),
  
  deactivateTerminal: (terminalId, reason) =>
    apiFetch(`/pos/terminals/${terminalId}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  getTerminalTransactions: (terminalId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/pos/terminals/${terminalId}/transactions?${query}`);
  },
  
  getTerminalHealth: (terminalId) =>
    apiFetch(`/pos/terminals/${terminalId}/health`),
  
  pushUpdate: (terminalId, updateData) =>
    apiFetch(`/pos/terminals/${terminalId}/update`, {
      method: 'POST',
      body: JSON.stringify(updateData),
    }),
};

// ============================================
// QR Code Management API
// ============================================

export const qrApi = {
  list: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/qr/codes?${query}`);
  },
  
  get: (qrId) => apiFetch(`/qr/codes/${qrId}`),
  
  generate: (qrData) =>
    apiFetch('/qr/codes', {
      method: 'POST',
      body: JSON.stringify(qrData),
    }),
  
  revoke: (qrId, reason) =>
    apiFetch(`/qr/codes/${qrId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  getTransactions: (qrId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/qr/codes/${qrId}/transactions?${query}`);
  },
  
  getStats: () => apiFetch('/qr/stats'),
};

// ============================================
// TigerBeetle Sync API
// ============================================

export const tigerBeetleApi = {
  getSyncStatus: () => apiFetch('/tigerbeetle/sync/status'),
  
  getEdgeNodes: () => apiFetch('/tigerbeetle/edges'),
  
  getEdgeStatus: (edgeId) => apiFetch(`/tigerbeetle/edges/${edgeId}`),
  
  triggerSync: (edgeId) =>
    apiFetch(`/tigerbeetle/edges/${edgeId}/sync`, { method: 'POST' }),
  
  getConflicts: () => apiFetch('/tigerbeetle/conflicts'),
  
  resolveConflict: (conflictId, resolution) =>
    apiFetch(`/tigerbeetle/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    }),
  
  getReconciliationStatus: () => apiFetch('/tigerbeetle/reconciliation'),
  
  triggerReconciliation: () =>
    apiFetch('/tigerbeetle/reconciliation', { method: 'POST' }),
  
  getAccounts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/tigerbeetle/accounts?${query}`);
  },
  
  getTransfers: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/tigerbeetle/transfers?${query}`);
  },
};

// ============================================
// Fluvio Streaming API
// ============================================

export const fluvioApi = {
  getStatus: () => apiFetch('/fluvio/status'),
  
  getTopics: () => apiFetch('/fluvio/topics'),
  
  getTopicDetails: (topicName) => apiFetch(`/fluvio/topics/${topicName}`),
  
  getConsumerGroups: () => apiFetch('/fluvio/consumer-groups'),
  
  getConsumerLag: (groupId) =>
    apiFetch(`/fluvio/consumer-groups/${groupId}/lag`),
  
  getMetrics: (period = '1h') =>
    apiFetch(`/fluvio/metrics?period=${period}`),
  
  getRecentEvents: (topicName, limit = 100) =>
    apiFetch(`/fluvio/topics/${topicName}/events?limit=${limit}`),
};

// ============================================
// Inventory Management API
// ============================================

export const inventoryApi = {
  getProducts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/inventory/products?${query}`);
  },
  
  getProduct: (productId) => apiFetch(`/inventory/products/${productId}`),
  
  createProduct: (productData) =>
    apiFetch('/inventory/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    }),
  
  updateProduct: (productId, productData) =>
    apiFetch(`/inventory/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(productData),
    }),
  
  getStockLevels: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/inventory/stock?${query}`);
  },
  
  adjustStock: (productId, adjustment) =>
    apiFetch(`/inventory/products/${productId}/adjust`, {
      method: 'POST',
      body: JSON.stringify(adjustment),
    }),
  
  getWarehouses: () => apiFetch('/inventory/warehouses'),
  
  getWarehouseStock: (warehouseId) =>
    apiFetch(`/inventory/warehouses/${warehouseId}/stock`),
  
  createTransfer: (transferData) =>
    apiFetch('/inventory/transfers', {
      method: 'POST',
      body: JSON.stringify(transferData),
    }),
  
  getLowStockAlerts: () => apiFetch('/inventory/alerts/low-stock'),
};

// ============================================
// Commission Management API
// ============================================

export const commissionApi = {
  getRules: () => apiFetch('/commissions/rules'),
  
  getRule: (ruleId) => apiFetch(`/commissions/rules/${ruleId}`),
  
  createRule: (ruleData) =>
    apiFetch('/commissions/rules', {
      method: 'POST',
      body: JSON.stringify(ruleData),
    }),
  
  updateRule: (ruleId, ruleData) =>
    apiFetch(`/commissions/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(ruleData),
    }),
  
  deleteRule: (ruleId) =>
    apiFetch(`/commissions/rules/${ruleId}`, { method: 'DELETE' }),
  
  getAgentCommissions: (agentId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/agents/${agentId}/commissions?${query}`);
  },
  
  getPayouts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/commissions/payouts?${query}`);
  },
  
  processPayout: (payoutId) =>
    apiFetch(`/commissions/payouts/${payoutId}/process`, { method: 'POST' }),
  
  getCommissionStats: (period = '30d') =>
    apiFetch(`/commissions/stats?period=${period}`),
};

// ============================================
// KYC Management API
// ============================================

export const kycApi = {
  getApplications: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/kyc/applications?${query}`);
  },
  
  getApplication: (applicationId) =>
    apiFetch(`/kyc/applications/${applicationId}`),
  
  approveApplication: (applicationId, notes) =>
    apiFetch(`/kyc/applications/${applicationId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  
  rejectApplication: (applicationId, reason) =>
    apiFetch(`/kyc/applications/${applicationId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  requestDocuments: (applicationId, documentTypes) =>
    apiFetch(`/kyc/applications/${applicationId}/request-documents`, {
      method: 'POST',
      body: JSON.stringify({ document_types: documentTypes }),
    }),
  
  getDocuments: (applicationId) =>
    apiFetch(`/kyc/applications/${applicationId}/documents`),
  
  verifyDocument: (documentId, verificationResult) =>
    apiFetch(`/kyc/documents/${documentId}/verify`, {
      method: 'POST',
      body: JSON.stringify(verificationResult),
    }),
  
  getStats: () => apiFetch('/kyc/stats'),
  
  getAuditLog: (applicationId) =>
    apiFetch(`/kyc/applications/${applicationId}/audit-log`),
};

// ============================================
// Analytics API
// ============================================

export const analyticsApi = {
  getOverview: (period = '30d') =>
    apiFetch(`/analytics/overview?period=${period}`),
  
  getTransactionAnalytics: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/analytics/transactions?${query}`);
  },
  
  getAgentAnalytics: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/analytics/agents?${query}`);
  },
  
  getRevenueAnalytics: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/analytics/revenue?${query}`);
  },
  
  getGeographicAnalytics: () => apiFetch('/analytics/geographic'),
  
  getCustomReport: (reportConfig) =>
    apiFetch('/analytics/custom-report', {
      method: 'POST',
      body: JSON.stringify(reportConfig),
    }),
  
  exportReport: (reportId, format = 'csv') =>
    apiFetch(`/analytics/reports/${reportId}/export?format=${format}`),
};

// ============================================
// System Health API
// ============================================

export const systemHealthApi = {
  getOverview: () => apiFetch('/health/overview'),
  
  getServices: () => apiFetch('/health/services'),
  
  getServiceHealth: (serviceName) =>
    apiFetch(`/health/services/${serviceName}`),
  
  getMetrics: (serviceName, period = '1h') =>
    apiFetch(`/health/services/${serviceName}/metrics?period=${period}`),
  
  getAlerts: () => apiFetch('/health/alerts'),
  
  acknowledgeAlert: (alertId) =>
    apiFetch(`/health/alerts/${alertId}/acknowledge`, { method: 'POST' }),
  
  getSLOs: () => apiFetch('/health/slos'),
  
  getIncidents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/health/incidents?${query}`);
  },
  
  getDatabaseHealth: () => apiFetch('/health/databases'),
  
  getCacheHealth: () => apiFetch('/health/cache'),
  
  getQueueHealth: () => apiFetch('/health/queues'),
};

// ============================================
// Settings API
// ============================================

export const settingsApi = {
  getAll: () => apiFetch('/settings'),
  
  get: (category) => apiFetch(`/settings/${category}`),
  
  update: (category, settings) =>
    apiFetch(`/settings/${category}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  
  getAuditLog: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/settings/audit-log?${query}`);
  },
  
  getUsers: () => apiFetch('/settings/users'),
  
  createUser: (userData) =>
    apiFetch('/settings/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    }),
  
  updateUser: (userId, userData) =>
    apiFetch(`/settings/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    }),
  
  deleteUser: (userId) =>
    apiFetch(`/settings/users/${userId}`, { method: 'DELETE' }),
  
  getRoles: () => apiFetch('/settings/roles'),
  
  getPermissions: () => apiFetch('/settings/permissions'),
};

// ============================================
// AML/Compliance API
// ============================================

export const complianceApi = {
  getAlerts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/compliance/alerts?${query}`);
  },
  
  getAlert: (alertId) => apiFetch(`/compliance/alerts/${alertId}`),
  
  reviewAlert: (alertId, review) =>
    apiFetch(`/compliance/alerts/${alertId}/review`, {
      method: 'POST',
      body: JSON.stringify(review),
    }),
  
  escalateAlert: (alertId, escalation) =>
    apiFetch(`/compliance/alerts/${alertId}/escalate`, {
      method: 'POST',
      body: JSON.stringify(escalation),
    }),
  
  getReports: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/compliance/reports?${query}`);
  },
  
  createReport: (reportData) =>
    apiFetch('/compliance/reports', {
      method: 'POST',
      body: JSON.stringify(reportData),
    }),
  
  submitReport: (reportId) =>
    apiFetch(`/compliance/reports/${reportId}/submit`, { method: 'POST' }),
  
  screenEntity: (entityData) =>
    apiFetch('/compliance/screen', {
      method: 'POST',
      body: JSON.stringify(entityData),
    }),
  
  getStats: () => apiFetch('/compliance/stats'),
};

// Export all APIs
export default {
  auth: authApi,
  dashboard: dashboardApi,
  agents: agentApi,
  transactions: transactionApi,
  pos: posApi,
  qr: qrApi,
  tigerBeetle: tigerBeetleApi,
  fluvio: fluvioApi,
  inventory: inventoryApi,
  commissions: commissionApi,
  kyc: kycApi,
  analytics: analyticsApi,
  systemHealth: systemHealthApi,
  settings: settingsApi,
  compliance: complianceApi,
};
