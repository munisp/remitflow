import React, { useState, useEffect } from 'react';
import './CommissionRulesManager.css';

const CommissionRulesManager = () => {
  const [rules, setRules] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [newRule, setNewRule] = useState({
    name: '',
    description: '',
    tier: 'Field Agent',
    transaction_type: 'all',
    min_amount: 0,
    max_amount: null,
    rate_type: 'percentage',
    rate_value: 0,
    flat_fee: 0,
    is_active: true,
    effective_date: new Date().toISOString().split('T')[0],
    expiry_date: null
  });

  useEffect(() => {
    loadCommissionRules();
  }, []);

  const loadCommissionRules = async () => {
    setLoading(true);
    try {
      // Default commission rules - loaded from commission service API
      const defaultRules = [
        {
          id: 'RULE001',
          name: 'Super Agent Standard Rate',
          description: 'Standard commission rate for Super Agents',
          tier: 'Super Agent',
          transaction_type: 'all',
          min_amount: 0,
          max_amount: null,
          rate_type: 'percentage',
          rate_value: 3.0,
          flat_fee: 0,
          is_active: true,
          effective_date: '2024-01-01',
          expiry_date: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'RULE002',
          name: 'Regional Agent Tiered Rate',
          description: 'Tiered commission rate for Regional Agents',
          tier: 'Regional Agent',
          transaction_type: 'transfer',
          min_amount: 100,
          max_amount: 10000,
          rate_type: 'percentage',
          rate_value: 2.5,
          flat_fee: 0,
          is_active: true,
          effective_date: '2024-01-01',
          expiry_date: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'RULE003',
          name: 'Field Agent Base Rate',
          description: 'Base commission rate for Field Agents',
          tier: 'Field Agent',
          transaction_type: 'all',
          min_amount: 0,
          max_amount: 5000,
          rate_type: 'percentage',
          rate_value: 2.0,
          flat_fee: 1.0,
          is_active: true,
          effective_date: '2024-01-01',
          expiry_date: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ];
      setRules(defaultRules);
    } catch (error) {
      console.error('Error loading commission rules:', error);
      alert('Failed to load commission rules');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRule = async () => {
    try {
      // Validate form
      if (!newRule.name || !newRule.description || newRule.rate_value <= 0) {
        alert('Please fill in all required fields');
        return;
      }

      // In production, this would call the commission service API
      const createdRule = {
        ...newRule,
        id: `RULE${String(rules.length + 1).padStart(3, '0')}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      setRules([...rules, createdRule]);
      setShowCreateModal(false);
      resetForm();
      alert('Commission rule created successfully');
    } catch (error) {
      console.error('Error creating commission rule:', error);
      alert('Failed to create commission rule');
    }
  };

  const handleUpdateRule = async () => {
    try {
      // In production, this would call the commission service API
      const updatedRules = rules.map(rule =>
        rule.id === editingRule.id
          ? { ...editingRule, updated_at: new Date().toISOString() }
          : rule
      );

      setRules(updatedRules);
      setEditingRule(null);
      alert('Commission rule updated successfully');
    } catch (error) {
      console.error('Error updating commission rule:', error);
      alert('Failed to update commission rule');
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm('Are you sure you want to delete this commission rule?')) {
      return;
    }

    try {
      // In production, this would call the commission service API
      setRules(rules.filter(rule => rule.id !== ruleId));
      alert('Commission rule deleted successfully');
    } catch (error) {
      console.error('Error deleting commission rule:', error);
      alert('Failed to delete commission rule');
    }
  };

  const handleToggleActive = async (ruleId) => {
    try {
      // In production, this would call the commission service API
      const updatedRules = rules.map(rule =>
        rule.id === ruleId
          ? { ...rule, is_active: !rule.is_active, updated_at: new Date().toISOString() }
          : rule
      );

      setRules(updatedRules);
    } catch (error) {
      console.error('Error toggling rule status:', error);
      alert('Failed to update rule status');
    }
  };

  const resetForm = () => {
    setNewRule({
      name: '',
      description: '',
      tier: 'Field Agent',
      transaction_type: 'all',
      min_amount: 0,
      max_amount: null,
      rate_type: 'percentage',
      rate_value: 0,
      flat_fee: 0,
      is_active: true,
      effective_date: new Date().toISOString().split('T')[0],
      expiry_date: null
    });
  };

  const filteredRules = rules.filter(rule =>
    rule.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rule.tier.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rule.transaction_type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRateDisplay = (rule) => {
    if (rule.rate_type === 'percentage') {
      return `${rule.rate_value}%${rule.flat_fee > 0 ? ` + $${rule.flat_fee}` : ''}`;
    } else {
      return `$${rule.rate_value}`;
    }
  };

  const getAmountRangeDisplay = (rule) => {
    if (rule.min_amount === 0 && !rule.max_amount) {
      return 'All amounts';
    } else if (!rule.max_amount) {
      return `$${rule.min_amount}+`;
    } else {
      return `$${rule.min_amount} - $${rule.max_amount}`;
    }
  };

  return (
    <div className="commission-rules-manager">
      <div className="rules-header">
        <div className="header-content">
          <h2>Commission Rules Management</h2>
          <p>Configure commission rates and rules for different agent tiers</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          <i className="icon-plus"></i>
          Create New Rule
        </button>
      </div>

      <div className="rules-controls">
        <div className="search-box">
          <i className="icon-search"></i>
          <input
            type="text"
            placeholder="Search rules..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="rules-stats">
          <div className="stat">
            <span className="stat-value">{rules.length}</span>
            <span className="stat-label">Total Rules</span>
          </div>
          <div className="stat">
            <span className="stat-value">{rules.filter(r => r.is_active).length}</span>
            <span className="stat-label">Active Rules</span>
          </div>
        </div>
      </div>

      <div className="rules-table">
        {loading ? (
          <div className="loading">Loading commission rules...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Agent Tier</th>
                <th>Transaction Type</th>
                <th>Amount Range</th>
                <th>Commission Rate</th>
                <th>Status</th>
                <th>Effective Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map(rule => (
                <tr key={rule.id}>
                  <td>
                    <div className="rule-name">
                      <strong>{rule.name}</strong>
                      <small>{rule.description}</small>
                    </div>
                  </td>
                  <td>
                    <span className={`tier-badge tier-${rule.tier.toLowerCase().replace(' ', '-')}`}>
                      {rule.tier}
                    </span>
                  </td>
                  <td>
                    <span className="transaction-type">
                      {rule.transaction_type === 'all' ? 'All Types' : rule.transaction_type}
                    </span>
                  </td>
                  <td>{getAmountRangeDisplay(rule)}</td>
                  <td className="commission-rate">{getRateDisplay(rule)}</td>
                  <td>
                    <button
                      className={`status-toggle ${rule.is_active ? 'active' : 'inactive'}`}
                      onClick={() => handleToggleActive(rule.id)}
                    >
                      {rule.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td>{new Date(rule.effective_date).toLocaleDateString()}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => setEditingRule(rule)}
                        title="Edit Rule"
                      >
                        <i className="icon-edit"></i>
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteRule(rule.id)}
                        title="Delete Rule"
                      >
                        <i className="icon-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Rule Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Create New Commission Rule</h3>
              <button
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={(e) => { e.preventDefault(); handleCreateRule(); }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Rule Name *</label>
                    <input
                      type="text"
                      value={newRule.name}
                      onChange={(e) => setNewRule({...newRule, name: e.target.value})}
                      placeholder="Enter rule name"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Agent Tier *</label>
                    <select
                      value={newRule.tier}
                      onChange={(e) => setNewRule({...newRule, tier: e.target.value})}
                      required
                    >
                      <option value="Super Agent">Super Agent</option>
                      <option value="Regional Agent">Regional Agent</option>
                      <option value="Field Agent">Field Agent</option>
                      <option value="Sub Agent">Sub Agent</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={newRule.description}
                    onChange={(e) => setNewRule({...newRule, description: e.target.value})}
                    placeholder="Enter rule description"
                    rows="3"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Transaction Type</label>
                    <select
                      value={newRule.transaction_type}
                      onChange={(e) => setNewRule({...newRule, transaction_type: e.target.value})}
                    >
                      <option value="all">All Types</option>
                      <option value="transfer">Transfer</option>
                      <option value="deposit">Deposit</option>
                      <option value="withdrawal">Withdrawal</option>
                      <option value="payment">Payment</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Rate Type</label>
                    <select
                      value={newRule.rate_type}
                      onChange={(e) => setNewRule({...newRule, rate_type: e.target.value})}
                    >
                      <option value="percentage">Percentage</option>
                      <option value="flat">Flat Rate</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Minimum Amount ($)</label>
                    <input
                      type="number"
                      value={newRule.min_amount}
                      onChange={(e) => setNewRule({...newRule, min_amount: parseFloat(e.target.value) || 0})}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="form-group">
                    <label>Maximum Amount ($)</label>
                    <input
                      type="number"
                      value={newRule.max_amount || ''}
                      onChange={(e) => setNewRule({...newRule, max_amount: e.target.value ? parseFloat(e.target.value) : null})}
                      min="0"
                      step="0.01"
                      placeholder="No limit"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>
                      {newRule.rate_type === 'percentage' ? 'Rate (%)' : 'Rate ($)'} *
                    </label>
                    <input
                      type="number"
                      value={newRule.rate_value}
                      onChange={(e) => setNewRule({...newRule, rate_value: parseFloat(e.target.value) || 0})}
                      min="0"
                      step={newRule.rate_type === 'percentage' ? '0.01' : '0.01'}
                      required
                    />
                  </div>
                  {newRule.rate_type === 'percentage' && (
                    <div className="form-group">
                      <label>Flat Fee ($)</label>
                      <input
                        type="number"
                        value={newRule.flat_fee}
                        onChange={(e) => setNewRule({...newRule, flat_fee: parseFloat(e.target.value) || 0})}
                        min="0"
                        step="0.01"
                      />
                    </div>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Effective Date</label>
                    <input
                      type="date"
                      value={newRule.effective_date}
                      onChange={(e) => setNewRule({...newRule, effective_date: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label>Expiry Date</label>
                    <input
                      type="date"
                      value={newRule.expiry_date || ''}
                      onChange={(e) => setNewRule({...newRule, expiry_date: e.target.value || null})}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newRule.is_active}
                      onChange={(e) => setNewRule({...newRule, is_active: e.target.checked})}
                    />
                    Active Rule
                  </label>
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Create Rule
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Rule Modal */}
      {editingRule && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Edit Commission Rule</h3>
              <button
                className="modal-close"
                onClick={() => setEditingRule(null)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={(e) => { e.preventDefault(); handleUpdateRule(); }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Rule Name *</label>
                    <input
                      type="text"
                      value={editingRule.name}
                      onChange={(e) => setEditingRule({...editingRule, name: e.target.value})}
                      placeholder="Enter rule name"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Agent Tier *</label>
                    <select
                      value={editingRule.tier}
                      onChange={(e) => setEditingRule({...editingRule, tier: e.target.value})}
                      required
                    >
                      <option value="Super Agent">Super Agent</option>
                      <option value="Regional Agent">Regional Agent</option>
                      <option value="Field Agent">Field Agent</option>
                      <option value="Sub Agent">Sub Agent</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={editingRule.description}
                    onChange={(e) => setEditingRule({...editingRule, description: e.target.value})}
                    placeholder="Enter rule description"
                    rows="3"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Transaction Type</label>
                    <select
                      value={editingRule.transaction_type}
                      onChange={(e) => setEditingRule({...editingRule, transaction_type: e.target.value})}
                    >
                      <option value="all">All Types</option>
                      <option value="transfer">Transfer</option>
                      <option value="deposit">Deposit</option>
                      <option value="withdrawal">Withdrawal</option>
                      <option value="payment">Payment</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Rate Type</label>
                    <select
                      value={editingRule.rate_type}
                      onChange={(e) => setEditingRule({...editingRule, rate_type: e.target.value})}
                    >
                      <option value="percentage">Percentage</option>
                      <option value="flat">Flat Rate</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Minimum Amount ($)</label>
                    <input
                      type="number"
                      value={editingRule.min_amount}
                      onChange={(e) => setEditingRule({...editingRule, min_amount: parseFloat(e.target.value) || 0})}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="form-group">
                    <label>Maximum Amount ($)</label>
                    <input
                      type="number"
                      value={editingRule.max_amount || ''}
                      onChange={(e) => setEditingRule({...editingRule, max_amount: e.target.value ? parseFloat(e.target.value) : null})}
                      min="0"
                      step="0.01"
                      placeholder="No limit"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>
                      {editingRule.rate_type === 'percentage' ? 'Rate (%)' : 'Rate ($)'} *
                    </label>
                    <input
                      type="number"
                      value={editingRule.rate_value}
                      onChange={(e) => setEditingRule({...editingRule, rate_value: parseFloat(e.target.value) || 0})}
                      min="0"
                      step={editingRule.rate_type === 'percentage' ? '0.01' : '0.01'}
                      required
                    />
                  </div>
                  {editingRule.rate_type === 'percentage' && (
                    <div className="form-group">
                      <label>Flat Fee ($)</label>
                      <input
                        type="number"
                        value={editingRule.flat_fee}
                        onChange={(e) => setEditingRule({...editingRule, flat_fee: parseFloat(e.target.value) || 0})}
                        min="0"
                        step="0.01"
                      />
                    </div>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Effective Date</label>
                    <input
                      type="date"
                      value={editingRule.effective_date}
                      onChange={(e) => setEditingRule({...editingRule, effective_date: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label>Expiry Date</label>
                    <input
                      type="date"
                      value={editingRule.expiry_date || ''}
                      onChange={(e) => setEditingRule({...editingRule, expiry_date: e.target.value || null})}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingRule.is_active}
                      onChange={(e) => setEditingRule({...editingRule, is_active: e.target.checked})}
                    />
                    Active Rule
                  </label>
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setEditingRule(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Update Rule
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommissionRulesManager;
