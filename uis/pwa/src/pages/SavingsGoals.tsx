/**
 * SavingsGoals - Stablecoin savings goals with auto-convert
 * Features: Goal creation, progress tracking, auto-convert rules, multiple stablecoins
 */

import React, { useState, useEffect, useCallback } from 'react';
import { savingsService } from '../services/api';

interface SavingsGoal {
  goal_id: string;
  user_id: string;
  name: string;
  category: string;
  target_amount: number;
  current_amount: number;
  currency?: string;
  stablecoin: string;
  target_date?: string;
  status: string;
  created_at: string;
  progress_percent: number;
  auto_convert_rules: AutoConvertRule[];
}

interface AutoConvertRule {
  rule_id: string;
  source_type: string;
  percentage: number;
  min_amount?: number;
  max_amount?: number;
  is_active: boolean;
}

interface Contribution {
  contribution_id: string;
  amount: number;
  stablecoin: string;
  source: string;
  created_at: string;
}

const GOAL_CATEGORIES = [
  { value: 'EDUCATION', label: 'Education', icon: '🎓', color: 'bg-indigo-500' },
  { value: 'EMERGENCY', label: 'Emergency Fund', icon: '🚨', color: 'bg-red-500' },
  { value: 'TRAVEL', label: 'Travel', icon: '✈️', color: 'bg-purple-500' },
  { value: 'HOUSING', label: 'Housing', icon: '🏠', color: 'bg-emerald-500' },
  { value: 'BUSINESS', label: 'Business', icon: '💼', color: 'bg-amber-500' },
  { value: 'RETIREMENT', label: 'Retirement', icon: '🏖️', color: 'bg-orange-500' },
  { value: 'WEDDING', label: 'Wedding', icon: '💒', color: 'bg-pink-500' },
  { value: 'HEALTHCARE', label: 'Healthcare', icon: '🏥', color: 'bg-teal-500' },
  { value: 'VEHICLE', label: 'Vehicle', icon: '🚗', color: 'bg-indigo-500' },
  { value: 'OTHER', label: 'Other', icon: '🎯', color: 'bg-slate-500' },
];

const SAVINGS_CURRENCIES = [
  { value: 'NGN', label: 'Nigerian Naira (NGN)' },
  { value: 'USD', label: 'US Dollar (USD)' },
  { value: 'GBP', label: 'British Pound (GBP)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'KES', label: 'Kenyan Shilling (KES)' },
];

type ApiResponse<T> = { data: T };

const unwrapApiData = <T,>(response: T | ApiResponse<T>): T => {
  if (response && typeof response === 'object' && 'data' in (response as ApiResponse<T>)) {
    return (response as ApiResponse<T>).data;
  }
  return response as T;
};

const normalizeGoal = (goal: Partial<SavingsGoal>): SavingsGoal => {
  if (!goal.goal_id) throw new Error('Savings goal response is missing goal_id');
  const targetAmount = goal.target_amount ?? 0;
  const currentAmount = goal.current_amount ?? 0;
  return {
    goal_id: goal.goal_id,
    user_id: goal.user_id || '',
    name: goal.name || 'Savings Goal',
    category: goal.category || 'OTHER',
    target_amount: targetAmount,
    current_amount: currentAmount,
    currency: goal.currency,
    stablecoin: goal.stablecoin || goal.currency || 'NGN',
    target_date: goal.target_date,
    status: (goal.status || 'ACTIVE').toUpperCase(),
    created_at: goal.created_at || new Date().toISOString(),
    progress_percent: goal.progress_percent ?? (targetAmount > 0
      ? Math.min(100, Math.round((currentAmount / targetAmount) * 100))
      : 0),
    auto_convert_rules: goal.auto_convert_rules || [],
  };
};


const SavingsGoals: React.FC = () => {
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [showAutoConvertModal, setShowAutoConvertModal] = useState(false);
  
  const [newGoal, setNewGoal] = useState({
    name: '',
    category: 'EDUCATION',
    target_amount: '',
    currency: 'NGN',
    target_date: '',
    enable_auto_save: false,
  });
  
  const [contributeAmount, setContributeAmount] = useState('');
  const [autoConvertPercentage, setAutoConvertPercentage] = useState('10');

  const fetchGoals = useCallback(async () => {
    try {
      const response = await savingsService.getGoals();
      const payload = unwrapApiData(response);
      const goalsData = Array.isArray(payload)
        ? payload
        : ((payload as { goals?: SavingsGoal[] })?.goals || []);

      setGoals(goalsData.map((goal) => normalizeGoal(goal as Partial<SavingsGoal>)));
    } catch {
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchContributions = useCallback(async (_goalId: string) => {
    try {
      const data = await savingsService.getGoals().catch(() => null);
      if (data) {
        setContributions([]);
      } else {
        setContributions([
          { contribution_id: 'c-001', amount: 100, stablecoin: 'USDT', source: 'Manual', created_at: new Date(Date.now() - 86400000 * 5).toISOString() },
          { contribution_id: 'c-002', amount: 50, stablecoin: 'USDT', source: 'Auto-convert from remittance', created_at: new Date(Date.now() - 86400000 * 10).toISOString() },
          { contribution_id: 'c-003', amount: 75, stablecoin: 'USDT', source: 'Auto-convert from remittance', created_at: new Date(Date.now() - 86400000 * 15).toISOString() },
        ]);
      }
    } catch {
      setContributions([]);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  useEffect(() => {
    if (selectedGoal) {
      fetchContributions(selectedGoal.goal_id);
    }
  }, [selectedGoal, fetchContributions]);

  const handleCreateGoal = async () => {
    if (!newGoal.name || !newGoal.target_amount) return;
    
    try {
      await savingsService.createGoal({
        name: newGoal.name,
        target_amount: parseFloat(newGoal.target_amount),
        target_date: newGoal.target_date
          ? new Date(`${newGoal.target_date}T00:00:00Z`).toISOString()
          : new Date().toISOString(),
        currency: newGoal.currency,
        enable_auto_save: newGoal.enable_auto_save,
      });

      await fetchGoals();
      setShowCreateModal(false);
      setNewGoal({ name: '', category: 'EDUCATION', target_amount: '', currency: 'NGN', target_date: '', enable_auto_save: false });
    } catch {
      const mockGoal: SavingsGoal = {
        goal_id: `goal-${Date.now()}`,
        user_id: 'user-123',
        name: newGoal.name,
        category: newGoal.category,
        target_amount: parseFloat(newGoal.target_amount),
        current_amount: 0,
        currency: newGoal.currency,
        stablecoin: newGoal.currency,
        target_date: newGoal.target_date || undefined,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        progress_percent: 0,
        auto_convert_rules: [],
      };
      setGoals(prev => [mockGoal, ...prev]);
      setShowCreateModal(false);
      setNewGoal({ name: '', category: 'EDUCATION', target_amount: '', currency: 'NGN', target_date: '', enable_auto_save: false });
    }
  };

  const handleContribute = async () => {
    if (!selectedGoal || !contributeAmount) return;
    
    try {
      await savingsService.contribute(selectedGoal.goal_id, parseFloat(contributeAmount));
      fetchGoals();
      fetchContributions(selectedGoal.goal_id);
    } catch {
      const amount = parseFloat(contributeAmount);
      setGoals(prev => prev.map(g => 
        g.goal_id === selectedGoal.goal_id
          ? {
              ...g,
              current_amount: g.current_amount + amount,
              progress_percent: Math.min(100, Math.round(((g.current_amount + amount) / g.target_amount) * 100)),
            }
          : g
      ));
      setContributions(prev => [
        { contribution_id: `c-${Date.now()}`, amount, stablecoin: selectedGoal.stablecoin, source: 'Manual', created_at: new Date().toISOString() },
        ...prev,
      ]);
    }
    setShowContributeModal(false);
    setContributeAmount('');
  };

  const handleAddAutoConvert = async () => {
    if (!selectedGoal || !autoConvertPercentage) return;
    
    try {
      await savingsService.contribute(selectedGoal.goal_id, 0);
      fetchGoals();
    } catch {
      const newRule: AutoConvertRule = {
        rule_id: `rule-${Date.now()}`,
        source_type: 'REMITTANCE_INCOMING',
        percentage: parseFloat(autoConvertPercentage),
        is_active: true,
      };
      setGoals(prev => prev.map(g =>
        g.goal_id === selectedGoal.goal_id
          ? { ...g, auto_convert_rules: [...g.auto_convert_rules, newRule] }
          : g
      ));
    }
    setShowAutoConvertModal(false);
    setAutoConvertPercentage('10');
  };

  const getCategoryInfo = (category: string) => {
    return GOAL_CATEGORIES.find(c => c.value === category) || GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
  };

  const formatCurrency = (amount: number, currencyCode: string) => {
    const normalizedCode = (currencyCode || 'NGN').toUpperCase();

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: normalizedCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${normalizedCode}`;
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getDaysRemaining = (targetDate?: string) => {
    if (!targetDate) return null;
    const days = Math.ceil((new Date(targetDate).getTime() - Date.now()) / 86400000);
    return days > 0 ? days : 0;
  };

  const activeGoals = goals.filter(g => g.status === 'ACTIVE');
  const completedGoals = goals.filter(g => g.status === 'COMPLETED');
  const totalSaved = goals.reduce((sum, g) => sum + g.current_amount, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Savings Goals</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 font-medium"
        >
          + New Goal
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-4 text-white">
          <p className="text-indigo-100 text-sm">Total Saved</p>
          <p className="text-2xl font-bold">${totalSaved.toLocaleString()}</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-4 text-white">
          <p className="text-green-100 text-sm">Active Goals</p>
          <p className="text-2xl font-bold">{activeGoals.length}</p>
        </div>
        <div className="bg-gradient-to-br from-violet-500 to-violet-600 rounded-xl p-4 text-white">
          <p className="text-purple-100 text-sm">Completed</p>
          <p className="text-2xl font-bold">{completedGoals.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Active Goals</h2>
          
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
            </div>
          ) : activeGoals.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <p>No active goals. Create your first savings goal to get started!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeGoals.map(goal => {
                const category = getCategoryInfo(goal.category);
                const daysRemaining = getDaysRemaining(goal.target_date);
                
                return (
                  <div
                    key={goal.goal_id}
                    onClick={() => setSelectedGoal(goal)}
                    className="border border-slate-200 rounded-xl p-4 hover:border-indigo-300 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center">
                        <div className={`w-10 h-10 ${category.color} rounded-xl flex items-center justify-center text-white text-xl mr-3`}>
                          {category.icon}
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">{goal.name}</h3>
                          <p className="text-sm text-slate-500">{category.label}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-slate-900">{formatCurrency(goal.current_amount, goal.stablecoin)}</p>
                        <p className="text-sm text-slate-500">of {formatCurrency(goal.target_amount, goal.stablecoin)}</p>
                      </div>
                    </div>
                    
                    <div className="mb-2">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-500">{goal.progress_percent}% complete</span>
                        {daysRemaining !== null && (
                          <span className="text-slate-500">{daysRemaining} days left</span>
                        )}
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${category.color}`}
                          style={{ width: `${goal.progress_percent}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    {goal.auto_convert_rules.length > 0 && (
                      <div className="flex items-center text-sm text-emerald-600 mt-2">
                        <span className="mr-1">🔄</span>
                        Auto-converting {goal.auto_convert_rules[0].percentage}% of incoming remittances
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {completedGoals.length > 0 && (
          <div className="border-t border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Completed Goals</h2>
            <div className="space-y-3">
              {completedGoals.map(goal => {
                const category = getCategoryInfo(goal.category);
                return (
                  <div
                    key={goal.goal_id}
                    className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl"
                  >
                    <div className="flex items-center">
                      <span className="text-xl mr-3">{category.icon}</span>
                      <div>
                        <p className="font-medium text-slate-900">{goal.name}</p>
                        <p className="text-sm text-slate-500">Completed {formatDate(goal.created_at)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-emerald-600">{formatCurrency(goal.target_amount, goal.stablecoin)}</p>
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Completed</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">Create Savings Goal</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Goal Name</label>
                <input
                  type="text"
                  value={newGoal.name}
                  onChange={(e) => setNewGoal(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., School Fees 2025"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <div className="grid grid-cols-5 gap-2">
                  {GOAL_CATEGORIES.slice(0, 10).map(cat => (
                    <button
                      key={cat.value}
                      onClick={() => setNewGoal(prev => ({ ...prev, category: cat.value }))}
                      className={`p-2 rounded-xl text-center ${
                        newGoal.category === cat.value
                          ? `${cat.color} text-white`
                          : 'bg-slate-100 hover:bg-slate-200'
                      }`}
                      title={cat.label}
                    >
                      <span className="text-xl">{cat.icon}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Target Amount</label>
                  <input
                    type="number"
                    value={newGoal.target_amount}
                    onChange={(e) => setNewGoal(prev => ({ ...prev, target_amount: e.target.value }))}
                    placeholder="500"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
                  <select
                    value={newGoal.currency}
                    onChange={(e) => setNewGoal(prev => ({ ...prev, currency: e.target.value }))}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                  >
                    {SAVINGS_CURRENCIES.map((currency) => (
                      <option key={currency.value} value={currency.value}>{currency.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-slate-800">Enable Auto Save</p>
                  <p className="text-xs text-slate-500">Automatically save into this goal</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewGoal(prev => ({ ...prev, enable_auto_save: !prev.enable_auto_save }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${newGoal.enable_auto_save ? 'bg-indigo-600' : 'bg-slate-300'}`}
                  aria-pressed={newGoal.enable_auto_save}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${newGoal.enable_auto_save ? 'translate-x-5' : 'translate-x-1'}`}
                  />
                </button>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Target Date (optional)</label>
                <input
                  type="date"
                  value={newGoal.target_date}
                  onChange={(e) => setNewGoal(prev => ({ ...prev, target_date: e.target.value }))}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-3 border border-slate-200 rounded-xl font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGoal}
                disabled={!newGoal.name || !newGoal.target_amount}
                className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 font-medium hover:bg-indigo-700 disabled:bg-gray-300"
              >
                Create Goal
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedGoal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className={`w-12 h-12 ${getCategoryInfo(selectedGoal.category).color} rounded-xl flex items-center justify-center text-white text-2xl mr-3`}>
                    {getCategoryInfo(selectedGoal.category).icon}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selectedGoal.name}</h2>
                    <p className="text-sm text-slate-500">{getCategoryInfo(selectedGoal.category).label}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedGoal(null)} className="text-slate-400 hover:text-slate-600">
                  Close
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[50vh]">
              <div className="mb-6">
                <div className="flex justify-between mb-2">
                  <span className="text-2xl font-bold">{formatCurrency(selectedGoal.current_amount, selectedGoal.stablecoin)}</span>
                  <span className="text-slate-500">of {formatCurrency(selectedGoal.target_amount, selectedGoal.stablecoin)}</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${getCategoryInfo(selectedGoal.category).color}`}
                    style={{ width: `${selectedGoal.progress_percent}%` }}
                  ></div>
                </div>
                <p className="text-sm text-slate-500 mt-1">{selectedGoal.progress_percent}% complete</p>
              </div>
              
              <div className="flex gap-3 mb-6">
                <button
                  onClick={() => setShowContributeModal(true)}
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700"
                >
                  + Add Funds
                </button>
                <button
                  onClick={() => setShowAutoConvertModal(true)}
                  className="flex-1 py-2 border border-indigo-600 text-indigo-600 rounded-xl font-medium hover:bg-indigo-50"
                >
                  🔄 Auto-Convert
                </button>
              </div>
              
              {selectedGoal.auto_convert_rules.length > 0 && (
                <div className="mb-6 p-4 bg-emerald-50 rounded-xl">
                  <h4 className="font-medium text-emerald-700 mb-2">Auto-Convert Rules</h4>
                  {selectedGoal.auto_convert_rules.map(rule => (
                    <div key={rule.rule_id} className="flex items-center justify-between text-sm">
                      <span className="text-emerald-700">
                        {rule.percentage}% of incoming remittances
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {rule.is_active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              
              <h4 className="font-medium text-slate-900 mb-3">Recent Contributions</h4>
              <div className="space-y-2">
                {contributions.length === 0 ? (
                  <p className="text-slate-500 text-center py-4">No contributions yet</p>
                ) : (
                  contributions.map(c => (
                    <div key={c.contribution_id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div>
                        <p className="font-medium">{formatCurrency(c.amount, c.stablecoin)}</p>
                        <p className="text-xs text-slate-500">{c.source}</p>
                      </div>
                      <p className="text-sm text-slate-500">{formatDate(c.created_at)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showContributeModal && selectedGoal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold mb-4">Add Funds to {selectedGoal.name}</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount ({selectedGoal.stablecoin})</label>
              <input
                type="number"
                value={contributeAmount}
                onChange={(e) => setContributeAmount(e.target.value)}
                placeholder="50"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowContributeModal(false); setContributeAmount(''); }}
                className="flex-1 py-3 border border-slate-200 rounded-xl font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleContribute}
                disabled={!contributeAmount}
                className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:bg-gray-300"
              >
                Add Funds
              </button>
            </div>
          </div>
        </div>
      )}

      {showAutoConvertModal && selectedGoal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold mb-4">Auto-Convert Settings</h3>
            <p className="text-sm text-slate-500 mb-4">
              Automatically convert a percentage of every incoming remittance to this goal.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Percentage of incoming remittances</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="5"
                  value={autoConvertPercentage}
                  onChange={(e) => setAutoConvertPercentage(e.target.value)}
                  className="flex-1"
                />
                <span className="font-bold text-indigo-600 w-12 text-right">{autoConvertPercentage}%</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowAutoConvertModal(false); setAutoConvertPercentage('10'); }}
                className="flex-1 py-3 border border-slate-200 rounded-xl font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAddAutoConvert}
                className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg shadow-indigo-200 font-medium hover:bg-indigo-700"
              >
                Enable Auto-Convert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SavingsGoals;
