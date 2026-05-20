import { apiClient } from '../client';

export const predictive_analyticsService = {
  create: async (data: any) => {
    const response = await apiClient.post('/api/v1/predictive-analytics', { data });
    return response.data;
  },

  get: async (id: string) => {
    const response = await apiClient.get(`/api/v1/predictive-analytics/${id}`);
    return response.data;
  },

  list: async (page: number = 1, pageSize: number = 10) => {
    const response = await apiClient.get('/api/v1/predictive-analytics', {
      params: { page, page_size: pageSize }
    });
    return response.data;
  },

  update: async (id: string, data: any) => {
    const response = await apiClient.put(`/api/v1/predictive-analytics/${id}`, { data });
    return response.data;
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/api/v1/predictive-analytics/${id}`);
    return response.data;
  },

  getStats: async () => {
    const response = await apiClient.get('/api/v1/predictive-analytics/stats');
    return response.data;
  },

  batchOperation: async (operations: any[]) => {
    const response = await apiClient.post('/api/v1/predictive-analytics/batch', operations);
    return response.data;
  }
};
