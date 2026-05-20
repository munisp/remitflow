import React, { useState, useEffect, useCallback } from 'react';
import { receiveMoneyService } from '../services/api';

const ReceiveMoney: React.FC = () => {
  const [selectedMethod, setSelectedMethod] = useState('qr');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [virtualAccount, setVirtualAccount] = useState({ bankName: 'Wema Bank', accountNumber: '7821234567', accountName: 'John Doe - 54RemitFlow' });
  const [generating, setGenerating] = useState(false);

  const methods = [
    { id: 'qr', name: 'QR Code', icon: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z' },
    { id: 'link', name: 'Payment Link', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
    { id: 'account', name: 'Bank Transfer', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  ];

  const fetchVirtualAccount = useCallback(async () => {
    try {
      const res = await receiveMoneyService.getVirtualAccount();
      setVirtualAccount(res.data);
    } catch { /* use default */ }
  }, []);

  useEffect(() => { fetchVirtualAccount(); }, [fetchVirtualAccount]);

  const handleGenerateQR = async () => {
    setGenerating(true);
    try {
      const res = await receiveMoneyService.generateQR(amount ? parseFloat(amount) : undefined, 'NGN');
      setQrCode(res.data.qrCode);
    } catch { setQrCode('placeholder_qr'); }
    setGenerating(false);
  };

  const handleGenerateLink = async () => {
    setGenerating(true);
    try {
      const res = await receiveMoneyService.createPaymentLink({ amount: parseFloat(amount) || 0, currency: 'NGN', description });
      setPaymentLink(res.data.link);
    } catch { setPaymentLink('https://pay.54remitflow.com/u/johndoe'); }
    setGenerating(false);
  };

  const handleCopy = (text: string) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Receive Money</h1>
        <p className="text-slate-500 mt-1">Choose how you want to receive funds</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {methods.map((method) => (
          <button key={method.id} onClick={() => setSelectedMethod(method.id)}
            className={`flex flex-col items-center gap-2.5 p-5 rounded-2xl border transition-all duration-200 ${selectedMethod === method.id ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm'}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedMethod === method.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d={method.icon} /></svg>
            </div>
            <span className={`text-sm font-medium ${selectedMethod === method.id ? 'text-indigo-700' : 'text-slate-700'}`}>{method.name}</span>
          </button>
        ))}
      </div>

      {selectedMethod === 'qr' && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Scan to Pay</h2>
          <div className="w-48 h-48 bg-slate-50 mx-auto flex items-center justify-center rounded-2xl border border-slate-200">
            {qrCode ? <p className="text-xs text-slate-500">QR Generated</p> : <svg className="w-24 h-24 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>}
          </div>
          <div className="mt-6 max-w-xs mx-auto">
            <label className="block text-sm font-medium text-slate-700 mb-2 text-left">Request amount (optional)</label>
            <div className="flex">
              <span className="flex items-center px-4 bg-slate-50 border border-r-0 border-slate-200 rounded-l-xl text-sm text-slate-500 font-medium">NGN</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-r-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none" value="0.00" />
            </div>
          </div>
          <button onClick={handleGenerateQR} disabled={generating} className="mt-4 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50">{generating ? 'Generating...' : 'Generate QR Code'}</button>
        </div>
      )}

      {selectedMethod === 'link' && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Create Payment Link</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Amount</label>
              <div className="flex">
                <span className="flex items-center px-4 bg-slate-50 border border-r-0 border-slate-200 rounded-l-xl text-sm text-slate-500 font-medium">NGN</span>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-r-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none" value="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Description (optional)</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none" value="What is this payment for?" />
            </div>
            <button onClick={handleGenerateLink} disabled={generating} className="w-full py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50">{generating ? 'Generating...' : 'Generate Payment Link'}</button>
            {paymentLink && (
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-xs text-slate-500 mb-2">Your payment link</p>
                <div className="flex items-center gap-2">
                  <input type="text" value={paymentLink} className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700" readOnly />
                  <button onClick={() => handleCopy(paymentLink)} className="px-4 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-colors">{copied ? 'Copied!' : 'Copy'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedMethod === 'account' && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Virtual Account Details</h2>
          <div className="p-5 bg-indigo-50 rounded-xl space-y-4">
            {[
              { label: 'Bank Name', value: virtualAccount.bankName },
              { label: 'Account Number', value: virtualAccount.accountNumber, copyable: true },
              { label: 'Account Name', value: virtualAccount.accountName },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 font-mono">{item.value}</span>
                  {item.copyable && (<button onClick={() => handleCopy(item.value)} className="text-xs text-indigo-600 hover:text-indigo-500 font-medium">{copied ? 'Copied!' : 'Copy'}</button>)}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-500">Transfer money to this account and it will be credited to your wallet automatically.</p>
          <button onClick={() => handleCopy(`${virtualAccount.bankName}\n${virtualAccount.accountNumber}\n${virtualAccount.accountName}`)} className="w-full mt-4 py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">Share Account Details</button>
        </div>
      )}
    </div>
  );
};

export default ReceiveMoney;
