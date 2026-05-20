import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Input } from '@/components/ui/input.jsx'
import { 
  ShoppingCart, Heart, Search, Star, StarHalf, 
  Package, Zap, Menu, X, Phone, Mail, MapPin
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCart } from './CartContext'
import ShoppingCartSidebar from './ShoppingCartSidebar'

// Mock data
const mockStore = {
  name: "Mama Ada's General Store",
  phone: "+234 803 123 4567",
  email: "mama.ada@example.com",
  address: "123 Market Street, Lagos, Nigeria"
}

const mockProducts = [
  {
    id: "1",
    name: "Premium Rice (50kg)",
    description: "High-quality imported rice, perfect for families",
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
    description: "Pure vegetable oil for healthy cooking",
    base_price: 8500,
    category: "Food & Groceries",
    images: ["https://via.placeholder.com/400"],
    rating: 4.8,
    reviews_count: 89,
    stock: 120,
    is_featured: true
  },
  {
    id: "3",
    name: "Detergent Powder (2kg)",
    description: "Powerful cleaning for all fabrics",
    base_price: 3200,
    category: "Household",
    images: ["https://via.placeholder.com/400"],
    rating: 4.3,
    reviews_count: 56,
    stock: 78
  },
  {
    id: "4",
    name: "Tomato Paste (70g x 50)",
    description: "Rich tomato paste for delicious meals",
    base_price: 12000,
    category: "Food & Groceries",
    images: ["https://via.placeholder.com/400"],
    rating: 4.6,
    reviews_count: 92,
    stock: 34
  },
  {
    id: "5",
    name: "Bathing Soap (Pack of 12)",
    description: "Gentle soap for the whole family",
    base_price: 2400,
    category: "Personal Care",
    images: ["https://via.placeholder.com/400"],
    rating: 4.4,
    reviews_count: 67,
    stock: 156
  },
  {
    id: "6",
    name: "Sugar (2kg)",
    description: "Pure white sugar for sweetening",
    base_price: 1800,
    category: "Food & Groceries",
    images: ["https://via.placeholder.com/400"],
    rating: 4.7,
    reviews_count: 43,
    stock: 89
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
        <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
      ))}
      {hasHalfStar && <StarHalf className="w-4 h-4 fill-yellow-400 text-yellow-400" />}
      {[...Array(5 - Math.ceil(rating))].map((_, i) => (
        <Star key={i + fullStars} className="w-4 h-4 text-gray-300" />
      ))}
      <span className="text-sm text-muted-foreground ml-1">{rating.toFixed(1)}</span>
    </div>
  )
}

const ProductCard = ({ product }) => {
  const [isHovered, setIsHovered] = useState(false)
  const navigate = useNavigate()
  const { addToCart } = useCart()
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -8 }}
      transition={{ duration: 0.3 }}
    >
      <Card 
        className="overflow-hidden cursor-pointer group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative overflow-hidden aspect-square">
          <img 
            src={product.images[0]} 
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
            onClick={() => navigate(`/shop/product/${product.id}`)}
          />
          {product.is_featured && (
            <Badge className="absolute top-2 left-2 bg-gradient-to-r from-purple-500 to-pink-500">
              <Zap className="w-3 h-3 mr-1" />
              Featured
            </Badge>
          )}
          {product.stock < 10 && (
            <Badge variant="destructive" className="absolute top-2 right-2">
              Only {product.stock} left
            </Badge>
          )}
        </div>
        <CardHeader className="pb-3">
          <CardTitle className="text-base line-clamp-2" onClick={() => navigate(`/shop/product/${product.id}`)}>
            {product.name}
          </CardTitle>
          <CardDescription className="line-clamp-2">{product.description}</CardDescription>
        </CardHeader>
        <CardContent className="pb-3">
          <StarRating rating={product.rating} />
          <p className="text-xs text-muted-foreground mt-1">{product.reviews_count} reviews</p>
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <p className="text-2xl font-bold">{formatCurrency(product.base_price)}</p>
          <Button 
            size="sm"
            onClick={() => addToCart(product, 1)}
            className="gap-2"
          >
            <ShoppingCart className="w-4 h-4" />
            Add
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  )
}

export default function StorefrontHome() {
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState('')
  const { getCartCount, isCartOpen, setIsCartOpen } = useCart()
  
  const filteredProducts = mockProducts.filter(product =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    product.description.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link to="/shop" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Package className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg">{mockStore.name}</h1>
                <p className="text-xs text-muted-foreground">Quality & Trust</p>
              </div>
            </Link>
            
            <div className="hidden md:flex flex-1 max-w-md mx-8">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  placeholder="Search products..." 
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="hidden md:flex">
                <Heart className="w-5 h-5" />
              </Button>
              <Button variant="ghost" size="icon" className="relative" onClick={() => setIsCartOpen(true)}>
                <ShoppingCart className="w-5 h-5" />
                {getCartCount() > 0 && (
                  <Badge className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center p-0 text-xs">
                    {getCartCount()}
                  </Badge>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-r from-purple-600 to-pink-600 text-white py-16">
        <div className="container mx-auto px-4 text-center">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-bold mb-4"
          >
            Welcome to {mockStore.name}
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-xl mb-8 opacity-90"
          >
            Quality products for everyday needs
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Button size="lg" variant="secondary" className="gap-2">
              <ShoppingCart className="w-5 h-5" />
              Start Shopping
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Products Grid */}
      <section className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-bold">
            {searchQuery ? `Search Results (${filteredProducts.length})` : 'Our Products'}
          </h3>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
        
        {filteredProducts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No products found matching "{searchQuery}"</p>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 mt-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h4 className="font-bold text-lg mb-4">{mockStore.name}</h4>
              <p className="text-gray-400 text-sm">Quality products for everyday needs</p>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-4">Contact Us</h4>
              <div className="space-y-2 text-sm text-gray-400">
                <p className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  {mockStore.phone}
                </p>
                <p className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  {mockStore.email}
                </p>
                <p className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  {mockStore.address}
                </p>
              </div>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-4">Quick Links</h4>
              <div className="space-y-2 text-sm text-gray-400">
                <p><Link to="/shop">Shop</Link></p>
                <p><Link to="/about">About Us</Link></p>
                <p><Link to="/contact">Contact</Link></p>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>© 2025 {mockStore.name}. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Shopping Cart Sidebar */}
      <ShoppingCartSidebar />
    </div>
  )
}

