import { apiClient } from '../client';

export const aml_monitoringService = {
  create: async (data: any) => {
    const response = await apiClient.post('/api/v1/aml-monitoring', { data });
    return response.data;
  },

  get: async (id: string) => {
    const response = await apiClient.get(`/api/v1/aml-monitoring/${id}`);
    return response.data;
  },

  list: async (page: number = 1, pageSize: number = 10) => {
    const response = await apiClient.get('/api/v1/aml-monitoring', {
      params: { page, page_size: pageSize }
    });
    return response.data;
  },

  update: async (id: string, data: any) => {
    const response = await apiClient.put(`/api/v1/aml-monitoring/${id}`, { data });
    return response.data;
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/api/v1/aml-monitoring/${id}`);
    return response.data;
  },

  getStats: async () => {
    const response = await apiClient.get('/api/v1/aml-monitoring/stats');
    return response.data;
  },

  batchOperation: async (operations: any[]) => {
    const response = await apiClient.post('/api/v1/aml-monitoring/batch', operations);
    return response.data;
  }
};
