/**
 * Real-time Dashboard Type Definitions
 * Nigerian Remittance Platform
 */

// Transaction Types
export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: TransactionType;
  sender: User;
  recipient: User;
  created_at: string;
  updated_at: string;
  payment_method: string;
  reference: string;
  description?: string;
}

export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded'
}

export enum TransactionType {
  SEND = 'send',
  RECEIVE = 'receive',
  WITHDRAW = 'withdraw',
  DEPOSIT = 'deposit',
  EXCHANGE = 'exchange'
}

// User Types
export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  avatar?: string;
}

// Metrics Types
export interface DashboardMetrics {
  active_transactions: number;
  total_volume: number;
  success_rate: number;
  average_processing_time: number;
  failed_transactions: number;
  pending_transactions: number;
  transactions_per_minute: number;
  active_users: number;
  total_fees_collected: number;
  currency_breakdown: CurrencyBreakdown[];
  hourly_volume: HourlyVolume[];
  top_corridors: TopCorridor[];
}

export interface CurrencyBreakdown {
  currency: string;
  volume: number;
  count: number;
  percentage: number;
}

export interface HourlyVolume {
  hour: string;
  volume: number;
  count: number;
}

export interface TopCorridor {
  from_country: string;
  to_country: string;
  volume: number;
  count: number;
}

// Alert Types
export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  metadata?: Record<string, any>;
}

export enum AlertType {
  FRAUD = 'fraud',
  HIGH_VOLUME = 'high_volume',
  SYSTEM_ERROR = 'system_error',
  RATE_LIMIT = 'rate_limit',
  UNUSUAL_ACTIVITY = 'unusual_activity',
  COMPLIANCE = 'compliance'
}

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

// WebSocket Message Types
export interface WebSocketMessage {
  type: WebSocketMessageType;
  data: any;
  timestamp: string;
}

export enum WebSocketMessageType {
  TRANSACTION_CREATED = 'transaction_created',
  TRANSACTION_UPDATED = 'transaction_updated',
  TRANSACTION_COMPLETED = 'transaction_completed',
  TRANSACTION_FAILED = 'transaction_failed',
  METRICS_UPDATE = 'metrics_update',
  ALERT_CREATED = 'alert_created',
  SYSTEM_STATUS = 'system_status',
  HEARTBEAT = 'heartbeat'
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  message?: string;
  status: 'success' | 'error';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Filter Types
export interface DashboardFilters {
  status?: TransactionStatus[];
  type?: TransactionType[];
  date_from?: string;
  date_to?: string;
  currency?: string[];
  min_amount?: number;
  max_amount?: number;
}

// Chart Data Types
export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
  label?: string;
}

// WebSocket Hook Types
export interface UseWebSocketOptions {
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  onReconnect?: (attempt: number) => void;
}

export interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: Event | null;
  reconnectAttempts: number;
}

// Dashboard State Types
export interface DashboardState {
  metrics: DashboardMetrics | null;
  recentTransactions: Transaction[];
  alerts: Alert[];
  filters: DashboardFilters;
  isLoading: boolean;
  error: string | null;
  lastUpdate: string | null;
}
