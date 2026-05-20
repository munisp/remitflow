import ApiService from './ApiService';

class OrderService {
  async getOrders(params?: { status?: string; page?: number }) {
    return ApiService.get('/orders', { params });
  }

  async getOrderById(id: string) {
    return ApiService.get(`/orders/${id}`);
  }

  async createOrder(data: any) {
    return ApiService.post('/orders', data);
  }

  async updateOrderStatus(id: string, status: string) {
    return ApiService.patch(`/orders/${id}/status`, { status });
  }

  async cancelOrder(id: string) {
    return ApiService.post(`/orders/${id}/cancel`);
  }

  async trackOrder(orderNumber: string) {
    return ApiService.get(`/orders/track/${orderNumber}`);
  }

  async getOrderHistory() {
    return ApiService.get('/orders/history');
  }
}

export default new OrderService();

