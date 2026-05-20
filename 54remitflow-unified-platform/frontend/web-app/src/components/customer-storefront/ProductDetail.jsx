import React, { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { 
  ShoppingCart, Heart, Star, StarHalf, Plus, Minus, 
  Package, ArrowLeft, MessageCircle, Truck, Shield
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useCart } from './CartContext'

// Mock data (same as in StorefrontHome)
const mockProducts = [
  {
    id: "1",
    name: "Premium Rice (50kg)",
    description: "High-quality imported rice, perfect for families. This premium long-grain rice is sourced from the best farms and provides excellent taste and nutrition for your family meals.",
    base_price: 45000,
    category: "Food & Groceries",
    images: ["https://via.placeholder.com/400"],
    rating: 4.5,
    reviews_count: 128,
    stock: 45,
    is_featured: true
  },
  {
    id: "2",
    name: "Cooking Oil (5L)",
    description: "Pure vegetable oil for healthy cooking. Made from 100% natural ingredients with no additives, perfect for frying, baking, and all your cooking needs.",
    base_price: 8500,
    category: "Food & Groceries",
    images: ["https://via.placeholder.com/400"],
    rating: 4.8,
    reviews_count: 89,
    stock: 120,
    is_featured: true
  }
]

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN'
  }).format(amount)
}

const StarRating = ({ rating }) => {
  const fullStars = Math.floor(rating)
  const hasHalfStar = rating % 1 !== 0
  
  return (
    <div className="flex items-center gap-1">
      {[...Array(fullStars)].map((_, i) => (
        <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
      ))}
      {hasHalfStar && <StarHalf className="w-5 h-5 fill-yellow-400 text-yellow-400" />}
      {[...Array(5 - Math.ceil(rating))].map((_, i) => (
        <Star key={i + fullStars} className="w-5 h-5 text-gray-300" />
      ))}
      <span className="text-lg font-semibold ml-2">{rating.toFixed(1)}</span>
      <span className="text-muted-foreground ml-1">({rating.toFixed(1)})</span>
    </div>
  )
}

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { addToCart } = useCart()
  const [quantity, setQuantity] = useState(1)
  
  const product = mockProducts.find(p => p.id === id)
  
  if (!product) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <h2 className="text-2xl font-bold mb-4">Product not found</h2>
        <Button onClick={() => navigate('/shop')}>Back to Shop</Button>
      </div>
    )
  }
  
  const handleAddToCart = () => {
    addToCart(product, quantity)
  }
  
  const handleWhatsAppOrder = () => {
    const message = `Hi! I'd like to order:\n${product.name}\nQuantity: ${quantity}\nTotal: ${formatCurrency(product.base_price * quantity)}`
    const whatsappUrl = `https://wa.me/2348031234567?text=${encodeURIComponent(message)}`
    window.open(whatsappUrl, '_blank')
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <Button 
          variant="ghost" 
          className="mb-6"
          onClick={() => navigate('/shop')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Shop
        </Button>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Product Image */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <Card className="overflow-hidden">
              <img 
                src={product.images[0]} 
                alt={product.name}
                className="w-full h-auto"
              />
            </Card>
          </motion.div>
          
          {/* Product Info */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            <div>
              <Badge className="mb-2">{product.category}</Badge>
              <h1 className="text-3xl font-bold mb-2">{product.name}</h1>
              <div className="flex items-center gap-4 mb-4">
                <StarRating rating={product.rating} />
                <span className="text-muted-foreground">
                  {product.reviews_count} reviews
                </span>
              </div>
              <p className="text-4xl font-bold text-primary mb-4">
                {formatCurrency(product.base_price)}
              </p>
            </div>
            
            <div className="prose max-w-none">
              <p className="text-muted-foreground">{product.description}</p>
            </div>
            
            <div className="flex items-center gap-2">
              {product.stock > 0 ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  In Stock - {product.stock} available
                </Badge>
              ) : (
                <Badge variant="outline" className="text-red-600 border-red-600">
                  Out of Stock
                </Badge>
              )}
            </div>
            
            {/* Quantity Selector */}
            <div className="flex items-center gap-4">
              <span className="font-semibold">Quantity:</span>
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-12 text-center font-semibold">{quantity}</span>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="space-y-3">
              <Button 
                size="lg" 
                className="w-full gap-2"
                onClick={handleAddToCart}
                disabled={product.stock === 0}
              >
                <ShoppingCart className="w-5 h-5" />
                Add to Cart
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                className="w-full gap-2"
                onClick={handleWhatsAppOrder}
              >
                <MessageCircle className="w-5 h-5" />
                Order via WhatsApp
              </Button>
            </div>
            
            {/* Additional Info */}
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Truck className="w-5 h-5 text-muted-foreground" />
                  <span>Free delivery on orders above ₦10,000</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Shield className="w-5 h-5 text-muted-foreground" />
                  <span>Secure payment guaranteed</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Package className="w-5 h-5 text-muted-foreground" />
                  <span>Quality products from trusted suppliers</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

