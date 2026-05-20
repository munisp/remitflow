/**
 * Alerts Panel Component
 * Nigerian Remittance Platform
 */

import React from 'react';
import { Alert, AlertSeverity } from '../../types/dashboard';
import { formatDate } from '../../utils/formatters';

interface AlertsPanelProps {
  alerts: Alert[];
  loading?: boolean;
  onAcknowledge?: (alertId: string) => void;
  acknowledging?: boolean;
}

export const AlertsPanel: React.FC<AlertsPanelProps> = ({
  alerts,
  loading = false,
  onAcknowledge,
  acknowledging = false
}) => {
  const getSeverityColor = (severity: AlertSeverity) => {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return 'bg-red-100 border-red-500 text-red-900';
      case AlertSeverity.ERROR:
        return 'bg-orange-100 border-orange-500 text-orange-900';
      case AlertSeverity.WARNING:
        return 'bg-yellow-100 border-yellow-500 text-yellow-900';
      case AlertSeverity.INFO:
        return 'bg-blue-100 border-blue-500 text-blue-900';
      default:
        return 'bg-gray-100 border-gray-500 text-gray-900';
    }
  };

  const getSeverityIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return '🚨';
      case AlertSeverity.ERROR:
        return '❌';
      case AlertSeverity.WARNING:
        return '⚠️';
      case AlertSeverity.INFO:
        return 'ℹ️';
      default:
        return '📌';
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Active Alerts</h3>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="p-4 rounded-lg border-l-4 animate-pulse bg-gray-50">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-full mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/4"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Active Alerts</h3>
        <div className="text-center py-8">
          <p className="text-gray-500">No active alerts</p>
          <p className="text-sm text-gray-400 mt-1">All systems operating normally</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Active Alerts</h3>
        <span className="bg-red-100 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
          {alerts.length}
        </span>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`p-4 rounded-lg border-l-4 ${getSeverityColor(alert.severity)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-lg">{getSeverityIcon(alert.severity)}</span>
                  <h4 className="font-semibold">{alert.title}</h4>
                </div>
                
                <p className="text-sm mb-2">{alert.message}</p>
                
                <div className="flex items-center space-x-4 text-xs">
                  <span className="font-medium">{alert.type}</span>
                  <span className="text-gray-600">{formatDate(alert.timestamp)}</span>
                </div>

                {alert.metadata && Object.keys(alert.metadata).length > 0 && (
                  <div className="mt-2 text-xs">
                    <details className="cursor-pointer">
                      <summary className="font-medium">Details</summary>
                      <pre className="mt-1 p-2 bg-white bg-opacity-50 rounded text-xs overflow-x-auto">
                        {JSON.stringify(alert.metadata, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>

              {!alert.acknowledged && onAcknowledge && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  disabled={acknowledging}
                  className="ml-4 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {acknowledging ? 'Acknowledging...' : 'Acknowledge'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
