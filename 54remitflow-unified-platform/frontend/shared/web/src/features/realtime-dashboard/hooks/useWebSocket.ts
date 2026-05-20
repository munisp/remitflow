/**
 * WebSocket Hook with Auto-Reconnect
 * Nigerian Remittance Platform
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { UseWebSocketOptions, WebSocketState, WebSocketMessage } from '../types/dashboard';

const DEFAULT_OPTIONS: Required<UseWebSocketOptions> = {
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
  onConnect: () => {},
  onDisconnect: () => {},
  onError: () => {},
  onReconnect: () => {}
};

export const useWebSocket = <T = any>(
  url: string,
  onMessage: (data: T) => void,
  options: UseWebSocketOptions = {}
) => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const isManualClose = useRef(false);

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    reconnectAttempts: 0
  });

  // Send heartbeat to keep connection alive
  const sendHeartbeat = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }, []);

  // Start heartbeat interval
  const startHeartbeat = useCallback(() => {
    heartbeatIntervalRef.current = setInterval(
      sendHeartbeat,
      opts.heartbeatInterval
    );
  }, [sendHeartbeat, opts.heartbeatInterval]);

  // Stop heartbeat interval
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Get auth token
      const token = localStorage.getItem('access_token');
      const wsUrl = token ? `${url}?token=${token}` : url;

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log('[WebSocket] Connected to', url);
        
        setState({
          isConnected: true,
          isConnecting: false,
          error: null,
          reconnectAttempts: 0
        });

        reconnectAttemptsRef.current = 0;
        startHeartbeat();
        opts.onConnect();
      };

      ws.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          // Ignore heartbeat responses
          if (message.type === 'heartbeat') {
            return;
          }

          onMessage(message.data as T);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.current.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        
        setState(prev => ({
          ...prev,
          error,
          isConnecting: false
        }));

        opts.onError(error);
      };

      ws.current.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false
        }));

        stopHeartbeat();
        opts.onDisconnect();

        // Attempt to reconnect if not manually closed
        if (!isManualClose.current && reconnectAttemptsRef.current < opts.maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          
          setState(prev => ({
            ...prev,
            reconnectAttempts: reconnectAttemptsRef.current
          }));

          console.log(
            `[WebSocket] Reconnecting in ${opts.reconnectInterval}ms (attempt ${reconnectAttemptsRef.current}/${opts.maxReconnectAttempts})`
          );

          opts.onReconnect(reconnectAttemptsRef.current);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, opts.reconnectInterval);
        } else if (reconnectAttemptsRef.current >= opts.maxReconnectAttempts) {
          console.error('[WebSocket] Max reconnect attempts reached');
        }
      };
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error as Event
      }));
    }
  }, [url, onMessage, opts, startHeartbeat, stopHeartbeat]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    isManualClose.current = true;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    stopHeartbeat();

    if (ws.current) {
      ws.current.close(1000, 'Manual disconnect');
      ws.current = null;
    }

    setState({
      isConnected: false,
      isConnecting: false,
      error: null,
      reconnectAttempts: 0
    });
  }, [stopHeartbeat]);

  // Send message to WebSocket
  const sendMessage = useCallback((message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      try {
        const payload = typeof message === 'string' 
          ? message 
          : JSON.stringify(message);
        
        ws.current.send(payload);
        return true;
      } catch (error) {
        console.error('[WebSocket] Failed to send message:', error);
        return false;
      }
    } else {
      console.warn('[WebSocket] Cannot send message: connection not open');
      return false;
    }
  }, []);

  // Reconnect manually
  const reconnect = useCallback(() => {
    disconnect();
    isManualClose.current = false;
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect, disconnect]);

  // Connect on mount
  useEffect(() => {
    isManualClose.current = false;
    connect();

    // Cleanup on unmount
    return () => {
      isManualClose.current = true;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      stopHeartbeat();

      if (ws.current) {
        ws.current.close(1000, 'Component unmounted');
      }
    };
  }, [connect, stopHeartbeat]);

  return {
    ...state,
    sendMessage,
    disconnect,
    reconnect
  };
};

// Hook for real-time dashboard WebSocket
export const useDashboardWebSocket = (
  onTransactionUpdate: (transaction: any) => void,
  onMetricsUpdate: (metrics: any) => void,
  onAlertCreated: (alert: any) => void
) => {
  const wsUrl = `${process.env.REACT_APP_WS_URL || 'ws://localhost:8000'}/ws/dashboard`;

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'transaction_created':
      case 'transaction_updated':
      case 'transaction_completed':
      case 'transaction_failed':
        onTransactionUpdate(message.data);
        break;

      case 'metrics_update':
        onMetricsUpdate(message.data);
        break;

      case 'alert_created':
        onAlertCreated(message.data);
        break;

      case 'system_status':
        console.log('[Dashboard] System status:', message.data);
        break;

      default:
        console.log('[Dashboard] Unknown message type:', message.type);
    }
  }, [onTransactionUpdate, onMetricsUpdate, onAlertCreated]);

  return useWebSocket<WebSocketMessage>(wsUrl, handleMessage, {
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
    onConnect: () => console.log('[Dashboard] WebSocket connected'),
    onDisconnect: () => console.log('[Dashboard] WebSocket disconnected'),
    onError: (error) => console.error('[Dashboard] WebSocket error:', error),
    onReconnect: (attempt) => console.log(`[Dashboard] Reconnecting (attempt ${attempt})`)
  });
};
