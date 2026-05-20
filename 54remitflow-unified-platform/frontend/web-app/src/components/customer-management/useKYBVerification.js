import { useState } from 'react';

const KYB_API_URL = import.meta.env.VITE_KYB_API_URL || 'http://localhost:8121';

export const useKYBVerification = () => {
  const [kybStatus, setKybStatus] = useState('idle');
  const [kybResult, setKybResult] = useState(null);

  const initiateKyb = async (customerData) => {
    setKybStatus('processing');
    setKybResult(null);

    try {
      const response = await fetch(`${KYB_API_URL}/kyb/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: customerData.businessName || customerData.business_name,
          business_type: customerData.businessType || customerData.business_type || 'llc',
          registration_number: customerData.registrationNumber || customerData.registration_number,
          tax_id: customerData.taxId || customerData.tax_id,
          incorporation_country: customerData.country || 'Nigeria',
          incorporation_state: customerData.state,
          email: customerData.email,
          phone: customerData.phone,
          industry: customerData.industry,
          beneficial_owners: customerData.beneficialOwners || customerData.beneficial_owners || [],
          verification_path: customerData.verificationPath || 'standard',
        }),
      });

      if (!response.ok) {
        throw new Error(`KYB API returned ${response.status}`);
      }

      const data = await response.json();
      setKybResult(data);
      setKybStatus(data.status === 'rejected' ? 'error' : 'success');
    } catch (error) {
      console.error('KYB verification failed:', error);
      setKybResult({ error: error.message });
      setKybStatus('error');
    }
  };

  const getKybStatus = async (verificationId) => {
    try {
      const response = await fetch(`${KYB_API_URL}/kyb/status/${verificationId}`);
      if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
      const data = await response.json();
      setKybResult(data);
      return data;
    } catch (error) {
      console.error('KYB status check failed:', error);
      return null;
    }
  };

  return { kybStatus, kybResult, initiateKyb, getKybStatus };
};
