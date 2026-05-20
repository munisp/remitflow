// React Native API Client with Security
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AnalyticsService } from '../services/AnalyticsService';

export class APIClient {
  private baseURL: string = 'https://api.remittance.com';

  async get(endpoint: string): Promise<any> {
    return this.request('GET', endpoint);
  }

  async post(endpoint: string, data: any): Promise<any> {
    return this.request('POST', endpoint, data);
  }

  async put(endpoint: string, data: any): Promise<any> {
    return this.request('PUT', endpoint, data);
  }

  async delete(endpoint: string): Promise<any> {
    return this.request('DELETE', endpoint);
  }

  private async request(method: string, endpoint: string, data?: any): Promise<any> {
    const token = await AsyncStorage.getItem('auth_token');
    const deviceId = await this.getDeviceId();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-ID': deviceId,
      'X-Request-ID': this.generateRequestId(),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    if (data && method !== 'GET') {
      config.body = JSON.stringify(data);
    }

    try {
      const startTime = Date.now();
      const response = await fetch(`${this.baseURL}${endpoint}`, config);
      const endTime = Date.now();

      AnalyticsService.trackPerformance(`api_${method.toLowerCase()}_${endpoint}`, endTime - startTime, 'ms');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();
      return { data: responseData, status: response.status };
    } catch (error) {
      AnalyticsService.trackError('api_request_failed', error);
      throw error;
    }
  }

  private async getDeviceId(): Promise<string> {
    let deviceId = await AsyncStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
