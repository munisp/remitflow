import React, { useState } from 'react';
import { useUpiintegrationService } from '../../hooks/useUpiintegrationService';

interface UPIPaymentProps {
  amount: number;
  currency: string;
  recipientUPI: string;
  onSuccess: (transactionId: string) => void;
  onError: (error: Error) => void;
}

export const UPIPayment: React.FC<UPIPaymentProps> = ({
  amount,
  currency,
  recipientUPI,
  onSuccess,
  onError
}) => {
  const [loading, setLoading] = useState(false);
  const { create } = useUpiintegrationService();

  const handlePayment = async () => {
    setLoading(true);
    try {
      const result = await create({
        amount,
        currency,
        recipient_upi: recipientUPI,
        payment_method: 'upi'
      });
      onSuccess(result.data.id);
    } catch (error) {
      onError(error as Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upi-payment-container p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">UPI Payment</h2>
      <div className="payment-details mb-4">
        <p className="text-lg">Amount: {currency} {amount}</p>
        <p className="text-gray-600">Recipient: {recipientUPI}</p>
      </div>
      <button 
        onClick={handlePayment} 
        disabled={loading}
        className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
      >
        {loading ? 'Processing...' : 'Pay with UPI'}
      </button>
    </div>
  );
};
