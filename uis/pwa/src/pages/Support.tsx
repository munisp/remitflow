import React, { useState } from 'react';
import { supportService } from '../services/api';

const Support: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [faqs, setFaqs] = useState<{q: string; a: string}[]>([
    { q: 'How do I send money?', a: 'Go to Send Money, enter recipient details, amount, and confirm the transfer.' },
    { q: 'What are the transfer limits?', a: 'Daily limit is NGN 5,000,000. You can increase this by completing KYC verification.' },
    { q: 'How long do transfers take?', a: 'Domestic transfers are instant. International transfers take 1-3 business days.' },
    { q: 'How do I verify my account?', a: 'Go to KYC Verification in your profile and follow the steps to upload your documents.' },
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategory || !subject || !message) return;
    setSubmitting(true);
    try {
      await supportService.createTicket({ subject, category: selectedCategory, message });
      setSubmitMessage('Your request has been submitted! We\'ll get back to you shortly.');
      setSubject('');
      setMessage('');
      setSelectedCategory('');
    } catch {
      setSubmitMessage('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSubmitMessage(''), 5000);
    }
  };

  const inputClass = "w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Help & Support</h1><p className="text-slate-500 mt-1">We're here to help you</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{ icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', label: 'Live Chat', color: 'bg-indigo-50 text-indigo-600' },
          { icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', label: 'Email Us', color: 'bg-violet-50 text-violet-600' },
          { icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z', label: 'Call Us', color: 'bg-emerald-50 text-emerald-600' },
          { icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', label: 'Help Center', color: 'bg-amber-50 text-amber-600' },
        ].map((item) => (
          <button key={item.label} className="bg-white rounded-2xl border border-slate-100 p-5 text-center hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
            <div className={`w-12 h-12 ${item.color} rounded-xl mx-auto mb-3 flex items-center justify-center`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">{item.label}</p>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Send us a message</h2>
        {submitMessage && <div className={`mb-4 p-3 rounded-xl text-sm font-medium ${submitMessage.includes('submitted') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{submitMessage}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium text-slate-700 mb-2">Category</label>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className={inputClass} required>
              <option value="">Select a category</option><option value="transaction">Transaction Issue</option><option value="account">Account Problem</option><option value="kyc">KYC Verification</option><option value="card">Card Issue</option><option value="other">Other</option>
            </select></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-2">Subject</label><input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} placeholder="Brief description of your issue" required /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-2">Message</label><textarea value={message} onChange={(e) => setMessage(e.target.value)} className={inputClass} rows={4} placeholder="Describe your issue in detail..." required /></div>
          <button type="submit" disabled={submitting} className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50">
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Frequently Asked Questions</h2>
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <button key={i} onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
              <div className="flex justify-between items-center">
                <p className="text-sm font-semibold text-slate-900 pr-4">{faq.q}</p>
                <svg className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
              {openFaq === i && <p className="mt-3 text-sm text-slate-600 leading-relaxed">{faq.a}</p>}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Contact Information</h2>
        <div className="space-y-3">
          {[{ icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', label: 'Email', value: 'support@54remitflow.com', color: 'bg-indigo-50 text-indigo-600' },
            { icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z', label: 'Phone', value: '+234 800 123 4567', color: 'bg-emerald-50 text-emerald-600' },
            { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Hours', value: '24/7 Support Available', color: 'bg-violet-50 text-violet-600' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-4 p-3.5 rounded-xl hover:bg-slate-50 transition-colors">
              <div className={`w-10 h-10 ${item.color} rounded-xl flex items-center justify-center`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg>
              </div>
              <div><p className="text-xs text-slate-400 font-medium">{item.label}</p><p className="text-sm font-semibold text-slate-900">{item.value}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Support;
