import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mail, 
  Phone, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw,
  ArrowLeft,
  Clock
} from 'lucide-react';

interface VerificationResponse {
  success: boolean;
  message: string;
  code_id?: string;
  expires_in?: number;
  method: string;
  fallback?: boolean;
}

interface EmailBackupVerificationProps {
  userId: string;
  email: string;
  phone?: string;
  onSuccess: (method: string) => void;
  onBack: () => void;
}

const EmailBackupVerification: React.FC<EmailBackupVerificationProps> = ({
  userId,
  email,
  phone,
  onSuccess,
  onBack
}) => {
  const [step, setStep] = useState<'method' | 'code'>('method');
  const [selectedMethod, setSelectedMethod] = useState<'email' | 'sms'>('email');
  const [verificationCode, setVerificationCode] = useState('');
  const [codeId, setCodeId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [countdown, setCountdown] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const sendVerificationCode = async (method: 'email' | 'sms', fallback = false) => {
    setIsLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/v1/verification/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          email: email,
          phone: phone,
          method: method,
          fallback: fallback
        }),
      });

      const data: VerificationResponse = await response.json();

      if (data.success) {
        setCodeId(data.code_id || '');
        setCountdown(data.expires_in || 600);
        setStep('code');
        setSelectedMethod(data.method as 'email' | 'sms');
        setUsedFallback(data.fallback || false);
        setSuccess(data.message);
        setAttempts(0);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Failed to send verification code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async () => {
    if (verificationCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/v1/verification/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code_id: codeId,
          code: verificationCode,
          user_id: userId
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess('Verification successful!');
        setTimeout(() => onSuccess(data.method), 1500);
      } else {
        setError(data.detail || data.message || 'Invalid verification code');
        setAttempts(prev => prev + 1);
        
        if (attempts >= 2) {
          setError('Too many failed attempts. Please request a new code.');
          setStep('method');
          setVerificationCode('');
        }
      }
    } catch (err) {
      setError('Verification failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMethodSelect = (method: 'email' | 'sms') => {
    setSelectedMethod(method);
    sendVerificationCode(method);
  };

  const handleResend = () => {
    sendVerificationCode(selectedMethod, true);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (step === 'method') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg"
      >
        <div className="flex items-center mb-6">
          <button
            onClick={onBack}
            className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Choose Verification Method</h2>
        </div>

        <p className="text-gray-600 mb-6">
          Select how you'd like to receive your verification code
        </p>

        <div className="space-y-4">
          <button
            onClick={() => handleMethodSelect('email')}
            disabled={isLoading}
            className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors text-left disabled:opacity-50"
          >
            <div className="flex items-center">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
                <Mail className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Email Verification</h3>
                <p className="text-sm text-gray-600">{email}</p>
              </div>
            </div>
          </button>

          {phone && (
            <button
              onClick={() => handleMethodSelect('sms')}
              disabled={isLoading}
              className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4">
                  <Phone className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">SMS Verification</h3>
                  <p className="text-sm text-gray-600">{phone}</p>
                </div>
              </div>
            </button>
          )}
        </div>

        {isLoading && (
          <div className="mt-6 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-green-600 mr-2" />
            <span className="text-gray-600">Sending verification code...</span>
          </div>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center"
            >
              <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
              <span className="text-red-700 text-sm">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg"
    >
      <div className="flex items-center mb-6">
        <button
          onClick={() => setStep('method')}
          className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h2 className="text-xl font-bold text-gray-900">Enter Verification Code</h2>
      </div>

      <div className="text-center mb-6">
        <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
          selectedMethod === 'email' ? 'bg-blue-100' : 'bg-green-100'
        }`}>
          {selectedMethod === 'email' ? (
            <Mail className={`w-8 h-8 ${selectedMethod === 'email' ? 'text-blue-600' : 'text-green-600'}`} />
          ) : (
            <Phone className={`w-8 h-8 ${selectedMethod === 'email' ? 'text-blue-600' : 'text-green-600'}`} />
          )}
        </div>
        
        <p className="text-gray-600">
          We sent a 6-digit code to your {selectedMethod === 'email' ? 'email' : 'phone'}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          {selectedMethod === 'email' ? email : phone}
          {usedFallback && (
            <span className="block text-orange-600 mt-1">
              (Fallback method used)
            </span>
          )}
        </p>
      </div>

      <div className="mb-6">
        <input
          type="text"
          value={verificationCode}
          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="w-full text-center text-2xl tracking-widest font-mono p-4 border-2 border-gray-300 rounded-lg focus:border-green-500 focus:outline-none"
          maxLength={6}
          autoComplete="one-time-code"
        />
      </div>

      <button
        onClick={verifyCode}
        disabled={verificationCode.length !== 6 || isLoading}
        className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? (
          <div className="flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Verifying...
          </div>
        ) : (
          'Verify Code'
        )}
      </button>

      <div className="mt-4 text-center">
        {countdown > 0 ? (
          <div className="flex items-center justify-center text-gray-500">
            <Clock className="w-4 h-4 mr-1" />
            <span className="text-sm">Resend in {formatTime(countdown)}</span>
          </div>
        ) : (
          <button
            onClick={handleResend}
            disabled={isLoading}
            className="text-green-600 text-sm font-medium hover:underline disabled:opacity-50"
          >
            Resend Code
          </button>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center"
          >
            <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
            <span className="text-red-700 text-sm">{error}</span>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center"
          >
            <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
            <span className="text-green-700 text-sm">{success}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {attempts > 0 && (
        <div className="mt-4 text-center">
          <p className="text-sm text-orange-600">
            {3 - attempts} attempts remaining
          </p>
        </div>
      )}
    </motion.div>
  );
};

export default EmailBackupVerification;