import { useEffect, useState } from 'react';
import { useIsOnline } from '../stores/offlineStore';

type EffectiveConnectionType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

interface NetworkInformation extends EventTarget {
  effectiveType?: EffectiveConnectionType;
  saveData?: boolean;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformation;
  mozConnection?: NetworkInformation;
  webkitConnection?: NetworkInformation;
}

const getConnection = (): NetworkInformation | undefined => {
  const nav = navigator as NavigatorWithConnection;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
};

export interface NetworkStatus {
  isOnline: boolean;
  effectiveType: EffectiveConnectionType;
  saveData: boolean;
  isSlowConnection: boolean;
}

/**
 * Reports online/offline state (via the existing offline store) plus, where the
 * browser exposes the Network Information API, connection quality — useful for
 * dialing back polling/prefetching on the slow/intermittent connections common
 * in the markets this app targets.
 */
export function useNetworkStatus(): NetworkStatus {
  const isOnline = useIsOnline();
  const [connectionInfo, setConnectionInfo] = useState<{
    effectiveType: EffectiveConnectionType;
    saveData: boolean;
  }>(() => {
    const connection = getConnection();
    return {
      effectiveType: connection?.effectiveType ?? 'unknown',
      saveData: connection?.saveData ?? false,
    };
  });

  useEffect(() => {
    const connection = getConnection();
    if (!connection) return;

    const updateConnectionInfo = () => {
      setConnectionInfo({
        effectiveType: connection.effectiveType ?? 'unknown',
        saveData: connection.saveData ?? false,
      });
    };

    connection.addEventListener('change', updateConnectionInfo);
    return () => connection.removeEventListener('change', updateConnectionInfo);
  }, []);

  return {
    isOnline,
    effectiveType: connectionInfo.effectiveType,
    saveData: connectionInfo.saveData,
    isSlowConnection: connectionInfo.effectiveType === 'slow-2g' || connectionInfo.effectiveType === '2g',
  };
}
