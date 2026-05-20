/**
 * Multi-lingual Inventory Management
 * Example implementation with Nigerian languages support
 */

import React, { useState } from 'react';
import { TranslationProvider, useTranslation, LanguageSelector } from '../../../shared/useTranslation';

function InventoryContent() {
  const { t } = useTranslation('inventory');
  const { t: tCommon } = useTranslation('common');
  const { t: tMessages } = useTranslation('messages');
  
  const [inventory] = useState([
    { id: 1, name: 'Rice (50kg)', stock: 20, reorder_level: 10, supplier: 'ABC Foods' },
    { id: 2, name: 'Vegetable Oil (5L)', stock: 5, reorder_level: 10, supplier: 'XYZ Oils' },
    { id: 3, name: 'Sugar (2kg)', stock: 30, reorder_level: 15, supplier: 'Sugar Co' },
    { id: 4, name: 'Flour (10kg)', stock: 0, reorder_level: 5, supplier: 'Flour Mills' }
  ]);

  const [filter, setFilter] = useState('all');

  const getStockStatus = (item) => {
    if (item.stock === 0) return 'out_of_stock';
    if (item.stock <= item.reorder_level) return 'low_stock';
    return 'in_stock';
  };

  const filteredInventory = inventory.filter(item => {
    if (filter === 'all') return true;
    return getStockStatus(item) === filter;
  });

  const getStockColor = (status) => {
    switch (status) {
      case 'in_stock': return '#10b981';
      case 'low_stock': return '#f59e0b';
      case 'out_of_stock': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div className="inventory-container">
      {/* Header */}
      <header className="inventory-header">
        <h1>{t('inventory')}</h1>
        <div className="header-actions">
          <LanguageSelector />
          <button className="export-btn">{tCommon('export')}</button>
        </div>
      </header>

      {/* Filters */}
      <div className="filters">
        <button
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          {tCommon('all')} ({inventory.length})
        </button>
        <button
          className={`filter-btn ${filter === 'in_stock' ? 'active' : ''}`}
          onClick={() => setFilter('in_stock')}
        >
          {t('in_stock')} ({inventory.filter(i => getStockStatus(i) === 'in_stock').length})
        </button>
        <button
          className={`filter-btn ${filter === 'low_stock' ? 'active' : ''}`}
          onClick={() => setFilter('low_stock')}
        >
          Low {t('stock')} ({inventory.filter(i => getStockStatus(i) === 'low_stock').length})
        </button>
        <button
          className={`filter-btn ${filter === 'out_of_stock' ? 'active' : ''}`}
          onClick={() => setFilter('out_of_stock')}
        >
          {t('out_of_stock')} ({inventory.filter(i => getStockStatus(i) === 'out_of_stock').length})
        </button>
      </div>

      {/* Inventory Table */}
      <div className="inventory-table-container">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>{t('stock')}</th>
              <th>Status</th>
              <th>{t('supplier')}</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredInventory.map(item => {
              const status = getStockStatus(item);
              return (
                <tr key={item.id}>
                  <td className="product-name">{item.name}</td>
                  <td className="stock-quantity">
                    <span className="stock-badge" style={{ background: getStockColor(status) }}>
                      {item.stock}
                    </span>
                  </td>
                  <td>
                    <span className="status-badge" style={{ color: getStockColor(status) }}>
                      {t(status)}
                    </span>
                  </td>
                  <td>{item.supplier}</td>
                  <td>
                    {status === 'out_of_stock' || status === 'low_stock' ? (
                      <button className="restock-btn">
                        {t('restock')}
                      </button>
                    ) : (
                      <button className="view-btn">{tCommon('view')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="card-icon">📦</div>
          <div className="card-content">
            <div className="card-label">Total Items</div>
            <div className="card-value">{inventory.length}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="card-icon">✅</div>
          <div className="card-content">
            <div className="card-label">{t('in_stock')}</div>
            <div className="card-value">
              {inventory.filter(i => getStockStatus(i) === 'in_stock').length}
            </div>
          </div>
        </div>
        <div className="summary-card warning">
          <div className="card-icon">⚠️</div>
          <div className="card-content">
            <div className="card-label">Low {t('stock')}</div>
            <div className="card-value">
              {inventory.filter(i => getStockStatus(i) === 'low_stock').length}
            </div>
          </div>
        </div>
        <div className="summary-card danger">
          <div className="card-icon">❌</div>
          <div className="card-content">
            <div className="card-label">{t('out_of_stock')}</div>
            <div className="card-value">
              {inventory.filter(i => getStockStatus(i) === 'out_of_stock').length}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .inventory-container {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
        }

        .inventory-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
        }

        .header-actions {
          display: flex;
          gap: 15px;
        }

        .export-btn {
          padding: 10px 20px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
        }

        .filters {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .filter-btn {
          padding: 10px 20px;
          background: white;
          border: 2px solid #e5e7eb;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
        }

        .filter-btn.active {
          background: #667eea;
          color: white;
          border-color: #667eea;
        }

        .filter-btn:hover:not(.active) {
          border-color: #667eea;
        }

        .inventory-table-container {
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          overflow: hidden;
          margin-bottom: 30px;
        }

        .inventory-table {
          width: 100%;
          border-collapse: collapse;
        }

        .inventory-table th,
        .inventory-table td {
          padding: 15px;
          text-align: left;
        }

        .inventory-table th {
          background: #f8f9fa;
          font-weight: 600;
          border-bottom: 2px solid #e5e7eb;
        }

        .inventory-table tr {
          border-bottom: 1px solid #e5e7eb;
        }

        .inventory-table tr:hover {
          background: #f8f9fa;
        }

        .product-name {
          font-weight: 500;
        }

        .stock-badge {
          display: inline-block;
          padding: 4px 12px;
          color: white;
          border-radius: 12px;
          font-weight: 600;
        }

        .status-badge {
          font-weight: 500;
        }

        .restock-btn,
        .view-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }

        .restock-btn {
          background: #f59e0b;
          color: white;
        }

        .view-btn {
          background: #e5e7eb;
          color: #374151;
        }

        .summary-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
        }

        .summary-card {
          background: white;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .summary-card.warning {
          border-left: 4px solid #f59e0b;
        }

        .summary-card.danger {
          border-left: 4px solid #ef4444;
        }

        .card-icon {
          font-size: 36px;
        }

        .card-label {
          color: #6b7280;
          font-size: 14px;
          margin-bottom: 5px;
        }

        .card-value {
          font-size: 28px;
          font-weight: bold;
          color: #111827;
        }
      `}</style>
    </div>
  );
}

export default function MultilingualInventory() {
  return (
    <TranslationProvider module="inventory" defaultLanguage="en">
      <InventoryContent />
    </TranslationProvider>
  );
}

