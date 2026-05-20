import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const Register: React.FC = () => {
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [validationError, setValidationError] = useState('');
  const [step, setStep] = useState(1);
  const { register, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setValidationError('');
  };

  const handleNext = () => {
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone) {
      setValidationError('Please fill in all fields');
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) { setValidationError('Passwords do not match'); return; }
    if (formData.password.length < 8) { setValidationError('Password must be at least 8 characters'); return; }
    await register({ firstName: formData.firstName, lastName: formData.lastName, email: formData.email, phone: formData.phone, password: formData.password });
    if (useAuthStore.getState().isAuthenticated) { navigate('/'); }
  };

  const inputClass = "w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 transition-all duration-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none hover:border-slate-300";

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-violet-600 via-indigo-700 to-indigo-800 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-40 left-10 w-80 h-80 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-64 h-64 bg-violet-300 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <h1 className="text-4xl font-bold leading-tight mb-4">Join millions sending money smarter</h1>
          <p className="text-lg text-indigo-100 leading-relaxed mb-12">Create your free account in under 2 minutes. No hidden fees, competitive exchange rates.</p>
          <div className="space-y-4">
            {['Bank-grade security & encryption', 'Real-time exchange rates', 'Send to 150+ countries', 'No hidden fees or charges'].map((f) => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
                <span className="text-indigo-100">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-indigo-600 to-violet-600">
              <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">54RemitFlow</span>
          </div>

          <div className="flex items-center gap-3 mb-8">
            {[1, 2].map((s) => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${step >= s ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{s}</div>
                {s < 2 && <div className={`flex-1 h-1 rounded-full transition-all duration-300 ${step > s ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
              </React.Fragment>
            ))}
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-1">{step === 1 ? 'Create your account' : 'Set your password'}</h2>
          <p className="text-slate-500 mb-8">{step === 1 ? 'Enter your personal details to get started' : 'Choose a strong password to secure your account'}</p>

          {(error || validationError) && (
            <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              <span className="flex-1">{error || validationError}</span>
              <button onClick={() => { clearError(); setValidationError(''); }} className="text-red-400 hover:text-red-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {step === 1 ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">First name</label>
                    <input name="firstName" type="text" required value={formData.firstName} onChange={handleChange} className={inputClass} value="John" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Last name</label>
                    <input name="lastName" type="text" required value={formData.lastName} onChange={handleChange} className={inputClass} value="Doe" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Email address</label>
                  <input name="email" type="email" required value={formData.email} onChange={handleChange} className={inputClass} value="you@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Phone number</label>
                  <input name="phone" type="tel" required value={formData.phone} onChange={handleChange} className={inputClass} value="+234 800 000 0000" />
                </div>
                <button type="button" onClick={handleNext}
                  className="w-full py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200">
                  Continue
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
                  <input name="password" type="password" required value={formData.password} onChange={handleChange} className={inputClass} value="Min. 8 characters" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Confirm password</label>
                  <input name="confirmPassword" type="password" required value={formData.confirmPassword} onChange={handleChange} className={inputClass} value="Repeat your password" />
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" required className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className="text-sm text-slate-600">I agree to the <a href="#" className="text-indigo-600 hover:text-indigo-500 font-medium">Terms of Service</a> and <a href="#" className="text-indigo-600 hover:text-indigo-500 font-medium">Privacy Policy</a></span>
                </label>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)} className="flex-1 py-3.5 px-6 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-all duration-200">Back</button>
                  <button type="submit" disabled={isLoading}
                    className="flex-1 py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50">
                    {isLoading ? 'Creating...' : 'Create account'}
                  </button>
                </div>
              </>
            )}
          </form>

          <p className="mt-8 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
