export interface BaseResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

export interface ItemResponse<T> extends BaseResponse {
  data: T | null;
}

export interface ListResponse<T> extends BaseResponse {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ErrorResponse extends BaseResponse {
  error_code: string;
  details?: Record<string, any>;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  recipient: string;
  payment_method: string;
  description?: string;
}

export interface Payment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}
