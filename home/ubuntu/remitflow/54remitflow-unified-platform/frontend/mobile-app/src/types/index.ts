export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'agent' | 'admin' | 'customer';
}

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'transfer';
  amount: number;
  customerId: string;
  customerName: string;
  reference: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: string;
  commission?: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address?: string;
  balance?: number;
  kycStatus?: 'pending' | 'verified' | 'rejected';
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  imageUrl?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  subtotal: number;
}