// API Client for Remittance Platform
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8020'
const PAYMENT_API_URL = import.meta.env.VITE_PAYMENT_GATEWAY_URL || 'http://localhost:8021'
const KYB_API_URL = import.meta.env.VITE_KYB_API_URL || 'http://localhost:8121'

function generateIdempotencyKey() {
  return crypto.randomUUID ? crypto.randomUUID() : (
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  )
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE'])

class APIClient {
  constructor(baseURL) {
    this.baseURL = baseURL
    this._pendingKeys = new Map()
  }

  _getOrCreateIdempotencyKey(method, endpoint, data) {
    if (!WRITE_METHODS.has(method)) return null
    const cacheKey = `${method}:${endpoint}:${JSON.stringify(data || '')}`
    if (this._pendingKeys.has(cacheKey)) {
      return this._pendingKeys.get(cacheKey)
    }
    const key = generateIdempotencyKey()
    this._pendingKeys.set(cacheKey, key)
    setTimeout(() => this._pendingKeys.delete(cacheKey), 60000)
    return key
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`
    const method = (options.method || 'GET').toUpperCase()
    const idempotencyKey = this._getOrCreateIdempotencyKey(method, endpoint, options.body)
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey
    }
    const config = { headers, ...options }

    try {
      const response = await fetch(url, config)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      if (idempotencyKey) {
        const cacheKey = `${method}:${endpoint}:${JSON.stringify(options.body || '')}`
        this._pendingKeys.delete(cacheKey)
      }
      return await response.json()
    } catch (error) {
      console.error('API request failed:', error)
      throw error
    }
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, { method: 'GET', ...options })
  }

  post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options
    })
  }

  put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...options
    })
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { method: 'DELETE', ...options })
  }

  // Upload file
  async uploadFile(endpoint, file, additionalData = {}) {
    const formData = new FormData()
    formData.append('file', file)
    Object.keys(additionalData).forEach(key => {
      formData.append(key, additionalData[key])
    })

    const url = `${this.baseURL}${endpoint}`
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      throw new Error(`Upload failed! status: ${response.status}`)
    }
    return await response.json()
  }
}

// Create API client instances
const ecommerceAPI = new APIClient(API_BASE_URL)
const paymentAPI = new APIClient(PAYMENT_API_URL)
const kybAPI = new APIClient(KYB_API_URL)

// E-commerce API endpoints
export const ecommerce = {
  // Products
  getProducts: () => ecommerceAPI.get('/api/ecommerce/products'),
  getProduct: (id) => ecommerceAPI.get(`/api/ecommerce/products/${id}`),
  createProduct: (product) => ecommerceAPI.post('/api/ecommerce/products', product),
  updateProduct: (id, product) => ecommerceAPI.put(`/api/ecommerce/products/${id}`, product),
  deleteProduct: (id) => ecommerceAPI.delete(`/api/ecommerce/products/${id}`),

  // Variants
  getVariants: (productId) => ecommerceAPI.get(`/api/ecommerce/products/${productId}/variants`),
  createVariant: (productId, variant) => ecommerceAPI.post(`/api/ecommerce/products/${productId}/variants`, variant),
  updateVariant: (productId, variantId, variant) => ecommerceAPI.put(`/api/ecommerce/products/${productId}/variants/${variantId}`, variant),
  deleteVariant: (productId, variantId) => ecommerceAPI.delete(`/api/ecommerce/products/${productId}/variants/${variantId}`),

  // Categories
  getCategories: () => ecommerceAPI.get('/api/ecommerce/categories'),
  createCategory: (category) => ecommerceAPI.post('/api/ecommerce/categories', category),

  // Orders
  getOrders: () => ecommerceAPI.get('/api/ecommerce/orders'),
  getOrder: (id) => ecommerceAPI.get(`/api/ecommerce/orders/${id}`),
  createOrder: (order) => ecommerceAPI.post('/api/ecommerce/orders', order),
  updateOrderStatus: (id, status) => ecommerceAPI.put(`/api/ecommerce/orders/${id}/status`, { status }),

  // Customers
  getCustomers: () => ecommerceAPI.get('/api/ecommerce/customers'),
  getCustomer: (id) => ecommerceAPI.get(`/api/ecommerce/customers/${id}`),
  createCustomer: (customer) => ecommerceAPI.post('/api/ecommerce/customers', customer),

  // Analytics
  getAnalytics: () => ecommerceAPI.get('/api/ecommerce/analytics'),
  getStats: () => ecommerceAPI.get('/api/ecommerce/analytics/stats'),
  getTopProducts: () => ecommerceAPI.get('/api/ecommerce/analytics/top-products'),
  getSalesData: (startDate, endDate) => ecommerceAPI.get(`/api/ecommerce/analytics/sales?start=${startDate}&end=${endDate}`),

  // Store
  getStore: (agentId) => ecommerceAPI.get(`/api/ecommerce/stores/agent/${agentId}`),
  createStore: (store) => ecommerceAPI.post('/api/ecommerce/stores', store),
  updateStore: (id, store) => ecommerceAPI.put(`/api/ecommerce/stores/${id}`, store),

  // Image Upload
  uploadImage: (file, productId) => ecommerceAPI.uploadFile('/api/ecommerce/products/images', file, { productId }),
  uploadStoreImage: (file, storeId, imageType) => ecommerceAPI.uploadFile('/api/ecommerce/stores/images', file, { storeId, imageType })
}

// Payment API endpoints
export const payment = {
  // Payments
  createPayment: (paymentData) => paymentAPI.post('/api/payments', paymentData),
  getPayment: (id) => paymentAPI.get(`/api/payments/${id}`),
  getPayments: () => paymentAPI.get('/api/payments'),

  // Refunds
  createRefund: (paymentId, amount) => paymentAPI.post(`/api/payments/${paymentId}/refund`, { amount }),

  // Payment Methods
  getPaymentMethods: () => paymentAPI.get('/api/payment-methods'),
  addPaymentMethod: (method) => paymentAPI.post('/api/payment-methods', method),

  // Transactions
  getTransactions: (merchantId) => paymentAPI.get(`/api/transactions/merchant/${merchantId}`),
  getTransaction: (id) => paymentAPI.get(`/api/transactions/${id}`),

  // Exchange Rates
  getExchangeRates: () => paymentAPI.get('/api/exchange-rates'),
  convertCurrency: (amount, from, to) => paymentAPI.post('/api/exchange-rates/convert', { amount, from, to })
}

// Agent Onboarding API endpoints
export const onboarding = {
  submitPersonalInfo: (data) => ecommerceAPI.post('/api/agents/onboarding/personal', data),
  submitBusinessInfo: (data) => ecommerceAPI.post('/api/agents/onboarding/business', data),
  submitKYB: (data) => ecommerceAPI.post('/api/agents/onboarding/kyb', data),
  uploadDocument: (file, documentType) => ecommerceAPI.uploadFile('/api/agents/onboarding/documents', file, { documentType }),
  getOnboardingStatus: (agentId) => ecommerceAPI.get(`/api/agents/onboarding/status/${agentId}`),
  completeOnboarding: (agentId) => ecommerceAPI.post(`/api/agents/onboarding/complete/${agentId}`)
}

// Agent Management API endpoints
export const agents = {
  getAgents: () => ecommerceAPI.get('/api/agents'),
  getAgent: (id) => ecommerceAPI.get(`/api/agents/${id}`),
  createAgent: (agent) => ecommerceAPI.post('/api/agents', agent),
  updateAgent: (id, agent) => ecommerceAPI.put(`/api/agents/${id}`, agent),
  getAgentHierarchy: (id) => ecommerceAPI.get(`/api/agents/${id}/hierarchy`),
  getAgentPerformance: (id) => ecommerceAPI.get(`/api/agents/${id}/performance`)
}

// Transaction API endpoints
export const transactions = {
  getTransactions: () => ecommerceAPI.get('/api/transactions'),
  getTransaction: (id) => ecommerceAPI.get(`/api/transactions/${id}`),
  createTransaction: (transaction) => ecommerceAPI.post('/api/transactions', transaction),
  getTransactionHistory: (agentId) => ecommerceAPI.get(`/api/transactions/agent/${agentId}`)
}

// Fraud Detection API endpoints
export const fraud = {
  checkTransaction: (transaction) => ecommerceAPI.post('/api/fraud/check', transaction),
  getFraudAlerts: () => ecommerceAPI.get('/api/fraud/alerts'),
  updateAlertStatus: (id, status) => ecommerceAPI.put(`/api/fraud/alerts/${id}`, { status })
}

// Security Monitoring API endpoints
export const security = {
  getIncidents: () => ecommerceAPI.get('/api/security/incidents'),
  getIncident: (id) => ecommerceAPI.get(`/api/security/incidents/${id}`),
  getAlerts: () => ecommerceAPI.get('/api/security/alerts'),
  getThreatIntelligence: () => ecommerceAPI.get('/api/security/threat-intelligence')
}

// Workflow Orchestration API endpoints
export const workflows = {
  getWorkflows: () => ecommerceAPI.get('/api/workflows'),
  getWorkflow: (id) => ecommerceAPI.get(`/api/workflows/${id}`),
  startWorkflow: (workflowType, data) => ecommerceAPI.post('/api/workflows/start', { workflowType, data }),
  getWorkflowStatus: (id) => ecommerceAPI.get(`/api/workflows/${id}/status`)
}

// KYB Verification API endpoints
export const kyb = {
  startVerification: (data) => kybAPI.post('/kyb/verify', data),
  getVerificationStatus: (id) => kybAPI.get(`/kyb/status/${id}`),
  submitBankStatement: (data) => kybAPI.post('/kyb/bank-statement', data),
  submitEvidence: (data) => kybAPI.post('/kyb/evidence', data),
  verifyOwners: (id) => kybAPI.post(`/kyb/verify-owners/${id}`),
  approveVerification: (id) => kybAPI.post(`/kyb/approve/${id}`),
  rejectVerification: (id, reason) => kybAPI.post(`/kyb/reject/${id}`, { reason }),
  getScreeningResults: (id) => kybAPI.get(`/kyb/screening/${id}`),
  uploadKYBDocuments: (file, verificationId, documentType) => kybAPI.uploadFile('/kyb/documents', file, { verificationId, documentType }),
  getVerificationPaths: () => kybAPI.get('/kyb/paths'),
}

// Export default API object
export default {
  ecommerce,
  payment,
  onboarding,
  agents,
  transactions,
  fraud,
  security,
  workflows,
  kyb
}
