/**
 * OfflinePage - Displayed when user is offline
 */

import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="p-8 max-w-md text-center">
        <WifiOff className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          You're Offline
        </h1>
        <p className="text-gray-600 mb-6">
          Please check your internet connection and try again.
        </p>
        <Button onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </Card>
    </div>
  );
}

