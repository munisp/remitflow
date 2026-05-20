'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

type LoadingVariant = 'spinner' | 'dots' | 'pulse' | 'bars';
type LoadingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface LoadingProps {
  variant?: LoadingVariant;
  size?: LoadingSize;
  color?: string;
  text?: string;
  fullScreen?: boolean;
  overlay?: boolean;
}

/**
 * Loading Component
 * 
 * Loading indicators for async operations with multiple variants.
 * 
 * Features:
 * - 4 variants (spinner, dots, pulse, bars)
 * - 5 sizes (xs, sm, md, lg, xl)
 * - Custom colors
 * - Optional text
 * - Full-screen overlay
 * - Inline variant
 * 
 * @example
 * ```tsx
 * <Loading variant="spinner" size="md" text="Loading..." />
 * <Loading variant="dots" size="sm" />
 * <Loading fullScreen overlay text="Please wait..." />
 * ```
 */
export const Loading: React.FC<LoadingProps> = ({
  variant = 'spinner',
  size = 'md',
  color = 'text-blue-600',
  text,
  fullScreen = false,
  overlay = false,
}) => {
  const getSizeClass = () => {
    switch (size) {
      case 'xs':
        return 'w-3 h-3';
      case 'sm':
        return 'w-4 h-4';
      case 'md':
        return 'w-6 h-6';
      case 'lg':
        return 'w-8 h-8';
      case 'xl':
        return 'w-12 h-12';
      default:
        return 'w-6 h-6';
    }
  };

  const getTextSize = () => {
    switch (size) {
      case 'xs':
        return 'text-xs';
      case 'sm':
        return 'text-sm';
      case 'md':
        return 'text-base';
      case 'lg':
        return 'text-lg';
      case 'xl':
        return 'text-xl';
      default:
        return 'text-base';
    }
  };

  const renderSpinner = () => (
    <Loader2 className={`${getSizeClass()} ${color} animate-spin`} />
  );

  const renderDots = () => (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`${getSizeClass()} ${color.replace('text-', 'bg-')} rounded-full animate-pulse`}
          style={{
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );

  const renderPulse = () => (
    <div className={`${getSizeClass()} ${color.replace('text-', 'bg-')} rounded-full animate-ping`} />
  );

  const renderBars = () => (
    <div className="flex items-end gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`w-1 ${color.replace('text-', 'bg-')} rounded-full animate-pulse`}
          style={{
            height: `${[12, 16, 20, 16][i]}px`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );

  const renderLoader = () => {
    switch (variant) {
      case 'spinner':
        return renderSpinner();
      case 'dots':
        return renderDots();
      case 'pulse':
        return renderPulse();
      case 'bars':
        return renderBars();
      default:
        return renderSpinner();
    }
  };

  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      {renderLoader()}
      {text && <p className={`${getTextSize()} ${color} font-medium`}>{text}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center ${
          overlay ? 'bg-black bg-opacity-50' : 'bg-white'
        }`}
      >
        {content}
      </div>
    );
  }

  return content;
};

/**
 * LoadingButton Component
 * 
 * Button with inline loading state.
 * 
 * @example
 * ```tsx
 * <LoadingButton loading={isLoading}>
 *   Submit
 * </LoadingButton>
 * ```
 */
interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: React.ReactNode;
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  loading = false,
  children,
  disabled,
  className = '',
  ...props
}) => {
  return (
    <button
      disabled={disabled || loading}
      className={`relative ${className}`}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
        </span>
      )}
      <span className={loading ? 'invisible' : ''}>{children}</span>
    </button>
  );
};

/**
 * LoadingOverlay Component
 * 
 * Overlay loading for specific sections.
 * 
 * @example
 * ```tsx
 * <div className="relative">
 *   <YourContent />
 *   {isLoading && <LoadingOverlay />}
 * </div>
 * ```
 */
export const LoadingOverlay: React.FC<{ text?: string }> = ({ text }) => {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white bg-opacity-90">
      <Loading text={text} />
    </div>
  );
};

export default Loading;

