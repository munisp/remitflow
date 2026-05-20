import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'http://localhost:8000', // Adjust this to your backend URL
  headers: {
    'Content-Type': 'application/json',
  },
});

// Generic GET request
export const get = async (url: string, params?: any) => {
  const response = await apiClient.get(url, { params });
  return response.data;
};

// Generic POST request
export const post = async (url: string, data: any) => {
  const response = await apiClient.post(url, data);
  return response.data;
};

// Generic PUT request
export const put = async (url: string, data: any) => {
  const response = await apiClient.put(url, data);
  return response.data;
};

// Generic DELETE request
export const del = async (url: string) => {
  const response = await apiClient.delete(url);
  return response.data;
};
