import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Warehouse, TrendingDown, AlertTriangle, Plus, ArrowUpDown } from 'lucide-react';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import { inventoryApi } from '../services/api';

const mockProducts = [
  { id: 'PRD001', name: 'POS Terminal', sku: 'POS-001', category: 'Hardware', stock: 150, reserved: 25, reorderLevel: 50, warehouse: 'Lagos', status: 'in_stock' },
  { id: 'PRD002', name: 'Receipt Paper', sku: 'RCP-001', category: 'Consumables', stock: 5000, reserved: 500, reorderLevel: 1000, warehouse: 'Lagos', status: 'in_stock' },
  { id: 'PRD003', name: 'SIM Cards', sku: 'SIM-001', category: 'Connectivity', stock: 80, reserved: 30, reorderLevel: 100, warehouse: 'Abuja', status: 'low_stock' },
  { id: 'PRD004', name: 'Card Reader', sku: 'CRD-001', category: 'Hardware', stock: 0, reserved: 0, reorderLevel: 20, warehouse: 'Kano', status: 'out_of_stock' },
  { id: 'PRD005', name: 'Agent ID Cards', sku: 'AID-001', category: 'Supplies', stock: 2500, reserved: 100, reorderLevel: 500, warehouse: 'Lagos', status: 'in_stock' },
];

const columns = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Product Name' },
  { key: 'category', label: 'Category' },
  { key: 'stock', label: 'Stock', render: (v) => v.toLocaleString() },
  { key: 'reserved', label: 'Reserved' },
  { key: 'reorderLevel', label: 'Reorder Level' },
  { key: 'warehouse', label: 'Warehouse' },
  { 
    key: 'status', 
    label: 'Status',
    render: (value) => (
      <span className={`badge ${
        value === 'in_stock' ? 'badge-success' :
        value === 'low_stock' ? 'badge-warning' :
        'badge-danger'
      }`}>
        {value.replace('_', ' ')}
      </span>
    )
  },
];

export default function InventoryManagement() {
  const [filter, setFilter] = useState('all');

  const { data: products = mockProducts } = useQuery({
    queryKey: ['inventory-products'],
    queryFn: () => inventoryApi.products(),
    placeholderData: mockProducts,
  });

  const filteredProducts = filter === 'all' 
    ? products 
    : products.filter(p => p.status === filter);

  const stats = {
    totalProducts: products.length,
    totalStock: products.reduce((sum, p) => sum + p.stock, 0),
    lowStock: products.filter(p => p.status === 'low_stock').length,
    outOfStock: products.filter(p => p.status === 'out_of_stock').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-500">Track and manage product inventory across warehouses</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary flex items-center gap-2">
            <ArrowUpDown size={18} />
            Stock Transfer
          </button>
          <button className="btn btn-primary flex items-center gap-2">
            <Plus size={18} />
            Add Product
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Products" value={stats.totalProducts} icon={Package} color="primary" />
        <StatCard title="Total Stock" value={stats.totalStock.toLocaleString()} icon={Warehouse} color="primary" />
        <StatCard title="Low Stock" value={stats.lowStock} icon={TrendingDown} color="warning" />
        <StatCard title="Out of Stock" value={stats.outOfStock} icon={AlertTriangle} color="danger" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {['all', 'in_stock', 'low_stock', 'out_of_stock'].map((status) => (
          <button
            key={status}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === status 
                ? 'bg-primary-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            onClick={() => setFilter(status)}
          >
            {status === 'all' ? 'All' : status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Product Table */}
      <DataTable columns={columns} data={filteredProducts} />
    </div>
  );
}
