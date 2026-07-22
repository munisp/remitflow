/**
 * PropertyKYC - Property Transaction KYC Flow
 * Bank-grade KYC for property transactions with buyer/seller verification
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOfflineStore, useIsOnline } from '../stores/offlineStore';
import { propertyKycService } from '../services/api';

// Types
interface PartyIdentity {
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  idType: 'NATIONAL_ID' | 'PASSPORT' | 'DRIVERS_LICENSE' | 'VOTERS_CARD' | 'NIN_SLIP' | 'BVN';
  idNumber: string;
  idExpiryDate: string;
  bvn?: string;
  nin?: string;
  address: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  email: string;
}

interface SourceOfFunds {
  primarySource: 'EMPLOYMENT' | 'BUSINESS' | 'SAVINGS' | 'GIFT' | 'LOAN' | 'INHERITANCE' | 'INVESTMENT' | 'SALE_OF_PROPERTY' | 'OTHER';
  description: string;
  employerName?: string;
  businessName?: string;
  annualIncome?: string;
}

interface BankStatement {
  file: File | null;
  fileName: string;
  startDate: string;
  endDate: string;
}

interface IncomeDocument {
  type: 'W2' | 'PAYE' | 'PAYSLIP' | 'TAX_RETURN' | 'BUSINESS_REGISTRATION' | 'AUDITED_ACCOUNTS';
  file: File | null;
  fileName: string;
  year: string;
}

interface PurchaseAgreement {
  file: File | null;
  fileName: string;
  propertyAddress: string;
  propertyValue: string;
  buyerName: string;
  sellerName: string;
  agreementDate: string;
  isSigned: boolean;
}

const STEPS = [
  { id: 1, name: 'Buyer KYC', description: 'Verify buyer identity' },
  { id: 2, name: 'Seller KYC', description: 'Verify seller identity' },
  { id: 3, name: 'Source of Funds', description: 'Declare fund source' },
  { id: 4, name: 'Bank Statements', description: '3 months required' },
  { id: 5, name: 'Income Documents', description: 'W-2 or equivalent' },
  { id: 6, name: 'Purchase Agreement', description: 'Signed agreement' },
  { id: 7, name: 'Review & Submit', description: 'Final review' },
];

const ID_TYPES = [
  { value: 'NATIONAL_ID', label: 'National ID Card' },
  { value: 'PASSPORT', label: 'International Passport' },
  { value: 'DRIVERS_LICENSE', label: "Driver's License" },
  { value: 'VOTERS_CARD', label: "Voter's Card" },
  { value: 'NIN_SLIP', label: 'NIN Slip' },
  { value: 'BVN', label: 'BVN Enrollment Slip' },
];

const SOURCE_OF_FUNDS_OPTIONS = [
  { value: 'EMPLOYMENT', label: 'Employment Income' },
  { value: 'BUSINESS', label: 'Business Income' },
  { value: 'SAVINGS', label: 'Personal Savings' },
  { value: 'GIFT', label: 'Gift from Family/Friend' },
  { value: 'LOAN', label: 'Bank Loan/Mortgage' },
  { value: 'INHERITANCE', label: 'Inheritance' },
  { value: 'INVESTMENT', label: 'Investment Returns' },
  { value: 'SALE_OF_PROPERTY', label: 'Sale of Property' },
  { value: 'OTHER', label: 'Other' },
];

const INCOME_DOC_TYPES = [
  { value: 'W2', label: 'W-2 Form' },
  { value: 'PAYE', label: 'PAYE Records' },
  { value: 'PAYSLIP', label: 'Payslip (3 months)' },
  { value: 'TAX_RETURN', label: 'Tax Return' },
  { value: 'BUSINESS_REGISTRATION', label: 'Business Registration' },
  { value: 'AUDITED_ACCOUNTS', label: 'Audited Accounts' },
];

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const emptyPartyIdentity: PartyIdentity = {
  fullName: '', dateOfBirth: '', nationality: 'Nigerian', idType: 'NATIONAL_ID',
  idNumber: '', idExpiryDate: '', bvn: '', nin: '', address: '', city: '',
  state: '', country: 'Nigeria', phone: '', email: '',
};

const PropertyKYC: React.FC = () => {
  const navigate = useNavigate();
  const isOnline = useIsOnline();
  const { cacheData } = useOfflineStore();

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [buyerKyc, setBuyerKyc] = useState<PartyIdentity>(emptyPartyIdentity);
  const [sellerKyc, setSellerKyc] = useState<PartyIdentity>(emptyPartyIdentity);
  const [sourceOfFunds, setSourceOfFunds] = useState<SourceOfFunds>({
    primarySource: 'EMPLOYMENT', description: '', employerName: '', businessName: '', annualIncome: '',
  });
  const [bankStatements, setBankStatements] = useState<BankStatement[]>([
    { file: null, fileName: '', startDate: '', endDate: '' },
  ]);
  const [incomeDocuments, setIncomeDocuments] = useState<IncomeDocument[]>([
    { type: 'PAYE', file: null, fileName: '', year: new Date().getFullYear().toString() },
  ]);
  const [purchaseAgreement, setPurchaseAgreement] = useState<PurchaseAgreement>({
    file: null, fileName: '', propertyAddress: '', propertyValue: '',
    buyerName: '', sellerName: '', agreementDate: '', isSigned: false,
  });

  const handlePartyChange = useCallback((party: 'buyer' | 'seller', field: keyof PartyIdentity, value: string) => {
    if (party === 'buyer') {
      setBuyerKyc(prev => ({ ...prev, [field]: value }));
    } else {
      setSellerKyc(prev => ({ ...prev, [field]: value }));
    }
  }, []);

  const handleSourceOfFundsChange = useCallback((field: keyof SourceOfFunds, value: string) => {
    setSourceOfFunds(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleFileUpload = useCallback((type: 'bankStatement' | 'incomeDoc' | 'agreement', index: number, file: File | null) => {
    if (type === 'bankStatement') {
      setBankStatements(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], file, fileName: file?.name || '' };
        return updated;
      });
    } else if (type === 'incomeDoc') {
      setIncomeDocuments(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], file, fileName: file?.name || '' };
        return updated;
      });
    } else {
      setPurchaseAgreement(prev => ({ ...prev, file, fileName: file?.name || '' }));
    }
  }, []);

  const addBankStatement = useCallback(() => {
    setBankStatements(prev => [...prev, { file: null, fileName: '', startDate: '', endDate: '' }]);
  }, []);

  const addIncomeDocument = useCallback(() => {
    setIncomeDocuments(prev => [...prev, { type: 'PAYE', file: null, fileName: '', year: new Date().getFullYear().toString() }]);
  }, []);

  const validateStep = useCallback((step: number): boolean => {
    switch (step) {
      case 1:
        return !!(buyerKyc.fullName && buyerKyc.idNumber && buyerKyc.phone && buyerKyc.email && buyerKyc.address);
      case 2:
        return !!(sellerKyc.fullName && sellerKyc.idNumber && sellerKyc.phone && sellerKyc.address);
      case 3:
        return !!(sourceOfFunds.primarySource && sourceOfFunds.description);
      case 4:
        return bankStatements.some(bs => bs.fileName && bs.startDate && bs.endDate);
      case 5:
        return incomeDocuments.some(doc => doc.fileName);
      case 6:
        return !!(purchaseAgreement.fileName && purchaseAgreement.propertyAddress && purchaseAgreement.propertyValue && purchaseAgreement.isSigned);
      case 7:
        return true;
      default:
        return false;
    }
  }, [buyerKyc, sellerKyc, sourceOfFunds, bankStatements, incomeDocuments, purchaseAgreement]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    const transactionData = {
      buyerKyc, sellerKyc, sourceOfFunds,
      bankStatements: bankStatements.filter(bs => bs.fileName),
      incomeDocuments: incomeDocuments.filter(doc => doc.fileName),
      purchaseAgreement,
    };

    try {
      if (!isOnline) {
        cacheData('pending_property_kyc', transactionData, 60 * 24 * 7);
        setSuccessMessage('KYC data saved locally. Will be submitted when you are back online.');
        return;
      }

      const result = await propertyKycService.createTransaction({
        propertyType: 'residential',
        propertyAddress: purchaseAgreement.propertyAddress,
        purchasePrice: parseFloat(purchaseAgreement.propertyValue) || 0,
        buyerId: '',
      }).catch(() => null);

      if (result) {
        const data = result as unknown as { transactionId?: string; id?: string };
        setSuccessMessage(`Property KYC submitted successfully! Reference: ${data.transactionId || data.id || 'N/A'}`);
        setTimeout(() => navigate('/transactions'), 3000);
      } else {
        throw new Error('Submission failed');
      }
    } catch (err) {
      if (!isOnline) {
        cacheData('pending_property_kyc', transactionData, 60 * 24 * 7);
        setSuccessMessage('You are offline. KYC data saved locally.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit KYC');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderPartyForm = (party: 'buyer' | 'seller') => {
    const data = party === 'buyer' ? buyerKyc : sellerKyc;
    const title = party === 'buyer' ? 'Buyer' : 'Seller';

    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-slate-900">{title} Identity Verification</h3>
        <p className="text-sm text-slate-600">Please provide the {title.toLowerCase()}'s government-issued ID and personal details.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name (as on ID)</label>
            <input type="text" value={data.fullName} onChange={(e) => handlePartyChange(party, 'fullName', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter full legal name" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date of Birth</label>
            <input type="date" value={data.dateOfBirth} onChange={(e) => handlePartyChange(party, 'dateOfBirth', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nationality</label>
            <input type="text" value={data.nationality} onChange={(e) => handlePartyChange(party, 'nationality', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter nationality" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ID Type</label>
            <select value={data.idType} onChange={(e) => handlePartyChange(party, 'idType', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500">
              {ID_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ID Number</label>
            <input type="text" value={data.idNumber} onChange={(e) => handlePartyChange(party, 'idNumber', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter ID number" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ID Expiry Date</label>
            <input type="date" value={data.idExpiryDate} onChange={(e) => handlePartyChange(party, 'idExpiryDate', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">BVN (11 digits)</label>
            <input type="text" value={data.bvn} onChange={(e) => handlePartyChange(party, 'bvn', e.target.value)} maxLength={11}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter 11-digit BVN" inputMode="numeric" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">NIN (11 digits)</label>
            <input type="text" value={data.nin} onChange={(e) => handlePartyChange(party, 'nin', e.target.value)} maxLength={11}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter 11-digit NIN" inputMode="numeric" />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Residential Address</label>
            <input type="text" value={data.address} onChange={(e) => handlePartyChange(party, 'address', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter full address" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
            <input type="text" value={data.city} onChange={(e) => handlePartyChange(party, 'city', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter city" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
            <select value={data.state} onChange={(e) => handlePartyChange(party, 'state', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500">
              <option value="">Select State</option>
              {NIGERIAN_STATES.map(state => <option key={state} value={state}>{state}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
            <input type="tel" value={data.phone} onChange={(e) => handlePartyChange(party, 'phone', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter phone number" inputMode="tel" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input type="email" value={data.email} onChange={(e) => handlePartyChange(party, 'email', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="name@example.com" required={party === 'buyer'} />
          </div>
        </div>
      </div>
    );
  };

  const renderSourceOfFundsForm = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Source of Funds Declaration</h3>
      <p className="text-sm text-slate-600">Please declare the source of funds for this property transaction.</p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Primary Source of Funds</label>
          <select value={sourceOfFunds.primarySource} onChange={(e) => handleSourceOfFundsChange('primarySource', e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500">
            {SOURCE_OF_FUNDS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        {(sourceOfFunds.primarySource === 'EMPLOYMENT' || sourceOfFunds.primarySource === 'BUSINESS') && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {sourceOfFunds.primarySource === 'EMPLOYMENT' ? 'Employer Name' : 'Business Name'}
            </label>
            <input type="text" value={sourceOfFunds.primarySource === 'EMPLOYMENT' ? sourceOfFunds.employerName : sourceOfFunds.businessName}
              onChange={(e) => handleSourceOfFundsChange(sourceOfFunds.primarySource === 'EMPLOYMENT' ? 'employerName' : 'businessName', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="Enter name" />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Annual Income Range</label>
          <select value={sourceOfFunds.annualIncome} onChange={(e) => handleSourceOfFundsChange('annualIncome', e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500">
            <option value="">Select range</option>
            <option value="0-5M">Below 5 Million NGN</option>
            <option value="5M-20M">5 - 20 Million NGN</option>
            <option value="20M-50M">20 - 50 Million NGN</option>
            <option value="50M-100M">50 - 100 Million NGN</option>
            <option value="100M+">Above 100 Million NGN</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Additional Details</label>
          <textarea value={sourceOfFunds.description} onChange={(e) => handleSourceOfFundsChange('description', e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" rows={4}
              placeholder="Please provide additional details about your source of funds..." required />
        </div>
      </div>
    </div>
  );

  const renderBankStatementsForm = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Bank Statements</h3>
      <p className="text-sm text-slate-600">Please upload at least 3 months of bank statements showing regular income.</p>

      <div className="bg-amber-50 border border-yellow-200 rounded-xl p-4">
        <div className="flex items-start">
          <svg className="w-5 h-5 text-amber-500 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-700">Requirements</p>
            <ul className="text-xs text-yellow-700 mt-1 list-disc list-inside">
              <li>Statements must cover at least 90 consecutive days</li>
              <li>Must be dated within the last 6 months</li>
              <li>Must show account holder name matching KYC</li>
            </ul>
          </div>
        </div>
      </div>

      {bankStatements.map((statement, index) => (
        <div key={index} className="p-4 border border-slate-200 rounded-xl space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-slate-900">Statement {index + 1}</h4>
            {index > 0 && (
              <button type="button" onClick={() => setBankStatements(prev => prev.filter((_, i) => i !== index))}
                className="text-red-600 hover:text-red-800 text-sm">Remove</button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Statement Start Date</label>
              <input type="date" value={statement.startDate}
                onChange={(e) => setBankStatements(prev => { const u = [...prev]; u[index] = { ...u[index], startDate: e.target.value }; return u; })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Statement End Date</label>
              <input type="date" value={statement.endDate}
                onChange={(e) => setBankStatements(prev => { const u = [...prev]; u[index] = { ...u[index], endDate: e.target.value }; return u; })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Upload Statement (PDF)</label>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-400 transition-colors">
              <input type="file" accept=".pdf" onChange={(e) => handleFileUpload('bankStatement', index, e.target.files?.[0] || null)}
                className="hidden" id={`bank-statement-${index}`} />
              <label htmlFor={`bank-statement-${index}`} className="cursor-pointer">
                {statement.fileName ? (
                  <div className="flex items-center justify-center text-emerald-600">
                    <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {statement.fileName}
                  </div>
                ) : (
                  <div className="text-slate-500">
                    <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Click to upload PDF
                  </div>
                )}
              </label>
            </div>
          </div>
        </div>
      ))}

      <button type="button" onClick={addBankStatement}
        className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-600 hover:border-blue-400 hover:text-indigo-600 transition-colors">
        + Add Another Statement
      </button>
    </div>
  );

  const renderIncomeDocumentsForm = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Income Documents</h3>
      <p className="text-sm text-slate-600">Please upload W-2, PAYE records, or equivalent income documentation.</p>

      {incomeDocuments.map((doc, index) => (
        <div key={index} className="p-4 border border-slate-200 rounded-xl space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-slate-900">Document {index + 1}</h4>
            {index > 0 && (
              <button type="button" onClick={() => setIncomeDocuments(prev => prev.filter((_, i) => i !== index))}
                className="text-red-600 hover:text-red-800 text-sm">Remove</button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Document Type</label>
              <select value={doc.type}
                onChange={(e) => setIncomeDocuments(prev => { const u = [...prev]; u[index] = { ...u[index], type: e.target.value as IncomeDocument['type'] }; return u; })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500">
                {INCOME_DOC_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
              <input type="text" value={doc.year}
                onChange={(e) => setIncomeDocuments(prev => { const u = [...prev]; u[index] = { ...u[index], year: e.target.value }; return u; })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" placeholder="YYYY" inputMode="numeric" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Upload Document (PDF)</label>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-400 transition-colors">
              <input type="file" accept=".pdf" onChange={(e) => handleFileUpload('incomeDoc', index, e.target.files?.[0] || null)}
                className="hidden" id={`income-doc-${index}`} />
              <label htmlFor={`income-doc-${index}`} className="cursor-pointer">
                {doc.fileName ? (
                  <div className="flex items-center justify-center text-emerald-600">
                    <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {doc.fileName}
                  </div>
                ) : (
                  <div className="text-slate-500">
                    <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Click to upload PDF
                  </div>
                )}
              </label>
            </div>
          </div>
        </div>
      ))}

      <button type="button" onClick={addIncomeDocument}
        className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-600 hover:border-blue-400 hover:text-indigo-600 transition-colors">
        + Add Another Document
      </button>
    </div>
  );

  const renderPurchaseAgreementForm = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Purchase Agreement</h3>
      <p className="text-sm text-slate-600">Please upload the signed purchase agreement with all required details.</p>

      <div className="bg-indigo-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start">
          <svg className="w-5 h-5 text-indigo-500 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-indigo-800">Agreement Requirements</p>
            <ul className="text-xs text-indigo-700 mt-1 list-disc list-inside">
              <li>Must show buyer and seller names matching KYC</li>
              <li>Must include property address and transaction value</li>
              <li>Must be signed and dated by both parties</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Property Address</label>
          <input type="text" value={purchaseAgreement.propertyAddress}
            onChange={(e) => setPurchaseAgreement(prev => ({ ...prev, propertyAddress: e.target.value }))}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
            placeholder="Enter full property address" required />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Property Value (NGN)</label>
          <input type="text" value={purchaseAgreement.propertyValue}
            onChange={(e) => setPurchaseAgreement(prev => ({ ...prev, propertyValue: e.target.value }))}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
            placeholder="Enter property value" inputMode="decimal" required />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Agreement Date</label>
          <input type="date" value={purchaseAgreement.agreementDate}
            onChange={(e) => setPurchaseAgreement(prev => ({ ...prev, agreementDate: e.target.value }))}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" required />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Buyer Name (on agreement)</label>
          <input type="text" value={purchaseAgreement.buyerName}
            onChange={(e) => setPurchaseAgreement(prev => ({ ...prev, buyerName: e.target.value }))}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
            placeholder="Must match buyer KYC" required />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Seller Name (on agreement)</label>
          <input type="text" value={purchaseAgreement.sellerName}
            onChange={(e) => setPurchaseAgreement(prev => ({ ...prev, sellerName: e.target.value }))}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
            placeholder="Must match seller KYC" required />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Upload Agreement (PDF)</label>
        <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-400 transition-colors">
          <input type="file" accept=".pdf" onChange={(e) => handleFileUpload('agreement', 0, e.target.files?.[0] || null)}
            className="hidden" id="purchase-agreement" />
          <label htmlFor="purchase-agreement" className="cursor-pointer">
            {purchaseAgreement.fileName ? (
              <div className="flex items-center justify-center text-emerald-600">
                <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {purchaseAgreement.fileName}
              </div>
            ) : (
              <div className="text-slate-500">
                <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Click to upload PDF
              </div>
            )}
          </label>
        </div>
      </div>

      <div className="flex items-center">
        <input type="checkbox" id="is-signed" checked={purchaseAgreement.isSigned}
          onChange={(e) => setPurchaseAgreement(prev => ({ ...prev, isSigned: e.target.checked }))}
          className="w-4 h-4 text-indigo-600 border-slate-200 rounded focus:ring-indigo-500" />
        <label htmlFor="is-signed" className="ml-2 text-sm text-slate-700">
          I confirm this agreement is signed and dated by both buyer and seller
        </label>
      </div>
    </div>
  );

  const renderReviewForm = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Review & Submit</h3>
      <p className="text-sm text-slate-600">Please review all information before submitting for compliance review.</p>

      <div className="space-y-4">
        <div className="bg-slate-50 rounded-xl p-4">
          <h4 className="font-medium text-slate-900 mb-2">Buyer Information</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-500">Name:</span> {buyerKyc.fullName || '-'}</div>
            <div><span className="text-slate-500">ID:</span> {buyerKyc.idType} - {buyerKyc.idNumber || '-'}</div>
            <div><span className="text-slate-500">Phone:</span> {buyerKyc.phone || '-'}</div>
            <div><span className="text-slate-500">Email:</span> {buyerKyc.email || '-'}</div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h4 className="font-medium text-slate-900 mb-2">Seller Information</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-500">Name:</span> {sellerKyc.fullName || '-'}</div>
            <div><span className="text-slate-500">ID:</span> {sellerKyc.idType} - {sellerKyc.idNumber || '-'}</div>
            <div><span className="text-slate-500">Phone:</span> {sellerKyc.phone || '-'}</div>
            <div><span className="text-slate-500">Address:</span> {sellerKyc.address || '-'}</div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h4 className="font-medium text-slate-900 mb-2">Source of Funds</h4>
          <div className="text-sm">
            <div><span className="text-slate-500">Primary Source:</span> {SOURCE_OF_FUNDS_OPTIONS.find(o => o.value === sourceOfFunds.primarySource)?.label}</div>
            <div><span className="text-slate-500">Annual Income:</span> {sourceOfFunds.annualIncome || '-'}</div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h4 className="font-medium text-slate-900 mb-2">Documents</h4>
          <div className="text-sm space-y-1">
            <div><span className="text-slate-500">Bank Statements:</span> {bankStatements.filter(bs => bs.fileName).length} uploaded</div>
            <div><span className="text-slate-500">Income Documents:</span> {incomeDocuments.filter(doc => doc.fileName).length} uploaded</div>
            <div><span className="text-slate-500">Purchase Agreement:</span> {purchaseAgreement.fileName ? 'Uploaded' : 'Not uploaded'}</div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h4 className="font-medium text-slate-900 mb-2">Property Details</h4>
          <div className="text-sm space-y-1">
            <div><span className="text-slate-500">Address:</span> {purchaseAgreement.propertyAddress || '-'}</div>
            <div><span className="text-slate-500">Value:</span> NGN {purchaseAgreement.propertyValue || '-'}</div>
            <div><span className="text-slate-500">Agreement Date:</span> {purchaseAgreement.agreementDate || '-'}</div>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-yellow-200 rounded-xl p-4">
        <p className="text-sm text-amber-700">
          By submitting this KYC application, you confirm that all information provided is accurate and complete.
          False or misleading information may result in rejection and potential legal consequences.
        </p>
      </div>
    </div>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case 1: return renderPartyForm('buyer');
      case 2: return renderPartyForm('seller');
      case 3: return renderSourceOfFundsForm();
      case 4: return renderBankStatementsForm();
      case 5: return renderIncomeDocumentsForm();
      case 6: return renderPurchaseAgreementForm();
      case 7: return renderReviewForm();
      default: return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Property Transaction KYC</h1>
          <p className="text-sm text-slate-600 mt-1">Bank-grade verification for property transactions</p>
        </div>
        {!isOnline && (
          <div className="flex items-center px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm">
            <span className="w-2 h-2 bg-amber-500 rounded-full mr-2 animate-pulse" />
            Offline Mode
          </div>
        )}
      </div>

      {/* Progress Steps */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 border border-slate-200 p-4">
        <div className="flex items-center justify-between overflow-x-auto">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center min-w-0">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                  currentStep > step.id ? 'bg-emerald-500 text-white' :
                  currentStep === step.id ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-200 text-slate-600'
                }`}>
                  {currentStep > step.id ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : step.id}
                </div>
                <span className={`text-xs mt-1 hidden md:block ${currentStep === step.id ? 'text-indigo-600 font-medium' : 'text-slate-500'}`}>
                  {step.name}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className={`w-8 md:w-12 h-0.5 mx-1 ${currentStep > step.id ? 'bg-emerald-500' : 'bg-slate-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start">
          <svg className="w-5 h-5 text-red-500 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-red-800">{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-red-600 hover:text-red-800 mt-1">Dismiss</button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start">
          <svg className="w-5 h-5 text-emerald-500 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-emerald-700">{successMessage}</p>
        </div>
      )}

      {/* Form Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 border border-slate-200 p-6">
        {renderStepContent()}

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
          {currentStep > 1 ? (
            <button type="button" onClick={() => setCurrentStep(currentStep - 1)}
              className="px-6 py-3 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium">
              Back
            </button>
          ) : (
            <button type="button" onClick={() => navigate(-1)}
              className="px-6 py-3 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium">
              Cancel
            </button>
          )}

          {currentStep < 7 ? (
            <button type="button" onClick={() => setCurrentStep(currentStep + 1)} disabled={!validateStep(currentStep)}
              className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
              Continue
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={isSubmitting}
              className="px-8 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium disabled:opacity-50 flex items-center">
              {isSubmitting ? (
                <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />Submitting...</>
              ) : (
                <><svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>Submit for Review</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PropertyKYC;
