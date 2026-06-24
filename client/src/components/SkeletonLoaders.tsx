/**
 * SkeletonLoaders.tsx — Shimmer/skeleton placeholders for all list screens
 *
 * Replaces spinner loading states with content-shaped placeholders
 * for perceived performance improvement. Used in:
 * - Transaction lists
 * - Wallet balance cards
 * - Contact lists
 * - KYC document lists
 * - Notification feeds
 */

import React from "react";

// Base shimmer animation (CSS-in-JS for portability)
const shimmerStyle = {
  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.5s infinite",
};

export function TransactionListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center space-x-3 p-4 bg-white dark:bg-gray-800 rounded-lg">
          <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          </div>
          <div className="text-right space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16 ml-auto" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WalletBalanceSkeleton() {
  return (
    <div className="animate-pulse bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-6">
      <div className="h-3 bg-white/20 rounded w-24 mb-2" />
      <div className="h-8 bg-white/20 rounded w-40 mb-4" />
      <div className="flex space-x-2">
        <div className="h-8 bg-white/20 rounded-full w-20" />
        <div className="h-8 bg-white/20 rounded-full w-20" />
        <div className="h-8 bg-white/20 rounded-full w-20" />
      </div>
    </div>
  );
}

export function ContactListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center space-x-3 p-3">
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function KYCDocumentSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-12 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-28" />
            </div>
            <div className="w-20 h-6 bg-gray-200 dark:bg-gray-700 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationFeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-1 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start space-x-3 p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full mt-1" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="animate-pulse bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
      <div className="flex justify-between items-start mb-8">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20" />
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-10" />
      </div>
      <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-4" />
      <div className="flex justify-between">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
      </div>
    </div>
  );
}

export function CurrencyListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="space-y-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex flex-col items-center">
        <div className="w-20 h-20 bg-gray-200 dark:bg-gray-700 rounded-full mb-3" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-1" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-28" />
            </div>
            <div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Global shimmer keyframes (inject once)
export function ShimmerStyles() {
  return (
    <style>{`
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
    `}</style>
  );
}
