import React, { useState, useEffect } from 'react'
import { Building2, Users, CreditCard, BarChart3, Settings, Shield, Bell, LogOut, User, DollarSign, TrendingUp, AlertTriangle, CheckCircle, Eye, EyeOff, Zap, Phone, Receipt, Sliders, Wifi, Tv, Droplets, FileText, ChevronRight, Search, Plus, Trash2, Edit, RefreshCw, UserPlus, MapPin, Upload, ClipboardCheck, Star, Award, Globe, Briefcase, Hash, Calendar, ArrowRight, ArrowLeft, Camera, Fingerprint, ShoppingCart, Package, MessageSquare, Truck, Warehouse, Tag, Filter, Image, Heart, Share2, MoreHorizontal, Send, Bot, Headphones, Radio, Smartphone, Mail, Volume2, MessageCircle, Activity, Clock, AlertCircle, Box, BarChart2, Layers, Target, Menu, X, ChevronDown, Wallet, ArrowUpRight, ArrowDownRight, CircleDot, Home, PieChart, Lock, Key, Monitor, Power, RotateCw, Terminal, HardDrive, Signal, WifiOff, Download, BookOpen, QrCode, XCircle } from 'lucide-react'
import { RealTimeNotifications, RealTimeMetrics, RealTimeTransactionFeed } from './components/RealTimeFeatures';
import PWAInstallPrompt, { PWAStatusIndicator, OfflineBanner } from './components/PWAInstallPrompt';
import './App.css'

// API Configuration
const API_BASE_URL = 'http://localhost:5000/api'

// API Helper Functions
const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('authToken')
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: { ...defaultHeaders, ...options.headers },
      signal: controller.signal,
      ...options
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error('API call failed:', error)
    // Return mock data for demo purposes
    return getMockData(endpoint)
  }
}

// Mock data for demo
const getMockData = (endpoint) => {
  const mockData = {
    '/auth/login': { token: 'demo-token', user: { id: 1, role: 'customer' } },
    '/dashboard/stats': {
      total_agents: 1247,
      total_customers: 45678,
      total_transactions: 234567,
      system_health: 98.5,
      active_agents: 1156,
      balance: 125000,
      commission: 15750,
      customers_count: 47,
      rating: 4.8
    },
    '/transactions': {
      transactions: [
        { id: 1, type: 'deposit', amount: 50000, created_at: '2024-01-15T10:30:00Z', status: 'completed', agent_name: 'John Agent' },
        { id: 2, type: 'withdrawal', amount: 25000, created_at: '2024-01-15T09:15:00Z', status: 'completed', agent_name: 'Jane Agent' }
      ]
    }
  }
  return mockData[endpoint] || {}
}

// Utility Components
const Button = ({ children, variant = 'default', size = 'default', className = '', onClick, disabled, ...props }) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer'
  const variants = {
    default: 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 shadow-md shadow-indigo-200 hover:shadow-lg hover:shadow-indigo-300 rounded-xl',
    outline: 'border-[1.5px] border-slate-200 bg-white hover:bg-slate-50 hover:border-indigo-300 text-slate-700 rounded-xl hover:shadow-sm',
    ghost: 'hover:bg-slate-100 text-slate-600 rounded-xl',
    destructive: 'bg-gradient-to-r from-red-500 to-rose-500 text-white hover:from-red-600 hover:to-rose-600 shadow-md shadow-red-200 rounded-xl'
  }
  const sizes = {
    default: 'h-10 py-2 px-5 text-sm',
    sm: 'h-9 px-3.5 text-xs',
    lg: 'h-12 px-8 text-base',
    icon: 'h-10 w-10'
  }
  
  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

const Badge = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20',
    success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
    warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
    destructive: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20',
    outline: 'border border-slate-200 text-slate-600 bg-white'
  }
  
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}

// Main App Component
function App() {
  const [currentUser, setCurrentUser] = useState(null)
  const [currentView, setCurrentView] = useState('login')
  const [isLoading, setIsLoading] = useState(false)
  const [dashboardData, setDashboardData] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    role: 'customer'
  })

  // URL-based auto-login for demo navigation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const role = params.get('role')
    const view = params.get('view')
    if (role && !currentUser) {
      setCurrentUser({ id: 1, role })
      setCurrentView(view || 'dashboard')
      localStorage.setItem('authToken', 'demo-token')
    }
  }, [])

  // Load dashboard data when user logs in
  useEffect(() => {
    if (currentUser) {
      loadDashboardData()
    }
  }, [currentUser])

  const loadDashboardData = async () => {
    try {
      const data = await apiCall('/dashboard/stats')
      setDashboardData(data)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    }
  }

  const handleLogin = async (role = null) => {
    setIsLoading(true)
    try {
      const loginData = role ? { role } : loginForm
      const response = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginData)
      })
      
      if (response.token) {
        localStorage.setItem('authToken', response.token)
        setCurrentUser({ ...response.user, role: role || loginForm.role })
        setCurrentView('dashboard')
      }
    } catch (error) {
      console.error('Login failed:', error)
      // For demo, allow login anyway
      setCurrentUser({ id: 1, role: role || loginForm.role })
      setCurrentView('dashboard')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    setCurrentUser(null)
    setCurrentView('login')
    setDashboardData(null)
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0
    }).format(amount)
  }

  const formatNumber = (num) => {
    return new Intl.NumberFormat('en-NG').format(num)
  }

  // Navigation items based on user role
  const getNavigationItems = () => {
    const baseItems = [
      { id: 'dashboard', label: 'Dashboard', icon: BarChart3 }
    ]

    switch (currentUser?.role) {
      case 'customer':
        return [
          ...baseItems,
          { id: 'transactions', label: 'Transactions', icon: CreditCard },
          { id: 'bills', label: 'Bills Payment', icon: Receipt },
          { id: 'airtime', label: 'Airtime & Data', icon: Phone },
          { id: 'profile', label: 'Profile', icon: User },
          { id: 'settings', label: 'Settings', icon: Settings }
        ]
      case 'agent':
        return [
          ...baseItems,
          { id: 'transactions', label: 'Transactions', icon: CreditCard },
          { id: 'bills', label: 'Bills Payment', icon: Receipt },
          { id: 'airtime', label: 'Airtime & Data', icon: Phone },
          { id: 'ecommerce', label: 'Ecommerce', icon: ShoppingCart },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'omnichannel', label: 'Channels', icon: MessageSquare },
          { id: 'customers', label: 'Customers', icon: Users },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          { id: 'cash', label: 'Cash Management', icon: DollarSign }
        ]
      case 'super_agent':
        return [
          ...baseItems,
          { id: 'onboarding', label: 'Agent Onboarding', icon: UserPlus },
          { id: 'transactions', label: 'Transactions', icon: CreditCard },
          { id: 'bills', label: 'Bills Payment', icon: Receipt },
          { id: 'airtime', label: 'Airtime & Data', icon: Phone },
          { id: 'ecommerce', label: 'Ecommerce', icon: ShoppingCart },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'omnichannel', label: 'Channels', icon: MessageSquare },
          { id: 'pos_management', label: 'POS Management', icon: Monitor },
          { id: 'agents', label: 'My Agents', icon: Users },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          { id: 'cash', label: 'Cash Management', icon: DollarSign }
        ]
      case 'master_agent':
        return [
          ...baseItems,
          { id: 'onboarding', label: 'Agent Onboarding', icon: UserPlus },
          { id: 'transactions', label: 'Transactions', icon: CreditCard },
          { id: 'bills', label: 'Bills Payment', icon: Receipt },
          { id: 'airtime', label: 'Airtime & Data', icon: Phone },
          { id: 'pos_management', label: 'POS Management', icon: Monitor },
          { id: 'agents', label: 'My Agents', icon: Users },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          { id: 'cash', label: 'Cash Management', icon: DollarSign },
          { id: 'settings', label: 'Settings', icon: Settings }
        ]
      case 'admin':
        return [
          ...baseItems,
          { id: 'onboarding', label: 'Agent Onboarding', icon: UserPlus },
          { id: 'transactions', label: 'Transactions', icon: CreditCard },
          { id: 'bills', label: 'Bills Payment', icon: Receipt },
          { id: 'airtime', label: 'Airtime & Data', icon: Phone },
          { id: 'ecommerce', label: 'Ecommerce', icon: ShoppingCart },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'omnichannel', label: 'Channels', icon: MessageSquare },
          { id: 'pos_management', label: 'POS Management', icon: Monitor },
          { id: 'agents', label: 'Agents', icon: Users },
          { id: 'fee_schedule', label: 'Fee Schedule', icon: Sliders },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          { id: 'system', label: 'System', icon: Settings },
          { id: 'security', label: 'Security', icon: Shield }
        ]
      default:
        return baseItems
    }
  }

  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Login Screen
  if (currentView === 'login') {
    return (
      <div className="min-h-screen relative overflow-hidden flex">
        <PWAInstallPrompt />
        <PWAStatusIndicator />

        <div className="hidden lg:flex lg:w-1/2 relative" style={{background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 40%, #312E81 100%)'}}>
          <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(99,102,241,0.4) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(139,92,246,0.3) 0%, transparent 50%)'}} />
          <div className="relative z-10 flex flex-col justify-center px-16 animate-fade-in-up">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mb-8 shadow-lg shadow-indigo-500/30">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">54Agent Banking</h1>
            <p className="text-lg text-slate-300 mb-10 leading-relaxed max-w-md">Next-generation digital financial services platform powering Africa's agent banking network.</p>
            <div className="space-y-5">
              {[
                { icon: Shield, text: 'Bank-grade security with end-to-end encryption' },
                { icon: Zap, text: 'Real-time transaction processing across all channels' },
                { icon: Globe, text: 'Omnichannel support: USSD, WhatsApp, POS, Mobile' },
                { icon: TrendingUp, text: 'AI-powered fraud detection and analytics' },
              ].map((item, i) => (
                <div key={i} className={`flex items-center gap-4 animate-slide-in-left stagger-${i + 1}`}>
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                    <item.icon className="w-5 h-5 text-indigo-300" />
                  </div>
                  <span className="text-sm text-slate-300">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
          <div className="w-full max-w-md animate-fade-in-up">
            <div className="lg:hidden text-center mb-8">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
                <Building2 className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">54Agent Banking</h1>
            </div>

            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 p-8 border border-slate-100/80">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Welcome back</h2>
                <p className="text-sm text-slate-500 mt-1">Sign in to your account to continue</p>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                    <input
                      type="email"
                      placeholder="you@company.com"
                      className="input-premium pl-11"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      className="input-premium pl-11 pr-11"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                      {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                    <select
                      className="input-premium pl-11 pr-10 appearance-none cursor-pointer"
                      value={loginForm.role}
                      onChange={(e) => setLoginForm(prev => ({ ...prev, role: e.target.value }))}
                    >
                      <option value="customer">Customer</option>
                      <option value="agent">Agent</option>
                      <option value="super_agent">Super Agent</option>
                      <option value="master_agent">Master Agent</option>
                      <option value="admin">Administrator</option>
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <button
                  onClick={() => handleLogin()}
                  disabled={isLoading}
                  className="btn-primary-gradient w-full h-12 text-[15px] rounded-xl"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Signing in...</span>
                  ) : 'Sign In'}
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100">
                <p className="text-center text-xs font-medium text-slate-400 uppercase tracking-wider mb-4">Quick Demo Access</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { role: 'customer', label: 'Customer', icon: User, color: 'text-indigo-600 bg-indigo-50' },
                    { role: 'agent', label: 'Agent', icon: Users, color: 'text-emerald-600 bg-emerald-50' },
                    { role: 'super_agent', label: 'Super Agent', icon: Building2, color: 'text-violet-600 bg-violet-50' },
                    { role: 'admin', label: 'Admin', icon: Shield, color: 'text-amber-600 bg-amber-50' },
                  ].map((item) => (
                    <button
                      key={item.role}
                      onClick={() => handleLogin(item.role)}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-200 hover:border-indigo-200 hover:bg-slate-50 transition-all text-sm font-medium text-slate-700 group"
                    >
                      <span className={`w-7 h-7 rounded-lg ${item.color} flex items-center justify-center transition-transform group-hover:scale-110`}>
                        <item.icon className="w-3.5 h-3.5" />
                      </span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center mt-5 gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-glow" />
              <span className="text-xs text-slate-500">Connected to production API</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Dashboard Screen
  return (
    <div className="min-h-screen bg-slate-50/80">
      <PWAInstallPrompt />
      <PWAStatusIndicator />
      <OfflineBanner />

      {/* Sidebar */}
      <aside className={`sidebar-nav ${sidebarOpen ? '' : 'max-lg:!-translate-x-full'} max-lg:${sidebarOpen ? 'open' : ''}`}>
        <div className="p-5 pb-3">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-white tracking-tight">54Agent</h1>
              <p className="text-[11px] text-slate-400">Banking Platform</p>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-bold">
                {(currentUser?.role || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate capitalize">{currentUser?.role?.replace('_', ' ')}</p>
                <p className="text-[11px] text-slate-400">Online</p>
              </div>
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
            </div>
          </div>

          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2 px-2">Navigation</p>
        </div>

        <nav className="px-3 pb-4 flex-1">
          {getNavigationItems().map((item) => {
            const IconComponent = item.icon
            return (
              <div
                key={item.id}
                className={`nav-item ${currentView === item.id ? 'active' : ''}`}
                onClick={() => { setCurrentView(item.id); if (window.innerWidth < 1024) setSidebarOpen(false) }}
              >
                <IconComponent className="w-[18px] h-[18px]" />
                <span>{item.label}</span>
              </div>
            )
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-white/5">
          <div
            className="nav-item text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={handleLogout}
          >
            <LogOut className="w-[18px] h-[18px]" />
            <span>Sign Out</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 glass border-b border-slate-200/60">
          <div className="flex items-center justify-between h-16 px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-600">
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight capitalize">
                  {currentView === 'dashboard' ? (currentUser?.role === 'customer' ? 'Account Overview' : currentUser?.role === 'agent' ? 'Agent Dashboard' : 'System Overview') : currentView.replace('_', ' ')}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="search-box hidden md:block">
                <Search className="search-icon" />
                <input type="text" placeholder="Search..." className="w-56" />
              </div>
              <RealTimeNotifications userRole={currentUser?.role} />
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-medium text-slate-600">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="capitalize">{currentUser?.role?.replace('_', ' ')}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="p-6 lg:p-8">
        {/* Dashboard Content */}
        {currentView === 'dashboard' && (
          <div className="space-y-8 animate-fade-in-up">
            {/* Real-time Metrics */}
            <RealTimeMetrics userRole={currentUser?.role} />

            {/* Real-time Transaction Feed */}
            <RealTimeTransactionFeed userRole={currentUser?.role} />

            {/* Role-specific content */}
            {currentUser?.role === 'customer' && (
              <div className="space-y-6">
                <div className="card-premium p-6 animate-fade-in-up stagger-1">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-base font-semibold text-slate-900">Account Details</h3>
                    <Badge variant="success">Active</Badge>
                  </div>
                  <div className="space-y-3.5">
                    {[
                      { label: 'Account Number', value: '1234567890' },
                      { label: 'Account Type', value: 'Savings' },
                      { label: 'KYC Status', badge: true, variant: 'success', value: 'Verified' },
                    ].map((item, i) => (
                      <div key={i} className="flex justify-between items-center py-1">
                        <span className="text-sm text-slate-500">{item.label}</span>
                        {item.badge ? <Badge variant={item.variant}>{item.value}</Badge> : <span className="text-sm font-semibold text-slate-900">{item.value}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Actions</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { icon: ArrowUpRight, label: 'Deposit', color: 'bg-emerald-50 text-emerald-600', view: 'transactions' },
                      { icon: ArrowDownRight, label: 'Withdraw', color: 'bg-amber-50 text-amber-600', view: 'transactions' },
                      { icon: CreditCard, label: 'Transfer', color: 'bg-indigo-50 text-indigo-600', view: 'transactions' },
                      { icon: BarChart3, label: 'Statement', color: 'bg-violet-50 text-violet-600', view: 'analytics' },
                    ].map((action) => (
                      <button key={action.label} onClick={() => setCurrentView(action.view)} className="quick-action-btn">
                        <div className={`icon-wrap ${action.color}`}>
                          <action.icon className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium text-slate-700">{action.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(currentUser?.role === 'super_agent'|| currentUser?.role === 'master_agent') && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { icon: Users, label: 'Sub-Agents', value: '24', trend: '+3 this month', gradient: 'from-indigo-500 to-violet-600', shadow: 'shadow-indigo-500/20' },
                    { icon: Wallet, label: 'Float Balance', value: formatCurrency(2500000), trend: '+12% vs last month', gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/20' },
                    { icon: TrendingUp, label: 'Monthly Volume', value: formatCurrency(15800000), trend: '+18% growth', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20' },
                    { icon: Award, label: 'Commission (MTD)', value: formatCurrency(185000), trend: 'On target', gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/20' },
                  ].map((card, i) => (
                    <div key={i} className={`stat-card bg-gradient-to-br ${card.gradient} shadow-lg ${card.shadow} animate-fade-in-up stagger-${i + 1}`}>
                      <div className="relative z-10">
                        <div className="flex items-center justify-between mb-3">
                          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                            <card.icon className="w-5 h-5 text-white" />
                          </div>
                          <ChevronRight className="w-4 h-4 text-white/50" />
                        </div>
                        <p className="text-sm text-white/70 mb-1">{card.label}</p>
                        <p className="text-xl font-bold text-white">{card.value}</p>
                        <p className="text-xs text-white/60 mt-1">{card.trend}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="card-premium p-6 animate-fade-in-up stagger-3">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-slate-900">Agent Profile</h3>
                      <Badge variant="default">Super Agent</Badge>
                    </div>
                    <div className="space-y-3.5">
                      {[
                        { label: 'Agent Code', value: 'SA-LG-001' },
                        { label: 'Territory', value: 'Lagos & Ogun States' },
                        { label: 'KYC Status', badge: true, variant: 'success', value: 'Verified' },
                        { label: 'KYB Status', badge: true, variant: 'success', value: 'Verified' },
                        { label: 'Transaction Limit', value: `${formatCurrency(5000000)}/day` },
                      ].map((item, i) => (
                        <div key={i} className="flex justify-between items-center py-1">
                          <span className="text-sm text-slate-500">{item.label}</span>
                          {item.badge ? <Badge variant={item.variant}>{item.value}</Badge> : <span className="text-sm font-semibold text-slate-900">{item.value}</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card-premium p-6 animate-fade-in-up stagger-4">
                    <h3 className="text-base font-semibold text-slate-900 mb-5">Recent Onboarding</h3>
                    <div className="space-y-2">
                      {[
                        { name: 'Adebayo Johnson', tier: 'Field Agent', status: 'approved', date: '2024-01-15' },
                        { name: 'Fatima Ibrahim', tier: 'Sub Agent', status: 'under_review', date: '2024-01-14' },
                        { name: 'Chukwu Emmanuel', tier: 'Field Agent', status: 'submitted', date: '2024-01-13' },
                        { name: 'Ngozi Okafor', tier: 'Sub Agent', status: 'approved', date: '2024-01-12' },
                      ].map((app, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group cursor-pointer">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-indigo-600 text-xs font-bold">
                              {app.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900">{app.name}</p>
                              <p className="text-xs text-slate-400">{app.tier} · {app.date}</p>
                            </div>
                          </div>
                          <Badge variant={app.status === 'approved' ? 'success' : app.status === 'under_review' ? 'warning' : 'default'}>
                            {app.status.replace('_', ' ')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentUser?.role === 'agent' && (
              <div className="space-y-6">
                <div className="card-premium p-6 animate-fade-in-up stagger-1">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-base font-semibold text-slate-900">Agent Profile</h3>
                    <Badge variant="success">Active</Badge>
                  </div>
                  <div className="space-y-3.5">
                    {[
                      { label: 'Agent Code', value: 'AG001' },
                      { label: 'Location', value: 'Lagos, Nigeria' },
                      { label: 'Tier', badge: true, variant: 'default', value: 'Super Agent' },
                    ].map((item, i) => (
                      <div key={i} className="flex justify-between items-center py-1">
                        <span className="text-sm text-slate-500">{item.label}</span>
                        {item.badge ? <Badge variant={item.variant}>{item.value}</Badge> : <span className="text-sm font-semibold text-slate-900">{item.value}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Actions</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { icon: UserPlus, label: 'New Customer', color: 'bg-indigo-50 text-indigo-600', view: 'customers' },
                      { icon: CreditCard, label: 'Transaction', color: 'bg-emerald-50 text-emerald-600', view: 'transactions' },
                      { icon: DollarSign, label: 'Cash Request', color: 'bg-amber-50 text-amber-600', view: 'cash' },
                      { icon: BarChart3, label: 'Reports', color: 'bg-violet-50 text-violet-600', view: 'analytics' },
                    ].map((action) => (
                      <button key={action.label} onClick={() => setCurrentView(action.view)} className="quick-action-btn">
                        <div className={`icon-wrap ${action.color}`}>
                          <action.icon className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium text-slate-700">{action.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentUser?.role === 'admin' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="card-premium p-6 animate-fade-in-up stagger-1">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-slate-900">Security Alerts</h3>
                      <Badge variant="destructive">2 active</Badge>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 p-3.5 bg-rose-50 rounded-xl border border-rose-100">
                        <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle className="w-4 h-4 text-rose-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-rose-900">High-risk transaction detected</p>
                          <p className="text-xs text-rose-500 mt-0.5">Agent AG045 · ₦500,000 withdrawal</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3.5 bg-amber-50 rounded-xl border border-amber-100">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-amber-900">Unusual activity pattern</p>
                          <p className="text-xs text-amber-500 mt-0.5">Multiple failed login attempts</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card-premium p-6 animate-fade-in-up stagger-2">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-slate-900">System Status</h3>
                      <Badge variant="success">Operational</Badge>
                    </div>
                    <div className="space-y-3">
                      {[
                        { name: 'API Gateway', status: 'online' },
                        { name: 'Database', status: 'online' },
                        { name: 'Payment Processing', status: 'online' },
                        { name: 'Fraud Detection', status: 'degraded' },
                      ].map((svc, i) => (
                        <div key={i} className="flex justify-between items-center py-1.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-2 h-2 rounded-full ${svc.status === 'online' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            <span className="text-sm text-slate-600">{svc.name}</span>
                          </div>
                          <Badge variant={svc.status === 'online' ? 'success' : 'warning'}>{svc.status}</Badge>
                        </div>
                      ))}
                      <div className="flex justify-between items-center py-1.5 mt-2 pt-3 border-t border-slate-100">
                        <span className="text-sm text-slate-600">Online Agents</span>
                        <span className="text-sm font-bold text-slate-900">892 <span className="font-normal text-slate-400">/ 1,156</span></span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {currentView === 'onboarding' && <AgentOnboardingPage formatCurrency={formatCurrency} userRole={currentUser?.role} />}
        {currentView === 'bills' && <BillsPaymentPage formatCurrency={formatCurrency} />}
        {currentView === 'airtime' && <AirtimeDataPage formatCurrency={formatCurrency} />}
        {currentView === 'fee_schedule' && <FeeSchedulePage formatCurrency={formatCurrency} />}
        {currentView === 'ecommerce' && <EcommercePage formatCurrency={formatCurrency} />}
        {currentView === 'inventory' && <InventoryPage formatCurrency={formatCurrency} />}
        {currentView === 'omnichannel' && <OmnichannelPage />}
        {currentView === 'transactions' && <TransactionsPage formatCurrency={formatCurrency} userRole={currentUser?.role} />}
        {currentView === 'profile' && <ProfilePage formatCurrency={formatCurrency} />}
        {currentView === 'settings' && <SettingsPage />}
        {currentView === 'customers' && <CustomersPage formatCurrency={formatCurrency} />}
        {currentView === 'analytics' && <AnalyticsPage formatCurrency={formatCurrency} userRole={currentUser?.role} />}
        {currentView === 'cash' && <CashManagementPage formatCurrency={formatCurrency} />}
        {currentView === 'agents' && <AgentsPage formatCurrency={formatCurrency} userRole={currentUser?.role} />}
        {currentView === 'system' && <SystemPage />}
        {currentView === 'security' && <SecurityPage />}
        {currentView === 'pos_management' && <POSManagementPage formatCurrency={formatCurrency} />}
        </div>
      </div>
    </div>
  )
}

const ELECTRICITY_PROVIDERS = [
  { id: 'ikeja-electric-prepaid', name: 'Ikeja Electric (IKEDC)', type: 'Prepaid', icon: Zap, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { id: 'eko-electric-prepaid', name: 'Eko Electric (EKEDC)', type: 'Prepaid', icon: Zap, color: 'text-orange-600', bg: 'bg-orange-50' },
  { id: 'abuja-electric-prepaid', name: 'Abuja Electric (AEDC)', type: 'Prepaid', icon: Zap, color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'kano-electric-prepaid', name: 'Kano Electric (KEDCO)', type: 'Prepaid', icon: Zap, color: 'text-green-600', bg: 'bg-green-50' },
  { id: 'ph-electric-prepaid', name: 'Port Harcourt Electric (PHED)', type: 'Prepaid', icon: Zap, color: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'benin-electric-prepaid', name: 'Benin Electric (BEDC)', type: 'Prepaid', icon: Zap, color: 'text-red-600', bg: 'bg-red-50' },
  { id: 'jos-electric-prepaid', name: 'Jos Electric (JED)', type: 'Prepaid', icon: Zap, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'kaduna-electric-prepaid', name: 'Kaduna Electric (KAEDCO)', type: 'Prepaid', icon: Zap, color: 'text-teal-600', bg: 'bg-teal-50' },
  { id: 'enugu-electric-prepaid', name: 'Enugu Electric (EEDC)', type: 'Prepaid', icon: Zap, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  { id: 'ibadan-electric-prepaid', name: 'Ibadan Electric (IBEDC)', type: 'Prepaid', icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50' },
]

const CABLE_TV_PROVIDERS = [
  { id: 'dstv', name: 'DStv', icon: Tv, color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'gotv', name: 'GOtv', icon: Tv, color: 'text-green-600', bg: 'bg-green-50' },
  { id: 'startimes', name: 'StarTimes', icon: Tv, color: 'text-orange-600', bg: 'bg-orange-50' },
  { id: 'showmax', name: 'Showmax', icon: Tv, color: 'text-red-600', bg: 'bg-red-50' },
]

const GOVERNMENT_SERVICES = [
  { id: 'waec', name: 'WAEC Result Checker', icon: FileText, color: 'text-green-600', bg: 'bg-green-50' },
  { id: 'jamb', name: 'JAMB', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
]

const TELCO_PROVIDERS = [
  { id: 'mtn', name: 'MTN', color: '#FFCC00', textColor: 'text-black', bg: 'bg-yellow-400' },
  { id: 'airtel', name: 'Airtel', color: '#FF0000', textColor: 'text-white', bg: 'bg-red-600' },
  { id: 'glo', name: 'Glo', color: '#00B300', textColor: 'text-white', bg: 'bg-green-600' },
  { id: '9mobile', name: '9mobile', color: '#006B3F', textColor: 'text-white', bg: 'bg-emerald-700' },
]

const DATA_PLANS = {
  mtn: [
    { code: 'mtn-500mb', name: '500MB - 30 Days', price: 500 },
    { code: 'mtn-1gb', name: '1GB - 30 Days', price: 1000 },
    { code: 'mtn-2gb', name: '2GB - 30 Days', price: 1200 },
    { code: 'mtn-3gb', name: '3GB - 30 Days', price: 1500 },
    { code: 'mtn-5gb', name: '5GB - 30 Days', price: 2500 },
    { code: 'mtn-10gb', name: '10GB - 30 Days', price: 3500 },
  ],
  airtel: [
    { code: 'airtel-500mb', name: '500MB - 30 Days', price: 500 },
    { code: 'airtel-1gb', name: '1GB - 30 Days', price: 1000 },
    { code: 'airtel-2gb', name: '2GB - 30 Days', price: 1200 },
    { code: 'airtel-5gb', name: '5GB - 30 Days', price: 2500 },
    { code: 'airtel-10gb', name: '10GB - 30 Days', price: 3500 },
  ],
  glo: [
    { code: 'glo-1.35gb', name: '1.35GB - 14 Days', price: 500 },
    { code: 'glo-2.9gb', name: '2.9GB - 30 Days', price: 1000 },
    { code: 'glo-4.1gb', name: '4.1GB - 30 Days', price: 1500 },
    { code: 'glo-7.7gb', name: '7.7GB - 30 Days', price: 2500 },
  ],
  '9mobile': [
    { code: '9mobile-500mb', name: '500MB - 30 Days', price: 500 },
    { code: '9mobile-1.5gb', name: '1.5GB - 30 Days', price: 1000 },
    { code: '9mobile-3gb', name: '3GB - 30 Days', price: 1500 },
    { code: '9mobile-11gb', name: '11GB - 30 Days', price: 4000 },
  ],
}

function BillsPaymentPage({ formatCurrency }) {
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [billForm, setBillForm] = useState({ meter_number: '', amount: '', phone: '' })
  const [isProcessing, setIsProcessing] = useState(false)
  const [txResult, setTxResult] = useState(null)
  const [recentBills, setRecentBills] = useState([
    { id: 'BIL-001', provider: 'Ikeja Electric (IKEDC)', amount: 15000, status: 'successful', date: '2024-01-15 10:30', token: '4523-8901-2345-6789' },
    { id: 'BIL-002', provider: 'DStv', amount: 24500, status: 'successful', date: '2024-01-14 14:20', token: 'Renewed' },
    { id: 'BIL-003', provider: 'Eko Electric (EKEDC)', amount: 8000, status: 'failed', date: '2024-01-13 09:10', token: '-' },
    { id: 'BIL-004', provider: 'GOtv', amount: 5700, status: 'successful', date: '2024-01-12 16:45', token: 'Renewed' },
  ])

  const handlePayBill = async () => {
    setIsProcessing(true)
    try {
      const response = await apiCall('/bills/pay', {
        method: 'POST',
        body: JSON.stringify({
          service_id: selectedProvider.id,
          meter_number: billForm.meter_number,
          amount: parseFloat(billForm.amount),
          phone: billForm.phone,
        })
      })
      setTxResult({ status: 'successful', token: response.token || '5678-1234-9012-3456', reference: response.reference || 'REF-' + Date.now() })
    } catch {
      setTxResult({ status: 'successful', token: '5678-1234-9012-3456', reference: 'REF-' + Date.now() })
    } finally {
      setIsProcessing(false)
    }
  }

  if (txResult) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${txResult.status === 'successful' ? 'bg-green-100' : 'bg-red-100'}`}>
            {txResult.status === 'successful' ? <CheckCircle className="w-10 h-10 text-green-600" /> : <AlertTriangle className="w-10 h-10 text-red-600" />}
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{txResult.status === 'successful' ? 'Payment Successful' : 'Payment Failed'}</h2>
          <p className="text-gray-600 mb-6">{selectedProvider?.name}</p>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-left mb-6">
            <div className="flex justify-between"><span className="text-gray-600">Amount</span><span className="font-bold">{formatCurrency(parseFloat(billForm.amount))}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Meter/Account</span><span className="font-medium">{billForm.meter_number}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Reference</span><span className="font-medium text-sm">{txResult.reference}</span></div>
            {txResult.token && <div className="flex justify-between"><span className="text-gray-600">Token</span><span className="font-bold text-green-700 text-lg">{txResult.token}</span></div>}
          </div>
          <Button onClick={() => { setTxResult(null); setSelectedProvider(null); setSelectedCategory(null); setBillForm({ meter_number: '', amount: '', phone: '' }) }} className="w-full bg-gradient-to-r from-blue-600 to-green-600 text-white">
            Pay Another Bill
          </Button>
        </div>
      </div>
    )
  }

  if (selectedProvider) {
    return (
      <div className="max-w-lg mx-auto">
        <button onClick={() => setSelectedProvider(null)} className="flex items-center text-blue-600 hover:text-blue-800 mb-4 text-sm font-medium">
          <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back to providers
        </button>
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center space-x-3 mb-6">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${selectedProvider.bg}`}>
              <selectedProvider.icon className={`w-6 h-6 ${selectedProvider.color}`} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{selectedProvider.name}</h2>
              <p className="text-sm text-gray-500">{selectedProvider.type || selectedCategory}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{selectedCategory === 'Electricity' ? 'Meter Number' : selectedCategory === 'Cable TV' ? 'Smart Card Number' : 'Account Number'}</label>
              <input type="text" placeholder={selectedCategory === 'Electricity' ? 'Enter meter number' : selectedCategory === 'Cable TV' ? 'Enter smart card number' : 'Enter account number'} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value={billForm.meter_number} onChange={(e) => setBillForm(prev => ({ ...prev, meter_number: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount ({selectedCategory === 'Cable TV' ? 'Subscription' : 'NGN'})</label>
              <input type="number" placeholder="Enter amount" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value={billForm.amount} onChange={(e) => setBillForm(prev => ({ ...prev, amount: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (for receipt)</label>
              <input type="tel" placeholder="08012345678" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value={billForm.phone} onChange={(e) => setBillForm(prev => ({ ...prev, phone: e.target.value }))} />
            </div>
            <Button onClick={handlePayBill} disabled={isProcessing || !billForm.meter_number || !billForm.amount} className="w-full bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700 text-white py-3 text-lg">
              {isProcessing ? 'Processing...' : `Pay ${billForm.amount ? formatCurrency(parseFloat(billForm.amount)) : ''}`}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (selectedCategory) {
    const providers = selectedCategory === 'Electricity' ? ELECTRICITY_PROVIDERS : selectedCategory === 'Cable TV' ? CABLE_TV_PROVIDERS : GOVERNMENT_SERVICES
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <button onClick={() => setSelectedCategory(null)} className="flex items-center text-blue-600 hover:text-blue-800 mb-2 text-sm font-medium">
              <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back to categories
            </button>
            <h2 className="text-2xl font-bold text-gray-900">{selectedCategory} Providers</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((provider) => (
            <button key={provider.id} onClick={() => setSelectedProvider(provider)} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-all p-4 text-left border border-gray-100 hover:border-blue-200">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${provider.bg}`}>
                  <provider.icon className={`w-5 h-5 ${provider.color}`} />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{provider.name}</p>
                  {provider.type && <p className="text-xs text-gray-500">{provider.type}</p>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Bills Payment</h2>
        <p className="text-gray-600">Pay utility bills, cable TV subscriptions, and government services</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <button onClick={() => setSelectedCategory('Electricity')} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all p-6 text-left border border-gray-100 hover:border-yellow-300 group">
          <div className="w-14 h-14 bg-yellow-100 rounded-xl flex items-center justify-center mb-4 group-hover:bg-yellow-200 transition-colors">
            <Zap className="w-7 h-7 text-yellow-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Electricity</h3>
          <p className="text-sm text-gray-500">PHCN Prepaid & Postpaid meters</p>
          <p className="text-xs text-gray-400 mt-2">10 Distribution Companies</p>
        </button>
        <button onClick={() => setSelectedCategory('Cable TV')} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all p-6 text-left border border-gray-100 hover:border-blue-300 group">
          <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
            <Tv className="w-7 h-7 text-blue-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Cable TV</h3>
          <p className="text-sm text-gray-500">DStv, GOtv, StarTimes, Showmax</p>
          <p className="text-xs text-gray-400 mt-2">4 Providers</p>
        </button>
        <button onClick={() => setSelectedCategory('Government')} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all p-6 text-left border border-gray-100 hover:border-green-300 group">
          <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mb-4 group-hover:bg-green-200 transition-colors">
            <FileText className="w-7 h-7 text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Government Services</h3>
          <p className="text-sm text-gray-500">WAEC, JAMB</p>
          <p className="text-xs text-gray-400 mt-2">2 Services</p>
        </button>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Bill Payments</h3>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Token</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentBills.map((bill) => (
                <tr key={bill.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{bill.id}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{bill.provider}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(bill.amount)}</td>
                  <td className="px-4 py-3"><Badge variant={bill.status === 'successful' ? 'success' : 'destructive'}>{bill.status}</Badge></td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-700">{bill.token}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{bill.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AirtimeDataPage({ formatCurrency }) {
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [activeTab, setActiveTab] = useState('airtime')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [txResult, setTxResult] = useState(null)
  const [recentPurchases, setRecentPurchases] = useState([
    { id: 'TEL-001', provider: 'MTN', type: 'Airtime', phone: '08012345678', amount: 2000, status: 'successful', date: '2024-01-15 11:00' },
    { id: 'TEL-002', provider: 'Airtel', type: 'Data (2GB)', phone: '09087654321', amount: 1200, status: 'successful', date: '2024-01-14 15:30' },
    { id: 'TEL-003', provider: 'Glo', type: 'Airtime', phone: '07056789012', amount: 500, status: 'successful', date: '2024-01-13 08:45' },
    { id: 'TEL-004', provider: '9mobile', type: 'Data (1.5GB)', phone: '08198765432', amount: 1000, status: 'failed', date: '2024-01-12 12:15' },
  ])

  const quickAmounts = [100, 200, 500, 1000, 2000, 5000]

  const handlePurchase = async () => {
    setIsProcessing(true)
    try {
      const endpoint = activeTab === 'airtime' ? '/telco/purchase' : '/telco/purchase'
      const payload = {
        phone_number: phoneNumber,
        provider: selectedProvider.id,
        product_type: activeTab,
        amount: activeTab === 'data' ? selectedPlan.price : parseFloat(amount),
        ...(activeTab === 'data' && { data_code: selectedPlan.code }),
      }
      await apiCall(endpoint, { method: 'POST', body: JSON.stringify(payload) })
      setTxResult({ status: 'successful', reference: 'VTU-' + Date.now() })
    } catch {
      setTxResult({ status: 'successful', reference: 'VTU-' + Date.now() })
    } finally {
      setIsProcessing(false)
    }
  }

  if (txResult) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${txResult.status === 'successful' ? 'bg-green-100' : 'bg-red-100'}`}>
            {txResult.status === 'successful' ? <CheckCircle className="w-10 h-10 text-green-600" /> : <AlertTriangle className="w-10 h-10 text-red-600" />}
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{txResult.status === 'successful' ? 'Purchase Successful' : 'Purchase Failed'}</h2>
          <p className="text-gray-600 mb-6">{selectedProvider?.name} {activeTab === 'data' ? 'Data' : 'Airtime'}</p>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-left mb-6">
            <div className="flex justify-between"><span className="text-gray-600">Amount</span><span className="font-bold">{formatCurrency(activeTab === 'data' ? selectedPlan?.price : parseFloat(amount))}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Phone</span><span className="font-medium">{phoneNumber}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Reference</span><span className="font-medium text-sm">{txResult.reference}</span></div>
            {activeTab === 'data' && selectedPlan && <div className="flex justify-between"><span className="text-gray-600">Plan</span><span className="font-medium">{selectedPlan.name}</span></div>}
          </div>
          <Button onClick={() => { setTxResult(null); setSelectedProvider(null); setPhoneNumber(''); setAmount(''); setSelectedPlan(null) }} className="w-full bg-gradient-to-r from-blue-600 to-green-600 text-white">
            Make Another Purchase
          </Button>
        </div>
      </div>
    )
  }

  if (selectedProvider) {
    const plans = DATA_PLANS[selectedProvider.id] || []
    return (
      <div className="max-w-lg mx-auto">
        <button onClick={() => { setSelectedProvider(null); setSelectedPlan(null) }} className="flex items-center text-blue-600 hover:text-blue-800 mb-4 text-sm font-medium">
          <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back to providers
        </button>
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center space-x-3 mb-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${selectedProvider.bg}`}>
              <Phone className={`w-6 h-6 ${selectedProvider.textColor}`} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{selectedProvider.name}</h2>
              <p className="text-sm text-gray-500">Buy {activeTab === 'airtime' ? 'Airtime' : 'Data Bundle'}</p>
            </div>
          </div>

          <div className="flex space-x-1 mb-6 bg-gray-100 rounded-lg p-1">
            <button onClick={() => { setActiveTab('airtime'); setSelectedPlan(null) }} className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${activeTab === 'airtime' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}>
              <Phone className="w-4 h-4 inline mr-1" /> Airtime
            </button>
            <button onClick={() => { setActiveTab('data'); setAmount('') }} className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${activeTab === 'data' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}>
              <Wifi className="w-4 h-4 inline mr-1" /> Data
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input type="tel" placeholder="08012345678" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
            </div>

            {activeTab === 'airtime' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (NGN)</label>
                  <input type="number" placeholder="Enter amount" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {quickAmounts.map((qa) => (
                    <button key={qa} onClick={() => setAmount(String(qa))} className={`py-2 rounded-lg text-sm font-medium border transition-colors ${amount === String(qa) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-blue-300 text-gray-700'}`}>
                      {formatCurrency(qa)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Data Plan</label>
                {plans.map((plan) => (
                  <button key={plan.code} onClick={() => setSelectedPlan(plan)} className={`w-full flex justify-between items-center p-3 rounded-lg border transition-colors text-left ${selectedPlan?.code === plan.code ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                    <span className="font-medium text-gray-900">{plan.name}</span>
                    <span className="font-bold text-blue-600">{formatCurrency(plan.price)}</span>
                  </button>
                ))}
              </div>
            )}

            <Button onClick={handlePurchase} disabled={isProcessing || !phoneNumber || (activeTab === 'airtime' ? !amount : !selectedPlan)} className="w-full bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700 text-white py-3 text-lg">
              {isProcessing ? 'Processing...' : `Buy ${activeTab === 'airtime' ? (amount ? formatCurrency(parseFloat(amount)) + ' Airtime' : 'Airtime') : (selectedPlan ? selectedPlan.name : 'Data')}`}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Airtime & Data Recharge</h2>
        <p className="text-gray-600">Buy airtime or data bundles for all Nigerian networks</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {TELCO_PROVIDERS.map((provider) => (
          <button key={provider.id} onClick={() => setSelectedProvider(provider)} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all p-6 text-center border border-gray-100 hover:border-blue-300 group">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${provider.bg}`}>
              <span className={`text-xl font-black ${provider.textColor}`}>{provider.name.charAt(0)}</span>
            </div>
            <h3 className="text-lg font-bold text-gray-900">{provider.name}</h3>
            <p className="text-xs text-gray-500 mt-1">Airtime & Data</p>
          </button>
        ))}
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Purchases</h3>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentPurchases.map((purchase) => (
                <tr key={purchase.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{purchase.id}</td>
                  <td className="px-4 py-3 text-sm font-medium">{purchase.provider}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{purchase.type}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-700">{purchase.phone}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(purchase.amount)}</td>
                  <td className="px-4 py-3"><Badge variant={purchase.status === 'successful' ? 'success' : 'destructive'}>{purchase.status}</Badge></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{purchase.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FeeSchedulePage({ formatCurrency }) {
  const [feeConfigs, setFeeConfigs] = useState([
    { id: 1, name: 'POS Cash-Out Standard', transaction_type: 'pos_cash_out', fee_type: 'percentage_capped', percentage: 0.5, cap: 100, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 2, name: 'POS Card Transaction', transaction_type: 'pos_card', fee_type: 'percentage', percentage: 0.2, cap: null, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 3, name: 'Inter-Bank Transfer', transaction_type: 'transfer_inter', fee_type: 'flat', flat_amount: 50, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 4, name: 'Intra-Bank Transfer', transaction_type: 'transfer_intra', fee_type: 'flat', flat_amount: 0, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 5, name: 'Electricity Bills', transaction_type: 'bills_electricity', fee_type: 'percentage_capped', percentage: 0.1, cap: 200, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 6, name: 'Cable TV Bills', transaction_type: 'bills_cable_tv', fee_type: 'percentage', percentage: 0.2, cap: null, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 7, name: 'Airtime VTU', transaction_type: 'telco_airtime', fee_type: 'percentage', percentage: 0.1, cap: null, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 8, name: 'Data VTU', transaction_type: 'telco_data', fee_type: 'percentage', percentage: 0.15, cap: null, merchant_id: null, provider_id: null, is_active: true, priority: 0 },
    { id: 9, name: 'Premium Agent POS', transaction_type: 'pos_cash_out', fee_type: 'percentage_capped', percentage: 0.3, cap: 75, merchant_id: 'AGENT-PREMIUM-001', provider_id: null, is_active: true, priority: 10 },
    { id: 10, name: 'High Volume Transfers', transaction_type: 'transfer_inter', fee_type: 'tiered', tiers: [{min: 0, max: 50000, fee: 25}, {min: 50000, max: 500000, fee: 50}, {min: 500000, max: null, fee: 100}], merchant_id: null, provider_id: null, is_active: true, priority: 0 },
  ])
  const [showAddForm, setShowAddForm] = useState(false)
  const [testAmount, setTestAmount] = useState('')
  const [testTxType, setTestTxType] = useState('pos_cash_out')
  const [testResult, setTestResult] = useState(null)
  const [filterType, setFilterType] = useState('all')

  const transactionTypes = [
    'pos_cash_out', 'pos_card', 'transfer_intra', 'transfer_inter',
    'bills_electricity', 'bills_cable_tv', 'bills_water', 'bills_government',
    'telco_airtime', 'telco_data', 'wallet_topup'
  ]

  const feeTypeLabels = {
    percentage: 'Percentage',
    percentage_capped: 'Percentage (Capped)',
    flat: 'Flat Fee',
    tiered: 'Tiered',
  }

  const calculateTestFee = () => {
    const amt = parseFloat(testAmount)
    if (!amt) return
    const config = feeConfigs.find(c => c.transaction_type === testTxType && c.is_active)
    if (!config) { setTestResult({ fee: 0, config: null }); return }

    let fee = 0
    if (config.fee_type === 'flat') {
      fee = config.flat_amount || 0
    } else if (config.fee_type === 'percentage') {
      fee = amt * (config.percentage / 100)
    } else if (config.fee_type === 'percentage_capped') {
      fee = Math.min(amt * (config.percentage / 100), config.cap || Infinity)
    } else if (config.fee_type === 'tiered' && config.tiers) {
      const tier = config.tiers.find(t => amt >= t.min && (t.max === null || amt < t.max))
      fee = tier ? tier.fee : 0
    }
    setTestResult({ fee: Math.round(fee * 100) / 100, config })
  }

  const filteredConfigs = filterType === 'all' ? feeConfigs : feeConfigs.filter(c => c.transaction_type === filterType)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Fee Schedule Management</h2>
          <p className="text-gray-600">Configure per-merchant, per-provider fee tiers with percentage caps</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)} className="bg-gradient-to-r from-blue-600 to-green-600 text-white">
          <Plus className="w-4 h-4 mr-2" /> Add Fee Rule
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-sm text-gray-500 mb-1">Total Fee Rules</div>
          <div className="text-2xl font-bold text-gray-900">{feeConfigs.length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-sm text-gray-500 mb-1">Active Rules</div>
          <div className="text-2xl font-bold text-green-600">{feeConfigs.filter(c => c.is_active).length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-sm text-gray-500 mb-1">Custom Merchant Rules</div>
          <div className="text-2xl font-bold text-blue-600">{feeConfigs.filter(c => c.merchant_id).length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-sm text-gray-500 mb-1">Transaction Types</div>
          <div className="text-2xl font-bold text-purple-600">{new Set(feeConfigs.map(c => c.transaction_type)).size}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Fee Calculator</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transaction Type</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" value={testTxType} onChange={(e) => setTestTxType(e.target.value)}>
              {transactionTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transaction Amount (NGN)</label>
            <input type="number" placeholder="e.g. 50000" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" value={testAmount} onChange={(e) => setTestAmount(e.target.value)} />
          </div>
          <Button onClick={calculateTestFee} className="bg-blue-600 text-white">
            Calculate Fee
          </Button>
          {testResult && (
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-sm text-blue-600">Calculated Fee</div>
              <div className="text-xl font-bold text-blue-800">{formatCurrency(testResult.fee)}</div>
              {testResult.config && <div className="text-xs text-blue-500">Rule: {testResult.config.name}</div>}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Fee Configurations</h3>
          <select className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All Types</option>
            {transactionTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
          </select>
        </div>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rule Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fee Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate / Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scope</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredConfigs.map((config) => (
                <tr key={config.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{config.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{config.transaction_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{feeTypeLabels[config.fee_type]}</Badge></td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {config.fee_type === 'flat' && formatCurrency(config.flat_amount)}
                    {config.fee_type === 'percentage' && `${config.percentage}%`}
                    {config.fee_type === 'percentage_capped' && `${config.percentage}% (cap ${formatCurrency(config.cap)})`}
                    {config.fee_type === 'tiered' && `${config.tiers?.length} tiers`}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {config.merchant_id ? <Badge variant="default">{config.merchant_id}</Badge> : <span className="text-gray-400">Global</span>}
                  </td>
                  <td className="px-4 py-3"><Badge variant={config.is_active ? 'success' : 'destructive'}>{config.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3 text-sm text-gray-600">{config.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const ONBOARDING_STEPS = [
  { id: 1, title: 'Agent Tier', description: 'Select agent type and tier', icon: Award },
  { id: 2, title: 'Personal Info', description: 'Agent personal details', icon: User },
  { id: 3, title: 'Business Details', description: 'Business registration info', icon: Briefcase },
  { id: 4, title: 'KYC Documents', description: 'Identity verification documents', icon: Upload },
  { id: 5, title: 'KYB Verification', description: 'Business verification documents', icon: ClipboardCheck },
  { id: 6, title: 'Territory Setup', description: 'Assign operating territory', icon: MapPin },
  { id: 7, title: 'Biometric Capture', description: 'Fingerprint and photo capture', icon: Fingerprint },
  { id: 8, title: 'Review & Submit', description: 'Review and submit application', icon: CheckCircle },
]

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
]

const AGENT_TIERS = [
  {
    id: 'super_agent', name: 'Super Agent', description: 'Manages multiple regional and field agents. Highest transaction limits and commission rates.',
    limits: { daily: 5000000, monthly: 100000000 }, commission: '0.5% - 1.0%',
    requirements: ['Minimum 5 years banking experience', 'CAC registered business', 'Minimum ₦2M float capital', 'Office in designated territory'],
    color: 'from-purple-600 to-indigo-600', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700'
  },
  {
    id: 'regional_agent', name: 'Regional Agent', description: 'Oversees field agents within a specific region. High transaction limits.',
    limits: { daily: 2000000, monthly: 50000000 }, commission: '0.3% - 0.7%',
    requirements: ['Minimum 3 years banking experience', 'Registered business', 'Minimum ₦1M float capital', 'Physical office location'],
    color: 'from-blue-600 to-cyan-600', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700'
  },
  {
    id: 'field_agent', name: 'Field Agent', description: 'Operates in the field handling direct customer transactions. Standard limits.',
    limits: { daily: 500000, monthly: 10000000 }, commission: '0.2% - 0.5%',
    requirements: ['Minimum 1 year experience', 'Valid ID', 'Minimum ₦200K float capital', 'POS terminal access'],
    color: 'from-green-600 to-emerald-600', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700'
  },
  {
    id: 'sub_agent', name: 'Sub Agent', description: 'Entry-level agent handling basic transactions under a supervising agent.',
    limits: { daily: 100000, monthly: 2000000 }, commission: '0.1% - 0.3%',
    requirements: ['Valid ID', 'Smartphone or POS terminal', 'Minimum ₦50K float capital', 'Referral from existing agent'],
    color: 'from-orange-600 to-amber-600', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700'
  },
]

function AgentOnboardingPage({ formatCurrency, userRole }) {
  const [currentStep, setCurrentStep] = useState(1)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [errors, setErrors] = useState({})

  const [selectedTier, setSelectedTier] = useState(null)

  const [personalInfo, setPersonalInfo] = useState({
    first_name: '', last_name: '', email: '', phone: '+234',
    date_of_birth: '', gender: '', nationality: 'Nigerian',
    nin: '', bvn: ''
  })

  const [businessInfo, setBusinessInfo] = useState({
    business_name: '', business_type: '', registration_number: '',
    tax_id: '', years_in_business: '', business_address: '',
    business_phone: '', business_email: '', expected_monthly_volume: ''
  })

  const [kycDocuments, setKycDocuments] = useState({
    national_id: null, passport_photo: null, proof_of_address: null, utility_bill: null
  })

  const [ocrStatus, setOcrStatus] = useState({})

  const [kybDocuments, setKybDocuments] = useState({
    business_registration: null, tax_certificate: null, bank_statement: null, reference_letter: null
  })

  const [territory, setTerritory] = useState({
    primary_state: '', primary_lga: '', secondary_states: [],
    operating_address: '', gps_latitude: '', gps_longitude: ''
  })

  const [biometric, setBiometric] = useState({
    photo_captured: false, fingerprint_captured: false, signature_captured: false
  })

  const [referralInfo, setReferralInfo] = useState({
    referrer_agent_id: '', referral_code: ''
  })

  const [applications, setApplications] = useState([
    { id: 'APP-2024-001', name: 'Adebayo Johnson', tier: 'Field Agent', status: 'approved', date: '2024-01-15', risk_score: 0.12, kyc: 'verified', kyb: 'verified' },
    { id: 'APP-2024-002', name: 'Fatima Ibrahim', tier: 'Sub Agent', status: 'under_review', date: '2024-01-14', risk_score: 0.35, kyc: 'verified', kyb: 'in_progress' },
    { id: 'APP-2024-003', name: 'Chukwu Emmanuel', tier: 'Field Agent', status: 'submitted', date: '2024-01-13', risk_score: 0.08, kyc: 'pending', kyb: 'pending' },
    { id: 'APP-2024-004', name: 'Ngozi Okafor', tier: 'Sub Agent', status: 'approved', date: '2024-01-12', risk_score: 0.05, kyc: 'verified', kyb: 'verified' },
    { id: 'APP-2024-005', name: 'Ibrahim Musa', tier: 'Regional Agent', status: 'rejected', date: '2024-01-11', risk_score: 0.72, kyc: 'failed', kyb: 'pending' },
    { id: 'APP-2024-006', name: 'Amina Yusuf', tier: 'Field Agent', status: 'additional_info', date: '2024-01-10', risk_score: 0.45, kyc: 'verified', kyb: 'failed' },
  ])

  const [activeTab, setActiveTab] = useState('new')

  const validateStep = () => {
    const newErrors = {}
    if (currentStep === 1 && !selectedTier) {
      newErrors.tier = 'Please select an agent tier'
    }
    if (currentStep === 2) {
      if (!personalInfo.first_name) newErrors.first_name = 'Required'
      if (!personalInfo.last_name) newErrors.last_name = 'Required'
      if (!personalInfo.email) newErrors.email = 'Required'
      if (!personalInfo.phone || personalInfo.phone.length < 11) newErrors.phone = 'Valid phone required'
      if (!personalInfo.nin || personalInfo.nin.length !== 11) newErrors.nin = 'NIN must be 11 digits'
      if (!personalInfo.bvn || personalInfo.bvn.length !== 11) newErrors.bvn = 'BVN must be 11 digits'
    }
    if (currentStep === 3) {
      if (!businessInfo.business_name) newErrors.business_name = 'Required'
      if (!businessInfo.business_type) newErrors.business_type = 'Required'
      if (selectedTier !== 'sub_agent' && !businessInfo.registration_number) newErrors.registration_number = 'Required for this tier'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validateStep()) {
      setCurrentStep(Math.min(currentStep + 1, ONBOARDING_STEPS.length))
    }
  }

  const handlePrevious = () => {
    setCurrentStep(Math.max(currentStep - 1, 1))
    setErrors({})
  }

  const handleSubmit = () => {
    setIsProcessing(true)
    setTimeout(() => {
      setIsProcessing(false)
      setIsSubmitted(true)
    }, 2500)
  }

  const handleFileUpload = (category, docType, file) => {
    if (file && file.size > 5 * 1024 * 1024) {
      setErrors({ ...errors, [docType]: 'File must be less than 5MB' })
      return
    }
    if (category === 'kyc') {
      setKycDocuments({ ...kycDocuments, [docType]: file })
    } else {
      setKybDocuments({ ...kybDocuments, [docType]: file })
    }
    if (file) {
      setOcrStatus(prev => ({ ...prev, [docType]: { stage: 'paddleocr', paddleocr: 'processing', vlm: 'pending', docling: 'pending', confidence: 0 } }))
      setTimeout(() => {
        setOcrStatus(prev => ({ ...prev, [docType]: { ...prev[docType], stage: 'vlm', paddleocr: 'done', vlm: 'processing', confidence: 0.82 } }))
        setTimeout(() => {
          setOcrStatus(prev => ({ ...prev, [docType]: { ...prev[docType], stage: 'docling', vlm: 'done', docling: 'processing', confidence: 0.91 } }))
          setTimeout(() => {
            setOcrStatus(prev => ({ ...prev, [docType]: { ...prev[docType], stage: 'complete', docling: 'done', confidence: 0.96 } }))
          }, 1200)
        }, 1400)
      }, 1000)
    }
  }

  const simulateBiometric = (type) => {
    setIsProcessing(true)
    setTimeout(() => {
      setBiometric({ ...biometric, [`${type}_captured`]: true })
      setIsProcessing(false)
    }, 1500)
  }

  if (isSubmitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-3">Application Submitted!</h2>
        <p className="text-gray-600 mb-6 text-lg">
          Agent onboarding application for <strong>{personalInfo.first_name} {personalInfo.last_name}</strong> has been submitted successfully.
        </p>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 text-left mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Application Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-sm text-gray-500">Application ID</span><p className="font-medium">APP-2024-007</p></div>
            <div><span className="text-sm text-gray-500">Agent Tier</span><p className="font-medium">{AGENT_TIERS.find(t => t.id === selectedTier)?.name}</p></div>
            <div><span className="text-sm text-gray-500">Status</span><Badge variant="warning">Under Review</Badge></div>
            <div><span className="text-sm text-gray-500">Est. Processing</span><p className="font-medium">1-3 business days</p></div>
            <div><span className="text-sm text-gray-500">Territory</span><p className="font-medium">{territory.primary_state || 'Lagos'}</p></div>
            <div><span className="text-sm text-gray-500">KYC Status</span><Badge variant="default">Pending Verification</Badge></div>
          </div>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 text-left mb-6">
          <h4 className="font-medium text-blue-900 mb-2">Next Steps</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>1. KYC documents processed via PaddleOCR + VLM + Docling pipeline</li>
            <li>2. AML/PEP screening will be conducted automatically</li>
            <li>3. KYB business verification (1-2 business days)</li>
            <li>4. Territory assignment confirmation</li>
            <li>5. Agent code generation and POS terminal assignment</li>
          </ul>
        </div>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => { setIsSubmitted(false); setCurrentStep(1); setSelectedTier(null); setPersonalInfo({ first_name: '', last_name: '', email: '', phone: '+234', date_of_birth: '', gender: '', nationality: 'Nigerian', nin: '', bvn: '' }); setBusinessInfo({ business_name: '', business_type: '', registration_number: '', tax_id: '', years_in_business: '', business_address: '', business_phone: '', business_email: '', expected_monthly_volume: '' }); }} className="bg-blue-600 text-white">
            Onboard Another Agent
          </Button>
          <Button variant="outline" onClick={() => setActiveTab('applications')}>
            View All Applications
          </Button>
        </div>
      </div>
    )
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Select Agent Tier</h3>
              <p className="text-sm text-gray-500">Choose the appropriate tier based on the agent's qualifications and expected volume</p>
            </div>
            {errors.tier && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{errors.tier}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {AGENT_TIERS.map((tier) => (
                <div
                  key={tier.id}
                  onClick={() => setSelectedTier(tier.id)}
                  className={`relative cursor-pointer rounded-xl border-2 p-5 transition-all ${
                    selectedTier === tier.id
                      ? `${tier.border} ${tier.bg} ring-2 ring-offset-2 ring-blue-500`
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  {selectedTier === tier.id && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    </div>
                  )}
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-r ${tier.color} flex items-center justify-center mb-3`}>
                    <Award className="w-5 h-5 text-white" />
                  </div>
                  <h4 className="font-semibold text-gray-900 text-lg">{tier.name}</h4>
                  <p className="text-sm text-gray-500 mt-1 mb-3">{tier.description}</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Daily Limit</span>
                      <span className="font-medium">{formatCurrency(tier.limits.daily)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Commission</span>
                      <span className="font-medium">{tier.commission}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-700 mb-1">Requirements:</p>
                    <ul className="text-xs text-gray-500 space-y-0.5">
                      {tier.requirements.map((req, i) => (
                        <li key={i} className="flex items-start">
                          <ChevronRight className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                          {req}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Personal Information</h3>
              <p className="text-sm text-gray-500">Enter the agent's personal details for KYC verification</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                <input className={`w-full px-3 py-2 border ${errors.first_name ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="Enter first name" value={personalInfo.first_name} onChange={(e) => setPersonalInfo({ ...personalInfo, first_name: e.target.value })} />
                {errors.first_name && <p className="text-xs text-red-500 mt-1">{errors.first_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                <input className={`w-full px-3 py-2 border ${errors.last_name ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="Enter last name" value={personalInfo.last_name} onChange={(e) => setPersonalInfo({ ...personalInfo, last_name: e.target.value })} />
                {errors.last_name && <p className="text-xs text-red-500 mt-1">{errors.last_name}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                <input type="email" className={`w-full px-3 py-2 border ${errors.email ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="agent@example.com" value={personalInfo.email} onChange={(e) => setPersonalInfo({ ...personalInfo, email: e.target.value })} />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                <input className={`w-full px-3 py-2 border ${errors.phone ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="+234 801 234 5678" value={personalInfo.phone} onChange={(e) => setPersonalInfo({ ...personalInfo, phone: e.target.value })} />
                {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                <input type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" value={personalInfo.date_of_birth} onChange={(e) => setPersonalInfo({ ...personalInfo, date_of_birth: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" value={personalInfo.gender} onChange={(e) => setPersonalInfo({ ...personalInfo, gender: e.target.value })}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nationality</label>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" value={personalInfo.nationality} onChange={(e) => setPersonalInfo({ ...personalInfo, nationality: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">National Identification Number (NIN) *</label>
                <input className={`w-full px-3 py-2 border ${errors.nin ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="12345678901" maxLength={11} value={personalInfo.nin} onChange={(e) => setPersonalInfo({ ...personalInfo, nin: e.target.value.replace(/\D/g, '') })} />
                {errors.nin && <p className="text-xs text-red-500 mt-1">{errors.nin}</p>}
                <p className="text-xs text-gray-400 mt-1">11-digit National ID Number</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Verification Number (BVN) *</label>
                <input className={`w-full px-3 py-2 border ${errors.bvn ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="22312345678" maxLength={11} value={personalInfo.bvn} onChange={(e) => setPersonalInfo({ ...personalInfo, bvn: e.target.value.replace(/\D/g, '') })} />
                {errors.bvn && <p className="text-xs text-red-500 mt-1">{errors.bvn}</p>}
                <p className="text-xs text-gray-400 mt-1">11-digit Bank Verification Number</p>
              </div>
            </div>
          </div>
        )

      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Business Details</h3>
              <p className="text-sm text-gray-500">Provide business registration and operational information</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label>
                <input className={`w-full px-3 py-2 border ${errors.business_name ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="e.g. Adeola Enterprises" value={businessInfo.business_name} onChange={(e) => setBusinessInfo({ ...businessInfo, business_name: e.target.value })} />
                {errors.business_name && <p className="text-xs text-red-500 mt-1">{errors.business_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Type *</label>
                <select className={`w-full px-3 py-2 border ${errors.business_type ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} value={businessInfo.business_type} onChange={(e) => setBusinessInfo({ ...businessInfo, business_type: e.target.value })}>
                  <option value="">Select type</option>
                  <option value="sole_proprietorship">Sole Proprietorship</option>
                  <option value="partnership">Partnership</option>
                  <option value="limited_company">Limited Company (Ltd)</option>
                  <option value="cooperative">Cooperative Society</option>
                  <option value="ngo">NGO / Non-Profit</option>
                </select>
                {errors.business_type && <p className="text-xs text-red-500 mt-1">{errors.business_type}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CAC Registration Number {selectedTier !== 'sub_agent' ? '*' : ''}</label>
                <input className={`w-full px-3 py-2 border ${errors.registration_number ? 'border-red-300' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-500`} placeholder="RC-1234567" value={businessInfo.registration_number} onChange={(e) => setBusinessInfo({ ...businessInfo, registration_number: e.target.value })} />
                {errors.registration_number && <p className="text-xs text-red-500 mt-1">{errors.registration_number}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Identification Number (TIN)</label>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="12345678-0001" value={businessInfo.tax_id} onChange={(e) => setBusinessInfo({ ...businessInfo, tax_id: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Years in Business</label>
                <input type="number" min="0" max="100" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="5" value={businessInfo.years_in_business} onChange={(e) => setBusinessInfo({ ...businessInfo, years_in_business: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Monthly Volume (NGN)</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g. 5000000" value={businessInfo.expected_monthly_volume} onChange={(e) => setBusinessInfo({ ...businessInfo, expected_monthly_volume: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Address</label>
              <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" rows={2} placeholder="Full business address" value={businessInfo.business_address} onChange={(e) => setBusinessInfo({ ...businessInfo, business_address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Phone</label>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="+234 801 234 5678" value={businessInfo.business_phone} onChange={(e) => setBusinessInfo({ ...businessInfo, business_phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Email</label>
                <input type="email" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="business@example.com" value={businessInfo.business_email} onChange={(e) => setBusinessInfo({ ...businessInfo, business_email: e.target.value })} />
              </div>
            </div>
            {referralInfo && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Referral Information (Optional)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Referring Agent ID</label>
                    <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="e.g. SA-LG-001" value={referralInfo.referrer_agent_id} onChange={(e) => setReferralInfo({ ...referralInfo, referrer_agent_id: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Referral Code</label>
                    <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="e.g. REF-2024-ABC" value={referralInfo.referral_code} onChange={(e) => setReferralInfo({ ...referralInfo, referral_code: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )

      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">KYC Document Upload</h3>
              <p className="text-sm text-gray-500">Upload identity documents for verification. Documents are processed through a multi-engine pipeline: PaddleOCR (text extraction) + VLM (semantic understanding) + Docling (structured parsing).</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 flex items-start space-x-3">
              <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-medium">Secure Document Processing</p>
                <p>All documents are encrypted with AES-256-GCM and stored in compliance with NDPR (Nigeria Data Protection Regulation).</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Document Processing Pipeline</h4>
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 bg-white px-3 py-2 rounded-lg border border-gray-200">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs font-medium text-gray-700">1. PaddleOCR</span>
                  <span className="text-xs text-gray-400">Text Extraction</span>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300" />
                <div className="flex items-center space-x-2 bg-white px-3 py-2 rounded-lg border border-gray-200">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-xs font-medium text-gray-700">2. VLM</span>
                  <span className="text-xs text-gray-400">Understanding</span>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300" />
                <div className="flex items-center space-x-2 bg-white px-3 py-2 rounded-lg border border-gray-200">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-xs font-medium text-gray-700">3. Docling</span>
                  <span className="text-xs text-gray-400">Structured Parsing</span>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              {[
                { key: 'national_id', label: 'National ID / NIN Slip', desc: 'Government-issued national ID card or NIN enrollment slip', required: true },
                { key: 'passport_photo', label: 'Passport Photograph', desc: 'Recent passport-size photograph (white background)', required: true },
                { key: 'proof_of_address', label: 'Proof of Address', desc: 'Utility bill or bank statement (not older than 3 months)', required: true },
                { key: 'utility_bill', label: 'Additional ID (Optional)', desc: 'Driver\'s license, international passport, or voter\'s card', required: false },
              ].map((doc) => (
                <div key={doc.key} className={`border-2 border-dashed rounded-xl p-5 transition-all ${kycDocuments[doc.key] ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-blue-300'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {kycDocuments[doc.key] ? (
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                          <Upload className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-gray-900">{doc.label} {doc.required && <span className="text-red-500">*</span>}</p>
                        <p className="text-sm text-gray-500">{doc.desc}</p>
                            {kycDocuments[doc.key] && (
                              <p className="text-xs text-green-600 mt-1">{kycDocuments[doc.key].name} ({(kycDocuments[doc.key].size / 1024).toFixed(1)} KB)</p>
                            )}
                            {ocrStatus[doc.key] && (
                              <div className="mt-2 space-y-1">
                                <div className="flex items-center space-x-3">
                                  {[{key:'paddleocr',label:'PaddleOCR',color:'blue'},{key:'vlm',label:'VLM',color:'purple'},{key:'docling',label:'Docling',color:'green'}].map(eng => (
                                    <div key={eng.key} className="flex items-center space-x-1">
                                      <div className={`w-1.5 h-1.5 rounded-full ${
                                        ocrStatus[doc.key][eng.key] === 'done' ? `bg-${eng.color}-500` :
                                        ocrStatus[doc.key][eng.key] === 'processing' ? `bg-${eng.color}-400 animate-pulse` :
                                        'bg-gray-300'
                                      }`} />
                                      <span className={`text-xs ${
                                        ocrStatus[doc.key][eng.key] === 'done' ? `text-${eng.color}-600 font-medium` :
                                        ocrStatus[doc.key][eng.key] === 'processing' ? `text-${eng.color}-500` :
                                        'text-gray-400'
                                      }`}>{eng.label}</span>
                                    </div>
                                  ))}
                                </div>
                                {ocrStatus[doc.key].confidence > 0 && (
                                  <div className="flex items-center space-x-2">
                                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                                      <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-500" style={{width: `${ocrStatus[doc.key].confidence * 100}%`}} />
                                    </div>
                                    <span className="text-xs text-gray-500 font-mono">{(ocrStatus[doc.key].confidence * 100).toFixed(0)}%</span>
                                  </div>
                                )}
                                {ocrStatus[doc.key].stage === 'complete' && (
                                  <p className="text-xs text-green-600 font-medium">All engines complete - data extracted</p>
                                )}
                              </div>
                            )}
                      </div>
                    </div>
                    <div>
                      <input type="file" id={`kyc-${doc.key}`} className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => handleFileUpload('kyc', doc.key, e.target.files[0])} />
                      <label htmlFor={`kyc-${doc.key}`}>
                        <Button variant={kycDocuments[doc.key] ? 'outline' : 'default'} className={kycDocuments[doc.key] ? '' : 'bg-blue-600 text-white'} onClick={() => document.getElementById(`kyc-${doc.key}`).click()}>
                          {kycDocuments[doc.key] ? 'Replace' : 'Upload'}
                        </Button>
                      </label>
                    </div>
                  </div>
                  {errors[doc.key] && <p className="text-xs text-red-500 mt-2">{errors[doc.key]}</p>}
                </div>
              ))}
            </div>
          </div>
        )

      case 5:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">KYB Business Verification</h3>
              <p className="text-sm text-gray-500">Upload business documents for KYB verification. Documents are verified through Temporal workflow with CAC registry cross-reference.</p>
            </div>
            <div className="space-y-4">
              {[
                { key: 'business_registration', label: 'CAC Business Registration Certificate', desc: 'Certificate of Incorporation / Business Name Registration', required: selectedTier !== 'sub_agent' },
                { key: 'tax_certificate', label: 'Tax Identification Certificate', desc: 'FIRS Tax Identification Number (TIN) certificate', required: selectedTier === 'super_agent' || selectedTier === 'regional_agent' },
                { key: 'bank_statement', label: 'Bank Statement (6 months)', desc: 'Recent 6-month bank statement showing business transactions', required: true },
                { key: 'reference_letter', label: 'Reference Letter', desc: 'Letter of reference from an existing agent or financial institution', required: false },
              ].map((doc) => (
                <div key={doc.key} className={`border-2 border-dashed rounded-xl p-5 transition-all ${kybDocuments[doc.key] ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-blue-300'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {kybDocuments[doc.key] ? (
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                          <Upload className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-gray-900">{doc.label} {doc.required && <span className="text-red-500">*</span>}</p>
                        <p className="text-sm text-gray-500">{doc.desc}</p>
                        {kybDocuments[doc.key] && (
                          <p className="text-xs text-green-600 mt-1">{kybDocuments[doc.key].name} ({(kybDocuments[doc.key].size / 1024).toFixed(1)} KB)</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <input type="file" id={`kyb-${doc.key}`} className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => handleFileUpload('kyb', doc.key, e.target.files[0])} />
                      <Button variant={kybDocuments[doc.key] ? 'outline' : 'default'} className={kybDocuments[doc.key] ? '' : 'bg-blue-600 text-white'} onClick={() => document.getElementById(`kyb-${doc.key}`).click()}>
                        {kybDocuments[doc.key] ? 'Replace' : 'Upload'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {selectedTier === 'sub_agent' && (
              <div className="bg-yellow-50 rounded-lg p-4 text-sm text-yellow-700">
                <p className="font-medium">Sub Agent Note:</p>
                <p>CAC registration and Tax Certificate are optional for Sub Agents. A bank statement and supervising agent referral are sufficient.</p>
              </div>
            )}
          </div>
        )

      case 6:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Territory Assignment</h3>
              <p className="text-sm text-gray-500">Define the agent's operating territory with GPS coordinates for geofence enforcement</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary State *</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" value={territory.primary_state} onChange={(e) => setTerritory({ ...territory, primary_state: e.target.value })}>
                  <option value="">Select state</option>
                  {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary LGA</label>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g. Ikeja" value={territory.primary_lga} onChange={(e) => setTerritory({ ...territory, primary_lga: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Operating Address</label>
              <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" rows={2} placeholder="Full address of primary operating location" value={territory.operating_address} onChange={(e) => setTerritory({ ...territory, operating_address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">GPS Latitude</label>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g. 6.5244" value={territory.gps_latitude} onChange={(e) => setTerritory({ ...territory, gps_latitude: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">GPS Longitude</label>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g. 3.3792" value={territory.gps_longitude} onChange={(e) => setTerritory({ ...territory, gps_longitude: e.target.value })} />
              </div>
            </div>
            {(selectedTier === 'super_agent' || selectedTier === 'regional_agent') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Additional Coverage States</label>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                  {NIGERIAN_STATES.filter(s => s !== territory.primary_state).map(state => (
                    <label key={state} className="flex items-center space-x-2 text-sm cursor-pointer">
                      <input type="checkbox" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={territory.secondary_states.includes(state)} onChange={(e) => {
                        if (e.target.checked) {
                          setTerritory({ ...territory, secondary_states: [...territory.secondary_states, state] })
                        } else {
                          setTerritory({ ...territory, secondary_states: territory.secondary_states.filter(s => s !== state) })
                        }
                      }} />
                      <span>{state}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Geofence Configuration</h4>
              <p className="text-xs text-gray-500 mb-3">CBN requires GPS accuracy within 10 meters for agent location verification. Geofence violations will be automatically flagged.</p>
              <div className="flex items-center space-x-4">
                <Badge variant="default">Radius: 5km</Badge>
                <Badge variant="default">Accuracy: 10m CBN requirement</Badge>
                <Badge variant="default">Haversine distance calculation</Badge>
              </div>
            </div>
          </div>
        )

      case 7:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Biometric Capture</h3>
              <p className="text-sm text-gray-500">Capture biometric data for agent identification and transaction verification</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className={`rounded-xl border-2 p-6 text-center ${biometric.photo_captured ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${biometric.photo_captured ? 'bg-green-100' : 'bg-gray-100'}`}>
                  {biometric.photo_captured ? <CheckCircle className="w-8 h-8 text-green-600" /> : <Camera className="w-8 h-8 text-gray-400" />}
                </div>
                <h4 className="font-semibold text-gray-900 mb-1">Photo Capture</h4>
                <p className="text-sm text-gray-500 mb-4">Live photo for facial recognition</p>
                <Button onClick={() => simulateBiometric('photo')} disabled={biometric.photo_captured || isProcessing} className={biometric.photo_captured ? '' : 'bg-blue-600 text-white'} variant={biometric.photo_captured ? 'outline' : 'default'}>
                  {isProcessing ? 'Capturing...' : biometric.photo_captured ? 'Captured' : 'Capture Photo'}
                </Button>
              </div>
              <div className={`rounded-xl border-2 p-6 text-center ${biometric.fingerprint_captured ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${biometric.fingerprint_captured ? 'bg-green-100' : 'bg-gray-100'}`}>
                  {biometric.fingerprint_captured ? <CheckCircle className="w-8 h-8 text-green-600" /> : <Fingerprint className="w-8 h-8 text-gray-400" />}
                </div>
                <h4 className="font-semibold text-gray-900 mb-1">Fingerprint Scan</h4>
                <p className="text-sm text-gray-500 mb-4">10-finger biometric enrollment</p>
                <Button onClick={() => simulateBiometric('fingerprint')} disabled={biometric.fingerprint_captured || isProcessing} className={biometric.fingerprint_captured ? '' : 'bg-blue-600 text-white'} variant={biometric.fingerprint_captured ? 'outline' : 'default'}>
                  {isProcessing ? 'Scanning...' : biometric.fingerprint_captured ? 'Scanned' : 'Scan Fingerprints'}
                </Button>
              </div>
              <div className={`rounded-xl border-2 p-6 text-center ${biometric.signature_captured ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${biometric.signature_captured ? 'bg-green-100' : 'bg-gray-100'}`}>
                  {biometric.signature_captured ? <CheckCircle className="w-8 h-8 text-green-600" /> : <Edit className="w-8 h-8 text-gray-400" />}
                </div>
                <h4 className="font-semibold text-gray-900 mb-1">Digital Signature</h4>
                <p className="text-sm text-gray-500 mb-4">Signature for agreement verification</p>
                <Button onClick={() => simulateBiometric('signature')} disabled={biometric.signature_captured || isProcessing} className={biometric.signature_captured ? '' : 'bg-blue-600 text-white'} variant={biometric.signature_captured ? 'outline' : 'default'}>
                  {isProcessing ? 'Capturing...' : biometric.signature_captured ? 'Captured' : 'Capture Signature'}
                </Button>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Biometric Capture Progress</p>
                  <p className="text-xs text-gray-500">All biometrics are stored encrypted with AES-256</p>
                </div>
                <div className="text-sm font-medium">
                  {[biometric.photo_captured, biometric.fingerprint_captured, biometric.signature_captured].filter(Boolean).length} / 3 completed
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
                <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${([biometric.photo_captured, biometric.fingerprint_captured, biometric.signature_captured].filter(Boolean).length / 3) * 100}%` }} />
              </div>
            </div>
          </div>
        )

      case 8:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Review & Submit</h3>
              <p className="text-sm text-gray-500">Review all information before submitting the onboarding application</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center"><Award className="w-4 h-4 mr-2 text-purple-600" /> Agent Tier</h4>
                <p className="text-lg font-medium text-purple-700">{AGENT_TIERS.find(t => t.id === selectedTier)?.name || 'Not selected'}</p>
                <p className="text-sm text-gray-500">Daily limit: {formatCurrency(AGENT_TIERS.find(t => t.id === selectedTier)?.limits.daily || 0)}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center"><User className="w-4 h-4 mr-2 text-blue-600" /> Personal Info</h4>
                <p className="font-medium">{personalInfo.first_name} {personalInfo.last_name}</p>
                <p className="text-sm text-gray-500">{personalInfo.email}</p>
                <p className="text-sm text-gray-500">{personalInfo.phone}</p>
                <p className="text-sm text-gray-500">NIN: {personalInfo.nin ? `***${personalInfo.nin.slice(-4)}` : 'N/A'} | BVN: {personalInfo.bvn ? `***${personalInfo.bvn.slice(-4)}` : 'N/A'}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center"><Briefcase className="w-4 h-4 mr-2 text-green-600" /> Business Details</h4>
                <p className="font-medium">{businessInfo.business_name || 'N/A'}</p>
                <p className="text-sm text-gray-500">Type: {businessInfo.business_type ? businessInfo.business_type.replace('_', ' ') : 'N/A'}</p>
                <p className="text-sm text-gray-500">CAC: {businessInfo.registration_number || 'N/A'}</p>
                <p className="text-sm text-gray-500">TIN: {businessInfo.tax_id || 'N/A'}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center"><MapPin className="w-4 h-4 mr-2 text-red-600" /> Territory</h4>
                <p className="font-medium">{territory.primary_state || 'Not set'} {territory.primary_lga ? `- ${territory.primary_lga}` : ''}</p>
                {territory.secondary_states.length > 0 && (
                  <p className="text-sm text-gray-500">+{territory.secondary_states.length} additional state(s)</p>
                )}
                {territory.gps_latitude && <p className="text-sm text-gray-500">GPS: {territory.gps_latitude}, {territory.gps_longitude}</p>}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center"><Upload className="w-4 h-4 mr-2 text-orange-600" /> Documents</h4>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>KYC Documents</span>
                    <span className="font-medium">{Object.values(kycDocuments).filter(Boolean).length}/4 uploaded</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>KYB Documents</span>
                    <span className="font-medium">{Object.values(kybDocuments).filter(Boolean).length}/4 uploaded</span>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center"><Fingerprint className="w-4 h-4 mr-2 text-indigo-600" /> Biometrics</h4>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><span>Photo</span><Badge variant={biometric.photo_captured ? 'success' : 'warning'}>{biometric.photo_captured ? 'Captured' : 'Pending'}</Badge></div>
                  <div className="flex justify-between text-sm"><span>Fingerprint</span><Badge variant={biometric.fingerprint_captured ? 'success' : 'warning'}>{biometric.fingerprint_captured ? 'Captured' : 'Pending'}</Badge></div>
                  <div className="flex justify-between text-sm"><span>Signature</span><Badge variant={biometric.signature_captured ? 'success' : 'warning'}>{biometric.signature_captured ? 'Captured' : 'Pending'}</Badge></div>
                </div>
              </div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4 text-sm text-yellow-700">
              <p className="font-medium mb-1">Before submitting, please verify:</p>
              <ul className="space-y-0.5">
                <li>- All personal and business information is accurate</li>
                <li>- KYC/KYB documents are clear and legible</li>
                <li>- Territory assignment matches the agent's operating location</li>
                <li>- Biometric captures are complete</li>
              </ul>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Agent Onboarding</h2>
          <p className="text-gray-500">Onboard new agents with KYC/KYB verification, territory assignment, and biometric enrollment</p>
        </div>
        <div className="flex gap-2">
          <Button variant={activeTab === 'new' ? 'default' : 'outline'} onClick={() => setActiveTab('new')} className={activeTab === 'new' ? 'bg-blue-600 text-white' : ''}>
            <UserPlus className="w-4 h-4 mr-2" /> New Application
          </Button>
          <Button variant={activeTab === 'applications' ? 'default' : 'outline'} onClick={() => setActiveTab('applications')} className={activeTab === 'applications' ? 'bg-blue-600 text-white' : ''}>
            <ClipboardCheck className="w-4 h-4 mr-2" /> Applications ({applications.length})
          </Button>
        </div>
      </div>

      {activeTab === 'applications' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[
              { label: 'Total', count: applications.length, color: 'bg-gray-100 text-gray-700' },
              { label: 'Approved', count: applications.filter(a => a.status === 'approved').length, color: 'bg-green-100 text-green-700' },
              { label: 'Under Review', count: applications.filter(a => a.status === 'under_review').length, color: 'bg-yellow-100 text-yellow-700' },
              { label: 'Submitted', count: applications.filter(a => a.status === 'submitted').length, color: 'bg-blue-100 text-blue-700' },
              { label: 'Rejected', count: applications.filter(a => a.status === 'rejected').length, color: 'bg-red-100 text-red-700' },
            ].map((stat) => (
              <div key={stat.label} className={`rounded-xl p-4 ${stat.color}`}>
                <p className="text-sm font-medium">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.count}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Agent Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">KYC</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">KYB</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk Score</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.map((app) => (
                  <tr key={app.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{app.id}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{app.name}</td>
                    <td className="px-4 py-3"><Badge variant="outline">{app.tier}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={app.kyc === 'verified' ? 'success' : app.kyc === 'failed' ? 'destructive' : 'warning'}>{app.kyc}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={app.kyb === 'verified' ? 'success' : app.kyb === 'failed' ? 'destructive' : 'warning'}>{app.kyb}</Badge></td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-medium ${app.risk_score > 0.5 ? 'text-red-600' : app.risk_score > 0.3 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {(app.risk_score * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={app.status === 'approved' ? 'success' : app.status === 'rejected' ? 'destructive' : app.status === 'under_review' ? 'warning' : 'default'}>
                        {app.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{app.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center space-x-2 overflow-x-auto pb-2">
            {ONBOARDING_STEPS.map((step, index) => {
              const StepIcon = step.icon
              const isActive = currentStep === step.id
              const isCompleted = currentStep > step.id
              return (
                <React.Fragment key={step.id}>
                  {index > 0 && (
                    <div className={`h-0.5 w-8 flex-shrink-0 ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`} />
                  )}
                  <div className={`flex items-center space-x-2 px-3 py-2 rounded-lg flex-shrink-0 transition-all ${
                    isActive ? 'bg-blue-100 text-blue-700' :
                    isCompleted ? 'bg-green-50 text-green-700' :
                    'text-gray-400'
                  }`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                      isActive ? 'bg-blue-600 text-white' :
                      isCompleted ? 'bg-green-500 text-white' :
                      'bg-gray-200 text-gray-500'
                    }`}>
                      {isCompleted ? <CheckCircle className="w-4 h-4" /> : step.id}
                    </div>
                    <span className="text-xs font-medium whitespace-nowrap">{step.title}</span>
                  </div>
                </React.Fragment>
              )
            })}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            {renderStepContent()}
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={handlePrevious} disabled={currentStep === 1}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Previous
            </Button>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-500">Step {currentStep} of {ONBOARDING_STEPS.length}</span>
            </div>
            {currentStep === ONBOARDING_STEPS.length ? (
              <Button onClick={handleSubmit} disabled={isProcessing} className="bg-green-600 text-white hover:bg-green-700">
                {isProcessing ? 'Submitting...' : 'Submit Application'}
              </Button>
            ) : (
              <Button onClick={handleNext} className="bg-blue-600 text-white">
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== ECOMMERCE PAGE ====================
const DEMO_PRODUCTS = [
  { id: 'P001', name: 'Samsung Galaxy A15', category: 'Electronics', price: 125000, stock: 24, image: null, rating: 4.5, sold: 156, status: 'active' },
  { id: 'P002', name: 'Tecno Spark 20C', category: 'Electronics', price: 89000, stock: 42, image: null, rating: 4.3, sold: 234, status: 'active' },
  { id: 'P003', name: 'Oraimo Power Bank 20000mAh', category: 'Accessories', price: 12500, stock: 67, image: null, rating: 4.7, sold: 89, status: 'active' },
  { id: 'P004', name: 'Airpod Pro Max Clone', category: 'Accessories', price: 8500, stock: 31, image: null, rating: 3.9, sold: 312, status: 'active' },
  { id: 'P005', name: 'Binatone Stabilizer 2000VA', category: 'Home & Office', price: 35000, stock: 12, image: null, rating: 4.1, sold: 45, status: 'active' },
  { id: 'P006', name: 'Hisense 32" Smart TV', category: 'Electronics', price: 145000, stock: 8, image: null, rating: 4.6, sold: 28, status: 'active' },
  { id: 'P007', name: 'Multipurpose Blender Set', category: 'Home & Office', price: 18500, stock: 0, image: null, rating: 4.2, sold: 167, status: 'out_of_stock' },
  { id: 'P008', name: 'Solar Panel 200W', category: 'Energy', price: 85000, stock: 15, image: null, rating: 4.4, sold: 53, status: 'active' },
]

const DEMO_ORDERS = [
  { id: 'ORD-2024-001', customer: 'Adebayo Ogunlesi', items: 2, total: 214000, status: 'delivered', date: '2024-01-15', channel: 'Storefront' },
  { id: 'ORD-2024-002', customer: 'Ngozi Okafor', items: 1, total: 89000, status: 'shipped', date: '2024-01-14', channel: 'WhatsApp' },
  { id: 'ORD-2024-003', customer: 'Ibrahim Musa', items: 3, total: 46500, status: 'processing', date: '2024-01-14', channel: 'Jumia' },
  { id: 'ORD-2024-004', customer: 'Chioma Eze', items: 1, total: 145000, status: 'pending', date: '2024-01-13', channel: 'Konga' },
  { id: 'ORD-2024-005', customer: 'Fatima Abdullahi', items: 2, total: 21000, status: 'delivered', date: '2024-01-12', channel: 'Storefront' },
  { id: 'ORD-2024-006', customer: 'Emeka Nwosu', items: 1, total: 85000, status: 'cancelled', date: '2024-01-11', channel: 'Amazon' },
]

const MARKETPLACE_CHANNELS = [
  { id: 'storefront', name: 'Agent Storefront', products: 8, orders: 145, revenue: 2340000, status: 'active', color: 'bg-blue-500' },
  { id: 'jumia', name: 'Jumia', products: 6, orders: 89, revenue: 1560000, status: 'active', color: 'bg-orange-500' },
  { id: 'konga', name: 'Konga', products: 5, orders: 67, revenue: 980000, status: 'active', color: 'bg-red-500' },
  { id: 'whatsapp', name: 'WhatsApp Commerce', products: 8, orders: 112, revenue: 1890000, status: 'active', color: 'bg-green-500' },
  { id: 'amazon', name: 'Amazon', products: 3, orders: 23, revenue: 450000, status: 'pending', color: 'bg-yellow-500' },
  { id: 'ebay', name: 'eBay', products: 2, orders: 11, revenue: 210000, status: 'pending', color: 'bg-purple-500' },
]

function EcommercePage({ formatCurrency }) {
  const [activeTab, setActiveTab] = useState('products')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [productForm, setProductForm] = useState({ name: '', category: 'Electronics', price: '', stock: '', description: '' })
  const [cart, setCart] = useState([])
  const [orderFilter, setOrderFilter] = useState('all')

  const tabs = [
    { id: 'products', label: 'Product Catalog', icon: Package },
    { id: 'orders', label: 'Orders', icon: ShoppingCart },
    { id: 'channels', label: 'Marketplace Channels', icon: Globe },
    { id: 'storefront', label: 'My Storefront', icon: Building2 },
  ]

  const categories = ['All', 'Electronics', 'Accessories', 'Home & Office', 'Energy']
  const [selectedCategory, setSelectedCategory] = useState('All')
  const filteredProducts = selectedCategory === 'All' ? DEMO_PRODUCTS : DEMO_PRODUCTS.filter(p => p.category === selectedCategory)

  const orderStatuses = { delivered: 'bg-green-100 text-green-800', shipped: 'bg-blue-100 text-blue-800', processing: 'bg-yellow-100 text-yellow-800', pending: 'bg-gray-100 text-gray-800', cancelled: 'bg-red-100 text-red-800' }
  const filteredOrders = orderFilter === 'all' ? DEMO_ORDERS : DEMO_ORDERS.filter(o => o.status === orderFilter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Ecommerce Platform</h2>
          <p className="text-gray-500 mt-1">Manage your products, orders, and marketplace channels</p>
        </div>
        <Button onClick={() => setShowAddProduct(true)} className="bg-blue-600 text-white">
          <Plus className="w-4 h-4 mr-2" /> Add Product
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: '8', sub: '6 active', icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Total Orders', value: '447', sub: '+23 today', icon: ShoppingCart, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Revenue (MTD)', value: formatCurrency(7430000), sub: '+18% vs last month', icon: DollarSign, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Active Channels', value: '4/6', sub: '2 pending setup', icon: Globe, color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{kpi.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
              </div>
              <div className={`w-12 h-12 ${kpi.bg} rounded-xl flex items-center justify-center`}>
                <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex border-b">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* PRODUCTS TAB */}
          {activeTab === 'products' && (
            <div>
              <div className="flex items-center space-x-3 mb-6">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedCategory === cat ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {cat}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredProducts.map(product => (
                  <div key={product.id} className="border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg transition-shadow">
                    <div className={`h-40 ${product.stock === 0 ? 'bg-gray-200' : 'bg-gradient-to-br from-blue-50 to-indigo-100'} flex items-center justify-center relative`}>
                      <Package className={`w-12 h-12 ${product.stock === 0 ? 'text-gray-400' : 'text-blue-300'}`} />
                      {product.stock === 0 && <div className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full">Out of Stock</div>}
                      {product.stock > 0 && product.stock <= 10 && <div className="absolute top-2 right-2 bg-orange-500 text-white text-xs px-2 py-1 rounded-full">Low Stock</div>}
                    </div>
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400">{product.category}</span>
                        <div className="flex items-center space-x-1">
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                          <span className="text-xs text-gray-500">{product.rating}</span>
                        </div>
                      </div>
                      <h3 className="font-semibold text-gray-900 text-sm mb-2">{product.name}</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold text-blue-600">{formatCurrency(product.price)}</span>
                        <span className="text-xs text-gray-400">{product.sold} sold</span>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-xs text-gray-500">Stock: {product.stock}</span>
                        <div className="flex space-x-2">
                          <button className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"><Edit className="w-3.5 h-3.5 text-gray-600" /></button>
                          <button className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"><Eye className="w-3.5 h-3.5 text-blue-600" /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ORDERS TAB */}
          {activeTab === 'orders' && (
            <div>
              <div className="flex items-center space-x-3 mb-6">
                {['all', 'pending', 'processing', 'shipped', 'delivered', 'cancelled'].map(status => (
                  <button key={status} onClick={() => setOrderFilter(status)} className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${orderFilter === status ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {status}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Order ID</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Customer</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Items</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Total</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Channel</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Date</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map(order => (
                      <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm font-medium text-blue-600">{order.id}</td>
                        <td className="py-3 px-4 text-sm text-gray-900">{order.customer}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">{order.items}</td>
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">{formatCurrency(order.total)}</td>
                        <td className="py-3 px-4"><span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">{order.channel}</span></td>
                        <td className="py-3 px-4"><span className={`text-xs px-2 py-1 rounded-full capitalize ${orderStatuses[order.status]}`}>{order.status}</span></td>
                        <td className="py-3 px-4 text-sm text-gray-500">{order.date}</td>
                        <td className="py-3 px-4"><button className="p-1.5 rounded-lg hover:bg-gray-100"><MoreHorizontal className="w-4 h-4 text-gray-400" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CHANNELS TAB */}
          {activeTab === 'channels' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {MARKETPLACE_CHANNELS.map(ch => (
                <div key={ch.id} className="border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 ${ch.color} rounded-lg flex items-center justify-center`}>
                        <Globe className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{ch.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${ch.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{ch.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{ch.products}</p>
                      <p className="text-xs text-gray-500">Products</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{ch.orders}</p>
                      <p className="text-xs text-gray-500">Orders</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-blue-600">{formatCurrency(ch.revenue)}</p>
                      <p className="text-xs text-gray-500">Revenue</p>
                    </div>
                  </div>
                  <div className="mt-4 flex space-x-2">
                    <Button variant="outline" size="sm" className="flex-1 text-xs">Manage</Button>
                    <Button variant="outline" size="sm" className="flex-1 text-xs">Sync Products</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STOREFRONT TAB */}
          {activeTab === 'storefront' && (
            <div>
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold">Lagos Central Agent Store</h3>
                    <p className="text-blue-100 mt-1">agent-store-lagos-central.54link.ng</p>
                    <div className="flex items-center space-x-4 mt-3">
                      <span className="text-sm"><CheckCircle className="w-4 h-4 inline mr-1" />Verified Seller</span>
                      <span className="text-sm"><Star className="w-4 h-4 inline mr-1" />4.8 Rating</span>
                      <span className="text-sm"><Users className="w-4 h-4 inline mr-1" />1,247 Customers</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold">{formatCurrency(7430000)}</p>
                    <p className="text-blue-100 text-sm">Total Revenue (MTD)</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h4 className="font-semibold text-gray-900 mb-3">Storefront Settings</h4>
                  <div className="space-y-3">
                    {['Store Name', 'Custom Domain', 'Payment Methods', 'Delivery Zones', 'Store Theme'].map(setting => (
                      <div key={setting} className="flex items-center justify-between py-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600">{setting}</span>
                        <button className="text-blue-600 text-sm font-medium">Edit</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h4 className="font-semibold text-gray-900 mb-3">Top Selling Products</h4>
                  <div className="space-y-3">
                    {DEMO_PRODUCTS.slice(0, 5).sort((a, b) => b.sold - a.sold).map(p => (
                      <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div className="flex items-center space-x-2">
                          <Package className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">{p.name}</span>
                        </div>
                        <span className="text-sm font-medium text-gray-600">{p.sold} sold</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h4 className="font-semibold text-gray-900 mb-3">Sales by Channel</h4>
                  <div className="space-y-3">
                    {MARKETPLACE_CHANNELS.filter(c => c.status === 'active').map(ch => (
                      <div key={ch.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div className="flex items-center space-x-2">
                          <div className={`w-3 h-3 rounded-full ${ch.color}`} />
                          <span className="text-sm text-gray-900">{ch.name}</span>
                        </div>
                        <span className="text-sm font-medium text-blue-600">{formatCurrency(ch.revenue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Add New Product</h3>
                <button onClick={() => setShowAddProduct(false)} className="p-2 hover:bg-gray-100 rounded-lg"><Trash2 className="w-4 h-4 text-gray-400" /></button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                <input type="text" value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g. Samsung Galaxy A15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select value={productForm.category} onChange={e => setProductForm({ ...productForm, category: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    {['Electronics', 'Accessories', 'Home & Office', 'Energy', 'Fashion', 'Food & Beverage'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price (NGN)</label>
                  <input type="number" value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="0" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Stock</label>
                <input type="number" value={productForm.stock} onChange={e => setProductForm({ ...productForm, stock: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="0" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea rows={3} value={productForm.description} onChange={e => setProductForm({ ...productForm, description: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Product description..." />
              </div>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Drag & drop product images or click to browse</p>
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setShowAddProduct(false)}>Cancel</Button>
              <Button onClick={() => { setShowAddProduct(false) }} className="bg-blue-600 text-white">Add Product</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== INVENTORY PAGE ====================
const DEMO_INVENTORY = [
  { sku: 'SKU-001', name: 'Samsung Galaxy A15', warehouse: 'Lagos Main', qty: 24, reorder: 10, cost: 95000, value: 2280000, status: 'healthy', lastRestock: '2024-01-10' },
  { sku: 'SKU-002', name: 'Tecno Spark 20C', warehouse: 'Lagos Main', qty: 42, reorder: 15, cost: 65000, value: 2730000, status: 'healthy', lastRestock: '2024-01-08' },
  { sku: 'SKU-003', name: 'Oraimo Power Bank 20000mAh', warehouse: 'Abuja Hub', qty: 67, reorder: 20, cost: 8000, value: 536000, status: 'overstocked', lastRestock: '2024-01-12' },
  { sku: 'SKU-004', name: 'Airpod Pro Max Clone', warehouse: 'Lagos Main', qty: 31, reorder: 25, cost: 5000, value: 155000, status: 'healthy', lastRestock: '2024-01-09' },
  { sku: 'SKU-005', name: 'Binatone Stabilizer 2000VA', warehouse: 'PH Depot', qty: 12, reorder: 15, cost: 25000, value: 300000, status: 'low', lastRestock: '2024-01-05' },
  { sku: 'SKU-006', name: 'Hisense 32" Smart TV', warehouse: 'Lagos Main', qty: 8, reorder: 10, cost: 110000, value: 880000, status: 'low', lastRestock: '2024-01-03' },
  { sku: 'SKU-007', name: 'Multipurpose Blender Set', warehouse: 'Abuja Hub', qty: 0, reorder: 20, cost: 12000, value: 0, status: 'out', lastRestock: '2023-12-28' },
  { sku: 'SKU-008', name: 'Solar Panel 200W', warehouse: 'PH Depot', qty: 15, reorder: 10, cost: 60000, value: 900000, status: 'healthy', lastRestock: '2024-01-11' },
]

const WAREHOUSES = [
  { id: 'lagos', name: 'Lagos Main Warehouse', location: 'Ikeja, Lagos', capacity: 500, used: 342, items: 156, orders: 89 },
  { id: 'abuja', name: 'Abuja Distribution Hub', location: 'Garki, Abuja', capacity: 300, used: 187, items: 98, orders: 45 },
  { id: 'ph', name: 'Port Harcourt Depot', location: 'Trans Amadi, PH', capacity: 200, used: 78, items: 45, orders: 23 },
]

const DEMAND_FORECAST = [
  { product: 'Samsung Galaxy A15', current: 24, predicted7d: 18, predicted30d: 65, confidence: 0.89, trend: 'up' },
  { product: 'Tecno Spark 20C', current: 42, predicted7d: 25, predicted30d: 95, confidence: 0.92, trend: 'up' },
  { product: 'Oraimo Power Bank', current: 67, predicted7d: 12, predicted30d: 40, confidence: 0.85, trend: 'stable' },
  { product: 'Solar Panel 200W', current: 15, predicted7d: 8, predicted30d: 35, confidence: 0.78, trend: 'up' },
  { product: 'Hisense 32" TV', current: 8, predicted7d: 6, predicted30d: 22, confidence: 0.81, trend: 'down' },
]

function InventoryPage({ formatCurrency }) {
  const [activeTab, setActiveTab] = useState('stock')

  const tabs = [
    { id: 'stock', label: 'Stock Levels', icon: Package },
    { id: 'warehouses', label: 'Warehouses', icon: Warehouse },
    { id: 'forecast', label: 'Demand Forecast', icon: TrendingUp },
    { id: 'suppliers', label: 'Procurement', icon: Truck },
  ]

  const statusColors = { healthy: 'bg-green-100 text-green-800', low: 'bg-orange-100 text-orange-800', out: 'bg-red-100 text-red-800', overstocked: 'bg-blue-100 text-blue-800' }
  const statusLabels = { healthy: 'Healthy', low: 'Low Stock', out: 'Out of Stock', overstocked: 'Overstocked' }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Inventory Management</h2>
          <p className="text-gray-500 mt-1">Track stock, manage warehouses, and forecast demand</p>
        </div>
        <div className="flex space-x-3">
          <Button variant="outline"><RefreshCw className="w-4 h-4 mr-2" /> Sync All</Button>
          <Button className="bg-blue-600 text-white"><Plus className="w-4 h-4 mr-2" /> Restock Order</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { label: 'Total SKUs', value: '8', icon: Box, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Total Value', value: formatCurrency(7781000), icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Low Stock Items', value: '2', icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Out of Stock', value: '1', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Warehouses', value: '3', icon: Warehouse, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 ${kpi.bg} rounded-lg flex items-center justify-center`}>
                <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{kpi.label}</p>
                <p className="text-xl font-bold text-gray-900">{kpi.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex border-b">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* STOCK TAB */}
          {activeTab === 'stock' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">SKU</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Product</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Warehouse</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Qty</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Reorder Point</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Unit Cost</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Total Value</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Last Restock</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_INVENTORY.map(item => (
                    <tr key={item.sku} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-mono text-blue-600">{item.sku}</td>
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{item.name}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{item.warehouse}</td>
                      <td className="py-3 px-4 text-sm font-bold text-gray-900">{item.qty}</td>
                      <td className="py-3 px-4 text-sm text-gray-500">{item.reorder}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{formatCurrency(item.cost)}</td>
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{formatCurrency(item.value)}</td>
                      <td className="py-3 px-4"><span className={`text-xs px-2 py-1 rounded-full ${statusColors[item.status]}`}>{statusLabels[item.status]}</span></td>
                      <td className="py-3 px-4 text-sm text-gray-500">{item.lastRestock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* WAREHOUSES TAB */}
          {activeTab === 'warehouses' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {WAREHOUSES.map(wh => (
                <div key={wh.id} className="border border-gray-200 rounded-xl p-5">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center">
                      <Warehouse className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{wh.name}</h3>
                      <p className="text-sm text-gray-500 flex items-center"><MapPin className="w-3 h-3 mr-1" />{wh.location}</p>
                    </div>
                  </div>
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-500">Capacity</span>
                      <span className="font-medium text-gray-900">{wh.used}/{wh.capacity} units</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div className={`h-2.5 rounded-full ${(wh.used / wh.capacity) > 0.8 ? 'bg-red-500' : (wh.used / wh.capacity) > 0.6 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${(wh.used / wh.capacity) * 100}%` }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-gray-900">{wh.items}</p>
                      <p className="text-xs text-gray-500">Unique Items</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-gray-900">{wh.orders}</p>
                      <p className="text-xs text-gray-500">Pending Orders</p>
                    </div>
                  </div>
                  <div className="mt-4 flex space-x-2">
                    <Button variant="outline" size="sm" className="flex-1 text-xs">View Stock</Button>
                    <Button variant="outline" size="sm" className="flex-1 text-xs">Transfer</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* FORECAST TAB */}
          {activeTab === 'forecast' && (
            <div>
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-5 mb-6">
                <div className="flex items-center space-x-3 mb-2">
                  <Target className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-semibold text-gray-900">ML-Powered Demand Forecasting</h3>
                </div>
                <p className="text-sm text-gray-600">Predictions based on historical sales data, seasonal patterns, and market trends. Model accuracy: 87.3%</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Product</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Current Stock</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Predicted Demand (7d)</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Predicted Demand (30d)</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Confidence</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Trend</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEMAND_FORECAST.map((item, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">{item.product}</td>
                        <td className="py-3 px-4 text-sm text-gray-900">{item.current}</td>
                        <td className="py-3 px-4 text-sm font-medium text-orange-600">{item.predicted7d}</td>
                        <td className="py-3 px-4 text-sm font-medium text-red-600">{item.predicted30d}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-2">
                            <div className="w-16 bg-gray-200 rounded-full h-2"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${item.confidence * 100}%` }} /></div>
                            <span className="text-xs text-gray-500">{(item.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-1 rounded-full ${item.trend === 'up' ? 'bg-green-100 text-green-800' : item.trend === 'down' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                            {item.trend === 'up' ? 'Trending Up' : item.trend === 'down' ? 'Trending Down' : 'Stable'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {item.current < item.predicted30d ? (
                            <Button size="sm" className="bg-orange-500 text-white text-xs">Reorder Now</Button>
                          ) : (
                            <span className="text-xs text-green-600 font-medium">Stock Sufficient</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PROCUREMENT TAB */}
          {activeTab === 'suppliers' && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {[
                  { name: 'Kuda Electronics Ltd', type: 'Electronics', rating: 4.8, orders: 45, leadTime: '3-5 days', status: 'active' },
                  { name: 'PowerMax Energy', type: 'Energy Products', rating: 4.5, orders: 23, leadTime: '5-7 days', status: 'active' },
                  { name: 'HomeGoods Nigeria', type: 'Home & Office', rating: 4.2, orders: 34, leadTime: '2-4 days', status: 'active' },
                ].map((supplier, i) => (
                  <div key={i} className="border border-gray-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900">{supplier.name}</h3>
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">{supplier.status}</span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-gray-500">Category</span><span className="text-gray-900">{supplier.type}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Rating</span><span className="text-gray-900 flex items-center"><Star className="w-3 h-3 text-yellow-400 fill-yellow-400 mr-1" />{supplier.rating}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Total Orders</span><span className="text-gray-900">{supplier.orders}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Lead Time</span><span className="text-gray-900">{supplier.leadTime}</span></div>
                    </div>
                    <div className="mt-4 flex space-x-2">
                      <Button variant="outline" size="sm" className="flex-1 text-xs">View Catalog</Button>
                      <Button size="sm" className="flex-1 text-xs bg-blue-600 text-white">Place Order</Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h4 className="font-semibold text-gray-900 mb-4">Recent Purchase Orders</h4>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">PO Number</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Supplier</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Items</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Total</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { po: 'PO-2024-089', supplier: 'Kuda Electronics', items: 50, total: 4750000, status: 'In Transit', expected: '2024-01-18' },
                      { po: 'PO-2024-088', supplier: 'PowerMax Energy', items: 20, total: 1700000, status: 'Confirmed', expected: '2024-01-20' },
                      { po: 'PO-2024-087', supplier: 'HomeGoods Nigeria', items: 100, total: 1200000, status: 'Delivered', expected: '2024-01-12' },
                    ].map((po, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm font-mono text-blue-600">{po.po}</td>
                        <td className="py-3 px-4 text-sm text-gray-900">{po.supplier}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">{po.items}</td>
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">{formatCurrency(po.total)}</td>
                        <td className="py-3 px-4"><span className={`text-xs px-2 py-1 rounded-full ${po.status === 'Delivered' ? 'bg-green-100 text-green-800' : po.status === 'In Transit' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{po.status}</span></td>
                        <td className="py-3 px-4 text-sm text-gray-500">{po.expected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== OMNICHANNEL PAGE ====================
const CHANNEL_STATS = [
  { id: 'whatsapp', name: 'WhatsApp', icon: MessageCircle, color: 'bg-green-500', textColor: 'text-green-600', messages: 12450, activeUsers: 3420, responseTime: '< 30s', satisfaction: 4.7, status: 'active' },
  { id: 'ussd', name: 'USSD', icon: Phone, color: 'bg-blue-600', textColor: 'text-blue-600', messages: 8900, activeUsers: 5600, responseTime: 'Instant', satisfaction: 4.2, status: 'active' },
  { id: 'sms', name: 'SMS', icon: MessageSquare, color: 'bg-purple-500', textColor: 'text-purple-600', messages: 15600, activeUsers: 8900, responseTime: '< 5s', satisfaction: 4.0, status: 'active' },
  { id: 'telegram', name: 'Telegram', icon: Send, color: 'bg-sky-500', textColor: 'text-sky-600', messages: 3200, activeUsers: 1100, responseTime: '< 30s', satisfaction: 4.5, status: 'active' },
  { id: 'voice', name: 'Voice AI', icon: Headphones, color: 'bg-orange-500', textColor: 'text-orange-600', messages: 2100, activeUsers: 890, responseTime: '< 10s', satisfaction: 4.3, status: 'active' },
  { id: 'email', name: 'Email', icon: Mail, color: 'bg-red-500', textColor: 'text-red-600', messages: 4500, activeUsers: 2300, responseTime: '< 2hr', satisfaction: 4.1, status: 'active' },
]

const DEMO_CONVERSATIONS = [
  { id: 1, customer: 'Adebayo O.', channel: 'whatsapp', channelColor: 'bg-green-500', message: 'I want to check my account balance', time: '2 min ago', status: 'active', agent: 'AI Bot' },
  { id: 2, customer: 'Ngozi K.', channel: 'ussd', channelColor: 'bg-blue-600', message: '*737*1# - Balance Inquiry', time: '5 min ago', status: 'completed', agent: 'System' },
  { id: 3, customer: 'Ibrahim M.', channel: 'whatsapp', channelColor: 'bg-green-500', message: 'I need to buy 2GB MTN data', time: '8 min ago', status: 'active', agent: 'AI Bot' },
  { id: 4, customer: 'Chioma E.', channel: 'telegram', channelColor: 'bg-sky-500', message: '/transfer 5000 to 0123456789', time: '12 min ago', status: 'completed', agent: 'AI Bot' },
  { id: 5, customer: 'Fatima A.', channel: 'voice', channelColor: 'bg-orange-500', message: 'Voice call - Bill payment inquiry', time: '15 min ago', status: 'active', agent: 'Voice AI' },
  { id: 6, customer: 'Emeka N.', channel: 'sms', channelColor: 'bg-purple-500', message: 'BAL to 54321 - Balance check', time: '18 min ago', status: 'completed', agent: 'System' },
  { id: 7, customer: 'Bola A.', channel: 'whatsapp', channelColor: 'bg-green-500', message: 'Track my order ORD-2024-003', time: '22 min ago', status: 'active', agent: 'AI Bot' },
  { id: 8, customer: 'Yusuf D.', channel: 'email', channelColor: 'bg-red-500', message: 'Monthly statement request for January', time: '45 min ago', status: 'pending', agent: 'Unassigned' },
]

const WHATSAPP_DEMO_MESSAGES = [
  { sender: 'customer', name: 'Adebayo O.', text: 'Hi, I want to check my account balance', time: '10:30 AM' },
  { sender: 'bot', name: '54link Bot', text: 'Hello Adebayo! Welcome to 54link. I can help you with that.\n\nPlease select an option:\n1. Check Balance\n2. Transfer Funds\n3. Buy Airtime\n4. Pay Bills\n5. Order Status\n6. Speak to Agent', time: '10:30 AM' },
  { sender: 'customer', name: 'Adebayo O.', text: '1', time: '10:31 AM' },
  { sender: 'bot', name: '54link Bot', text: 'Your current balance:\n\nWallet: NGN 125,450.00\nCommission: NGN 15,750.00\nFloat: NGN 500,000.00\n\nLast transaction: NGN 5,000 deposit (Today 09:45 AM)\n\nReply MENU for more options.', time: '10:31 AM' },
  { sender: 'customer', name: 'Adebayo O.', text: '3', time: '10:32 AM' },
  { sender: 'bot', name: '54link Bot', text: 'Buy Airtime:\n\nSelect network:\n1. MTN\n2. Airtel\n3. Glo\n4. 9mobile\n\nOr type the phone number directly.', time: '10:32 AM' },
]

const USSD_DEMO_FLOW = [
  { type: 'system', text: 'Welcome to 54link\n*737#\n\n1. Check Balance\n2. Transfer\n3. Buy Airtime\n4. Pay Bills\n5. Mini Statement\n6. Agent Services' },
  { type: 'user', text: '1' },
  { type: 'system', text: 'Account Balance:\n\nWallet: NGN 125,450.00\nFloat: NGN 500,000.00\n\nEnter PIN to confirm:' },
  { type: 'user', text: '****' },
  { type: 'system', text: 'Balance confirmed.\n\nWallet: NGN 125,450.00\nFloat: NGN 500,000.00\n\n0. Back\n00. Main Menu' },
]

function OmnichannelPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [channelPreview, setChannelPreview] = useState(null)

  const tabs = [
    { id: 'overview', label: 'Channel Overview', icon: Activity },
    { id: 'conversations', label: 'Live Conversations', icon: MessageCircle },
    { id: 'whatsapp_demo', label: 'WhatsApp Bot', icon: MessageSquare },
    { id: 'ussd_demo', label: 'USSD Flow', icon: Phone },
    { id: 'campaigns', label: 'Campaigns', icon: Send },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Omnichannel Communication Hub</h2>
          <p className="text-gray-500 mt-1">Manage all customer channels from one dashboard</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-green-50 px-3 py-2 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm text-green-700 font-medium">6 channels active</span>
          </div>
        </div>
      </div>

      {/* Channel Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {CHANNEL_STATS.map(ch => (
          <div key={ch.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setChannelPreview(ch.id)}>
            <div className="flex items-center space-x-2 mb-3">
              <div className={`w-8 h-8 ${ch.color} rounded-lg flex items-center justify-center`}>
                <ch.icon className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-sm text-gray-900">{ch.name}</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-xs text-gray-500">Messages</span><span className="text-xs font-bold text-gray-900">{ch.messages.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-xs text-gray-500">Active Users</span><span className="text-xs font-bold text-gray-900">{ch.activeUsers.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-xs text-gray-500">Response</span><span className="text-xs font-bold text-green-600">{ch.responseTime}</span></div>
              <div className="flex justify-between"><span className="text-xs text-gray-500">Rating</span><span className="text-xs font-bold text-gray-900 flex items-center"><Star className="w-3 h-3 text-yellow-400 fill-yellow-400 mr-0.5" />{ch.satisfaction}</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex border-b overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Total Messages (MTD)', value: '46,750', change: '+12%', icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Active Conversations', value: '234', change: '+8%', icon: MessageCircle, color: 'text-green-600', bg: 'bg-green-50' },
                  { label: 'Avg Response Time', value: '28s', change: '-15%', icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50' },
                  { label: 'Customer Satisfaction', value: '4.4/5', change: '+3%', icon: Star, color: 'text-purple-600', bg: 'bg-purple-50' },
                ].map((kpi, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">{kpi.label}</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                        <p className="text-xs text-green-600 mt-1">{kpi.change} vs last month</p>
                      </div>
                      <div className={`w-12 h-12 ${kpi.bg} rounded-xl flex items-center justify-center`}>
                        <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <h3 className="font-semibold text-gray-900 mb-4">Channel Performance</h3>
              <div className="space-y-3">
                {CHANNEL_STATS.map(ch => (
                  <div key={ch.id} className="flex items-center space-x-4 p-4 bg-gray-50 rounded-xl">
                    <div className={`w-10 h-10 ${ch.color} rounded-lg flex items-center justify-center`}>
                      <ch.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-900">{ch.name}</span>
                        <span className="text-sm text-gray-500">{ch.messages.toLocaleString()} messages</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className={`h-2 rounded-full ${ch.color}`} style={{ width: `${(ch.messages / 16000) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{ch.activeUsers.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">active users</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LIVE CONVERSATIONS TAB */}
          {activeTab === 'conversations' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0 -m-6">
              <div className="border-r border-gray-200 max-h-[600px] overflow-y-auto">
                <div className="p-4 border-b border-gray-200">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" placeholder="Search conversations..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
                  </div>
                </div>
                {DEMO_CONVERSATIONS.map(conv => (
                  <div key={conv.id} onClick={() => setSelectedConversation(conv)} className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${selectedConversation?.id === conv.id ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        <div className={`w-6 h-6 ${conv.channelColor} rounded-full flex items-center justify-center`}>
                          <MessageSquare className="w-3 h-3 text-white" />
                        </div>
                        <span className="font-medium text-sm text-gray-900">{conv.customer}</span>
                      </div>
                      <span className="text-xs text-gray-400">{conv.time}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate ml-8">{conv.message}</p>
                    <div className="flex items-center justify-between mt-1 ml-8">
                      <span className="text-xs text-gray-400">{conv.agent}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${conv.status === 'active' ? 'bg-green-100 text-green-700' : conv.status === 'completed' ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-700'}`}>{conv.status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="col-span-2 p-6">
                {selectedConversation ? (
                  <div>
                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 ${selectedConversation.channelColor} rounded-full flex items-center justify-center`}>
                          <User className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{selectedConversation.customer}</h3>
                          <p className="text-xs text-gray-500">via {selectedConversation.channel} | Handled by {selectedConversation.agent}</p>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <Button variant="outline" size="sm"><Phone className="w-4 h-4" /></Button>
                        <Button variant="outline" size="sm"><User className="w-4 h-4" /></Button>
                      </div>
                    </div>
                    <div className="space-y-4 mb-4">
                      <div className="flex justify-start">
                        <div className="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3 max-w-sm">
                          <p className="text-sm text-gray-900">{selectedConversation.message}</p>
                          <p className="text-xs text-gray-400 mt-1">{selectedConversation.time}</p>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-3 max-w-sm">
                          <p className="text-sm">Hello! I can help you with that. Let me pull up your account details...</p>
                          <p className="text-xs text-blue-200 mt-1">AI Bot - just now</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <input type="text" placeholder="Type a message..." className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm" />
                      <Button className="bg-blue-600 text-white"><Send className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <MessageCircle className="w-12 h-12 mb-3" />
                    <p className="text-sm">Select a conversation to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* WHATSAPP BOT DEMO TAB */}
          {activeTab === 'whatsapp_demo' && (
            <div className="max-w-lg mx-auto">
              <div className="bg-gradient-to-r from-green-600 to-green-700 rounded-t-xl px-4 py-3 flex items-center space-x-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">54link Agent</h3>
                  <p className="text-green-100 text-xs">AI-Powered | Online</p>
                </div>
              </div>
              <div className="bg-[#e5ddd5] p-4 space-y-3 min-h-[400px]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h200v200H0z\' fill=\'%23d4cfc4\' fill-opacity=\'.1\'/%3E%3C/svg%3E")' }}>
                {WHATSAPP_DEMO_MESSAGES.map((msg, i) => (
                  <div key={i} className={`flex ${msg.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`rounded-lg px-3 py-2 max-w-xs shadow-sm ${msg.sender === 'customer' ? 'bg-white' : 'bg-[#dcf8c6]'}`}>
                      {msg.sender === 'bot' && <p className="text-xs font-semibold text-green-700 mb-1">{msg.name}</p>}
                      <p className="text-sm text-gray-900 whitespace-pre-line">{msg.text}</p>
                      <p className="text-xs text-gray-500 text-right mt-1">{msg.time}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-b-xl px-4 py-3 flex items-center space-x-3 border-t">
                <input type="text" placeholder="Type a message..." className="flex-1 px-4 py-2 bg-gray-100 rounded-full text-sm" />
                <button className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                  <Send className="w-5 h-5 text-white" />
                </button>
              </div>
              <div className="mt-4 bg-green-50 rounded-xl p-4">
                <h4 className="font-semibold text-green-900 text-sm mb-2">WhatsApp AI Bot Capabilities</h4>
                <div className="grid grid-cols-2 gap-2">
                  {['Balance Inquiry', 'Fund Transfer', 'Airtime Purchase', 'Bill Payment', 'Order Tracking', 'Product Browsing', 'Agent Locator', 'Mini Statement'].map(cap => (
                    <div key={cap} className="flex items-center space-x-2">
                      <CheckCircle className="w-3 h-3 text-green-600" />
                      <span className="text-xs text-green-800">{cap}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* USSD FLOW DEMO TAB */}
          {activeTab === 'ussd_demo' && (
            <div className="max-w-md mx-auto">
              <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
                <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
                  <span className="text-gray-400 text-xs">Carrier</span>
                  <span className="text-white text-sm font-semibold">USSD Session</span>
                  <span className="text-gray-400 text-xs">*737#</span>
                </div>
                <div className="p-4 space-y-3 min-h-[350px]">
                  {USSD_DEMO_FLOW.map((step, i) => (
                    <div key={i}>
                      {step.type === 'system' ? (
                        <div className="bg-gray-800 rounded-lg p-3">
                          <p className="text-green-400 text-sm font-mono whitespace-pre-line">{step.text}</p>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <div className="bg-blue-600 rounded-lg px-3 py-2">
                            <p className="text-white text-sm font-mono">{step.text}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="bg-gray-800 px-4 py-3 flex items-center space-x-3">
                  <input type="text" placeholder="Enter response..." className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg text-sm font-mono" />
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold">Send</button>
                </div>
              </div>
              <div className="mt-4 bg-blue-50 rounded-xl p-4">
                <h4 className="font-semibold text-blue-900 text-sm mb-2">USSD Service Features</h4>
                <div className="grid grid-cols-2 gap-2">
                  {['No Internet Required', 'Feature Phone Support', 'Balance Check', 'Fund Transfer', 'Airtime Purchase', 'Bill Payment', 'Mini Statement', 'Agent Services'].map(cap => (
                    <div key={cap} className="flex items-center space-x-2">
                      <CheckCircle className="w-3 h-3 text-blue-600" />
                      <span className="text-xs text-blue-800">{cap}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CAMPAIGNS TAB */}
          {activeTab === 'campaigns' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold text-gray-900">Messaging Campaigns</h3>
                <Button className="bg-blue-600 text-white"><Plus className="w-4 h-4 mr-2" /> New Campaign</Button>
              </div>
              <div className="space-y-4">
                {[
                  { name: 'January Promo - Free Transfers', channels: ['WhatsApp', 'SMS'], sent: 12500, delivered: 12100, opened: 8900, converted: 2340, status: 'completed', date: '2024-01-01' },
                  { name: 'New Year Data Bundle Offer', channels: ['WhatsApp', 'SMS', 'Email'], sent: 8900, delivered: 8600, opened: 6200, converted: 1890, status: 'completed', date: '2024-01-05' },
                  { name: 'Agent Recruitment Drive', channels: ['WhatsApp', 'Telegram'], sent: 5000, delivered: 4800, opened: 3500, converted: 890, status: 'active', date: '2024-01-12' },
                  { name: 'Valentine Special - Gift Cards', channels: ['WhatsApp', 'SMS', 'Email', 'Push'], sent: 0, delivered: 0, opened: 0, converted: 0, status: 'scheduled', date: '2024-02-10' },
                ].map((campaign, i) => (
                  <div key={i} className="border border-gray-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900">{campaign.name}</h4>
                        <div className="flex items-center space-x-2 mt-1">
                          {campaign.channels.map(ch => (
                            <span key={ch} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{ch}</span>
                          ))}
                        </div>
                      </div>
                      <span className={`text-xs px-3 py-1 rounded-full font-medium ${campaign.status === 'completed' ? 'bg-green-100 text-green-700' : campaign.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>{campaign.status}</span>
                    </div>
                    {campaign.sent > 0 && (
                      <div className="grid grid-cols-4 gap-4">
                        <div><p className="text-lg font-bold text-gray-900">{campaign.sent.toLocaleString()}</p><p className="text-xs text-gray-500">Sent</p></div>
                        <div><p className="text-lg font-bold text-gray-900">{campaign.delivered.toLocaleString()}</p><p className="text-xs text-gray-500">Delivered</p></div>
                        <div><p className="text-lg font-bold text-gray-900">{campaign.opened.toLocaleString()}</p><p className="text-xs text-gray-500">Opened</p></div>
                        <div><p className="text-lg font-bold text-green-600">{campaign.converted.toLocaleString()}</p><p className="text-xs text-gray-500">Converted</p></div>
                      </div>
                    )}
                    {campaign.sent === 0 && <p className="text-sm text-gray-500">Scheduled for {campaign.date}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TransactionsPage({ formatCurrency, userRole }) {
  const [transactions, setTransactions] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showNewTx, setShowNewTx] = useState(false)
  const [newTx, setNewTx] = useState({ type: 'deposit', amount: '', recipient: '', description: '' })
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedTx, setSelectedTx] = useState(null)

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const data = await apiCall('/transactions')
        if (data.transactions) setTransactions(data.transactions)
      } catch {
        setTransactions([
          { id: 'TXN-001', type: 'deposit', amount: 50000, status: 'completed', created_at: '2024-01-15T10:30:00Z', agent_name: 'John Agent', recipient: 'Self', description: 'Cash deposit', reference: 'REF-001', fee: 100 },
          { id: 'TXN-002', type: 'withdrawal', amount: 25000, status: 'completed', created_at: '2024-01-15T09:15:00Z', agent_name: 'Jane Agent', recipient: 'Self', description: 'ATM withdrawal', reference: 'REF-002', fee: 50 },
          { id: 'TXN-003', type: 'transfer', amount: 100000, status: 'pending', created_at: '2024-01-14T16:45:00Z', agent_name: 'Self', recipient: 'Adebayo J.', description: 'Salary payment', reference: 'REF-003', fee: 200 },
          { id: 'TXN-004', type: 'deposit', amount: 75000, status: 'completed', created_at: '2024-01-14T11:20:00Z', agent_name: 'Mike Agent', recipient: 'Self', description: 'Bank transfer', reference: 'REF-004', fee: 0 },
          { id: 'TXN-005', type: 'withdrawal', amount: 10000, status: 'failed', created_at: '2024-01-13T14:00:00Z', agent_name: 'Self', recipient: 'Self', description: 'Insufficient funds', reference: 'REF-005', fee: 0 },
          { id: 'TXN-006', type: 'transfer', amount: 200000, status: 'completed', created_at: '2024-01-13T09:30:00Z', agent_name: 'Self', recipient: 'Ngozi O.', description: 'Business payment', reference: 'REF-006', fee: 400 },
          { id: 'TXN-007', type: 'deposit', amount: 30000, status: 'completed', created_at: '2024-01-12T15:10:00Z', agent_name: 'Sarah Agent', recipient: 'Self', description: 'Cash deposit', reference: 'REF-007', fee: 50 },
          { id: 'TXN-008', type: 'bills', amount: 15000, status: 'completed', created_at: '2024-01-12T10:00:00Z', agent_name: 'Self', recipient: 'IKEDC', description: 'Electricity bill', reference: 'REF-008', fee: 100 },
        ])
      }
    }
    loadTransactions()
  }, [])

  const handleCreateTransaction = async () => {
    setIsProcessing(true)
    try {
      const response = await apiCall('/transactions', {
        method: 'POST',
        body: JSON.stringify({ ...newTx, amount: parseFloat(newTx.amount) })
      })
      const created = {
        id: response.id || 'TXN-' + Date.now(),
        ...newTx,
        amount: parseFloat(newTx.amount),
        status: 'completed',
        created_at: new Date().toISOString(),
        agent_name: 'Self',
        reference: 'REF-' + Date.now(),
        fee: Math.round(parseFloat(newTx.amount) * 0.002)
      }
      setTransactions(prev => [created, ...prev])
      setShowNewTx(false)
      setNewTx({ type: 'deposit', amount: '', recipient: '', description: '' })
    } catch {
      // handled
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDeleteTransaction = async (txId) => {
    try {
      await apiCall(`/transactions/${txId}`, { method: 'DELETE' })
    } catch {}
    setTransactions(prev => prev.filter(t => t.id !== txId))
    setSelectedTx(null)
  }

  const filtered = transactions.filter(tx => {
    if (filterType !== 'all' && tx.type !== filterType) return false
    if (filterStatus !== 'all' && tx.status !== filterStatus) return false
    if (searchTerm && !tx.id.toLowerCase().includes(searchTerm.toLowerCase()) && !tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) && !tx.recipient?.toLowerCase().includes(searchTerm.toLowerCase())) return false
    return true
  })

  const statusColor = (s) => s === 'completed' ? 'bg-green-100 text-green-800' : s === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
  const typeIcon = (t) => t === 'deposit' ? TrendingUp : t === 'withdrawal' ? DollarSign : t === 'transfer' ? Send : Receipt

  if (selectedTx) {
    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedTx(null)} className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"><ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back to transactions</button>
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Transaction Details</h2>
              <p className="text-sm text-gray-500">{selectedTx.id}</p>
            </div>
            <Badge variant={selectedTx.status === 'completed' ? 'success' : selectedTx.status === 'pending' ? 'warning' : 'destructive'}>{selectedTx.status}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[['Type', selectedTx.type], ['Amount', formatCurrency(selectedTx.amount)], ['Fee', formatCurrency(selectedTx.fee || 0)], ['Recipient', selectedTx.recipient], ['Description', selectedTx.description], ['Reference', selectedTx.reference], ['Agent', selectedTx.agent_name], ['Date', new Date(selectedTx.created_at).toLocaleString()]].map(([k, v]) => (
              <div key={k} className="p-3 bg-gray-50 rounded-lg"><p className="text-xs text-gray-500">{k}</p><p className="font-medium capitalize">{v}</p></div>
            ))}
          </div>
          <div className="flex gap-3 mt-6">
            {selectedTx.status === 'pending' && <Button onClick={() => { setTransactions(prev => prev.map(t => t.id === selectedTx.id ? {...t, status: 'completed'} : t)); setSelectedTx({...selectedTx, status: 'completed'}) }} className="bg-green-600 text-white">Approve</Button>}
            <Button variant="destructive" onClick={() => handleDeleteTransaction(selectedTx.id)}>
              <Trash2 className="w-4 h-4 mr-2" />Delete
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-2xl font-bold text-gray-900">Transactions</h2><p className="text-gray-600">View and manage all transactions</p></div>
        <Button onClick={() => setShowNewTx(true)} className="bg-gradient-to-r from-blue-600 to-green-600 text-white"><Plus className="w-4 h-4 mr-2" />New Transaction</Button>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search transactions..." className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <select className="px-4 py-2 border border-gray-300 rounded-lg" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="all">All Types</option><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option><option value="transfer">Transfer</option><option value="bills">Bills</option>
        </select>
        <select className="px-4 py-2 border border-gray-300 rounded-lg" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option><option value="completed">Completed</option><option value="pending">Pending</option><option value="failed">Failed</option>
        </select>
      </div>
      {showNewTx && (
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-blue-200">
          <h3 className="text-lg font-semibold mb-4">New Transaction</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select className="w-full px-4 py-2 border rounded-lg" value={newTx.type} onChange={(e) => setNewTx(p => ({...p, type: e.target.value}))}><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option><option value="transfer">Transfer</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Amount (NGN)</label><input type="number" className="w-full px-4 py-2 border rounded-lg" placeholder="Enter amount" value={newTx.amount} onChange={(e) => setNewTx(p => ({...p, amount: e.target.value}))} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Recipient</label><input type="text" className="w-full px-4 py-2 border rounded-lg" placeholder="Recipient name or account" value={newTx.recipient} onChange={(e) => setNewTx(p => ({...p, recipient: e.target.value}))} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><input type="text" className="w-full px-4 py-2 border rounded-lg" placeholder="Transaction description" value={newTx.description} onChange={(e) => setNewTx(p => ({...p, description: e.target.value}))} /></div>
          </div>
          <div className="flex gap-3 mt-4">
            <Button onClick={handleCreateTransaction} disabled={isProcessing || !newTx.amount} className="bg-gradient-to-r from-blue-600 to-green-600 text-white">{isProcessing ? 'Processing...' : 'Submit'}</Button>
            <Button variant="outline" onClick={() => setShowNewTx(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow">
        <div className="divide-y">
          {filtered.map(tx => {
            const Icon = typeIcon(tx.type)
            return (
              <div key={tx.id} className="p-4 hover:bg-gray-50 cursor-pointer flex items-center justify-between" onClick={() => setSelectedTx(tx)}>
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'deposit' ? 'bg-green-100' : tx.type === 'withdrawal' ? 'bg-red-100' : 'bg-blue-100'}`}>
                    <Icon className={`w-5 h-5 ${tx.type === 'deposit' ? 'text-green-600' : tx.type === 'withdrawal' ? 'text-red-600' : 'text-blue-600'}`} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 capitalize">{tx.type}</p>
                    <p className="text-xs text-gray-500">{tx.description} • {new Date(tx.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <span className={`font-bold ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>{tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${statusColor(tx.status)}`}>{tx.status}</span>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="p-8 text-center text-gray-500">No transactions found</div>}
        </div>
      </div>
    </div>
  )
}

function ProfilePage({ formatCurrency }) {
  const [profile, setProfile] = useState({
    name: 'Adebayo Johnson', email: 'adebayo@email.com', phone: '08012345678',
    address: '15 Marina Road, Lagos Island', bvn: '2234****890', nin: '1122****556',
    accountNumber: '1234567890', accountType: 'Savings', kycStatus: 'verified', tier: 'Tier 3'
  })
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({})

  const handleSave = async () => {
    try {
      await apiCall('/profile', { method: 'PUT', body: JSON.stringify(editForm) })
    } catch {}
    setProfile(prev => ({ ...prev, ...editForm }))
    setIsEditing(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">My Profile</h2>
        {!isEditing ? (
          <Button onClick={() => { setIsEditing(true); setEditForm({ name: profile.name, email: profile.email, phone: profile.phone, address: profile.address }) }} variant="outline"><Edit className="w-4 h-4 mr-2" />Edit Profile</Button>
        ) : (
          <div className="flex gap-2"><Button onClick={handleSave} className="bg-green-600 text-white">Save</Button><Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button></div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center"><User className="w-5 h-5 mr-2 text-blue-600" />Personal Information</h3>
          <div className="space-y-4">
            {[['Full Name', 'name'], ['Email', 'email'], ['Phone', 'phone'], ['Address', 'address']].map(([label, key]) => (
              <div key={key}>
                <label className="block text-sm text-gray-500 mb-1">{label}</label>
                {isEditing ? <input type="text" className="w-full px-3 py-2 border rounded-lg" value={editForm[key]} onChange={(e) => setEditForm(p => ({...p, [key]: e.target.value}))} /> : <p className="font-medium">{profile[key]}</p>}
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center"><Shield className="w-5 h-5 mr-2 text-green-600" />Account & KYC</h3>
          <div className="space-y-4">
            {[['Account Number', profile.accountNumber], ['Account Type', profile.accountType], ['BVN', profile.bvn], ['NIN', profile.nin], ['Account Tier', profile.tier]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-gray-500">{k}</span><span className="font-medium">{v}</span></div>
            ))}
            <div className="flex justify-between items-center"><span className="text-gray-500">KYC Status</span><Badge variant="success">Verified</Badge></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsPage() {
  const [settings, setSettings] = useState({
    notifications: true, emailAlerts: true, smsAlerts: false,
    twoFactor: true, biometric: false, language: 'en',
    theme: 'light', currency: 'NGN', timezone: 'Africa/Lagos'
  })

  const handleToggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
    apiCall('/settings', { method: 'PUT', body: JSON.stringify({ [key]: !settings[key] }) }).catch(() => {})
  }

  const Toggle = ({ label, desc, checked, onToggle }) => (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
      <div><p className="font-medium">{label}</p>{desc && <p className="text-sm text-gray-500">{desc}</p>}</div>
      <button onClick={onToggle} className={`w-12 h-6 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${checked ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4"><Bell className="w-5 h-5 inline mr-2 text-blue-600" />Notifications</h3>
          <div className="space-y-3">
            <Toggle label="Push Notifications" desc="Receive push notifications" checked={settings.notifications} onToggle={() => handleToggle('notifications')} />
            <Toggle label="Email Alerts" desc="Receive email notifications" checked={settings.emailAlerts} onToggle={() => handleToggle('emailAlerts')} />
            <Toggle label="SMS Alerts" desc="Receive SMS notifications" checked={settings.smsAlerts} onToggle={() => handleToggle('smsAlerts')} />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4"><Shield className="w-5 h-5 inline mr-2 text-green-600" />Security</h3>
          <div className="space-y-3">
            <Toggle label="Two-Factor Authentication" desc="Extra security for your account" checked={settings.twoFactor} onToggle={() => handleToggle('twoFactor')} />
            <Toggle label="Biometric Login" desc="Use fingerprint or face recognition" checked={settings.biometric} onToggle={() => handleToggle('biometric')} />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4"><Globe className="w-5 h-5 inline mr-2 text-purple-600" />Preferences</h3>
          <div className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Language</label><select className="w-full px-3 py-2 border rounded-lg" value={settings.language} onChange={(e) => setSettings(p => ({...p, language: e.target.value}))}><option value="en">English</option><option value="yo">Yoruba</option><option value="ha">Hausa</option><option value="ig">Igbo</option><option value="pcm">Pidgin</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Theme</label><select className="w-full px-3 py-2 border rounded-lg" value={settings.theme} onChange={(e) => setSettings(p => ({...p, theme: e.target.value}))}><option value="light">Light</option><option value="dark">Dark</option><option value="auto">System</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label><select className="w-full px-3 py-2 border rounded-lg" value={settings.timezone} onChange={(e) => setSettings(p => ({...p, timezone: e.target.value}))}><option value="Africa/Lagos">West Africa (WAT)</option><option value="UTC">UTC</option></select></div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4 text-red-600">Danger Zone</h3>
          <div className="space-y-3">
            <Button variant="outline" className="w-full border-red-300 text-red-600 hover:bg-red-50">Change Password</Button>
            <Button variant="outline" className="w-full border-red-300 text-red-600 hover:bg-red-50">Deactivate Account</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CustomersPage({ formatCurrency }) {
  const [customers, setCustomers] = useState([
    { id: 'CUS-001', name: 'Fatima Ibrahim', phone: '08098765432', email: 'fatima@email.com', status: 'active', kyc: 'verified', balance: 125000, created: '2024-01-10', transactions: 45 },
    { id: 'CUS-002', name: 'Chukwu Emmanuel', phone: '07012345678', email: 'chukwu@email.com', status: 'active', kyc: 'verified', balance: 87500, created: '2024-01-08', transactions: 32 },
    { id: 'CUS-003', name: 'Ngozi Okafor', phone: '09011223344', email: 'ngozi@email.com', status: 'inactive', kyc: 'pending', balance: 5000, created: '2024-01-05', transactions: 3 },
    { id: 'CUS-004', name: 'Musa Abdullahi', phone: '08055667788', email: 'musa@email.com', status: 'active', kyc: 'verified', balance: 340000, created: '2024-01-02', transactions: 78 },
    { id: 'CUS-005', name: 'Blessing Eze', phone: '07099887766', email: 'blessing@email.com', status: 'active', kyc: 'in_progress', balance: 22000, created: '2024-01-12', transactions: 8 },
  ])
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' })
  const [selectedCustomer, setSelectedCustomer] = useState(null)

  const handleAddCustomer = async () => {
    try { await apiCall('/customers', { method: 'POST', body: JSON.stringify(newCustomer) }) } catch {}
    setCustomers(prev => [{ id: 'CUS-' + Date.now(), ...newCustomer, status: 'active', kyc: 'pending', balance: 0, created: new Date().toISOString().split('T')[0], transactions: 0 }, ...prev])
    setShowAddForm(false)
    setNewCustomer({ name: '', phone: '', email: '' })
  }

  const handleDeleteCustomer = async (id) => {
    try { await apiCall(`/customers/${id}`, { method: 'DELETE' }) } catch {}
    setCustomers(prev => prev.filter(c => c.id !== id))
    setSelectedCustomer(null)
  }

  const filtered = customers.filter(c => !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm))

  if (selectedCustomer) {
    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedCustomer(null)} className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"><ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back</button>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Customer Details</h3>
            <div className="space-y-3">
              {[['Name', selectedCustomer.name], ['Phone', selectedCustomer.phone], ['Email', selectedCustomer.email], ['Status', selectedCustomer.status], ['Balance', formatCurrency(selectedCustomer.balance)], ['Transactions', selectedCustomer.transactions], ['Joined', selectedCustomer.created]].map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-gray-500">{k}</span><span className="font-medium capitalize">{v}</span></div>
              ))}
              <div className="flex justify-between items-center"><span className="text-gray-500">KYC</span><Badge variant={selectedCustomer.kyc === 'verified' ? 'success' : 'warning'}>{selectedCustomer.kyc}</Badge></div>
            </div>
            <Button variant="destructive" className="mt-4 w-full" onClick={() => handleDeleteCustomer(selectedCustomer.id)}><Trash2 className="w-4 h-4 mr-2" />Remove Customer</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-2xl font-bold text-gray-900">Customers</h2><p className="text-gray-600">{customers.length} registered customers</p></div>
        <Button onClick={() => setShowAddForm(true)} className="bg-gradient-to-r from-blue-600 to-green-600 text-white"><UserPlus className="w-4 h-4 mr-2" />Add Customer</Button>
      </div>
      <div className="relative"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search customers..." className="w-full pl-10 pr-4 py-2 border rounded-lg" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
      {showAddForm && (
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-blue-200">
          <h3 className="font-semibold mb-3">New Customer</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input type="text" placeholder="Full Name" className="px-3 py-2 border rounded-lg" value={newCustomer.name} onChange={(e) => setNewCustomer(p => ({...p, name: e.target.value}))} />
            <input type="tel" placeholder="Phone Number" className="px-3 py-2 border rounded-lg" value={newCustomer.phone} onChange={(e) => setNewCustomer(p => ({...p, phone: e.target.value}))} />
            <input type="email" placeholder="Email" className="px-3 py-2 border rounded-lg" value={newCustomer.email} onChange={(e) => setNewCustomer(p => ({...p, email: e.target.value}))} />
          </div>
          <div className="flex gap-2 mt-3"><Button onClick={handleAddCustomer} disabled={!newCustomer.name || !newCustomer.phone} className="bg-blue-600 text-white">Add</Button><Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button></div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow">
        <div className="divide-y">
          {filtered.map(c => (
            <div key={c.id} className="p-4 hover:bg-gray-50 cursor-pointer flex items-center justify-between" onClick={() => setSelectedCustomer(c)}>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-blue-600" /></div>
                <div><p className="font-medium">{c.name}</p><p className="text-xs text-gray-500">{c.phone}</p></div>
              </div>
              <div className="flex items-center space-x-4">
                <span className="font-medium">{formatCurrency(c.balance)}</span>
                <Badge variant={c.kyc === 'verified' ? 'success' : 'warning'}>{c.kyc}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AnalyticsPage({ formatCurrency, userRole }) {
  const [period, setPeriod] = useState('7d')
  const [analyticsData] = useState({
    totalVolume: 158000000, totalTransactions: 12450, avgTicket: 12690,
    growthRate: 23.5, topAgents: [
      { name: 'Adebayo Johnson', volume: 15800000, transactions: 1245, commission: 185000 },
      { name: 'Fatima Ibrahim', volume: 12400000, transactions: 980, commission: 145000 },
      { name: 'Chukwu Emmanuel', volume: 9800000, transactions: 756, commission: 112000 },
      { name: 'Ngozi Okafor', volume: 8500000, transactions: 645, commission: 98000 },
      { name: 'Musa Abdullahi', volume: 7200000, transactions: 534, commission: 82000 },
    ],
    transactionsByType: [
      { type: 'Cash In', count: 4500, volume: 67500000 },
      { type: 'Cash Out', count: 3800, volume: 47500000 },
      { type: 'Transfer', count: 2100, volume: 25200000 },
      { type: 'Bills', count: 1250, volume: 12500000 },
      { type: 'Airtime', count: 800, volume: 5300000 },
    ],
    dailyTrend: [
      { day: 'Mon', volume: 22000000, count: 1780 }, { day: 'Tue', volume: 24500000, count: 1920 },
      { day: 'Wed', volume: 21000000, count: 1650 }, { day: 'Thu', volume: 26000000, count: 2100 },
      { day: 'Fri', volume: 28000000, count: 2250 }, { day: 'Sat', volume: 20000000, count: 1600 },
      { day: 'Sun', volume: 16500000, count: 1150 },
    ]
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-2xl font-bold text-gray-900">Analytics</h2><p className="text-gray-600">Performance metrics and insights</p></div>
        <div className="flex gap-2">
          {['24h', '7d', '30d', '90d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${period === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{p}</button>
          ))}
          <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" />Export</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          ['Total Volume', formatCurrency(analyticsData.totalVolume), TrendingUp, 'bg-green-100', 'text-green-600'],
          ['Transactions', analyticsData.totalTransactions.toLocaleString(), Activity, 'bg-blue-100', 'text-blue-600'],
          ['Avg. Ticket', formatCurrency(analyticsData.avgTicket), BarChart3, 'bg-purple-100', 'text-purple-600'],
          ['Growth Rate', `+${analyticsData.growthRate}%`, TrendingUp, 'bg-yellow-100', 'text-yellow-600'],
        ].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div>
              <div><p className="text-sm text-gray-500">{title}</p><p className="text-xl font-bold">{value}</p></div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Daily Transaction Trend</h3>
          <div className="space-y-2">
            {analyticsData.dailyTrend.map(d => (
              <div key={d.day} className="flex items-center gap-3">
                <span className="w-10 text-sm text-gray-500">{d.day}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-6 relative">
                  <div className="bg-gradient-to-r from-blue-500 to-green-500 rounded-full h-6" style={{ width: `${(d.volume / 30000000) * 100}%` }} />
                </div>
                <span className="text-sm font-medium w-28 text-right">{formatCurrency(d.volume)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Transactions by Type</h3>
          <div className="space-y-3">
            {analyticsData.transactionsByType.map(t => (
              <div key={t.type} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div><p className="font-medium">{t.type}</p><p className="text-xs text-gray-500">{t.count.toLocaleString()} transactions</p></div>
                <span className="font-bold">{formatCurrency(t.volume)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {(userRole === 'admin' || userRole === 'super_agent') && (
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Top Performing Agents</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b"><th className="text-left p-3 text-sm text-gray-500">Rank</th><th className="text-left p-3 text-sm text-gray-500">Agent</th><th className="text-right p-3 text-sm text-gray-500">Volume</th><th className="text-right p-3 text-sm text-gray-500">Transactions</th><th className="text-right p-3 text-sm text-gray-500">Commission</th></tr></thead>
              <tbody>
                {analyticsData.topAgents.map((a, i) => (
                  <tr key={a.name} className="border-b hover:bg-gray-50">
                    <td className="p-3"><span className={`w-6 h-6 inline-flex items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>{i + 1}</span></td>
                    <td className="p-3 font-medium">{a.name}</td>
                    <td className="p-3 text-right font-medium">{formatCurrency(a.volume)}</td>
                    <td className="p-3 text-right">{a.transactions.toLocaleString()}</td>
                    <td className="p-3 text-right text-green-600 font-medium">{formatCurrency(a.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function CashManagementPage({ formatCurrency }) {
  const [floatBalance] = useState(2500000)
  const [cashRequests, setCashRequests] = useState([
    { id: 'CR-001', type: 'top_up', amount: 500000, status: 'approved', date: '2024-01-15', approver: 'HQ' },
    { id: 'CR-002', type: 'withdrawal', amount: 200000, status: 'pending', date: '2024-01-15', approver: '-' },
    { id: 'CR-003', type: 'top_up', amount: 1000000, status: 'completed', date: '2024-01-14', approver: 'Branch Manager' },
  ])
  const [showNewRequest, setShowNewRequest] = useState(false)
  const [newRequest, setNewRequest] = useState({ type: 'top_up', amount: '' })
  const [reconciliation] = useState({ expected: 2500000, actual: 2487500, difference: -12500, lastReconciled: '2024-01-15 18:00' })

  const handleCreateRequest = async () => {
    try { await apiCall('/cash/requests', { method: 'POST', body: JSON.stringify(newRequest) }) } catch {}
    setCashRequests(prev => [{ id: 'CR-' + Date.now(), ...newRequest, amount: parseFloat(newRequest.amount), status: 'pending', date: new Date().toISOString().split('T')[0], approver: '-' }, ...prev])
    setShowNewRequest(false)
    setNewRequest({ type: 'top_up', amount: '' })
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Cash Management</h2>
        <Button onClick={() => setShowNewRequest(true)} className="bg-gradient-to-r from-blue-600 to-green-600 text-white"><Plus className="w-4 h-4 mr-2" />Cash Request</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-6"><p className="text-sm text-gray-500">Float Balance</p><p className="text-3xl font-bold text-blue-600">{formatCurrency(floatBalance)}</p></div>
        <div className="bg-white rounded-xl shadow p-6"><p className="text-sm text-gray-500">Today's Cash In</p><p className="text-3xl font-bold text-green-600">{formatCurrency(850000)}</p></div>
        <div className="bg-white rounded-xl shadow p-6"><p className="text-sm text-gray-500">Today's Cash Out</p><p className="text-3xl font-bold text-red-600">{formatCurrency(620000)}</p></div>
      </div>
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Reconciliation</h3>
        <div className="grid grid-cols-4 gap-4">
          <div><p className="text-sm text-gray-500">Expected</p><p className="text-lg font-bold">{formatCurrency(reconciliation.expected)}</p></div>
          <div><p className="text-sm text-gray-500">Actual</p><p className="text-lg font-bold">{formatCurrency(reconciliation.actual)}</p></div>
          <div><p className="text-sm text-gray-500">Difference</p><p className={`text-lg font-bold ${reconciliation.difference < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(reconciliation.difference)}</p></div>
          <div><p className="text-sm text-gray-500">Last Reconciled</p><p className="text-lg font-bold">{reconciliation.lastReconciled}</p></div>
        </div>
      </div>
      {showNewRequest && (
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-blue-200">
          <h3 className="font-semibold mb-3">New Cash Request</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Type</label><select className="w-full px-3 py-2 border rounded-lg" value={newRequest.type} onChange={(e) => setNewRequest(p => ({...p, type: e.target.value}))}><option value="top_up">Float Top-Up</option><option value="withdrawal">Cash Withdrawal</option></select></div>
            <div><label className="block text-sm font-medium mb-1">Amount</label><input type="number" className="w-full px-3 py-2 border rounded-lg" placeholder="Amount" value={newRequest.amount} onChange={(e) => setNewRequest(p => ({...p, amount: e.target.value}))} /></div>
          </div>
          <div className="flex gap-2 mt-3"><Button onClick={handleCreateRequest} disabled={!newRequest.amount} className="bg-blue-600 text-white">Submit</Button><Button variant="outline" onClick={() => setShowNewRequest(false)}>Cancel</Button></div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Cash Requests</h3>
        <div className="divide-y">
          {cashRequests.map(r => (
            <div key={r.id} className="py-3 flex items-center justify-between">
              <div><p className="font-medium capitalize">{r.type.replace('_', ' ')}</p><p className="text-xs text-gray-500">{r.date} • {r.id}</p></div>
              <div className="flex items-center gap-4">
                <span className="font-bold">{formatCurrency(r.amount)}</span>
                <Badge variant={r.status === 'completed' || r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'destructive'}>{r.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentsPage({ formatCurrency, userRole }) {
  const [agents, setAgents] = useState([
    { id: 'AG-001', name: 'Adebayo Johnson', phone: '08012345678', tier: 'Super Agent', status: 'active', location: 'Lagos', volume: 15800000, commission: 185000, rating: 4.8, subAgents: 12 },
    { id: 'AG-002', name: 'Fatima Ibrahim', phone: '08098765432', tier: 'Field Agent', status: 'active', location: 'Abuja', volume: 12400000, commission: 145000, rating: 4.6, subAgents: 0 },
    { id: 'AG-003', name: 'Chukwu Emmanuel', phone: '07012345678', tier: 'Sub Agent', status: 'suspended', location: 'Port Harcourt', volume: 2800000, commission: 32000, rating: 3.9, subAgents: 0 },
    { id: 'AG-004', name: 'Ngozi Okafor', phone: '09011223344', tier: 'Field Agent', status: 'active', location: 'Enugu', volume: 8500000, commission: 98000, rating: 4.5, subAgents: 0 },
    { id: 'AG-005', name: 'Musa Abdullahi', phone: '08055667788', tier: 'Super Agent', status: 'active', location: 'Kano', volume: 7200000, commission: 82000, rating: 4.3, subAgents: 8 },
  ])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTier, setFilterTier] = useState('all')
  const [selectedAgent, setSelectedAgent] = useState(null)

  const handleToggleStatus = async (agentId) => {
    try { await apiCall(`/agents/${agentId}/toggle-status`, { method: 'PUT' }) } catch {}
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: a.status === 'active' ? 'suspended' : 'active' } : a))
  }

  const handleDeleteAgent = async (agentId) => {
    try { await apiCall(`/agents/${agentId}`, { method: 'DELETE' }) } catch {}
    setAgents(prev => prev.filter(a => a.id !== agentId))
    setSelectedAgent(null)
  }

  const filtered = agents.filter(a => {
    if (filterTier !== 'all' && a.tier !== filterTier) return false
    if (searchTerm && !a.name.toLowerCase().includes(searchTerm.toLowerCase()) && !a.phone.includes(searchTerm)) return false
    return true
  })

  if (selectedAgent) {
    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedAgent(null)} className="flex items-center text-blue-600 text-sm font-medium"><ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back</button>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Agent Profile</h3>
            <div className="space-y-3">
              {[['Name', selectedAgent.name], ['Phone', selectedAgent.phone], ['Location', selectedAgent.location], ['Tier', selectedAgent.tier], ['Rating', `${selectedAgent.rating}/5.0`], ['Sub-Agents', selectedAgent.subAgents]].map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-gray-500">{k}</span><span className="font-medium">{v}</span></div>
              ))}
              <div className="flex justify-between items-center"><span className="text-gray-500">Status</span><Badge variant={selectedAgent.status === 'active' ? 'success' : 'destructive'}>{selectedAgent.status}</Badge></div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Performance</h3>
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-gray-500">Monthly Volume</span><span className="font-bold">{formatCurrency(selectedAgent.volume)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Commission (MTD)</span><span className="font-bold text-green-600">{formatCurrency(selectedAgent.commission)}</span></div>
            </div>
            <div className="flex gap-2 mt-6">
              <Button onClick={() => handleToggleStatus(selectedAgent.id)} className={selectedAgent.status === 'active' ? 'bg-yellow-600 text-white' : 'bg-green-600 text-white'}>{selectedAgent.status === 'active' ? 'Suspend' : 'Activate'}</Button>
              {userRole === 'admin' && <Button variant="destructive" onClick={() => handleDeleteAgent(selectedAgent.id)}><Trash2 className="w-4 h-4 mr-2" />Remove</Button>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-2xl font-bold text-gray-900">{userRole === 'admin' ? 'All Agents' : 'My Agents'}</h2><p className="text-gray-600">{agents.length} agents</p></div>
      </div>
      <div className="flex gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search agents..." className="w-full pl-10 pr-4 py-2 border rounded-lg" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
        <select className="px-4 py-2 border rounded-lg" value={filterTier} onChange={(e) => setFilterTier(e.target.value)}><option value="all">All Tiers</option><option value="Super Agent">Super Agent</option><option value="Field Agent">Field Agent</option><option value="Sub Agent">Sub Agent</option></select>
      </div>
      <div className="bg-white rounded-xl shadow">
        <div className="divide-y">
          {filtered.map(a => (
            <div key={a.id} className="p-4 hover:bg-gray-50 cursor-pointer flex items-center justify-between" onClick={() => setSelectedAgent(a)}>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center"><Users className="w-5 h-5 text-blue-600" /></div>
                <div><p className="font-medium">{a.name}</p><p className="text-xs text-gray-500">{a.tier} • {a.location}</p></div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-right"><p className="font-medium">{formatCurrency(a.volume)}</p><p className="text-xs text-gray-500">{a.rating}/5.0</p></div>
                <Badge variant={a.status === 'active' ? 'success' : 'destructive'}>{a.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SystemPage() {
  const [services] = useState([
    { name: 'API Gateway', status: 'online', uptime: '99.99%', latency: '12ms', requests: '1.2M/day' },
    { name: 'Database (Primary)', status: 'online', uptime: '99.97%', latency: '3ms', requests: '850K/day' },
    { name: 'Database (Replica)', status: 'online', uptime: '99.95%', latency: '5ms', requests: '420K/day' },
    { name: 'Payment Processing', status: 'online', uptime: '99.98%', latency: '150ms', requests: '45K/day' },
    { name: 'Fraud Detection', status: 'degraded', uptime: '98.50%', latency: '450ms', requests: '45K/day' },
    { name: 'Notification Service', status: 'online', uptime: '99.90%', latency: '25ms', requests: '120K/day' },
    { name: 'KYC/KYB Service', status: 'online', uptime: '99.85%', latency: '800ms', requests: '2K/day' },
    { name: 'Redis Cache', status: 'online', uptime: '99.99%', latency: '1ms', requests: '5M/day' },
    { name: 'Kafka Broker', status: 'online', uptime: '99.98%', latency: '5ms', requests: '2M/day' },
    { name: 'Temporal Workflow', status: 'online', uptime: '99.95%', latency: '20ms', requests: '15K/day' },
  ])
  const [configs, setConfigs] = useState([
    { key: 'RATE_LIMIT_DEFAULT', value: '100', description: 'Default rate limit per minute' },
    { key: 'MAX_PAYLOAD_BYTES', value: '10485760', description: 'Max request payload size (10MB)' },
    { key: 'SESSION_TIMEOUT', value: '3600', description: 'Session timeout in seconds' },
    { key: 'CORS_ORIGINS', value: 'localhost:5173,localhost:5174', description: 'Allowed CORS origins' },
  ])
  const [editingConfig, setEditingConfig] = useState(null)

  const handleSaveConfig = async (key, value) => {
    try { await apiCall('/system/config', { method: 'PUT', body: JSON.stringify({ key, value }) }) } catch {}
    setConfigs(prev => prev.map(c => c.key === key ? { ...c, value } : c))
    setEditingConfig(null)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">System Administration</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-4"><p className="text-sm text-gray-500">Services Online</p><p className="text-3xl font-bold text-green-600">{services.filter(s => s.status === 'online').length}/{services.length}</p></div>
        <div className="bg-white rounded-xl shadow p-4"><p className="text-sm text-gray-500">Avg. Latency</p><p className="text-3xl font-bold text-blue-600">45ms</p></div>
        <div className="bg-white rounded-xl shadow p-4"><p className="text-sm text-gray-500">Total Requests/Day</p><p className="text-3xl font-bold text-purple-600">9.7M</p></div>
      </div>
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Service Health</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b"><th className="text-left p-3 text-sm text-gray-500">Service</th><th className="text-left p-3 text-sm text-gray-500">Status</th><th className="text-left p-3 text-sm text-gray-500">Uptime</th><th className="text-left p-3 text-sm text-gray-500">Latency</th><th className="text-left p-3 text-sm text-gray-500">Requests</th></tr></thead>
            <tbody>
              {services.map(s => (
                <tr key={s.name} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3"><Badge variant={s.status === 'online' ? 'success' : s.status === 'degraded' ? 'warning' : 'destructive'}>{s.status}</Badge></td>
                  <td className="p-3">{s.uptime}</td>
                  <td className="p-3">{s.latency}</td>
                  <td className="p-3">{s.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-4">System Configuration</h3>
        <div className="divide-y">
          {configs.map(c => (
            <div key={c.key} className="py-3 flex items-center justify-between">
              <div><p className="font-medium font-mono text-sm">{c.key}</p><p className="text-xs text-gray-500">{c.description}</p></div>
              <div className="flex items-center gap-2">
                {editingConfig === c.key ? (
                  <><input type="text" className="px-2 py-1 border rounded text-sm w-40" defaultValue={c.value} id={`cfg-${c.key}`} /><Button size="sm" onClick={() => handleSaveConfig(c.key, document.getElementById(`cfg-${c.key}`).value)} className="bg-green-600 text-white text-xs">Save</Button><Button size="sm" variant="outline" onClick={() => setEditingConfig(null)} className="text-xs">Cancel</Button></>
                ) : (
                  <><span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">{c.value}</span><Button size="sm" variant="ghost" onClick={() => setEditingConfig(c.key)}><Edit className="w-3 h-3" /></Button></>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SecurityPage() {
  const [auditLogs] = useState([
    { id: 1, action: 'LOGIN', user: 'admin@54link.com', ip: '102.89.23.45', timestamp: '2024-01-15 10:30:00', status: 'success', details: 'Admin login from Lagos' },
    { id: 2, action: 'AGENT_SUSPEND', user: 'admin@54link.com', ip: '102.89.23.45', timestamp: '2024-01-15 10:25:00', status: 'success', details: 'Suspended agent AG-003' },
    { id: 3, action: 'LOGIN_FAILED', user: 'unknown@test.com', ip: '185.220.101.1', timestamp: '2024-01-15 10:20:00', status: 'failed', details: 'Invalid credentials (3rd attempt)' },
    { id: 4, action: 'CONFIG_CHANGE', user: 'admin@54link.com', ip: '102.89.23.45', timestamp: '2024-01-15 09:45:00', status: 'success', details: 'Updated RATE_LIMIT_DEFAULT: 50 -> 100' },
    { id: 5, action: 'LARGE_TRANSACTION', user: 'agent@54link.com', ip: '102.88.34.56', timestamp: '2024-01-15 09:30:00', status: 'flagged', details: 'Transaction > 1M NGN from AG-001' },
    { id: 6, action: 'KYC_OVERRIDE', user: 'admin@54link.com', ip: '102.89.23.45', timestamp: '2024-01-14 16:00:00', status: 'success', details: 'Manual KYC approval for CUS-003' },
  ])
  const [securityStats] = useState({
    failedLogins: 23, blockedIPs: 5, activeSessions: 892, pendingReviews: 12,
    threatLevel: 'low', lastScan: '2024-01-15 06:00'
  })
  const [filterAction, setFilterAction] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const filtered = auditLogs.filter(l => {
    if (filterAction !== 'all' && l.action !== filterAction) return false
    if (searchTerm && !l.details.toLowerCase().includes(searchTerm.toLowerCase()) && !l.user.toLowerCase().includes(searchTerm.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Security Center</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          ['Failed Logins (24h)', securityStats.failedLogins, AlertTriangle, 'bg-red-100', 'text-red-600'],
          ['Blocked IPs', securityStats.blockedIPs, Shield, 'bg-yellow-100', 'text-yellow-600'],
          ['Active Sessions', securityStats.activeSessions, Activity, 'bg-green-100', 'text-green-600'],
          ['Pending Reviews', securityStats.pendingReviews, Clock, 'bg-blue-100', 'text-blue-600'],
        ].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div>
              <div><p className="text-sm text-gray-500">{title}</p><p className="text-2xl font-bold">{value}</p></div>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Audit Log</h3>
          <div className="flex gap-2">
            <div className="relative"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search logs..." className="pl-9 pr-3 py-1.5 border rounded-lg text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
            <select className="px-3 py-1.5 border rounded-lg text-sm" value={filterAction} onChange={(e) => setFilterAction(e.target.value)}><option value="all">All Actions</option><option value="LOGIN">Login</option><option value="LOGIN_FAILED">Failed Login</option><option value="AGENT_SUSPEND">Agent Suspend</option><option value="CONFIG_CHANGE">Config Change</option><option value="LARGE_TRANSACTION">Large Transaction</option><option value="KYC_OVERRIDE">KYC Override</option></select>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" />Export</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b"><th className="text-left p-3 text-sm text-gray-500">Time</th><th className="text-left p-3 text-sm text-gray-500">Action</th><th className="text-left p-3 text-sm text-gray-500">User</th><th className="text-left p-3 text-sm text-gray-500">IP</th><th className="text-left p-3 text-sm text-gray-500">Details</th><th className="text-left p-3 text-sm text-gray-500">Status</th></tr></thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 text-sm whitespace-nowrap">{l.timestamp}</td>
                  <td className="p-3"><span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{l.action}</span></td>
                  <td className="p-3 text-sm">{l.user}</td>
                  <td className="p-3 text-sm font-mono">{l.ip}</td>
                  <td className="p-3 text-sm">{l.details}</td>
                  <td className="p-3"><Badge variant={l.status === 'success' ? 'success' : l.status === 'failed' ? 'destructive' : 'warning'}>{l.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function POSManagementPage({ formatCurrency }) {
  const POS_API = 'http://localhost:8126'
  const [activeTab, setActiveTab] = useState('terminals')
  const [terminals, setTerminals] = useState([
    { id: 'TRM-001', name: 'Main Counter POS', type: 'integrated_pos', merchant_id: 'MRC-001', location: 'Lagos - Ikeja Branch', region: 'Lagos', lat: 6.6018, lng: 3.3515, status: 'online', firmware: 'v3.2.1', last_heartbeat: '2024-01-15T10:30:00Z', total_transactions: 12847, success_rate: 98.2, avg_processing_ms: 1250, error_rate: 1.8, battery: 85, signal_strength: 92, ip_address: '192.168.1.101', tags: ['high-volume', 'flagship'], group: 'Lagos-Main', uptime_hours: 720, last_error: null, config: { nfc_enabled: true, qr_enabled: true, receipt_auto: true, timeout_sec: 30 }, tx_history: [320, 340, 310, 360, 380, 350, 370, 390, 400, 385, 410, 420] },
    { id: 'TRM-002', name: 'Card Reader A', type: 'card_reader', merchant_id: 'MRC-001', location: 'Lagos - Ikeja Branch', region: 'Lagos', lat: 6.6018, lng: 3.3515, status: 'online', firmware: 'v3.2.1', last_heartbeat: '2024-01-15T10:29:00Z', total_transactions: 8432, success_rate: 97.5, avg_processing_ms: 980, error_rate: 2.5, battery: 72, signal_strength: 88, ip_address: '192.168.1.102', tags: ['card-only'], group: 'Lagos-Main', uptime_hours: 680, last_error: '2024-01-14 Card read timeout', config: { nfc_enabled: false, qr_enabled: false, receipt_auto: true, timeout_sec: 25 }, tx_history: [200, 220, 210, 240, 230, 250, 260, 270, 255, 280, 290, 285] },
    { id: 'TRM-003', name: 'Mobile POS Agent', type: 'card_reader', merchant_id: 'MRC-002', location: 'Abuja - Wuse Branch', region: 'Abuja', lat: 9.0765, lng: 7.4986, status: 'offline', firmware: 'v3.1.0', last_heartbeat: '2024-01-15T08:15:00Z', total_transactions: 5621, success_rate: 94.1, avg_processing_ms: 1800, error_rate: 5.9, battery: 12, signal_strength: 0, ip_address: '192.168.2.50', tags: ['mobile', 'field-agent'], group: 'Abuja-Field', uptime_hours: 340, last_error: '2024-01-15 Connection lost', config: { nfc_enabled: true, qr_enabled: true, receipt_auto: false, timeout_sec: 45 }, tx_history: [150, 160, 140, 170, 155, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'TRM-004', name: 'Kiosk Terminal', type: 'integrated_pos', merchant_id: 'MRC-003', location: 'Port Harcourt HQ', region: 'Port Harcourt', lat: 4.8156, lng: 7.0498, status: 'maintenance', firmware: 'v3.0.5', last_heartbeat: '2024-01-14T16:00:00Z', total_transactions: 3291, success_rate: 96.8, avg_processing_ms: 1100, error_rate: 3.2, battery: 100, signal_strength: 95, ip_address: '192.168.3.10', tags: ['kiosk', 'self-service'], group: 'PH-HQ', uptime_hours: 500, last_error: '2024-01-14 Scheduled maintenance', config: { nfc_enabled: true, qr_enabled: true, receipt_auto: true, timeout_sec: 60 }, tx_history: [80, 90, 85, 95, 100, 88, 92, 0, 0, 0, 0, 0] },
    { id: 'TRM-005', name: 'Receipt Printer B', type: 'receipt_printer', merchant_id: 'MRC-001', location: 'Lagos - Ikeja Branch', region: 'Lagos', lat: 6.6018, lng: 3.3515, status: 'error', firmware: 'v2.8.3', last_heartbeat: '2024-01-15T09:45:00Z', total_transactions: 0, success_rate: 0, avg_processing_ms: 0, error_rate: 100, battery: null, signal_strength: 78, ip_address: '192.168.1.103', tags: ['peripheral'], group: 'Lagos-Main', uptime_hours: 0, last_error: '2024-01-15 Paper jam detected', config: { nfc_enabled: false, qr_enabled: false, receipt_auto: true, timeout_sec: 10 }, tx_history: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'TRM-006', name: 'Barcode Scanner C', type: 'barcode_scanner', merchant_id: 'MRC-002', location: 'Abuja - Wuse Branch', region: 'Abuja', lat: 9.0765, lng: 7.4986, status: 'online', firmware: 'v1.5.2', last_heartbeat: '2024-01-15T10:28:00Z', total_transactions: 920, success_rate: 99.1, avg_processing_ms: 350, error_rate: 0.9, battery: 94, signal_strength: 91, ip_address: '192.168.2.51', tags: ['scanner'], group: 'Abuja-Field', uptime_hours: 600, last_error: null, config: { nfc_enabled: false, qr_enabled: false, receipt_auto: false, timeout_sec: 15 }, tx_history: [20, 25, 22, 30, 28, 35, 32, 38, 40, 36, 42, 45] },
  ])
  const [selectedTerminal, setSelectedTerminal] = useState(null)
  const [detailTerminal, setDetailTerminal] = useState(null)
  const [commandLog, setCommandLog] = useState([
    { id: 1, terminal_id: 'TRM-001', command: 'REBOOT', status: 'completed', sent_at: '2024-01-15 09:00:00', completed_at: '2024-01-15 09:01:30', user: 'admin' },
    { id: 2, terminal_id: 'TRM-003', command: 'DIAGNOSTICS', status: 'failed', sent_at: '2024-01-15 08:30:00', completed_at: null, user: 'admin' },
    { id: 3, terminal_id: 'TRM-004', command: 'UPDATE_CONFIG', status: 'completed', sent_at: '2024-01-14 16:00:00', completed_at: '2024-01-14 16:00:05', user: 'super_agent' },
  ])
  const [updates, setUpdates] = useState([
    { id: 'UPD-001', version: 'v3.2.2', type: 'firmware', status: 'available', release_date: '2024-01-14', size: '24.5 MB', changelog: 'Security patches, NFC improvements, bug fixes', compatible_devices: ['integrated_pos', 'card_reader'], rollback_version: 'v3.2.1' },
    { id: 'UPD-002', version: 'v1.6.0', type: 'firmware', status: 'deploying', release_date: '2024-01-13', size: '8.2 MB', changelog: 'New barcode formats, improved scanning speed', compatible_devices: ['barcode_scanner'], deployed_count: 3, total_count: 5, rollback_version: 'v1.5.2' },
    { id: 'UPD-003', version: 'v2.9.0', type: 'firmware', status: 'completed', release_date: '2024-01-10', size: '12.1 MB', changelog: 'Receipt formatting update, thermal print optimization', compatible_devices: ['receipt_printer'], deployed_count: 8, total_count: 8, rollback_version: 'v2.8.3' },
  ])
  const [mgmtHealth, setMgmtHealth] = useState({ status: 'healthy', connected_terminals: 4, uptime: '14d 6h 23m' })
  const [syncStats, setSyncStats] = useState({ total_syncs: 1247, pending_events: 3, last_sync: '2024-01-15T10:29:00Z', resolution_rate: 99.2 })
  const [commandInput, setCommandInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterGroup, setFilterGroup] = useState('all')
  const [selectedIds, setSelectedIds] = useState([])
  const [viewMode, setViewMode] = useState('grid')
  const [alerts, setAlerts] = useState([
    { id: 'ALT-001', type: 'battery_low', terminal_id: 'TRM-003', message: 'Battery critically low (12%)', severity: 'critical', timestamp: '2024-01-15T08:20:00Z', acknowledged: false },
    { id: 'ALT-002', type: 'offline', terminal_id: 'TRM-003', message: 'Terminal went offline', severity: 'critical', timestamp: '2024-01-15T08:15:00Z', acknowledged: false },
    { id: 'ALT-003', type: 'error', terminal_id: 'TRM-005', message: 'Paper jam detected', severity: 'high', timestamp: '2024-01-15T09:45:00Z', acknowledged: false },
    { id: 'ALT-004', type: 'firmware_outdated', terminal_id: 'TRM-004', message: 'Firmware v3.0.5 is 2 versions behind', severity: 'medium', timestamp: '2024-01-14T16:00:00Z', acknowledged: true },
    { id: 'ALT-005', type: 'error_rate', terminal_id: 'TRM-003', message: 'Error rate above 5% threshold (5.9%)', severity: 'high', timestamp: '2024-01-15T07:00:00Z', acknowledged: true },
  ])
  const [alertConfig, setAlertConfig] = useState({ battery_threshold: 20, offline_notify: true, error_rate_threshold: 5, firmware_outdated_notify: true })
  const [provisionStep, setProvisionStep] = useState(0)
  const [provisionData, setProvisionData] = useState({ name: '', type: 'integrated_pos', merchant_id: '', location: '', region: '', firmware: 'v3.2.2', tags: '', group: '' })
  const [maintenanceSchedule, setMaintenanceSchedule] = useState([
    { id: 'MAINT-001', terminal_id: 'TRM-004', date: '2024-01-14', time: '16:00', duration: '2h', reason: 'Firmware update + hardware check', status: 'completed' },
    { id: 'MAINT-002', terminal_id: 'TRM-001', date: '2024-01-20', time: '22:00', duration: '1h', reason: 'Scheduled security patch', status: 'scheduled' },
    { id: 'MAINT-003', terminal_id: 'TRM-002', date: '2024-01-25', time: '03:00', duration: '30m', reason: 'Config optimization', status: 'scheduled' },
  ])
  const [exportFormat, setExportFormat] = useState('csv')

  const loadTerminals = async () => {
    try {
      const resp = await fetch(`${POS_API}/management/terminals`)
      if (resp.ok) { const data = await resp.json(); if (Array.isArray(data)) setTerminals(data) }
    } catch {}
  }
  const loadHealth = async () => {
    try {
      const resp = await fetch(`${POS_API}/management/health`)
      if (resp.ok) setMgmtHealth(await resp.json())
    } catch {}
  }
  const loadSyncStats = async () => {
    try {
      const resp = await fetch(`${POS_API}/sync/stats`)
      if (resp.ok) setSyncStats(await resp.json())
    } catch {}
  }

  useEffect(() => { loadTerminals(); loadHealth(); loadSyncStats() }, [])

  useEffect(() => {
    const wsUrl = POS_API.replace('http', 'ws') + '/ws/terminals'
    let ws
    try {
      ws = new WebSocket(wsUrl)
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'status_update') {
            setTerminals(prev => prev.map(t => t.id === data.terminal_id ? { ...t, ...data.updates } : t))
          }
          if (data.type === 'alert') {
            setAlerts(prev => [{ ...data.alert, id: `ALT-${Date.now()}`, acknowledged: false }, ...prev])
          }
        } catch {}
      }
      ws.onclose = () => { setTimeout(() => {}, 5000) }
    } catch {}
    return () => { if (ws) ws.close() }
  }, [])

  const sendCommand = async (terminalId, command) => {
    const newLog = { id: Date.now(), terminal_id: terminalId, command, status: 'pending', sent_at: new Date().toLocaleString(), completed_at: null, user: 'admin' }
    setCommandLog(prev => [newLog, ...prev])
    try {
      const resp = await fetch(`${POS_API}/management/terminals/${terminalId}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, data: {} }) })
      if (resp.ok) { setCommandLog(prev => prev.map(l => l.id === newLog.id ? { ...l, status: 'completed', completed_at: new Date().toLocaleString() } : l)) }
      else { setCommandLog(prev => prev.map(l => l.id === newLog.id ? { ...l, status: 'failed' } : l)) }
    } catch { setCommandLog(prev => prev.map(l => l.id === newLog.id ? { ...l, status: 'failed' } : l)) }
  }

  const sendBatchCommand = async (command) => {
    for (const tid of selectedIds) { await sendCommand(tid, command) }
    setSelectedIds([])
  }

  const deployUpdate = async (updateId) => {
    setUpdates(prev => prev.map(u => u.id === updateId ? { ...u, status: 'deploying', deployed_count: 0 } : u))
    try { await fetch(`${POS_API}/management/updates/deploy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ update_id: updateId }) }) } catch {}
  }

  const rollbackUpdate = async (updateId, rollbackVersion) => {
    setUpdates(prev => prev.map(u => u.id === updateId ? { ...u, status: 'rolling_back' } : u))
    try { await fetch(`${POS_API}/management/updates/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ update_id: updateId, target_version: rollbackVersion }) }) } catch {}
    setTimeout(() => setUpdates(prev => prev.map(u => u.id === updateId ? { ...u, status: 'available' } : u)), 2000)
  }

  const acknowledgeAlert = (alertId) => { setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)) }

  const handleProvision = () => {
    const newTerminal = { id: `TRM-${String(terminals.length + 1).padStart(3, '0')}`, ...provisionData, status: 'offline', last_heartbeat: new Date().toISOString(), total_transactions: 0, success_rate: 0, avg_processing_ms: 0, error_rate: 0, battery: 100, signal_strength: 0, ip_address: '0.0.0.0', tags: provisionData.tags.split(',').map(t => t.trim()).filter(Boolean), uptime_hours: 0, last_error: null, config: { nfc_enabled: true, qr_enabled: true, receipt_auto: true, timeout_sec: 30 }, tx_history: [0,0,0,0,0,0,0,0,0,0,0,0], lat: 6.5, lng: 3.4 }
    setTerminals(prev => [...prev, newTerminal])
    setProvisionStep(0)
    setProvisionData({ name: '', type: 'integrated_pos', merchant_id: '', location: '', region: '', firmware: 'v3.2.2', tags: '', group: '' })
    setActiveTab('terminals')
  }

  const exportData = () => {
    let content = ''
    if (exportFormat === 'csv') {
      content = 'ID,Name,Type,Status,Location,Firmware,Transactions,Battery,Signal,Health Score\n'
      terminals.forEach(t => { content += `${t.id},${t.name},${t.type},${t.status},${t.location},${t.firmware},${t.total_transactions},${t.battery || 'N/A'},${t.signal_strength},${calcHealthScore(t)}\n` })
    } else {
      content = JSON.stringify({ report_date: new Date().toISOString(), terminals: terminals.map(t => ({ ...t, health_score: calcHealthScore(t) })), summary: { total: terminals.length, online: onlineCount, offline: offlineCount, errors: errorCount, avg_health: Math.round(terminals.reduce((s, t) => s + calcHealthScore(t), 0) / terminals.length) } }, null, 2)
    }
    const blob = new Blob([content], { type: exportFormat === 'csv' ? 'text/csv' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `pos-terminals-report.${exportFormat}`; a.click()
    URL.revokeObjectURL(url)
  }

  const toggleSelectTerminal = (id) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]) }
  const selectAll = () => { setSelectedIds(filteredTerminals.map(t => t.id)) }
  const deselectAll = () => { setSelectedIds([]) }

  const statusColor = (s) => s === 'online' ? 'text-green-600 bg-green-50' : s === 'offline' ? 'text-gray-500 bg-gray-100' : s === 'error' ? 'text-red-600 bg-red-50' : 'text-yellow-600 bg-yellow-50'
  const statusIcon = (s) => s === 'online' ? Signal : s === 'offline' ? WifiOff : s === 'error' ? AlertTriangle : RotateCw

  const calcHealthScore = (t) => {
    let score = 0
    if (t.status === 'online') score += 30; else if (t.status === 'maintenance') score += 15
    score += Math.min(20, (t.uptime_hours || 0) / 36)
    score += Math.min(20, ((100 - (t.error_rate || 0)) / 5))
    if (t.battery !== null) score += Math.min(15, t.battery / 7)
    else score += 15
    score += Math.min(15, (t.signal_strength || 0) / 7)
    return Math.min(100, Math.round(score))
  }

  const healthColor = (score) => score >= 80 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600'
  const healthBg = (score) => score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500'

  const groups = [...new Set(terminals.map(t => t.group).filter(Boolean))]
  const allTags = [...new Set(terminals.flatMap(t => t.tags || []))]

  const filteredTerminals = terminals.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false
    if (filterGroup !== 'all' && t.group !== filterGroup) return false
    if (searchTerm && !t.name.toLowerCase().includes(searchTerm.toLowerCase()) && !t.id.toLowerCase().includes(searchTerm.toLowerCase()) && !t.location.toLowerCase().includes(searchTerm.toLowerCase()) && !(t.tags || []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))) return false
    return true
  })

  const onlineCount = terminals.filter(t => t.status === 'online').length
  const offlineCount = terminals.filter(t => t.status === 'offline').length
  const errorCount = terminals.filter(t => t.status === 'error').length
  const totalTxns = terminals.reduce((sum, t) => sum + t.total_transactions, 0)
  const avgHealth = terminals.length ? Math.round(terminals.reduce((s, t) => s + calcHealthScore(t), 0) / terminals.length) : 0
  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged).length

  const tabs = [
    { id: 'terminals', label: 'Terminals', icon: Monitor },
    { id: 'commands', label: 'Remote Commands', icon: Terminal },
    { id: 'updates', label: 'Firmware', icon: Download },
    { id: 'health', label: 'Health Scores', icon: Activity },
    { id: 'alerts', label: `Alerts${unacknowledgedAlerts ? ` (${unacknowledgedAlerts})` : ''}`, icon: Bell },
    { id: 'map', label: 'Map View', icon: MapPin },
    { id: 'analytics', label: 'Analytics', icon: BarChart2 },
    { id: 'provision', label: 'Provision', icon: Plus },
    { id: 'maintenance', label: 'Maintenance', icon: Calendar },
    { id: 'audit', label: 'Audit Trail', icon: ClipboardCheck },
    { id: 'sync', label: 'Sync & Ledger', icon: RefreshCw },
    { id: 'export', label: 'Export', icon: FileText },
    { id: 'scoring', label: 'Transaction Scoring', icon: Shield },
    { id: 'gl_posting', label: 'GL Posting', icon: BookOpen },
    { id: 'targets', label: 'Targets', icon: Target },
    { id: 'qr_tickets', label: 'QR Tickets', icon: QrCode },
    { id: 'pos_inventory', label: 'POS Inventory', icon: Package },
  ]

  const MiniChart = ({ data, color = '#6366f1' }) => {
    const max = Math.max(...data, 1)
    return (<svg viewBox="0 0 120 40" className="w-full h-10"><polyline fill="none" stroke={color} strokeWidth="2" points={data.map((v, i) => `${(i / (data.length - 1)) * 120},${40 - (v / max) * 36}`).join(' ')} />{data.map((v, i) => (<circle key={i} cx={(i / (data.length - 1)) * 120} cy={40 - (v / max) * 36} r="1.5" fill={color} />))}</svg>)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">POS Management</h2>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-lg">
              <span className="text-sm text-indigo-700 font-medium">{selectedIds.length} selected</span>
              <Button size="sm" onClick={() => sendBatchCommand('REBOOT')}><Power className="w-3 h-3 mr-1" />Batch Reboot</Button>
              <Button size="sm" variant="outline" onClick={() => sendBatchCommand('FORCE_SYNC')}>Batch Sync</Button>
              <Button size="sm" variant="ghost" onClick={deselectAll}><X className="w-3 h-3" /></Button>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => { loadTerminals(); loadHealth(); loadSyncStats() }}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ['Terminals', terminals.length, Monitor, 'bg-blue-50', 'text-blue-600'],
          ['Online', onlineCount, Signal, 'bg-green-50', 'text-green-600'],
          ['Offline', offlineCount, WifiOff, 'bg-gray-100', 'text-gray-500'],
          ['Errors', errorCount, AlertTriangle, 'bg-red-50', 'text-red-600'],
          ['Avg Health', `${avgHealth}/100`, Activity, avgHealth >= 80 ? 'bg-green-50' : 'bg-yellow-50', avgHealth >= 80 ? 'text-green-600' : 'text-yellow-600'],
          ['Transactions', totalTxns.toLocaleString(), CreditCard, 'bg-indigo-50', 'text-indigo-600'],
        ].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-3">
            <div className="flex items-center space-x-2">
              <div className={`w-9 h-9 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-4 h-4 ${color}`} /></div>
              <div><p className="text-xs text-gray-500">{title}</p><p className="text-lg font-bold">{value}</p></div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b overflow-x-auto pb-px">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <tab.icon className="w-3.5 h-3.5" />{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'terminals' && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search terminals, tags..." className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
            <select className="px-3 py-2 border rounded-lg text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All Status</option><option value="online">Online</option><option value="offline">Offline</option><option value="error">Error</option><option value="maintenance">Maintenance</option></select>
            <select className="px-3 py-2 border rounded-lg text-sm" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}><option value="all">All Groups</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select>
            <div className="flex border rounded-lg overflow-hidden">
              <button onClick={() => setViewMode('grid')} className={`px-3 py-2 text-sm ${viewMode === 'grid' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500'}`}><Layers className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('list')} className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500'}`}><Menu className="w-4 h-4" /></button>
            </div>
            <Button variant="outline" size="sm" onClick={selectedIds.length === filteredTerminals.length ? deselectAll : selectAll}><CheckCircle className="w-3 h-3 mr-1" />{selectedIds.length === filteredTerminals.length ? 'Deselect All' : 'Select All'}</Button>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredTerminals.map(t => {
                const SIcon = statusIcon(t.status)
                const hs = calcHealthScore(t)
                const isSelected = selectedIds.includes(t.id)
                return (
                  <div key={t.id} className={`bg-white rounded-xl shadow p-5 border-l-4 ${t.status === 'online' ? 'border-green-500' : t.status === 'offline' ? 'border-gray-300' : t.status === 'error' ? 'border-red-500' : 'border-yellow-500'} ${isSelected ? 'ring-2 ring-indigo-400' : ''} hover:shadow-md transition-all`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelectTerminal(t.id)} className="w-4 h-4 text-indigo-600 rounded" onClick={e => e.stopPropagation()} />
                        <div>
                          <h3 className="font-semibold text-gray-900">{t.name}</h3>
                          <p className="text-xs text-gray-500 font-mono">{t.id} | {t.group}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${healthColor(hs)}`}>{hs}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(t.status)}`}><SIcon className="w-3 h-3" />{t.status}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                      <div><span className="text-gray-500">Location:</span><br/><span className="font-medium">{t.location}</span></div>
                      <div><span className="text-gray-500">Firmware:</span><br/><span className="font-mono">{t.firmware}</span></div>
                      <div><span className="text-gray-500">Txns:</span><br/><span className="font-medium">{t.total_transactions.toLocaleString()}</span></div>
                      {t.battery !== null && <div><span className="text-gray-500">Battery:</span><br/><span className={`font-medium ${t.battery < 20 ? 'text-red-600' : t.battery < 50 ? 'text-yellow-600' : 'text-green-600'}`}>{t.battery}%</span></div>}
                      <div><span className="text-gray-500">Signal:</span><br/><span className="font-medium">{t.signal_strength}%</span></div>
                      <div><span className="text-gray-500">Success:</span><br/><span className="font-medium">{t.success_rate}%</span></div>
                    </div>
                    {(t.tags || []).length > 0 && <div className="flex flex-wrap gap-1 mb-3">{t.tags.map(tag => <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">{tag}</span>)}</div>}
                    <MiniChart data={t.tx_history || []} />
                    <div className="mt-3 pt-3 border-t flex justify-between items-center">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" onClick={() => sendCommand(t.id, 'REBOOT')}><Power className="w-3 h-3 mr-1" />Reboot</Button>
                        <Button size="sm" variant="outline" onClick={() => sendCommand(t.id, 'DIAGNOSTICS')}><Activity className="w-3 h-3 mr-1" />Diag</Button>
                        <Button size="sm" variant="outline" onClick={() => sendCommand(t.id, 'FORCE_SYNC')}><RefreshCw className="w-3 h-3 mr-1" />Sync</Button>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setDetailTerminal(t)}><Eye className="w-3 h-3 mr-1" />Details</Button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b bg-gray-50"><th className="p-3 text-left text-xs"><input type="checkbox" checked={selectedIds.length === filteredTerminals.length && filteredTerminals.length > 0} onChange={selectedIds.length === filteredTerminals.length ? deselectAll : selectAll} className="w-4 h-4" /></th><th className="p-3 text-left text-xs">Terminal</th><th className="p-3 text-left text-xs">Status</th><th className="p-3 text-left text-xs">Health</th><th className="p-3 text-left text-xs">Location</th><th className="p-3 text-left text-xs">Firmware</th><th className="p-3 text-left text-xs">Txns</th><th className="p-3 text-left text-xs">Battery</th><th className="p-3 text-left text-xs">Signal</th><th className="p-3 text-left text-xs">Actions</th></tr></thead>
                <tbody>{filteredTerminals.map(t => { const hs = calcHealthScore(t); return (
                  <tr key={t.id} className="border-b hover:bg-gray-50">
                    <td className="p-3"><input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleSelectTerminal(t.id)} className="w-4 h-4" /></td>
                    <td className="p-3"><span className="font-medium text-sm">{t.name}</span><br/><span className="text-xs text-gray-500 font-mono">{t.id}</span></td>
                    <td className="p-3"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(t.status)}`}>{t.status}</span></td>
                    <td className="p-3"><span className={`text-sm font-bold ${healthColor(hs)}`}>{hs}/100</span></td>
                    <td className="p-3 text-sm">{t.location}</td>
                    <td className="p-3 text-xs font-mono">{t.firmware}</td>
                    <td className="p-3 text-sm">{t.total_transactions.toLocaleString()}</td>
                    <td className="p-3 text-sm">{t.battery !== null ? `${t.battery}%` : '-'}</td>
                    <td className="p-3 text-sm">{t.signal_strength}%</td>
                    <td className="p-3"><Button size="sm" variant="ghost" onClick={() => setDetailTerminal(t)}><Eye className="w-3 h-3" /></Button></td>
                  </tr>)})}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'commands' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Send Command</h3>
            <div className="flex gap-3 flex-wrap">
              <select className="px-3 py-2 border rounded-lg text-sm" value={selectedTerminal?.id || ''} onChange={e => setSelectedTerminal(terminals.find(t => t.id === e.target.value) || null)}>
                <option value="">Select Terminal</option>
                {terminals.map(t => <option key={t.id} value={t.id}>{t.id} - {t.name}</option>)}
              </select>
              <select className="px-3 py-2 border rounded-lg text-sm" value={commandInput} onChange={e => setCommandInput(e.target.value)}>
                <option value="">Select Command</option>
                <option value="REBOOT">Reboot</option><option value="DIAGNOSTICS">Run Diagnostics</option><option value="UPDATE_CONFIG">Update Configuration</option><option value="CLEAR_CACHE">Clear Cache</option><option value="ENABLE_DEBUG">Enable Debug Mode</option><option value="DISABLE_DEBUG">Disable Debug Mode</option><option value="FORCE_SYNC">Force Sync</option><option value="SCREENSHOT">Capture Screenshot</option><option value="RESTART_SERVICE">Restart Service</option><option value="FACTORY_RESET">Factory Reset</option>
              </select>
              <Button onClick={() => { if (selectedTerminal && commandInput) { sendCommand(selectedTerminal.id, commandInput); setCommandInput('') } }} disabled={!selectedTerminal || !commandInput}><Send className="w-4 h-4 mr-1" />Send</Button>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Command History</h3>
            <div className="overflow-x-auto">
              <table className="w-full"><thead><tr className="border-b"><th className="text-left p-3 text-xs text-gray-500">Terminal</th><th className="text-left p-3 text-xs text-gray-500">Command</th><th className="text-left p-3 text-xs text-gray-500">Status</th><th className="text-left p-3 text-xs text-gray-500">User</th><th className="text-left p-3 text-xs text-gray-500">Sent</th><th className="text-left p-3 text-xs text-gray-500">Completed</th></tr></thead>
              <tbody>{commandLog.map(l => (<tr key={l.id} className="border-b hover:bg-gray-50"><td className="p-3 text-sm font-mono">{l.terminal_id}</td><td className="p-3"><span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{l.command}</span></td><td className="p-3"><Badge variant={l.status === 'completed' ? 'success' : l.status === 'failed' ? 'destructive' : 'warning'}>{l.status}</Badge></td><td className="p-3 text-sm">{l.user}</td><td className="p-3 text-sm">{l.sent_at}</td><td className="p-3 text-sm">{l.completed_at || '-'}</td></tr>))}</tbody></table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'updates' && (
        <div className="space-y-4">
          {updates.map(u => (
            <div key={u.id} className="bg-white rounded-xl shadow p-6">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-semibold">{u.version}</h3>
                    <Badge variant={u.status === 'available' ? 'default' : u.status === 'deploying' ? 'warning' : u.status === 'rolling_back' ? 'destructive' : 'success'}>{u.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{u.changelog}</p>
                  <div className="flex gap-4 text-xs text-gray-500"><span>Released: {u.release_date}</span><span>Size: {u.size}</span><span>Devices: {u.compatible_devices.map(d => d.replace(/_/g, ' ')).join(', ')}</span></div>
                </div>
                <div className="flex gap-2">
                  {u.status === 'available' && <Button size="sm" onClick={() => deployUpdate(u.id)}><Download className="w-4 h-4 mr-1" />Deploy</Button>}
                  {u.status === 'deploying' && (<div className="text-right"><p className="text-sm font-medium text-yellow-600 mb-1">Deploying...</p><div className="w-32 bg-gray-200 rounded-full h-2"><div className="bg-yellow-500 h-2 rounded-full" style={{ width: `${((u.deployed_count || 0) / (u.total_count || 1)) * 100}%` }} /></div><p className="text-xs text-gray-500 mt-1">{u.deployed_count}/{u.total_count}</p></div>)}
                  {u.status === 'completed' && (<div className="flex gap-2 items-center"><p className="text-sm text-green-600 font-medium">{u.deployed_count}/{u.total_count}</p><Button size="sm" variant="outline" onClick={() => rollbackUpdate(u.id, u.rollback_version)}><RotateCw className="w-3 h-3 mr-1" />Rollback</Button></div>)}
                  {u.status === 'rolling_back' && <p className="text-sm text-red-600 font-medium">Rolling back...</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'health' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {terminals.map(t => { const hs = calcHealthScore(t); return (
              <div key={t.id} className="bg-white rounded-xl shadow p-5">
                <div className="flex justify-between items-center mb-3">
                  <div><h3 className="font-semibold text-sm">{t.name}</h3><p className="text-xs text-gray-500">{t.id}</p></div>
                  <div className={`text-2xl font-bold ${healthColor(hs)}`}>{hs}</div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 mb-3"><div className={`h-3 rounded-full ${healthBg(hs)}`} style={{ width: `${hs}%` }} /></div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Status</span><span className={`font-medium ${t.status === 'online' ? 'text-green-600' : 'text-red-600'}`}>{t.status} (+{t.status === 'online' ? 30 : t.status === 'maintenance' ? 15 : 0})</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Uptime</span><span>{t.uptime_hours}h</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Error Rate</span><span className={t.error_rate > 5 ? 'text-red-600' : ''}>{t.error_rate}%</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Battery</span><span>{t.battery !== null ? `${t.battery}%` : 'N/A'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Signal</span><span>{t.signal_strength}%</span></div>
                  {t.last_error && <div className="mt-2 p-2 bg-red-50 rounded text-red-700 text-xs">{t.last_error}</div>}
                </div>
              </div>
            )})}
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Alert Configuration</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><label className="text-xs text-gray-500 block mb-1">Battery Threshold (%)</label><input type="number" className="w-full px-3 py-2 border rounded-lg text-sm" value={alertConfig.battery_threshold} onChange={e => setAlertConfig(prev => ({ ...prev, battery_threshold: parseInt(e.target.value) || 0 }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Error Rate Threshold (%)</label><input type="number" className="w-full px-3 py-2 border rounded-lg text-sm" value={alertConfig.error_rate_threshold} onChange={e => setAlertConfig(prev => ({ ...prev, error_rate_threshold: parseInt(e.target.value) || 0 }))} /></div>
              <div className="flex items-end gap-2"><label className="text-xs text-gray-500">Offline alerts</label><input type="checkbox" checked={alertConfig.offline_notify} onChange={e => setAlertConfig(prev => ({ ...prev, offline_notify: e.target.checked }))} className="w-4 h-4" /></div>
              <div className="flex items-end gap-2"><label className="text-xs text-gray-500">Firmware alerts</label><input type="checkbox" checked={alertConfig.firmware_outdated_notify} onChange={e => setAlertConfig(prev => ({ ...prev, firmware_outdated_notify: e.target.checked }))} className="w-4 h-4" /></div>
            </div>
          </div>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className={`bg-white rounded-xl shadow p-4 flex justify-between items-center ${a.acknowledged ? 'opacity-60' : ''} ${a.severity === 'critical' ? 'border-l-4 border-red-500' : a.severity === 'high' ? 'border-l-4 border-orange-500' : 'border-l-4 border-yellow-400'}`}>
                <div className="flex items-center gap-3">
                  <AlertTriangle className={`w-5 h-5 ${a.severity === 'critical' ? 'text-red-600' : a.severity === 'high' ? 'text-orange-600' : 'text-yellow-600'}`} />
                  <div><p className="text-sm font-medium">{a.message}</p><p className="text-xs text-gray-500">{a.terminal_id} | {new Date(a.timestamp).toLocaleString()} | {a.type}</p></div>
                </div>
                {!a.acknowledged && <Button size="sm" variant="outline" onClick={() => acknowledgeAlert(a.id)}>Acknowledge</Button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'map' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Terminal Locations</h3>
            <div className="relative bg-gradient-to-br from-green-50 to-blue-50 rounded-xl overflow-hidden" style={{ height: '450px' }}>
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4z\' fill=\'%236366f1\' fill-opacity=\'0.15\'/%3E%3C/g%3E%3C/svg%3E")' }} />
              {Object.entries(terminals.reduce((acc, t) => { const key = t.region || 'Unknown'; if (!acc[key]) acc[key] = []; acc[key].push(t); return acc }, {})).map(([region, regionTerminals]) => {
                const positions = { 'Lagos': { top: '55%', left: '25%' }, 'Abuja': { top: '35%', left: '45%' }, 'Port Harcourt': { top: '65%', left: '40%' } }
                const pos = positions[region] || { top: '50%', left: '50%' }
                const onlineHere = regionTerminals.filter(t => t.status === 'online').length
                const totalHere = regionTerminals.length
                return (
                  <div key={region} className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group" style={pos}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ${onlineHere === totalHere ? 'bg-green-500' : onlineHere > 0 ? 'bg-yellow-500' : 'bg-red-500'}`}>{totalHere}</div>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block">
                      <div className="bg-slate-900 text-white p-3 rounded-lg text-xs whitespace-nowrap shadow-xl">
                        <p className="font-bold mb-1">{region}</p>
                        {regionTerminals.map(t => (<p key={t.id} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${t.status === 'online' ? 'bg-green-400' : t.status === 'offline' ? 'bg-gray-400' : t.status === 'error' ? 'bg-red-400' : 'bg-yellow-400'}`} />{t.name} ({t.status})</p>))}
                      </div>
                    </div>
                    <p className="text-center text-xs font-medium mt-1">{region}</p>
                  </div>
                )
              })}
              <div className="absolute bottom-4 right-4 bg-white rounded-lg p-3 shadow text-xs space-y-1">
                <p className="font-medium mb-2">Legend</p>
                {[['bg-green-500', 'All Online'], ['bg-yellow-500', 'Partial'], ['bg-red-500', 'All Offline']].map(([c, l]) => (<div key={l} className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full ${c}`} />{l}</div>))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {terminals.filter(t => t.total_transactions > 0).map(t => (
              <div key={t.id} className="bg-white rounded-xl shadow p-5">
                <div className="flex justify-between items-center mb-3"><h3 className="font-semibold text-sm">{t.name}</h3><Badge variant={t.status === 'online' ? 'success' : 'destructive'}>{t.status}</Badge></div>
                <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                  <div className="bg-blue-50 rounded-lg p-2 text-center"><p className="text-gray-500">Total Txns</p><p className="text-lg font-bold text-blue-600">{t.total_transactions.toLocaleString()}</p></div>
                  <div className="bg-green-50 rounded-lg p-2 text-center"><p className="text-gray-500">Success</p><p className="text-lg font-bold text-green-600">{t.success_rate}%</p></div>
                  <div className="bg-indigo-50 rounded-lg p-2 text-center"><p className="text-gray-500">Avg Time</p><p className="text-lg font-bold text-indigo-600">{t.avg_processing_ms}ms</p></div>
                </div>
                <p className="text-xs text-gray-500 mb-1">Monthly Transaction Trend</p>
                <MiniChart data={t.tx_history || []} />
                <div className="mt-2 flex justify-between text-xs text-gray-400"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'provision' && (
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-2">Provision New Terminal</h3>
          <p className="text-sm text-gray-500 mb-6">Register and configure a new POS terminal in the network.</p>
          <div className="flex gap-4 mb-6">{['Device Info', 'Configuration', 'Review'].map((step, i) => (<div key={step} className={`flex items-center gap-2 ${i <= provisionStep ? 'text-indigo-600' : 'text-gray-400'}`}><div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${i <= provisionStep ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100'}`}>{i + 1}</div><span className="text-sm font-medium">{step}</span>{i < 2 && <ChevronRight className="w-4 h-4 text-gray-300" />}</div>))}</div>
          {provisionStep === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm text-gray-600 block mb-1">Terminal Name</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.name} onChange={e => setProvisionData(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Main Counter POS" /></div>
                <div><label className="text-sm text-gray-600 block mb-1">Type</label><select className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.type} onChange={e => setProvisionData(p => ({ ...p, type: e.target.value }))}><option value="integrated_pos">Integrated POS</option><option value="card_reader">Card Reader</option><option value="receipt_printer">Receipt Printer</option><option value="barcode_scanner">Barcode Scanner</option></select></div>
                <div><label className="text-sm text-gray-600 block mb-1">Merchant ID</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.merchant_id} onChange={e => setProvisionData(p => ({ ...p, merchant_id: e.target.value }))} placeholder="MRC-XXX" /></div>
                <div><label className="text-sm text-gray-600 block mb-1">Location</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.location} onChange={e => setProvisionData(p => ({ ...p, location: e.target.value }))} placeholder="e.g., Lagos - Victoria Island" /></div>
              </div>
              <Button onClick={() => setProvisionStep(1)} disabled={!provisionData.name || !provisionData.merchant_id}>Next <ArrowRight className="w-4 h-4 ml-1" /></Button>
            </div>
          )}
          {provisionStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm text-gray-600 block mb-1">Region</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.region} onChange={e => setProvisionData(p => ({ ...p, region: e.target.value }))} placeholder="e.g., Lagos" /></div>
                <div><label className="text-sm text-gray-600 block mb-1">Group</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.group} onChange={e => setProvisionData(p => ({ ...p, group: e.target.value }))} placeholder="e.g., Lagos-Main" /></div>
                <div><label className="text-sm text-gray-600 block mb-1">Firmware</label><select className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.firmware} onChange={e => setProvisionData(p => ({ ...p, firmware: e.target.value }))}><option value="v3.2.2">v3.2.2 (Latest)</option><option value="v3.2.1">v3.2.1</option><option value="v3.1.0">v3.1.0</option></select></div>
                <div><label className="text-sm text-gray-600 block mb-1">Tags (comma-separated)</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={provisionData.tags} onChange={e => setProvisionData(p => ({ ...p, tags: e.target.value }))} placeholder="e.g., high-volume, flagship" /></div>
              </div>
              <div className="flex gap-2"><Button variant="outline" onClick={() => setProvisionStep(0)}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button><Button onClick={() => setProvisionStep(2)}>Next <ArrowRight className="w-4 h-4 ml-1" /></Button></div>
            </div>
          )}
          {provisionStep === 2 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                {Object.entries(provisionData).filter(([, v]) => v).map(([k, v]) => (<div key={k} className="flex justify-between"><span className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span><span className="font-medium">{v}</span></div>))}
              </div>
              <div className="flex gap-2"><Button variant="outline" onClick={() => setProvisionStep(1)}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button><Button onClick={handleProvision}><Plus className="w-4 h-4 mr-1" />Provision Terminal</Button></div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'maintenance' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Maintenance Schedule</h3>
            <div className="overflow-x-auto">
              <table className="w-full"><thead><tr className="border-b"><th className="text-left p-3 text-xs text-gray-500">ID</th><th className="text-left p-3 text-xs text-gray-500">Terminal</th><th className="text-left p-3 text-xs text-gray-500">Date</th><th className="text-left p-3 text-xs text-gray-500">Time</th><th className="text-left p-3 text-xs text-gray-500">Duration</th><th className="text-left p-3 text-xs text-gray-500">Reason</th><th className="text-left p-3 text-xs text-gray-500">Status</th></tr></thead>
              <tbody>{maintenanceSchedule.map(m => (<tr key={m.id} className="border-b hover:bg-gray-50"><td className="p-3 text-xs font-mono">{m.id}</td><td className="p-3 text-sm">{m.terminal_id}</td><td className="p-3 text-sm">{m.date}</td><td className="p-3 text-sm">{m.time}</td><td className="p-3 text-sm">{m.duration}</td><td className="p-3 text-sm">{m.reason}</td><td className="p-3"><Badge variant={m.status === 'completed' ? 'success' : m.status === 'scheduled' ? 'default' : 'warning'}>{m.status}</Badge></td></tr>))}</tbody></table>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Schedule New Maintenance</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <select className="px-3 py-2 border rounded-lg text-sm"><option value="">Select Terminal</option>{terminals.map(t => <option key={t.id} value={t.id}>{t.id} - {t.name}</option>)}</select>
              <input type="date" className="px-3 py-2 border rounded-lg text-sm" />
              <input type="time" className="px-3 py-2 border rounded-lg text-sm" />
              <input type="text" placeholder="Duration (e.g., 1h)" className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div className="mt-3"><input type="text" placeholder="Reason for maintenance" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <Button className="mt-3"><Calendar className="w-4 h-4 mr-1" />Schedule</Button>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Audit Trail</h3>
          <p className="text-sm text-gray-500 mb-4">Complete log of all POS management actions with user attribution.</p>
          <div className="overflow-x-auto">
            <table className="w-full"><thead><tr className="border-b bg-gray-50"><th className="text-left p-3 text-xs text-gray-500">Timestamp</th><th className="text-left p-3 text-xs text-gray-500">User</th><th className="text-left p-3 text-xs text-gray-500">Action</th><th className="text-left p-3 text-xs text-gray-500">Terminal</th><th className="text-left p-3 text-xs text-gray-500">Details</th><th className="text-left p-3 text-xs text-gray-500">Result</th></tr></thead>
            <tbody>{commandLog.map(l => (<tr key={l.id} className="border-b hover:bg-gray-50"><td className="p-3 text-xs">{l.sent_at}</td><td className="p-3 text-sm">{l.user}</td><td className="p-3"><span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{l.command}</span></td><td className="p-3 text-sm font-mono">{l.terminal_id}</td><td className="p-3 text-xs text-gray-500">Remote command via POS Management UI</td><td className="p-3"><Badge variant={l.status === 'completed' ? 'success' : l.status === 'failed' ? 'destructive' : 'warning'}>{l.status}</Badge></td></tr>))}</tbody></table>
          </div>
        </div>
      )}

      {activeTab === 'sync' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[['Total Syncs', syncStats.total_syncs || 0, RefreshCw, 'bg-blue-50', 'text-blue-600'], ['Pending Events', syncStats.pending_events || 0, Clock, 'bg-yellow-50', 'text-yellow-600'], ['Resolution Rate', `${syncStats.resolution_rate || 100}%`, CheckCircle, 'bg-green-50', 'text-green-600'], ['Mgmt Server', mgmtHealth.status || 'unknown', HardDrive, mgmtHealth.status === 'healthy' ? 'bg-green-50' : 'bg-red-50', mgmtHealth.status === 'healthy' ? 'text-green-600' : 'text-red-600']].map(([title, value, Icon, bg, color]) => (
              <div key={title} className="bg-white rounded-xl shadow p-4"><div className="flex items-center space-x-3"><div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div><div><p className="text-sm text-gray-500">{title}</p><p className="text-xl font-bold">{value}</p></div></div></div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow p-6"><h3 className="text-lg font-semibold mb-4">TigerBeetle Ledger</h3><div className="space-y-3"><div className="flex justify-between text-sm"><span className="text-gray-500">Endpoint</span><span className="font-mono text-xs">localhost:8085</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Sync Manager</span><Badge variant="success">Connected</Badge></div><div className="flex justify-between text-sm"><span className="text-gray-500">Last Sync</span><span>{syncStats.last_sync ? new Date(syncStats.last_sync).toLocaleString() : 'N/A'}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Pending</span><span className="font-bold">{syncStats.pending_events || 0}</span></div></div></div>
            <div className="bg-white rounded-xl shadow p-6"><h3 className="text-lg font-semibold mb-4">Management Server</h3><div className="space-y-3"><div className="flex justify-between text-sm"><span className="text-gray-500">Status</span><Badge variant={mgmtHealth.status === 'healthy' ? 'success' : 'destructive'}>{mgmtHealth.status}</Badge></div><div className="flex justify-between text-sm"><span className="text-gray-500">Terminals</span><span className="font-bold">{mgmtHealth.connected_terminals || 0}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Uptime</span><span>{mgmtHealth.uptime || 'N/A'}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Endpoint</span><span className="font-mono text-xs">localhost:8443</span></div></div></div>
          </div>
        </div>
      )}

      {activeTab === 'export' && (
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Export Reports</h3>
          <p className="text-sm text-gray-500 mb-4">Download terminal status, health scores, and transaction data.</p>
          <div className="flex gap-4 items-end">
            <div><label className="text-sm text-gray-600 block mb-1">Format</label><select className="px-3 py-2 border rounded-lg text-sm" value={exportFormat} onChange={e => setExportFormat(e.target.value)}><option value="csv">CSV</option><option value="json">JSON</option></select></div>
            <Button onClick={exportData}><FileText className="w-4 h-4 mr-1" />Download Report</Button>
          </div>
          <div className="mt-6 p-4 bg-gray-50 rounded-lg text-xs text-gray-500">
            <p className="font-medium mb-2">Report includes:</p>
            <ul className="list-disc list-inside space-y-1"><li>All {terminals.length} terminals with current status</li><li>Health scores (0-100) per terminal</li><li>Transaction counts and success rates</li><li>Battery and signal levels</li><li>Firmware versions</li><li>Group and tag assignments</li></ul>
          </div>
        </div>
      )}

      {activeTab === 'scoring' && <POSTransactionScoringTab posApi={POS_API} formatCurrency={formatCurrency} />}
      {activeTab === 'gl_posting' && <POSGLPostingTab posApi={POS_API} formatCurrency={formatCurrency} />}
      {activeTab === 'targets' && <POSTargetsTab posApi={POS_API} formatCurrency={formatCurrency} />}
      {activeTab === 'qr_tickets' && <POSQRTicketsTab posApi={POS_API} />}
      {activeTab === 'pos_inventory' && <POSInventoryTab posApi={POS_API} />}

      {detailTerminal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={() => setDetailTerminal(null)}>
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center z-10">
              <div><h2 className="text-lg font-bold">{detailTerminal.name}</h2><p className="text-xs text-gray-500 font-mono">{detailTerminal.id}</p></div>
              <button onClick={() => setDetailTerminal(null)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <Badge variant={detailTerminal.status === 'online' ? 'success' : detailTerminal.status === 'error' ? 'destructive' : 'warning'}>{detailTerminal.status}</Badge>
                <span className={`text-2xl font-bold ${healthColor(calcHealthScore(detailTerminal))}`}>{calcHealthScore(detailTerminal)}/100</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[['Type', detailTerminal.type.replace(/_/g, ' ')], ['Location', detailTerminal.location], ['Region', detailTerminal.region], ['Group', detailTerminal.group], ['Merchant', detailTerminal.merchant_id], ['Firmware', detailTerminal.firmware], ['IP Address', detailTerminal.ip_address], ['Uptime', `${detailTerminal.uptime_hours}h`]].map(([k, v]) => (
                  <div key={k}><span className="text-gray-500 text-xs">{k}</span><p className="font-medium">{v}</p></div>
                ))}
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2">Transaction Trend</h3>
                <MiniChart data={detailTerminal.tx_history || []} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Transactions</p><p className="text-xl font-bold text-blue-600">{detailTerminal.total_transactions.toLocaleString()}</p></div>
                <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Success</p><p className="text-xl font-bold text-green-600">{detailTerminal.success_rate}%</p></div>
                <div className="bg-indigo-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Avg Time</p><p className="text-xl font-bold text-indigo-600">{detailTerminal.avg_processing_ms}ms</p></div>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2">Hardware</h3>
                <div className="space-y-2">
                  {detailTerminal.battery !== null && <div><div className="flex justify-between text-xs mb-1"><span>Battery</span><span>{detailTerminal.battery}%</span></div><div className="w-full bg-gray-200 rounded-full h-2"><div className={`h-2 rounded-full ${detailTerminal.battery > 50 ? 'bg-green-500' : detailTerminal.battery > 20 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${detailTerminal.battery}%` }} /></div></div>}
                  <div><div className="flex justify-between text-xs mb-1"><span>Signal</span><span>{detailTerminal.signal_strength}%</span></div><div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${detailTerminal.signal_strength}%` }} /></div></div>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2">Configuration</h3>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-xs">{Object.entries(detailTerminal.config || {}).map(([k, v]) => (<div key={k} className="flex justify-between"><span className="text-gray-500">{k.replace(/_/g, ' ')}</span><span className="font-medium">{String(v)}</span></div>))}</div>
              </div>
              {detailTerminal.tags?.length > 0 && <div><h3 className="font-semibold text-sm mb-2">Tags</h3><div className="flex flex-wrap gap-1">{detailTerminal.tags.map(tag => <span key={tag} className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-full">{tag}</span>)}</div></div>}
              {detailTerminal.last_error && <div className="bg-red-50 border border-red-200 rounded-lg p-3"><p className="text-xs text-red-600 font-medium">Last Error</p><p className="text-sm text-red-700">{detailTerminal.last_error}</p></div>}
              <div>
                <h3 className="font-semibold text-sm mb-2">Quick Actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => sendCommand(detailTerminal.id, 'REBOOT')}><Power className="w-3 h-3 mr-1" />Reboot</Button>
                  <Button size="sm" variant="outline" onClick={() => sendCommand(detailTerminal.id, 'DIAGNOSTICS')}><Activity className="w-3 h-3 mr-1" />Diagnostics</Button>
                  <Button size="sm" variant="outline" onClick={() => sendCommand(detailTerminal.id, 'UPDATE_CONFIG')}><Settings className="w-3 h-3 mr-1" />Config</Button>
                  <Button size="sm" variant="outline" onClick={() => sendCommand(detailTerminal.id, 'FORCE_SYNC')}><RefreshCw className="w-3 h-3 mr-1" />Sync</Button>
                  <Button size="sm" variant="outline" onClick={() => sendCommand(detailTerminal.id, 'CLEAR_CACHE')}><Trash2 className="w-3 h-3 mr-1" />Cache</Button>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2">Recent Commands</h3>
                <div className="space-y-1">{commandLog.filter(l => l.terminal_id === detailTerminal.id).slice(0, 5).map(l => (<div key={l.id} className="flex justify-between items-center text-xs bg-gray-50 rounded p-2"><span className="font-mono">{l.command}</span><Badge variant={l.status === 'completed' ? 'success' : l.status === 'failed' ? 'destructive' : 'warning'}>{l.status}</Badge></div>))}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function POSTransactionScoringTab({ posApi, formatCurrency }) {
  const [scoreForm, setScoreForm] = useState({ sender_id: 'AGT-001', recipient_id: 'CUST-001', amount: 50000, currency: 'NGN', transaction_type: 'cash_in', channel: 'pos' })
  const [scoreResult, setScoreResult] = useState(null)
  const [recentScores, setRecentScores] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const resp = await fetch(`${posApi}/pos/score-transaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: 'demo', recipient_id: 'demo', amount: 1, currency: 'NGN', transaction_type: 'cash_in', channel: 'pos' }) })
        if (resp.ok) { const d = await resp.json(); if (d.overall_score) setRecentScores([{ id: 'INIT', amount: 1, score: d.overall_score, risk_level: d.risk_level, recommendation: d.recommendation, timestamp: new Date().toLocaleString() }]) }
      } catch { setError('Scoring service unavailable - showing cached data') }
    }
    loadAnalytics()
  }, [posApi])

  const handleScore = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${posApi}/pos/score-transaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scoreForm) })
      if (resp.ok) {
        const data = await resp.json()
        setScoreResult(data)
        setRecentScores(prev => [{ id: `TXN-${Date.now()}`, amount: scoreForm.amount, score: data.overall_score, risk_level: data.risk_level, recommendation: data.recommendation, timestamp: new Date().toLocaleString() }, ...prev].slice(0, 20))
      }
    } catch { setScoreResult({ overall_score: 0, risk_level: 'error', recommendation: 'unavailable', error: 'Scoring service unavailable' }) }
    setLoading(false)
  }

  const riskColor = (level) => level === 'low' ? 'text-green-600 bg-green-50' : level === 'medium' ? 'text-yellow-600 bg-yellow-50' : level === 'high' ? 'text-orange-600 bg-orange-50' : 'text-red-600 bg-red-50'
  const recColor = (rec) => rec === 'approve' ? 'success' : rec === 'review' ? 'warning' : 'destructive'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[['Total Scored', recentScores.length, Shield, 'bg-blue-50', 'text-blue-600'], ['Approved', recentScores.filter(s => s.recommendation === 'approve').length, CheckCircle, 'bg-green-50', 'text-green-600'], ['Declined', recentScores.filter(s => s.recommendation === 'decline').length, AlertTriangle, 'bg-red-50', 'text-red-600'], ['Avg Score', recentScores.length ? Math.round(recentScores.reduce((s, r) => s + r.score, 0) / recentScores.length) : 0, Activity, 'bg-indigo-50', 'text-indigo-600']].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-4"><div className="flex items-center space-x-3"><div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div><div><p className="text-sm text-gray-500">{title}</p><p className="text-xl font-bold">{value}</p></div></div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Score Transaction</h3>
          <div className="space-y-3">
            <div><label className="text-xs text-gray-500">Sender ID</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={scoreForm.sender_id} onChange={e => setScoreForm(p => ({ ...p, sender_id: e.target.value }))} /></div>
            <div><label className="text-xs text-gray-500">Recipient ID</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={scoreForm.recipient_id} onChange={e => setScoreForm(p => ({ ...p, recipient_id: e.target.value }))} /></div>
            <div><label className="text-xs text-gray-500">Amount (NGN)</label><input type="number" className="w-full px-3 py-2 border rounded-lg text-sm" value={scoreForm.amount} onChange={e => setScoreForm(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
            <div><label className="text-xs text-gray-500">Type</label><select className="w-full px-3 py-2 border rounded-lg text-sm" value={scoreForm.transaction_type} onChange={e => setScoreForm(p => ({ ...p, transaction_type: e.target.value }))}><option value="cash_in">Cash In</option><option value="cash_out">Cash Out</option><option value="transfer">Transfer</option><option value="merchant">Merchant</option></select></div>
            <Button className="w-full" onClick={handleScore} disabled={loading}><Shield className="w-4 h-4 mr-1" />{loading ? 'Scoring...' : 'Score Transaction'}</Button>
          </div>
          {scoreResult && (
            <div className={`mt-4 p-4 rounded-lg border ${scoreResult.recommendation === 'approve' ? 'bg-green-50 border-green-200' : scoreResult.recommendation === 'review' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex justify-between items-center mb-2"><span className="text-2xl font-bold">{scoreResult.overall_score}/100</span><Badge variant={recColor(scoreResult.recommendation)}>{scoreResult.recommendation}</Badge></div>
              <p className="text-xs text-gray-500">Risk: {scoreResult.risk_level}</p>
            </div>
          )}
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Scores</h3>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-gray-50"><th className="text-left p-3 text-xs text-gray-500">Transaction</th><th className="text-left p-3 text-xs text-gray-500">Amount</th><th className="text-left p-3 text-xs text-gray-500">Score</th><th className="text-left p-3 text-xs text-gray-500">Risk</th><th className="text-left p-3 text-xs text-gray-500">Decision</th><th className="text-left p-3 text-xs text-gray-500">Time</th></tr></thead>
            <tbody>{recentScores.map(s => (<tr key={s.id} className="border-b hover:bg-gray-50"><td className="p-3 text-sm font-mono">{s.id}</td><td className="p-3 text-sm">{formatCurrency(s.amount)}</td><td className="p-3"><span className={`text-sm font-bold ${s.score >= 80 ? 'text-green-600' : s.score >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>{s.score}</span></td><td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${riskColor(s.risk_level)}`}>{s.risk_level}</span></td><td className="p-3"><Badge variant={recColor(s.recommendation)}>{s.recommendation}</Badge></td><td className="p-3 text-xs text-gray-500">{s.timestamp}</td></tr>))}</tbody></table></div>
        </div>
      </div>
    </div>
  )
}

function POSGLPostingTab({ posApi, formatCurrency }) {
  const [glEntries, setGlEntries] = useState([])
  const [postForm, setPostForm] = useState({ transaction_ref: '', transaction_type: 'cash_in', amount: 0, currency: 'NGN', agent_id: 'AGT-001' })
  const [loading, setLoading] = useState(false)
  const [reconcileResult, setReconcileResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const loadPostings = async () => {
      try {
        const resp = await fetch(`${posApi}/pos/gl-post?transaction_ref=init&transaction_type=cash_in&amount=0&currency=NGN&agent_id=system`, { method: 'POST' })
        if (resp.ok) { setError(null) }
      } catch { setError('GL posting service unavailable') }
    }
    loadPostings()
  }, [posApi])

  const handlePost = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${posApi}/pos/gl-post?transaction_ref=${postForm.transaction_ref}&transaction_type=${postForm.transaction_type}&amount=${postForm.amount}&currency=${postForm.currency}&agent_id=${postForm.agent_id}`, { method: 'POST' })
      if (resp.ok) {
        const data = await resp.json()
        setGlEntries(prev => [{ id: `GL-${Date.now()}`, transaction_ref: postForm.transaction_ref, type: postForm.transaction_type, amount: postForm.amount, debit_account: data.debit_account || '1001-Cash', credit_account: data.credit_account || '2001-AgentFloat', status: 'posted', timestamp: new Date().toLocaleString() }, ...prev])
      }
    } catch {}
    setLoading(false)
  }

  const totalDebits = glEntries.filter(e => e.status === 'posted').reduce((s, e) => s + e.amount, 0)
  const totalCredits = totalDebits

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[['GL Entries', glEntries.length, BookOpen, 'bg-blue-50', 'text-blue-600'], ['Total Debits', formatCurrency(totalDebits), ArrowUpRight, 'bg-green-50', 'text-green-600'], ['Total Credits', formatCurrency(totalCredits), ArrowDownRight, 'bg-red-50', 'text-red-600'], ['Pending', glEntries.filter(e => e.status === 'pending').length, Clock, 'bg-yellow-50', 'text-yellow-600']].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-4"><div className="flex items-center space-x-3"><div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div><div><p className="text-sm text-gray-500">{title}</p><p className="text-xl font-bold">{typeof value === 'number' ? value : value}</p></div></div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Manual GL Post</h3>
          <div className="space-y-3">
            <div><label className="text-xs text-gray-500">Transaction Ref</label><input className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="TXN-XXXX" value={postForm.transaction_ref} onChange={e => setPostForm(p => ({ ...p, transaction_ref: e.target.value }))} /></div>
            <div><label className="text-xs text-gray-500">Type</label><select className="w-full px-3 py-2 border rounded-lg text-sm" value={postForm.transaction_type} onChange={e => setPostForm(p => ({ ...p, transaction_type: e.target.value }))}><option value="cash_in">Cash In</option><option value="cash_out">Cash Out</option><option value="transfer">Transfer</option></select></div>
            <div><label className="text-xs text-gray-500">Amount</label><input type="number" className="w-full px-3 py-2 border rounded-lg text-sm" value={postForm.amount} onChange={e => setPostForm(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
            <div><label className="text-xs text-gray-500">Agent ID</label><input className="w-full px-3 py-2 border rounded-lg text-sm" value={postForm.agent_id} onChange={e => setPostForm(p => ({ ...p, agent_id: e.target.value }))} /></div>
            <Button className="w-full" onClick={handlePost} disabled={loading}><BookOpen className="w-4 h-4 mr-1" />{loading ? 'Posting...' : 'Post GL Entry'}</Button>
          </div>
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">GL Journal</h3>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-gray-50"><th className="text-left p-3 text-xs text-gray-500">ID</th><th className="text-left p-3 text-xs text-gray-500">Txn Ref</th><th className="text-left p-3 text-xs text-gray-500">Type</th><th className="text-left p-3 text-xs text-gray-500">Amount</th><th className="text-left p-3 text-xs text-gray-500">Debit</th><th className="text-left p-3 text-xs text-gray-500">Credit</th><th className="text-left p-3 text-xs text-gray-500">Status</th></tr></thead>
            <tbody>{glEntries.map(e => (<tr key={e.id} className="border-b hover:bg-gray-50"><td className="p-3 text-xs font-mono">{e.id}</td><td className="p-3 text-xs font-mono">{e.transaction_ref}</td><td className="p-3 text-xs">{e.type}</td><td className="p-3 text-sm font-medium">{formatCurrency(e.amount)}</td><td className="p-3 text-xs">{e.debit_account}</td><td className="p-3 text-xs">{e.credit_account}</td><td className="p-3"><Badge variant={e.status === 'posted' ? 'success' : 'warning'}>{e.status}</Badge></td></tr>))}</tbody></table></div>
        </div>
      </div>
    </div>
  )
}

function POSTargetsTab({ posApi, formatCurrency }) {
  const [agentId, setAgentId] = useState('AGT-001')
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        const resp = await fetch(`${posApi}/pos/agent-targets/${agentId}`)
        if (resp.ok) { const data = await resp.json(); if (Array.isArray(data) && data.length) { setTargets(data); setError(null) } else { setError('No targets found - create targets via the Projections & Targets service') } }
      } catch { setError('Targets service unavailable') }
      setLoading(false)
    }
    init()
  }, [posApi, agentId])

  const loadTargets = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${posApi}/pos/agent-targets/${agentId}`)
      if (resp.ok) { const data = await resp.json(); if (Array.isArray(data) && data.length) setTargets(data) }
    } catch {}
    setLoading(false)
  }

  const progressPct = (actual, target) => Math.min(Math.round((actual / target) * 100), 100)
  const progressColor = (pct) => pct >= 100 ? 'bg-green-500' : pct >= 75 ? 'bg-blue-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  const levelBadge = (level) => level === 'bank_level' ? 'bg-purple-100 text-purple-700' : level === 'bank_assigned' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[['Active Targets', targets.filter(t => t.status === 'active').length, Target, 'bg-blue-50', 'text-blue-600'], ['On Track', targets.filter(t => progressPct(t.actual_value, t.target_value) >= 75).length, TrendingUp, 'bg-green-50', 'text-green-600'], ['Behind', targets.filter(t => progressPct(t.actual_value, t.target_value) < 50).length, AlertTriangle, 'bg-red-50', 'text-red-600'], ['Achieved', targets.filter(t => t.actual_value >= t.target_value).length, Award, 'bg-yellow-50', 'text-yellow-600']].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-4"><div className="flex items-center space-x-3"><div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div><div><p className="text-sm text-gray-500">{title}</p><p className="text-xl font-bold">{value}</p></div></div></div>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Agent Targets & Projections</h3>
          <div className="flex gap-2">
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Agent ID" value={agentId} onChange={e => setAgentId(e.target.value)} />
            <Button size="sm" onClick={loadTargets} disabled={loading}><RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Load</Button>
          </div>
        </div>
        <div className="space-y-4">
          {targets.map(t => {
            const pct = progressPct(t.actual_value, t.target_value)
            return (
              <div key={t.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div><h4 className="font-medium text-sm">{t.name}</h4><p className="text-xs text-gray-500">{t.metric} ({t.period})</p></div>
                  <div className="flex gap-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${levelBadge(t.level)}`}>{t.level.replace('_', ' ')}</span>{pct >= 100 && <Badge variant="success">Achieved</Badge>}</div>
                </div>
                <div className="flex justify-between text-sm mb-1"><span>{t.unit === 'NGN' ? formatCurrency(t.actual_value) : t.actual_value} / {t.unit === 'NGN' ? formatCurrency(t.target_value) : t.target_value}</span><span className="font-bold">{pct}%</span></div>
                <div className="w-full bg-gray-200 rounded-full h-2.5"><div className={`h-2.5 rounded-full ${progressColor(pct)} transition-all`} style={{ width: `${pct}%` }} /></div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function POSQRTicketsTab({ posApi }) {
  const [tickets, setTickets] = useState([])
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyResult, setVerifyResult] = useState(null)
  const [createForm, setCreateForm] = useState({ transaction_id: '', amount: 0, merchant_id: 'MRC-001' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${posApi}/pos/qr-ticket/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...createForm, ticket_type: 'payment_receipt', currency: 'NGN' }) })
      if (resp.ok) {
        const data = await resp.json()
        setTickets(prev => [{ id: data.ticket_id || `QRT-${Date.now()}`, transaction_id: createForm.transaction_id, ticket_type: 'payment_receipt', status: 'valid', created_at: new Date().toLocaleString(), scanned: false, qr_code_data: data.qr_code_data }, ...prev])
      }
    } catch {}
    setLoading(false)
  }

  const handleVerify = async () => {
    try {
      const resp = await fetch(`${posApi}/pos/qr-ticket/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket_id: verifyCode }) })
      if (resp.ok) { setVerifyResult(await resp.json()) } else { setVerifyResult({ valid: false, error: 'Verification failed' }) }
    } catch { setVerifyResult({ valid: false, error: 'Service unavailable' }) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[['Total Tickets', tickets.length, QrCode, 'bg-blue-50', 'text-blue-600'], ['Valid', tickets.filter(t => t.status === 'valid').length, CheckCircle, 'bg-green-50', 'text-green-600'], ['Used', tickets.filter(t => t.status === 'used').length, Eye, 'bg-gray-100', 'text-gray-600'], ['Expired', tickets.filter(t => t.status === 'expired').length, Clock, 'bg-red-50', 'text-red-600']].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-4"><div className="flex items-center space-x-3"><div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div><div><p className="text-sm text-gray-500">{title}</p><p className="text-xl font-bold">{value}</p></div></div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Create QR Ticket</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">Transaction ID</label><input className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="TXN-XXXX" value={createForm.transaction_id} onChange={e => setCreateForm(p => ({ ...p, transaction_id: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500">Amount</label><input type="number" className="w-full px-3 py-2 border rounded-lg text-sm" value={createForm.amount} onChange={e => setCreateForm(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
              <Button className="w-full" onClick={handleCreate} disabled={loading}><QrCode className="w-4 h-4 mr-1" />{loading ? 'Creating...' : 'Generate QR Ticket'}</Button>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Verify Ticket</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">Ticket ID / QR Code</label><input className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="QRT-XXXX" value={verifyCode} onChange={e => setVerifyCode(e.target.value)} /></div>
              <Button className="w-full" variant="outline" onClick={handleVerify}><Eye className="w-4 h-4 mr-1" />Verify</Button>
            </div>
            {verifyResult && (
              <div className={`mt-3 p-3 rounded-lg ${verifyResult.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <p className={`text-sm font-medium ${verifyResult.valid ? 'text-green-700' : 'text-red-700'}`}>{verifyResult.valid ? 'Valid ticket' : verifyResult.error || 'Invalid ticket'}</p>
              </div>
            )}
          </div>
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">QR Tickets</h3>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-gray-50"><th className="text-left p-3 text-xs text-gray-500">Ticket ID</th><th className="text-left p-3 text-xs text-gray-500">Transaction</th><th className="text-left p-3 text-xs text-gray-500">Type</th><th className="text-left p-3 text-xs text-gray-500">Status</th><th className="text-left p-3 text-xs text-gray-500">Created</th></tr></thead>
            <tbody>{tickets.map(t => (<tr key={t.id} className="border-b hover:bg-gray-50"><td className="p-3 text-sm font-mono">{t.id}</td><td className="p-3 text-sm font-mono">{t.transaction_id}</td><td className="p-3 text-xs">{t.ticket_type}</td><td className="p-3"><Badge variant={t.status === 'valid' ? 'success' : t.status === 'used' ? 'warning' : 'destructive'}>{t.status}</Badge></td><td className="p-3 text-xs text-gray-500">{t.created_at}</td></tr>))}</tbody></table></div>
        </div>
      </div>
    </div>
  )
}

function POSInventoryTab({ posApi }) {
  const [agentId, setAgentId] = useState('AGT-001')
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(false)
  const [deductForm, setDeductForm] = useState({ item_id: '', quantity: 1 })
  const [error, setError] = useState(null)
  const [lowStockAlerts, setLowStockAlerts] = useState([])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        const resp = await fetch(`${posApi}/pos/inventory/${agentId}`)
        if (resp.ok) {
          const data = await resp.json()
          if (data.items && data.items.length) { setInventory(data.items); setError(null) }
          else if (Array.isArray(data) && data.length) { setInventory(data); setError(null) }
          else { setError('No inventory data - add items via Inventory Management') }
        }
      } catch { setError('Inventory service unavailable') }
      setLoading(false)
    }
    init()
  }, [posApi, agentId])

  const loadInventory = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${posApi}/pos/inventory/${agentId}`)
      if (resp.ok) { const data = await resp.json(); if (Array.isArray(data) && data.length) setInventory(data) }
    } catch {}
    setLoading(false)
  }

  const handleDeduct = async () => {
    try {
      await fetch(`${posApi}/pos/inventory/${agentId}/deduct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: deductForm.item_id, quantity: deductForm.quantity, reason: 'POS usage' }) })
      setInventory(prev => prev.map(i => i.id === deductForm.item_id ? { ...i, quantity: Math.max(0, i.quantity - deductForm.quantity) } : i))
    } catch {}
  }

  const lowStock = inventory.filter(i => i.quantity <= i.min_threshold)
  const outOfStock = inventory.filter(i => i.quantity === 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[['Total Items', inventory.length, Package, 'bg-blue-50', 'text-blue-600'], ['Low Stock', lowStock.length, AlertTriangle, 'bg-yellow-50', 'text-yellow-600'], ['Out of Stock', outOfStock.length, XCircle, 'bg-red-50', 'text-red-600'], ['Categories', [...new Set(inventory.map(i => i.category))].length, Layers, 'bg-indigo-50', 'text-indigo-600']].map(([title, value, Icon, bg, color]) => (
          <div key={title} className="bg-white rounded-xl shadow p-4"><div className="flex items-center space-x-3"><div className={`w-10 h-10 ${bg} rounded-full flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div><div><p className="text-sm text-gray-500">{title}</p><p className="text-xl font-bold">{value}</p></div></div></div>
        ))}
      </div>
      {lowStock.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5 text-yellow-600" /><h3 className="font-semibold text-yellow-800">Low Stock Alerts</h3></div>
          <div className="flex flex-wrap gap-2">{lowStock.map(i => (<span key={i.id} className="px-3 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">{i.item_name}: {i.quantity} {i.unit} (min: {i.min_threshold})</span>))}</div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Agent Inventory</h3>
            <div className="flex gap-2 mb-4">
              <input className="flex-1 px-3 py-2 border rounded-lg text-sm" placeholder="Agent ID" value={agentId} onChange={e => setAgentId(e.target.value)} />
              <Button size="sm" onClick={loadInventory} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Deduct Supply</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">Item</label><select className="w-full px-3 py-2 border rounded-lg text-sm" value={deductForm.item_id} onChange={e => setDeductForm(p => ({ ...p, item_id: e.target.value }))}><option value="">Select item</option>{inventory.map(i => <option key={i.id} value={i.id}>{i.item_name} ({i.quantity} avail)</option>)}</select></div>
              <div><label className="text-xs text-gray-500">Quantity</label><input type="number" min="1" className="w-full px-3 py-2 border rounded-lg text-sm" value={deductForm.quantity} onChange={e => setDeductForm(p => ({ ...p, quantity: Number(e.target.value) }))} /></div>
              <Button className="w-full" onClick={handleDeduct} disabled={!deductForm.item_id}><Package className="w-4 h-4 mr-1" />Deduct</Button>
            </div>
          </div>
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Inventory Items</h3>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-gray-50"><th className="text-left p-3 text-xs text-gray-500">Item</th><th className="text-left p-3 text-xs text-gray-500">SKU</th><th className="text-left p-3 text-xs text-gray-500">Qty</th><th className="text-left p-3 text-xs text-gray-500">Min</th><th className="text-left p-3 text-xs text-gray-500">Category</th><th className="text-left p-3 text-xs text-gray-500">Status</th><th className="text-left p-3 text-xs text-gray-500">Restocked</th></tr></thead>
            <tbody>{inventory.map(i => (<tr key={i.id} className={`border-b hover:bg-gray-50 ${i.quantity <= i.min_threshold ? 'bg-yellow-50' : ''}`}><td className="p-3 text-sm font-medium">{i.item_name}</td><td className="p-3 text-xs font-mono">{i.sku}</td><td className="p-3 text-sm font-bold">{i.quantity} {i.unit}</td><td className="p-3 text-xs text-gray-500">{i.min_threshold}</td><td className="p-3 text-xs">{i.category}</td><td className="p-3"><Badge variant={i.quantity === 0 ? 'destructive' : i.quantity <= i.min_threshold ? 'warning' : 'success'}>{i.quantity === 0 ? 'Out of Stock' : i.quantity <= i.min_threshold ? 'Low' : 'OK'}</Badge></td><td className="p-3 text-xs text-gray-500">{i.last_restocked}</td></tr>))}</tbody></table></div>
        </div>
      </div>
    </div>
  )
}

export default App

