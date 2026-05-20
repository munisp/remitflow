import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { Card } from '@/components/ui/card.jsx'
import StorefrontHome from './StorefrontHome'
import ProductDetail from './ProductDetail'
import CheckoutFlow from './CheckoutFlow'
import OrderConfirmation from './OrderConfirmation'
import { CartProvider } from './CartContext'

export default function CustomerStorefront() {
  return (
    <CartProvider>
      <div className="min-h-screen bg-gray-50">
        <Routes>
          <Route path="/" element={<StorefrontHome />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="/checkout" element={<CheckoutFlow />} />
          <Route path="/order-success" element={<OrderConfirmation />} />
        </Routes>
      </div>
    </CartProvider>
  )
}

