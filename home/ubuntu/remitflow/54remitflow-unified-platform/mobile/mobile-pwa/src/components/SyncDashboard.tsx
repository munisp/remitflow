import React, { useState, useEffect, useCallback } from 'react';

// Types
interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  conflictCount: number;
  bytesTransferred: number;
  avgLatency: number;
  networkQuality: 'excellent' | 'good' | 'poor' | 'offline';
}

interface SyncItem {
  id: string;
  entityType: string;
  operation: string;
  priority: 'critical' | 'high' | 'normal' | 'low' | 'background';
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  createdAt: Date;
  retryCount: number;
  lastError?: string;
}

interface ConflictItem {
  id: string;
  entityId: string;
  entityType: string;
  localValue: any;
  remoteValue: any;
  detectedAt: Date;
  resolution?: 'local' | 'remote' | 'merge' | 'manual';
}

interface SyncMetrics {
  totalSyncs: number;
  successRate: number;
  avgSyncTime: number;
  compressionRatio: number;
  bandwidthSaved: number;
}

// Sync Dashboard Component
export const SyncDashboard: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSyncTime: null,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
    conflictCount: 0,
    bytesTransferred: 0,
    avgLatency: 0,
    networkQuality: 'good',
  });

  const [pendingItems, setPendingItems] = useState<SyncItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [metrics, setMetrics] = useState<SyncMetrics>({
    totalSyncs: 0,
    successRate: 100,
    avgSyncTime: 0,
    compressionRatio: 1,
    bandwidthSaved: 0,
  });
  const [activeTab, setActiveTab] = useState<'overview' | 'pending' | 'conflicts' | 'metrics'>('overview');

  // Network status listener
  useEffect(() => {
    const handleOnline = () => setStatus(s => ({ ...s, isOnline: true, networkQuality: 'good' }));
    const handleOffline = () => setStatus(s => ({ ...s, isOnline: false, networkQuality: 'offline' }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch sync status periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/sync/status');
        if (response.ok) {
          const data = await response.json();
          setStatus(prev => ({
            ...prev,
            ...data,
            lastSyncTime: data.lastSyncTime ? new Date(data.lastSyncTime) : null,
          }));
        }
      } catch (error) {
        console.error('Failed to fetch sync status:', error);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch pending items
  useEffect(() => {
    const fetchPending = async () => {
      try {
        const response = await fetch('/api/sync/pending');
        if (response.ok) {
          const data = await response.json();
          setPendingItems(data.items || []);
        }
      } catch (error) {
        console.error('Failed to fetch pending items:', error);
      }
    };

    fetchPending();
    const interval = setInterval(fetchPending, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch conflicts
  useEffect(() => {
    const fetchConflicts = async () => {
      try {
        const response = await fetch('/api/sync/conflicts');
        if (response.ok) {
          const data = await response.json();
          setConflicts(data.conflicts || []);
        }
      } catch (error) {
        console.error('Failed to fetch conflicts:', error);
      }
    };

    fetchConflicts();
    const interval = setInterval(fetchConflicts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Force sync
  const handleForceSync = useCallback(async () => {
    try {
      setStatus(s => ({ ...s, isSyncing: true }));
      await fetch('/api/sync/force', { method: 'POST' });
    } catch (error) {
      console.error('Force sync failed:', error);
    }
  }, []);

  // Resolve conflict
  const handleResolveConflict = useCallback(async (conflictId: string, resolution: 'local' | 'remote' | 'merge') => {
    try {
      await fetch(`/api/sync/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      });
      setConflicts(prev => prev.filter(c => c.id !== conflictId));
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  }, []);

  // Retry failed item
  const handleRetry = useCallback(async (itemId: string) => {
    try {
      await fetch(`/api/sync/items/${itemId}/retry`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to retry item:', error);
    }
  }, []);

  // Format bytes
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format time ago
  const formatTimeAgo = (date: Date | null): string => {
    if (!date) return 'Never';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  // Get network quality color
  const getNetworkColor = (quality: string): string => {
    switch (quality) {
      case 'excellent': return '#22c55e';
      case 'good': return '#84cc16';
      case 'poor': return '#f59e0b';
      case 'offline': return '#ef4444';
      default: return '#6b7280';
    }
  };

  // Get priority color
  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'critical': return '#ef4444';
      case 'high': return '#f59e0b';
      case 'normal': return '#3b82f6';
      case 'low': return '#6b7280';
      case 'background': return '#9ca3af';
      default: return '#6b7280';
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Sync Dashboard</h1>
        <div style={styles.statusIndicator}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor: status.isOnline ? '#22c55e' : '#ef4444',
            }}
          />
          <span>{status.isOnline ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{status.pendingCount}</div>
          <div style={styles.statLabel}>Pending</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{status.syncedCount}</div>
          <div style={styles.statLabel}>Synced</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{status.failedCount}</div>
          <div style={styles.statLabel}>Failed</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{status.conflictCount}</div>
          <div style={styles.statLabel}>Conflicts</div>
        </div>
      </div>

      {/* Network Quality */}
      <div style={styles.networkCard}>
        <div style={styles.networkHeader}>
          <span>Network Quality</span>
          <span style={{ color: getNetworkColor(status.networkQuality) }}>
            {status.networkQuality.toUpperCase()}
          </span>
        </div>
        <div style={styles.networkBar}>
          <div
            style={{
              ...styles.networkFill,
              width: status.networkQuality === 'excellent' ? '100%' :
                     status.networkQuality === 'good' ? '75%' :
                     status.networkQuality === 'poor' ? '40%' : '0%',
              backgroundColor: getNetworkColor(status.networkQuality),
            }}
          />
        </div>
        <div style={styles.networkStats}>
          <span>Latency: {status.avgLatency}ms</span>
          <span>Transferred: {formatBytes(status.bytesTransferred)}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {(['overview', 'pending', 'conflicts', 'metrics'] as const).map(tab => (
          <button
            key={tab}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.activeTab : {}),
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={styles.tabContent}>
        {activeTab === 'overview' && (
          <div>
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Sync Status</h3>
              <div style={styles.infoRow}>
                <span>Last Sync:</span>
                <span>{formatTimeAgo(status.lastSyncTime)}</span>
              </div>
              <div style={styles.infoRow}>
                <span>Status:</span>
                <span>{status.isSyncing ? 'Syncing...' : 'Idle'}</span>
              </div>
              <button
                style={styles.syncButton}
                onClick={handleForceSync}
                disabled={status.isSyncing || !status.isOnline}
              >
                {status.isSyncing ? 'Syncing...' : 'Force Sync'}
              </button>
            </div>

            {status.conflictCount > 0 && (
              <div style={styles.alertCard}>
                <span style={styles.alertIcon}>⚠️</span>
                <span>{status.conflictCount} conflict(s) need resolution</span>
              </div>
            )}

            {status.failedCount > 0 && (
              <div style={{ ...styles.alertCard, backgroundColor: '#fef2f2' }}>
                <span style={styles.alertIcon}>❌</span>
                <span>{status.failedCount} item(s) failed to sync</span>
              </div>
            )}
          </div>
        )}

        {activeTab === 'pending' && (
          <div>
            <h3 style={styles.sectionTitle}>Pending Items ({pendingItems.length})</h3>
            {pendingItems.length === 0 ? (
              <div style={styles.emptyState}>No pending items</div>
            ) : (
              <div style={styles.itemList}>
                {pendingItems.map(item => (
                  <div key={item.id} style={styles.itemCard}>
                    <div style={styles.itemHeader}>
                      <span
                        style={{
                          ...styles.priorityBadge,
                          backgroundColor: getPriorityColor(item.priority),
                        }}
                      >
                        {item.priority}
                      </span>
                      <span style={styles.itemType}>{item.entityType}</span>
                    </div>
                    <div style={styles.itemDetails}>
                      <span>Operation: {item.operation}</span>
                      <span>Retries: {item.retryCount}</span>
                    </div>
                    {item.status === 'failed' && (
                      <div style={styles.itemError}>
                        <span>{item.lastError}</span>
                        <button
                          style={styles.retryButton}
                          onClick={() => handleRetry(item.id)}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'conflicts' && (
          <div>
            <h3 style={styles.sectionTitle}>Conflicts ({conflicts.length})</h3>
            {conflicts.length === 0 ? (
              <div style={styles.emptyState}>No conflicts</div>
            ) : (
              <div style={styles.itemList}>
                {conflicts.map(conflict => (
                  <div key={conflict.id} style={styles.conflictCard}>
                    <div style={styles.conflictHeader}>
                      <span style={styles.conflictType}>{conflict.entityType}</span>
                      <span style={styles.conflictTime}>
                        {formatTimeAgo(new Date(conflict.detectedAt))}
                      </span>
                    </div>
                    <div style={styles.conflictValues}>
                      <div style={styles.conflictValue}>
                        <span style={styles.conflictLabel}>Local:</span>
                        <pre style={styles.conflictData}>
                          {JSON.stringify(conflict.localValue, null, 2)}
                        </pre>
                      </div>
                      <div style={styles.conflictValue}>
                        <span style={styles.conflictLabel}>Remote:</span>
                        <pre style={styles.conflictData}>
                          {JSON.stringify(conflict.remoteValue, null, 2)}
                        </pre>
                      </div>
                    </div>
                    <div style={styles.conflictActions}>
                      <button
                        style={{ ...styles.resolveButton, backgroundColor: '#3b82f6' }}
                        onClick={() => handleResolveConflict(conflict.id, 'local')}
                      >
                        Keep Local
                      </button>
                      <button
                        style={{ ...styles.resolveButton, backgroundColor: '#22c55e' }}
                        onClick={() => handleResolveConflict(conflict.id, 'remote')}
                      >
                        Keep Remote
                      </button>
                      <button
                        style={{ ...styles.resolveButton, backgroundColor: '#8b5cf6' }}
                        onClick={() => handleResolveConflict(conflict.id, 'merge')}
                      >
                        Merge
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'metrics' && (
          <div>
            <h3 style={styles.sectionTitle}>Sync Metrics</h3>
            <div style={styles.metricsGrid}>
              <div style={styles.metricCard}>
                <div style={styles.metricValue}>{metrics.totalSyncs}</div>
                <div style={styles.metricLabel}>Total Syncs</div>
              </div>
              <div style={styles.metricCard}>
                <div style={styles.metricValue}>{metrics.successRate.toFixed(1)}%</div>
                <div style={styles.metricLabel}>Success Rate</div>
              </div>
              <div style={styles.metricCard}>
                <div style={styles.metricValue}>{metrics.avgSyncTime}ms</div>
                <div style={styles.metricLabel}>Avg Sync Time</div>
              </div>
              <div style={styles.metricCard}>
                <div style={styles.metricValue}>{(metrics.compressionRatio * 100).toFixed(0)}%</div>
                <div style={styles.metricLabel}>Compression</div>
              </div>
            </div>
            <div style={styles.bandwidthCard}>
              <span>Bandwidth Saved:</span>
              <span style={styles.bandwidthValue}>{formatBytes(metrics.bandwidthSaved)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Styles
const styles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: '16px',
    maxWidth: '600px',
    margin: '0 auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '24px',
    fontWeight: '600',
    margin: 0,
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px',
    marginBottom: '20px',
  },
  statCard: {
    backgroundColor: '#f3f4f6',
    borderRadius: '8px',
    padding: '12px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#1f2937',
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
  },
  networkCard: {
    backgroundColor: '#f9fafb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '20px',
  },
  networkHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '12px',
    fontWeight: '500',
  },
  networkBar: {
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '12px',
  },
  networkFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  networkStats: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#6b7280',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: '16px',
  },
  tab: {
    flex: 1,
    padding: '12px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#6b7280',
  },
  activeTab: {
    color: '#3b82f6',
    borderBottom: '2px solid #3b82f6',
    fontWeight: '500',
  },
  tabContent: {
    minHeight: '300px',
  },
  section: {
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '12px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  syncButton: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    marginTop: '16px',
  },
  alertCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#fef3c7',
    borderRadius: '8px',
    marginBottom: '12px',
  },
  alertIcon: {
    fontSize: '20px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280',
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  itemCard: {
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    padding: '12px',
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  priorityBadge: {
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: '600',
    color: 'white',
    textTransform: 'uppercase',
  },
  itemType: {
    fontWeight: '500',
  },
  itemDetails: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#6b7280',
  },
  itemError: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '8px',
    padding: '8px',
    backgroundColor: '#fef2f2',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#ef4444',
  },
  retryButton: {
    padding: '4px 12px',
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  conflictCard: {
    backgroundColor: '#fffbeb',
    borderRadius: '8px',
    padding: '12px',
    border: '1px solid #fcd34d',
  },
  conflictHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  conflictType: {
    fontWeight: '600',
  },
  conflictTime: {
    fontSize: '12px',
    color: '#6b7280',
  },
  conflictValues: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '12px',
  },
  conflictValue: {
    backgroundColor: 'white',
    borderRadius: '4px',
    padding: '8px',
  },
  conflictLabel: {
    fontSize: '12px',
    fontWeight: '500',
    marginBottom: '4px',
    display: 'block',
  },
  conflictData: {
    fontSize: '10px',
    margin: 0,
    overflow: 'auto',
    maxHeight: '80px',
  },
  conflictActions: {
    display: 'flex',
    gap: '8px',
  },
  resolveButton: {
    flex: 1,
    padding: '8px',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
    marginBottom: '16px',
  },
  metricCard: {
    backgroundColor: '#f3f4f6',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center',
  },
  metricValue: {
    fontSize: '28px',
    fontWeight: '600',
    color: '#1f2937',
  },
  metricLabel: {
    fontSize: '12px',
    color: '#6b7280',
  },
  bandwidthCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderRadius: '8px',
    padding: '16px',
  },
  bandwidthValue: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#059669',
  },
};

export default SyncDashboard;
