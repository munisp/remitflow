import ApiService from './ApiService';

class TransactionService {
  async getTransactions(params?: { page?: number; limit?: number; status?: string }) {
    return ApiService.get('/transactions', { params });
  }

  async getTransactionById(id: string) {
    return ApiService.get(`/transactions/${id}`);
  }

  async createTransaction(data: any) {
    return ApiService.post('/transactions', data);
  }

  async updateTransaction(id: string, data: any) {
    return ApiService.put(`/transactions/${id}`, data);
  }

  async cancelTransaction(id: string) {
    return ApiService.post(`/transactions/${id}/cancel`);
  }

  async getTransactionHistory(params?: { startDate?: string; endDate?: string }) {
    return ApiService.get('/transactions/history', { params });
  }

  async exportTransactions(format: 'pdf' | 'csv' | 'excel') {
    return ApiService.get(`/transactions/export?format=${format}`, {
      responseType: 'blob',
    });
  }
}

export default new TransactionService();

