import ApiService from './ApiService';

class ProductService {
  async getProducts(params?: { category?: string; search?: string; page?: number }) {
    return ApiService.get('/products', { params });
  }

  async getProductById(id: string) {
    return ApiService.get(`/products/${id}`);
  }

  async getCategories() {
    return ApiService.get('/products/categories');
  }

  async searchProducts(query: string) {
    return ApiService.get('/products/search', { params: { q: query } });
  }

  async getProductReviews(productId: string) {
    return ApiService.get(`/products/${productId}/reviews`);
  }

  async addProductReview(productId: string, data: { rating: number; comment: string }) {
    return ApiService.post(`/products/${productId}/reviews`, data);
  }
}

export default new ProductService();

