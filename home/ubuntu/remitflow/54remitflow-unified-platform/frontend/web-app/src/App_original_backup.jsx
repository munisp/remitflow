import { useState, useEffect } from 'react'
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
  Calendar, MessageSquare, HelpCircle, LogOut, Menu, X
} from 'lucide-react'
import './App.css'

// Mock data for demonstration
const mockTransactions = [
  { id: 1, type: 'deposit', amount: 5000, customer: 'John Doe', date: '2024-10-07', status: 'completed' },
  { id: 2, type: 'withdrawal', amount: 2500, customer: 'Jane Smith', date: '2024-10-07', status: 'pending' },
  { id: 3, type: 'transfer', amount: 1200, customer: 'Mike Johnson', date: '2024-10-06', status: 'completed' },
  { id: 4, type: 'deposit', amount: 8000, customer: 'Sarah Wilson', date: '2024-10-06', status: 'completed' },
]

const mockCustomers = [
  { id: 1, name: 'John Doe', phone: '+234-801-234-5678', balance: 15000, status: 'active', kyc: 'verified' },
  { id: 2, name: 'Jane Smith', phone: '+234-802-345-6789', balance: 8500, status: 'active', kyc: 'pending' },
  { id: 3, name: 'Mike Johnson', phone: '+234-803-456-7890', balance: 22000, status: 'active', kyc: 'verified' },
  { id: 4, name: 'Sarah Wilson', phone: '+234-804-567-8901', balance: 5200, status: 'suspended', kyc: 'rejected' },
]

const chartData = [
  { name: 'Jan', deposits: 45000, withdrawals: 32000, transfers: 18000 },
  { name: 'Feb', deposits: 52000, withdrawals: 38000, transfers: 22000 },
  { name: 'Mar', deposits: 48000, withdrawals: 35000, transfers: 25000 },
  { name: 'Apr', deposits: 61000, withdrawals: 42000, transfers: 28000 },
  { name: 'May', deposits: 55000, withdrawals: 39000, transfers: 31000 },
  { name: 'Jun', deposits: 67000, withdrawals: 45000, transfers: 35000 },
]

const pieData = [
  { name: 'Deposits', value: 45, color: '#0088FE' },
  { name: 'Withdrawals', value: 30, color: '#00C49F' },
  { name: 'Transfers', value: 25, color: '#FFBB28' },
]

function LoginPage({ onLogin }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    // Simulate API call
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
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <Button 
                type="submit" 
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                disabled={isLoading}
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4 mr-2" />
                )}
                {isLoading ? 'Signing In...' : 'Sign In'}
              </Button>
            </form>
            <div className="text-center text-sm text-gray-600">
              Demo credentials: any username/password
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}

function Dashboard({ user }) {
  const [selectedTab, setSelectedTab] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const stats = [
    { title: 'Total Balance', value: '₦2,450,000', change: '+12%', icon: DollarSign, color: 'text-green-600' },
    { title: 'Today\'s Transactions', value: '47', change: '+8%', icon: Activity, color: 'text-blue-600' },
    { title: 'Active Customers', value: '234', change: '+15%', icon: Users, color: 'text-purple-600' },
    { title: 'Commission Earned', value: '₦45,600', change: '+22%', icon: TrendingUp, color: 'text-orange-600' },
  ]

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <motion.div
        initial={false}
        animate={{ width: sidebarOpen ? 280 : 80 }}
        className="bg-white shadow-lg border-r border-gray-200 flex flex-col"
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <motion.div
              animate={{ opacity: sidebarOpen ? 1 : 0 }}
              className="flex items-center space-x-3"
            >
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <Building className="w-6 h-6 text-white" />
              </div>
              {sidebarOpen && (
                <div>
                  <h1 className="text-lg font-bold text-gray-900">Remittance Platform</h1>
                  <p className="text-sm text-gray-500">Platform</p>
                </div>
              )}
            </motion.div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'transactions', label: 'Transactions', icon: Receipt },
            { id: 'customers', label: 'Customers', icon: Users },
            { id: 'analytics', label: 'Analytics', icon: PieChartIcon },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((item) => (
            <Button
              key={item.id}
              variant={selectedTab === item.id ? 'default' : 'ghost'}
              className={`w-full justify-start ${!sidebarOpen && 'px-3'}`}
              onClick={() => setSelectedTab(item.id)}
            >
              <item.icon className="w-4 h-4" />
              {sidebarOpen && <span className="ml-3">{item.label}</span>}
            </Button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center space-x-3">
            <Avatar>
              <AvatarFallback className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                {user.name.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                <p className="text-xs text-gray-500 truncate">{user.tier}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 capitalize">{selectedTab}</h2>
              <p className="text-gray-600">Welcome back, {user.name}</p>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" size="sm">
                <Bell className="w-4 h-4 mr-2" />
                Notifications
              </Button>
              <Button variant="outline" size="sm">
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              {selectedTab === 'overview' && <OverviewTab stats={stats} />}
              {selectedTab === 'transactions' && <TransactionsTab />}
              {selectedTab === 'customers' && <CustomersTab />}
              {selectedTab === 'analytics' && <AnalyticsTab />}
              {selectedTab === 'security' && <SecurityTab />}
              {selectedTab === 'settings' && <SettingsTab />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

function OverviewTab({ stats }) {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                    <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                    <p className={`text-sm ${stat.color} flex items-center mt-1`}>
                      <ArrowUpRight className="w-4 h-4 mr-1" />
                      {stat.change}
                    </p>
                  </div>
                  <div className={`p-3 rounded-full bg-gray-100`}>
                    <stat.icon className={`w-6 h-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Transaction Volume</CardTitle>
            <CardDescription>Monthly transaction trends</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="deposits" stackId="1" stroke="#0088FE" fill="#0088FE" fillOpacity={0.6} />
                <Area type="monotone" dataKey="withdrawals" stackId="1" stroke="#00C49F" fill="#00C49F" fillOpacity={0.6} />
                <Area type="monotone" dataKey="transfers" stackId="1" stroke="#FFBB28" fill="#FFBB28" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transaction Distribution</CardTitle>
            <CardDescription>Breakdown by transaction type</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center space-x-6 mt-4">
              {pieData.map((entry) => (
                <div key={entry.name} className="flex items-center">
                  <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
                  <span className="text-sm text-gray-600">{entry.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>Latest customer transactions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockTransactions.slice(0, 5).map((transaction) => (
              <div key={transaction.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className={`p-2 rounded-full ${
                    transaction.type === 'deposit' ? 'bg-green-100 text-green-600' :
                    transaction.type === 'withdrawal' ? 'bg-red-100 text-red-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>
                    {transaction.type === 'deposit' ? <ArrowDownRight className="w-4 h-4" /> :
                     transaction.type === 'withdrawal' ? <ArrowUpRight className="w-4 h-4" /> :
                     <RefreshCw className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-medium">{transaction.customer}</p>
                    <p className="text-sm text-gray-500 capitalize">{transaction.type}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">₦{transaction.amount.toLocaleString()}</p>
                  <Badge variant={transaction.status === 'completed' ? 'default' : 'secondary'}>
                    {transaction.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function TransactionsTab() {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  const filteredTransactions = mockTransactions.filter(transaction => {
    const matchesSearch = transaction.customer.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesFilter = filterStatus === 'all' || transaction.status === filterStatus
    return matchesSearch && matchesFilter
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex gap-4 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button size="sm">
            <Plus className="w-4 h-4 mr-2" />
            New Transaction
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium text-gray-900">Customer</th>
                  <th className="text-left p-4 font-medium text-gray-900">Type</th>
                  <th className="text-left p-4 font-medium text-gray-900">Amount</th>
                  <th className="text-left p-4 font-medium text-gray-900">Date</th>
                  <th className="text-left p-4 font-medium text-gray-900">Status</th>
                  <th className="text-left p-4 font-medium text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((transaction) => (
                  <tr key={transaction.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <div className="flex items-center space-x-3">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-xs">
                            {transaction.customer.split(' ').map(n => n[0]).join('')}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{transaction.customer}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant="outline" className="capitalize">
                        {transaction.type}
                      </Badge>
                    </td>
                    <td className="p-4 font-medium">₦{transaction.amount.toLocaleString()}</td>
                    <td className="p-4 text-gray-600">{transaction.date}</td>
                    <td className="p-4">
                      <Badge variant={transaction.status === 'completed' ? 'default' : 
                                   transaction.status === 'pending' ? 'secondary' : 'destructive'}>
                        {transaction.status}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex space-x-2">
                        <Button variant="ghost" size="sm">
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function CustomersTab() {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredCustomers = mockCustomers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone.includes(searchTerm)
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search customers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Customer
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCustomers.map((customer) => (
          <motion.div
            key={customer.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Avatar className="w-12 h-12">
                    <AvatarFallback className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                      {customer.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <Badge variant={customer.status === 'active' ? 'default' : 'destructive'}>
                    {customer.status}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-lg">{customer.name}</h3>
                  <p className="text-gray-600 flex items-center">
                    <Phone className="w-4 h-4 mr-2" />
                    {customer.phone}
                  </p>
                  <p className="text-lg font-bold text-green-600">
                    ₦{customer.balance.toLocaleString()}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">KYC Status:</span>
                    <Badge variant={customer.kyc === 'verified' ? 'default' : 
                                  customer.kyc === 'pending' ? 'secondary' : 'destructive'}>
                      {customer.kyc}
                    </Badge>
                  </div>
                </div>
                <div className="flex space-x-2 mt-4">
                  <Button variant="outline" size="sm" className="flex-1">
                    <Eye className="w-4 h-4 mr-2" />
                    View
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1">
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function AnalyticsTab() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Revenue Trend</CardTitle>
            <CardDescription>Revenue growth over the past 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="deposits" stroke="#0088FE" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transaction Comparison</CardTitle>
            <CardDescription>Deposits vs Withdrawals vs Transfers</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="deposits" fill="#0088FE" />
                <Bar dataKey="withdrawals" fill="#00C49F" />
                <Bar dataKey="transfers" fill="#FFBB28" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-600">Transaction Success Rate</span>
                <span className="text-sm font-medium">98.5%</span>
              </div>
              <Progress value={98.5} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-600">Customer Satisfaction</span>
                <span className="text-sm font-medium">94.2%</span>
              </div>
              <Progress value={94.2} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-600">System Uptime</span>
                <span className="text-sm font-medium">99.9%</span>
              </div>
              <Progress value={99.9} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Performing Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { name: 'Agent Smith', transactions: 156, commission: '₦12,400' },
                { name: 'Agent Johnson', transactions: 142, commission: '₦11,200' },
                { name: 'Agent Williams', transactions: 128, commission: '₦9,800' },
              ].map((agent, index) => (
                <div key={agent.name} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-sm text-gray-500">{agent.transactions} transactions</p>
                    </div>
                  </div>
                  <span className="font-medium text-green-600">{agent.commission}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { service: 'API Gateway', status: 'healthy', uptime: '99.9%' },
                { service: 'Database', status: 'healthy', uptime: '99.8%' },
                { service: 'Payment Service', status: 'warning', uptime: '98.5%' },
                { service: 'Notification Service', status: 'healthy', uptime: '99.7%' },
              ].map((service) => (
                <div key={service.service} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      service.status === 'healthy' ? 'bg-green-500' : 
                      service.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <span className="text-sm">{service.service}</span>
                  </div>
                  <span className="text-sm text-gray-600">{service.uptime}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SecurityTab() {
  const [mfaEnabled, setMfaEnabled] = useState(true)
  const [notifications, setNotifications] = useState(true)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>Manage your account security preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Two-Factor Authentication</h4>
                <p className="text-sm text-gray-600">Add an extra layer of security to your account</p>
              </div>
              <Button
                variant={mfaEnabled ? "default" : "outline"}
                onClick={() => setMfaEnabled(!mfaEnabled)}
              >
                {mfaEnabled ? <Lock className="w-4 h-4 mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
                {mfaEnabled ? 'Enabled' : 'Disabled'}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Security Notifications</h4>
                <p className="text-sm text-gray-600">Get notified of security events</p>
              </div>
              <Button
                variant={notifications ? "default" : "outline"}
                onClick={() => setNotifications(!notifications)}
              >
                {notifications ? <Bell className="w-4 h-4 mr-2" /> : <Bell className="w-4 h-4 mr-2" />}
                {notifications ? 'On' : 'Off'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Security Events</CardTitle>
            <CardDescription>Monitor your account activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { event: 'Successful login', time: '2 minutes ago', status: 'success' },
                { event: 'Password changed', time: '1 day ago', status: 'success' },
                { event: 'Failed login attempt', time: '3 days ago', status: 'warning' },
                { event: 'MFA enabled', time: '1 week ago', status: 'success' },
              ].map((event, index) => (
                <div key={index} className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    event.status === 'success' ? 'bg-green-500' : 
                    event.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{event.event}</p>
                    <p className="text-xs text-gray-500">{event.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>Manage your active login sessions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { device: 'Chrome on Windows', location: 'Lagos, Nigeria', current: true, lastActive: 'Now' },
              { device: 'Safari on iPhone', location: 'Lagos, Nigeria', current: false, lastActive: '2 hours ago' },
              { device: 'Firefox on MacOS', location: 'Abuja, Nigeria', current: false, lastActive: '1 day ago' },
            ].map((session, index) => (
              <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    {session.device.includes('iPhone') ? <Smartphone className="w-5 h-5" /> : <Laptop className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-medium">{session.device}</p>
                    <p className="text-sm text-gray-600 flex items-center">
                      <MapPin className="w-4 h-4 mr-1" />
                      {session.location}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">{session.lastActive}</p>
                  {session.current ? (
                    <Badge variant="default">Current</Badge>
                  ) : (
                    <Button variant="outline" size="sm">
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SettingsTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" defaultValue="Agent" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" defaultValue="Smith" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" defaultValue="agent.smith@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" defaultValue="+234-801-234-5678" />
            </div>
          </div>
          <Button>Save Changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
          <CardDescription>Choose what notifications you want to receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: 'Transaction Alerts', description: 'Get notified of all transactions' },
            { label: 'Security Alerts', description: 'Important security notifications' },
            { label: 'System Updates', description: 'Platform updates and maintenance' },
            { label: 'Marketing', description: 'Promotional offers and news' },
          ].map((pref) => (
            <div key={pref.label} className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">{pref.label}</h4>
                <p className="text-sm text-gray-600">{pref.description}</p>
              </div>
              <input type="checkbox" className="w-4 h-4" defaultChecked />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
          <CardDescription>Platform details and version information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-2">Platform Version</h4>
              <p className="text-sm text-gray-600">v6.0.0 - Production Ready</p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Last Updated</h4>
              <p className="text-sm text-gray-600">October 7, 2025</p>
            </div>
            <div>
              <h4 className="font-medium mb-2">API Version</h4>
              <p className="text-sm text-gray-600">v2.1.0</p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Support</h4>
              <p className="text-sm text-gray-600">24/7 Available</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)

  return (
    <Router>
      <div className="App">
        {!user ? (
          <LoginPage onLogin={setUser} />
        ) : (
          <Dashboard user={user} />
        )}
      </div>
    </Router>
  )
}

export default App
