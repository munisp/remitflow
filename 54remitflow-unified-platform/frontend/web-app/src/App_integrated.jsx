import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Area, AreaChart
} from 'recharts'
import {
  User, Users, CreditCard, TrendingUp, Shield, Bell, Settings,
  DollarSign, Activity, ArrowUpRight, ArrowDownRight, Eye, EyeOff,
  Search, Filter, Download, Plus, Edit, Trash2, CheckCircle,
  AlertTriangle, XCircle, Clock, MapPin, Phone, Mail, Building,
  Smartphone, Laptop, Globe, Lock, Unlock, RefreshCw, Send,
  Receipt, FileText, PieChart as PieChartIcon, BarChart3,
  Calendar, MessageSquare, HelpCircle, LogOut, Menu, X,
  ShoppingCart, Package
} from 'lucide-react'

// Import new components
import CustomerStorefront from '@/components/customer-storefront/CustomerStorefront.jsx'
import CommunicationsDashboard from '@/components/communications/CommunicationsDashboard.jsx'

import './App.css'

// ... (keep all existing mock data and component definitions from original App.jsx)

function LoginPage({ onLogin }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setTimeout(() => {
      onLogin({ name: 'Agent Smith', id: 'AGT001', tier: 'Super Agent' })
      setIsLoading(false)
    }, 1500)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-2xl border-0">
          <CardHeader className="text-center pb-8">
            <div className="mx-auto w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full flex items-center justify-center mb-4">
              <Building className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Remittance Platform
            </CardTitle>
            <CardDescription>
              Secure access to your banking operations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={credentials.username}
                  onChange={(e) => setCredentials({...credentials, username: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={credentials.password}
                    onChange={(e) => setCredentials({...credentials, password: e.target.value})}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}

// Placeholder Dashboard component (use existing Dashboard from original App.jsx)
function Dashboard({ user }) {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Welcome, {user.name}!</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => window.location.href = '/shop'}>
                <ShoppingCart className="w-4 h-4" />
                Customer Storefront
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => window.location.href = '/communications'}>
                <MessageSquare className="w-4 h-4" />
                Communications Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)

  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route path="/shop/*" element={<CustomerStorefront />} />
        
        {/* Protected routes */}
        <Route 
          path="/communications" 
          element={user ? <CommunicationsDashboard /> : <Navigate to="/" />} 
        />
        <Route 
          path="/dashboard" 
          element={user ? <Dashboard user={user} /> : <Navigate to="/" />} 
        />
        
        {/* Login route */}
        <Route 
          path="/" 
          element={!user ? <LoginPage onLogin={setUser} /> : <Navigate to="/dashboard" />} 
        />
      </Routes>
    </Router>
  )
}

export default App

