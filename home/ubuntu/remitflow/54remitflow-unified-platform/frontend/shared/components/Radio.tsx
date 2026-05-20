'use client';

import React, { forwardRef } from 'react';

type RadioSize = 'sm' | 'md' | 'lg';

interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  description?: string;
  error?: string;
  size?: RadioSize;
}

/**
 * Radio Component
 * 
 * Radio button input with label and description.
 * 
 * Features:
 * - 3 sizes (sm, md, lg)
 * - Label and description support
 * - Error state
 * - Disabled state
 * - Custom styling
 * - forwardRef support
 * 
 * @example
 * ```tsx
 * <Radio
 *   name="payment"
 *   value="card"
 *   label="Credit Card"
 *   description="Pay with credit or debit card"
 *   checked={method === 'card'}
 *   onChange={(e) => setMethod(e.target.value)}
 * />
 * ```
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  (
    {
      label,
      description,
      error,
      size = 'md',
      className = '',
      disabled = false,
      ...props
    },
    ref
  ) => {
    const getSizeClass = () => {
      switch (size) {
        case 'sm':
          return 'w-4 h-4';
        case 'md':
          return 'w-5 h-5';
        case 'lg':
          return 'w-6 h-6';
        default:
          return 'w-5 h-5';
      }
    };

    const getDotSize = () => {
      switch (size) {
        case 'sm':
          return 'w-2 h-2';
        case 'md':
          return 'w-2.5 h-2.5';
        case 'lg':
          return 'w-3 h-3';
        default:
          return 'w-2.5 h-2.5';
      }
    };

    const getLabelSize = () => {
      switch (size) {
        case 'sm':
          return 'text-sm';
        case 'md':
          return 'text-base';
        case 'lg':
          return 'text-lg';
        default:
          return 'text-base';
      }
    };

    const radioId = props.id || `radio-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div className={className}>
        <div className="flex items-start gap-2">
          <div className="relative flex items-center">
            <input
              ref={ref}
              type="radio"
              id={radioId}
              disabled={disabled}
              className="sr-only peer"
              {...props}
            />
            <div
              className={`
                ${getSizeClass()}
                flex items-center justify-center
                border-2 rounded-full
                transition-all duration-200
                ${
                  error
                    ? 'border-red-500'
                    : 'border-gray-300 peer-focus:border-blue-500 peer-focus:ring-2 peer-focus:ring-blue-500 peer-focus:ring-offset-1'
                }
                ${
                  disabled
                    ? 'bg-gray-100 cursor-not-allowed'
                    : 'bg-white cursor-pointer peer-checked:border-blue-600'
                }
              `}
              onClick={() => {
                if (!disabled) {
                  const input = document.getElementById(radioId) as HTMLInputElement;
                  input?.click();
                }
              }}
            >
              {props.checked && (
                <div className={`${getDotSize()} bg-blue-600 rounded-full`} />
              )}
            </div>
          </div>

          {(label || description) && (
            <div className="flex-1">
              {label && (
                <label
                  htmlFor={radioId}
                  className={`
                    ${getLabelSize()}
                    font-medium
                    ${disabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-900 cursor-pointer'}
                  `}
                >
                  {label}
                </label>
              )}
              {description && (
                <p className="text-sm text-gray-500 mt-0.5">{description}</p>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
      </div>
    );
  }
);

Radio.displayName = 'Radio';

/**
 * RadioGroup Component
 * 
 * Group of radio buttons with shared name and label.
 * 
 * @example
 * ```tsx
 * <RadioGroup
 *   label="Payment Method"
 *   name="payment"
 *   value={method}
 *   onChange={setMethod}
 *   error={error}
 * >
 *   <Radio value="card" label="Credit Card" description="Visa, Mastercard" />
 *   <Radio value="bank" label="Bank Transfer" description="Direct bank transfer" />
 *   <Radio value="wallet" label="Mobile Wallet" description="Pay with mobile money" />
 * </RadioGroup>
 * ```
 */
interface RadioGroupProps {
  label?: string;
  description?: string;
  error?: string;
  name: string;
  value?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({
  label,
  description,
  error,
  name,
  value,
  onChange,
  children,
  orientation = 'vertical',
  required = false,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e.target.value);
  };

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      {description && (
        <p className="text-sm text-gray-500 mb-3">{description}</p>
      )}
      <div
        className={`
          flex gap-4
          ${orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'}
        `}
      >
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement<any>, {
              name,
              checked: child.props.value === value,
              onChange: handleChange,
            });
          }
          return child;
        })}
      </div>
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
    </div>
  );
};

export default Radio;

