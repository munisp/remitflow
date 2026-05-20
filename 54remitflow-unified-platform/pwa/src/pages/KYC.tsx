import React, { useState, useEffect, useCallback } from 'react';
import { kycService, type KYCProfile, type KYCDocument } from '../services/api';

const KYC: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [kycProfile, setKycProfile] = useState<KYCProfile | null>(null);
  const [documents, setDocuments] = useState<KYCDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [bvn, setBvn] = useState('');
  const [bvnVerifying, setBvnVerifying] = useState(false);
  const [bvnResult, setBvnResult] = useState<string | null>(null);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', dateOfBirth: '' });

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kycService.getProfile();
      setKycProfile(res.data);
      if (res.data.firstName) setFormData({ firstName: res.data.firstName || '', lastName: res.data.lastName || '', dateOfBirth: res.data.dateOfBirth || '' });
      if (res.data.bvnVerified) setCurrentStep(2);
      if (res.data.idDocumentStatus === 'verified') setCurrentStep(3);
      if (res.data.addressProofStatus === 'verified') setCurrentStep(4);
    } catch { /* use defaults */ }
    try {
      const docRes = await kycService.getDocuments();
      setDocuments(docRes.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleBvnVerify = async () => {
    if (bvn.length !== 11) return;
    setBvnVerifying(true);
    setBvnResult(null);
    try {
      const res = await kycService.verifyBvn(bvn);
      if (res.data.valid) {
        setBvnResult('BVN verified successfully');
        setFormData({ firstName: res.data.firstName, lastName: res.data.lastName, dateOfBirth: res.data.dateOfBirth });
      } else { setBvnResult('BVN verification failed. Please check and retry.'); }
    } catch { setBvnResult('Verification service unavailable. Please try again later.'); }
    setBvnVerifying(false);
  };

  const handleSaveProfile = async () => {
    setSubmitting(true);
    try {
      await kycService.updateProfile({ firstName: formData.firstName, lastName: formData.lastName, dateOfBirth: formData.dateOfBirth, bvn });
      setCurrentStep(2);
    } catch { /* show error */ }
    setSubmitting(false);
  };

  const handleFileUpload = async (type: string, file: File) => {
    try {
      const res = await kycService.uploadDocument(type, file);
      setDocuments(prev => [...prev, res.data]);
    } catch { /* show error */ }
  };

  const handleSubmitKYC = async () => {
    setSubmitting(true);
    try { await kycService.requestTierUpgrade('tier2'); } catch { /* ignore */ }
    setSubmitting(false);
  };

  const steps = [
    { id: 1, name: 'Personal Info', status: currentStep > 1 ? 'completed' : currentStep === 1 ? 'current' : 'pending' },
    { id: 2, name: 'ID Verification', status: currentStep > 2 ? 'completed' : currentStep === 2 ? 'current' : 'pending' },
    { id: 3, name: 'Address Proof', status: currentStep > 3 ? 'completed' : currentStep === 3 ? 'current' : 'pending' },
    { id: 4, name: 'Selfie', status: currentStep === 4 ? 'current' : 'pending' },
  ];

  const inputClass = "w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all";

  if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">KYC Verification</h1>
        <p className="text-slate-500 mt-1">Complete verification to unlock full features</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${step.status === 'completed' ? 'bg-emerald-500 text-white' : step.status === 'current' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-100 text-slate-400'}`}>
                {step.status === 'completed' ? (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>) : step.id}
              </div>
              {i < steps.length - 1 && (<div className={`w-10 md:w-20 h-1 mx-2 rounded-full transition-all duration-300 ${step.status === 'completed' ? 'bg-emerald-500' : 'bg-slate-100'}`} />)}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        {currentStep === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Personal Information</h2>
            <div><label className="block text-sm font-medium text-slate-700 mb-2">BVN (Bank Verification Number)</label>
              <div className="flex gap-2"><input type="text" value={bvn} onChange={(e) => setBvn(e.target.value)} className={inputClass} value="Enter 11-digit BVN" maxLength={11} />
              <button onClick={handleBvnVerify} disabled={bvn.length !== 11 || bvnVerifying} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 whitespace-nowrap">{bvnVerifying ? 'Verifying...' : 'Verify'}</button></div>
              {bvnResult && <p className={`text-sm mt-2 ${bvnResult.includes('success') ? 'text-emerald-600' : 'text-red-600'}`}>{bvnResult}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-2">First Name</label><input type="text" value={formData.firstName} onChange={(e) => setFormData(p => ({...p, firstName: e.target.value}))} className={inputClass} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-2">Last Name</label><input type="text" value={formData.lastName} onChange={(e) => setFormData(p => ({...p, lastName: e.target.value}))} className={inputClass} /></div>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-2">Date of Birth</label><input type="date" value={formData.dateOfBirth} onChange={(e) => setFormData(p => ({...p, dateOfBirth: e.target.value}))} className={inputClass} /></div>
            <button onClick={handleSaveProfile} disabled={submitting} className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 disabled:opacity-50">{submitting ? 'Saving...' : 'Save & Continue'}</button>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">ID Verification</h2>
            <p className="text-sm text-slate-500">Upload a valid government-issued ID</p>
            <div className="grid grid-cols-2 gap-3">
              {['NIN', 'Passport', 'Driver License', 'Voter Card'].map((type) => (
                <label key={type} className="p-4 border-2 border-slate-100 rounded-2xl text-center hover:border-indigo-400 hover:bg-indigo-50 transition-all duration-200 cursor-pointer">
                  <p className="font-semibold text-sm text-slate-700">{type}</p>
                  <input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(type.toLowerCase(), e.target.files[0]); }} />
                </label>
              ))}
            </div>
            {documents.filter(d => d.type.includes('id')).length > 0 && <p className="text-sm text-emerald-600">Document uploaded successfully</p>}
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Proof of Address</h2>
            <p className="text-sm text-slate-500">Upload a utility bill or bank statement (not older than 3 months)</p>
            <label className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-all duration-200 cursor-pointer block">
              <div className="w-14 h-14 bg-violet-50 rounded-2xl mx-auto mb-3 flex items-center justify-center">
                <svg className="w-7 h-7 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Upload proof of address</p>
              <p className="text-xs text-slate-400">PDF, JPG, PNG up to 10MB</p>
              <input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload('address_proof', e.target.files[0]); }} />
            </label>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Selfie Verification</h2>
            <p className="text-sm text-slate-500">Take a clear selfie for liveness verification</p>
            <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center hover:border-indigo-300 transition-all duration-200">
              <div className="w-20 h-20 bg-indigo-50 rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg className="w-10 h-10 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-4">Position your face in the frame</p>
              <label className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl transition-all cursor-pointer inline-block">
                Take Selfie
                <input type="file" className="hidden" accept="image/*" capture="user" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload('selfie', e.target.files[0]); }} />
              </label>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-6 pt-4 border-t border-slate-100">
          <button onClick={() => setCurrentStep(Math.max(1, currentStep - 1))} disabled={currentStep === 1} className="px-5 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-40">Previous</button>
          <button onClick={() => { if (currentStep === 4) handleSubmitKYC(); else setCurrentStep(Math.min(4, currentStep + 1)); }} disabled={submitting}
            className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50">
            {submitting ? 'Submitting...' : currentStep === 4 ? 'Submit Verification' : 'Continue'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Verification Status</h2>
        <div className="space-y-2">
          {[
            { label: 'Email Verified', done: kycProfile?.emailVerified ?? true },
            { label: 'Phone Verified', done: kycProfile?.phoneVerified ?? true },
            { label: 'BVN Verified', done: kycProfile?.bvnVerified ?? false },
            { label: 'ID Document', done: kycProfile?.idDocumentStatus === 'verified' },
            { label: 'Address Proof', done: kycProfile?.addressProofStatus === 'verified' },
            { label: 'Selfie', done: kycProfile?.selfieStatus === 'verified' },
          ].map((item) => (
            <div key={item.label} className={`flex items-center justify-between p-3.5 rounded-xl ${item.done ? 'bg-emerald-50' : 'bg-amber-50'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.done ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                  {item.done ? (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>) : (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>)}
                </div>
                <span className="text-sm font-medium text-slate-900">{item.label}</span>
              </div>
              <span className={`text-xs font-semibold ${item.done ? 'text-emerald-600' : 'text-amber-600'}`}>{item.done ? 'Completed' : 'Pending'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KYC;
