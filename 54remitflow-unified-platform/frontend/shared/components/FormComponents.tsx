'use client';

import React, { useState } from 'react';
import { User, Mail, Phone, MapPin, Lock, Eye, EyeOff, Upload, AlertCircle, CheckCircle } from 'lucide-react';

// ==================== BENEFICIARYFORM COMPONENT ====================

interface BeneficiaryFormData {
  type: 'bank' | 'mobile';
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  bankName?: string;
  accountNumber?: string;
  walletProvider?: string;
  walletNumber?: string;
  isFavorite?: boolean;
}

interface BeneficiaryFormProps {
  initialData?: Partial<BeneficiaryFormData>;
  onSubmit: (data: BeneficiaryFormData) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

export const BeneficiaryForm: React.FC<BeneficiaryFormProps> = ({
  initialData,
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const [formData, setFormData] = useState<BeneficiaryFormData>({
    type: 'bank',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    bankName: '',
    accountNumber: '',
    walletProvider: '',
    walletNumber: '',
    isFavorite: false,
    ...initialData,
  });

  const [errors, setErrors] = useState<Partial<Record<keyof BeneficiaryFormData, string>>>({});

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof BeneficiaryFormData, string>> = {};

    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';

    if (formData.type === 'bank') {
      if (!formData.bankName) newErrors.bankName = 'Bank name is required';
      if (!formData.accountNumber) newErrors.accountNumber = 'Account number is required';
      else if (!/^\d{10}$/.test(formData.accountNumber)) {
        newErrors.accountNumber = 'Account number must be 10 digits';
      }
    } else {
      if (!formData.walletProvider) newErrors.walletProvider = 'Wallet provider is required';
      if (!formData.walletNumber) newErrors.walletNumber = 'Wallet number is required';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }

    if (formData.phone && !/^(\+234|0)[789]\d{9}$/.test(formData.phone)) {
      newErrors.phone = 'Invalid Nigerian phone number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      await onSubmit(formData);
    }
  };

  const handleChange = (field: keyof BeneficiaryFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const nigerianBanks = [
    'Access Bank', 'GTBank', 'First Bank', 'UBA', 'Zenith Bank',
    'Ecobank', 'Fidelity Bank', 'FCMB', 'Sterling Bank', 'Union Bank',
    'Wema Bank', 'Polaris Bank', 'Stanbic IBTC', 'Keystone Bank',
  ];

  const walletProviders = ['OPay', 'PalmPay', 'Kuda', 'Moniepoint', 'Paga'];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Type Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Beneficiary Type <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => handleChange('type', 'bank')}
            className={`p-4 border-2 rounded-lg transition-all ${
              formData.type === 'bank'
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="font-medium">Bank Account</div>
            <div className="text-xs text-gray-500 mt-1">Transfer to bank account</div>
          </button>
          <button
            type="button"
            onClick={() => handleChange('type', 'mobile')}
            className={`p-4 border-2 rounded-lg transition-all ${
              formData.type === 'mobile'
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="font-medium">Mobile Wallet</div>
            <div className="text-xs text-gray-500 mt-1">Transfer to mobile wallet</div>
          </button>
        </div>
      </div>

      {/* Personal Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => handleChange('firstName', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              errors.firstName ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="John"
          />
          {errors.firstName && <p className="mt-1 text-sm text-red-500">{errors.firstName}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => handleChange('lastName', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              errors.lastName ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="Doe"
          />
          {errors.lastName && <p className="mt-1 text-sm text-red-500">{errors.lastName}</p>}
        </div>
      </div>

      {/* Contact Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email (Optional)</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => handleChange('email', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              errors.email ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="john.doe@example.com"
          />
          {errors.email && <p className="mt-1 text-sm text-red-500">{errors.email}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone (Optional)</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              errors.phone ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="+234 801 234 5678"
          />
          {errors.phone && <p className="mt-1 text-sm text-red-500">{errors.phone}</p>}
        </div>
      </div>

      {/* Bank Details */}
      {formData.type === 'bank' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bank Name <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.bankName}
              onChange={(e) => handleChange('bankName', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                errors.bankName ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
              }`}
            >
              <option value="">Select bank</option>
              {nigerianBanks.map((bank) => (
                <option key={bank} value={bank}>
                  {bank}
                </option>
              ))}
            </select>
            {errors.bankName && <p className="mt-1 text-sm text-red-500">{errors.bankName}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Account Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.accountNumber}
              onChange={(e) => handleChange('accountNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                errors.accountNumber ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
              }`}
              placeholder="1234567890"
              maxLength={10}
            />
            {errors.accountNumber && <p className="mt-1 text-sm text-red-500">{errors.accountNumber}</p>}
          </div>
        </div>
      )}

      {/* Mobile Wallet Details */}
      {formData.type === 'mobile' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Wallet Provider <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.walletProvider}
              onChange={(e) => handleChange('walletProvider', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                errors.walletProvider ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
              }`}
            >
              <option value="">Select provider</option>
              {walletProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
            {errors.walletProvider && <p className="mt-1 text-sm text-red-500">{errors.walletProvider}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Wallet Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.walletNumber}
              onChange={(e) => handleChange('walletNumber', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                errors.walletNumber ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
              }`}
              placeholder="+234 801 234 5678"
            />
            {errors.walletNumber && <p className="mt-1 text-sm text-red-500">{errors.walletNumber}</p>}
          </div>
        </div>
      )}

      {/* Favorite */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isFavorite"
          checked={formData.isFavorite}
          onChange={(e) => handleChange('isFavorite', e.target.checked)}
          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
        <label htmlFor="isFavorite" className="text-sm text-gray-700">
          Add to favorites for quick access
        </label>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Saving...' : initialData ? 'Update Beneficiary' : 'Add Beneficiary'}
        </button>
      </div>
    </form>
  );
};

// ==================== KYCFORM COMPONENT ====================

interface KYCFormData {
  documentType: 'nin' | 'bvn' | 'passport' | 'drivers_license';
  documentNumber: string;
  documentFile?: File;
  selfieFile?: File;
  dateOfBirth: string;
  address: string;
  city: string;
  state: string;
}

interface KYCFormProps {
  onSubmit: (data: KYCFormData) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

export const KYCForm: React.FC<KYCFormProps> = ({ onSubmit, onCancel, isLoading = false }) => {
  const [formData, setFormData] = useState<KYCFormData>({
    documentType: 'nin',
    documentNumber: '',
    dateOfBirth: '',
    address: '',
    city: '',
    state: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof KYCFormData, string>>>({});

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof KYCFormData, string>> = {};

    if (!formData.documentNumber.trim()) {
      newErrors.documentNumber = 'Document number is required';
    } else {
      if (formData.documentType === 'nin' && !/^\d{11}$/.test(formData.documentNumber)) {
        newErrors.documentNumber = 'NIN must be 11 digits';
      } else if (formData.documentType === 'bvn' && !/^\d{11}$/.test(formData.documentNumber)) {
        newErrors.documentNumber = 'BVN must be 11 digits';
      }
    }

    if (!formData.documentFile) newErrors.documentFile = 'Document photo is required';
    if (!formData.selfieFile) newErrors.selfieFile = 'Selfie is required';
    if (!formData.dateOfBirth) newErrors.dateOfBirth = 'Date of birth is required';
    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state) newErrors.state = 'State is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      await onSubmit(formData);
    }
  };

  const handleChange = (field: keyof KYCFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleFileChange = (field: 'documentFile' | 'selfieFile', file: File | undefined) => {
    setFormData((prev) => ({ ...prev, [field]: file }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const nigerianStates = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
    'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
    'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
    'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
    'Yobe', 'Zamfara',
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">KYC Verification Required</p>
            <p>Please provide accurate information. This process helps us comply with regulatory requirements and protect your account.</p>
          </div>
        </div>
      </div>

      {/* Document Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Document Type <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { value: 'nin', label: 'NIN' },
            { value: 'bvn', label: 'BVN' },
            { value: 'passport', label: 'Passport' },
            { value: 'drivers_license', label: 'Driver\'s License' },
          ].map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => handleChange('documentType', type.value)}
              className={`p-3 border-2 rounded-lg transition-all ${
                formData.documentType === type.value
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-medium">{type.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Document Number */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Document Number <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.documentNumber}
          onChange={(e) => handleChange('documentNumber', e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
            errors.documentNumber ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
          }`}
          placeholder={formData.documentType === 'nin' || formData.documentType === 'bvn' ? '12345678901' : 'Enter document number'}
        />
        {errors.documentNumber && <p className="mt-1 text-sm text-red-500">{errors.documentNumber}</p>}
      </div>

      {/* File Uploads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Document Photo <span className="text-red-500">*</span>
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFileChange('documentFile', e.target.files?.[0])}
              className="hidden"
              id="documentFile"
            />
            <label htmlFor="documentFile" className="text-sm text-blue-600 hover:text-blue-700 cursor-pointer">
              {formData.documentFile ? formData.documentFile.name : 'Click to upload'}
            </label>
            <p className="text-xs text-gray-500 mt-1">PNG, JPG up to 5MB</p>
          </div>
          {errors.documentFile && <p className="mt-1 text-sm text-red-500">{errors.documentFile}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Selfie Photo <span className="text-red-500">*</span>
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFileChange('selfieFile', e.target.files?.[0])}
              className="hidden"
              id="selfieFile"
            />
            <label htmlFor="selfieFile" className="text-sm text-blue-600 hover:text-blue-700 cursor-pointer">
              {formData.selfieFile ? formData.selfieFile.name : 'Click to upload'}
            </label>
            <p className="text-xs text-gray-500 mt-1">Clear photo of your face</p>
          </div>
          {errors.selfieFile && <p className="mt-1 text-sm text-red-500">{errors.selfieFile}</p>}
        </div>
      </div>

      {/* Date of Birth */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Date of Birth <span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          value={formData.dateOfBirth}
          onChange={(e) => handleChange('dateOfBirth', e.target.value)}
          max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
            errors.dateOfBirth ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
          }`}
        />
        {errors.dateOfBirth && <p className="mt-1 text-sm text-red-500">{errors.dateOfBirth}</p>}
      </div>

      {/* Address */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Street Address <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.address}
          onChange={(e) => handleChange('address', e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
            errors.address ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
          }`}
          placeholder="123 Main Street, Ikeja"
        />
        {errors.address && <p className="mt-1 text-sm text-red-500">{errors.address}</p>}
      </div>

      {/* City and State */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            City <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.city}
            onChange={(e) => handleChange('city', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              errors.city ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="Lagos"
          />
          {errors.city && <p className="mt-1 text-sm text-red-500">{errors.city}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            State <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.state}
            onChange={(e) => handleChange('state', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              errors.state ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
            }`}
          >
            <option value="">Select state</option>
            {nigerianStates.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          {errors.state && <p className="mt-1 text-sm text-red-500">{errors.state}</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Submitting...' : 'Submit for Verification'}
        </button>
      </div>
    </form>
  );
};

// Note: ProfileForm and PasswordForm will be in a separate file due to length constraints

