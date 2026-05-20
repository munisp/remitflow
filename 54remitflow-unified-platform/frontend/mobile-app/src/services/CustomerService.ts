import ApiService from './ApiService';

class CustomerService {
  async getCustomers(params?: { page?: number; limit?: number }) {
    return ApiService.get('/customers', { params });
  }

  async getCustomerById(id: string) {
    return ApiService.get(`/customers/${id}`);
  }

  async createCustomer(data: any) {
    return ApiService.post('/customers', data);
  }

  async updateCustomer(id: string, data: any) {
    return ApiService.put(`/customers/${id}`, data);
  }

  async searchCustomers(query: string) {
    return ApiService.get('/customers/search', { params: { q: query } });
  }

  async getCustomerTransactions(customerId: string) {
    return ApiService.get(`/customers/${customerId}/transactions`);
  }

  async getCustomerAnalytics(customerId: string) {
    return ApiService.get(`/customers/${customerId}/analytics`);
  }
}

export default new CustomerService();

