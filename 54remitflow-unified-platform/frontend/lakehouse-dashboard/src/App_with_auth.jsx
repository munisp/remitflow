import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Database, TrendingUp, ShoppingCart, Package, Shield, Activity, Lock, LogOut, User as UserIcon } from 'lucide-react'
import './App.css'

function App() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [accessToken, setAccessToken] = useState(null)
  const [refreshToken, setRefreshToken] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  
  // Login form state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  // Dashboard state
  const [lakehouseStats, setLakehouseStats] = useState(null)

  // Check for existing token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('access_token')
    const storedRefreshToken = localStorage.getItem('refresh_token')
    const storedUser = localStorage.getItem('current_user')
    
    if (storedToken && storedUser) {
      setAccessToken(storedToken)
      setRefreshToken(storedRefreshToken)
      setCurrentUser(JSON.parse(storedUser))
      setIsAuthenticated(true)
    }
  }, [])

  // Fetch lakehouse stats when authenticated
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      fetchLakehouseStats()
      
      // Auto-refresh every 30 seconds
      const interval = setInterval(fetchLakehouseStats, 30000)
      return () => clearInterval(interval)
    }
  }, [isAuthenticated, accessToken])

  // Login function
  const handleLogin = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setLoginError('')

    try {
      const response = await fetch('http://localhost:8070/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password })
      })

      if (response.ok) {
        const data = await response.json()
        
        // Store tokens and user info
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('current_user', JSON.stringify(data.user))
        
        // Update state
        setAccessToken(data.access_token)
        setRefreshToken(data.refresh_token)
        setCurrentUser(data.user)
        setIsAuthenticated(true)
        
        // Clear form
        setUsername('')
        setPassword('')
      } else {
        const error = await response.json()
        setLoginError(error.detail || 'Login failed')
      }
    } catch (error) {
      setLoginError('Network error. Please try again.')
      console.error('Login error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Logout function
  const handleLogout = () => {
    // Clear storage
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('current_user')
    
    // Clear state
    setAccessToken(null)
    setRefreshToken(null)
    setCurrentUser(null)
    setIsAuthenticated(false)
    setLakehouseStats(null)
  }

  // Fetch lakehouse stats with authentication
  const fetchLakehouseStats = async () => {
    try {
      const response = await fetch('http://localhost:8070/analytics/summary', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setLakehouseStats(data)
      } else if (response.status === 401) {
        // Token expired, try to refresh
        await refreshAccessToken()
      } else {
        console.warn('Failed to fetch lakehouse stats')
      }
    } catch (error) {
      console.error('Error fetching lakehouse stats:', error)
    }
  }

  // Refresh access token
  const refreshAccessToken = async () => {
    try {
      const response = await fetch('http://localhost:8070/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      })

      if (response.ok) {
        const data = await response.json()
        
        // Update tokens
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        
        setAccessToken(data.access_token)
        setRefreshToken(data.refresh_token)
        
        // Retry fetching stats
        fetchLakehouseStats()
      } else {
        // Refresh failed, logout
        handleLogout()
      }
    } catch (error) {
      console.error('Error refreshing token:', error)
      handleLogout()
    }
  }

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-3 rounded-lg">
                <Database className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl text-center">Lakehouse Dashboard</CardTitle>
            <CardDescription className="text-center">
              Sign in to access the data lakehouse
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              
              {loginError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                  {loginError}
                </div>
              )}
              
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
            
            <div className="mt-6 p-4 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-600 font-semibold mb-2">Demo Credentials:</p>
              <div className="space-y-1 text-xs text-slate-600">
                <p>• <strong>admin</strong> / admin123 (full access)</p>
                <p>• <strong>data_engineer</strong> / engineer123 (create tables)</p>
                <p>• <strong>analyst</strong> / analyst123 (read analytics)</p>
                <p>• <strong>viewer</strong> / viewer123 (view catalog)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Dashboard screen (authenticated)
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-2 rounded-lg">
                <Database className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Lakehouse Dashboard</h1>
                <p className="text-sm text-slate-500">Authenticated Session</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Lock className="w-3 h-3 mr-1" />
                Secured
              </Badge>
              <div className="flex items-center space-x-2 px-3 py-2 bg-slate-50 rounded-lg">
                <UserIcon className="w-4 h-4 text-slate-600" />
                <div className="text-sm">
                  <div className="font-medium text-slate-900">{currentUser?.username}</div>
                  <div className="text-xs text-slate-500 capitalize">{currentUser?.role}</div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Tables</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-slate-900">{lakehouseStats?.total_tables || 0}</div>
                <Database className="w-8 h-8 text-blue-500" />
              </div>
              <p className="text-xs text-slate-500 mt-2">Across 4 domains</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Rows</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-slate-900">
                  {lakehouseStats ? (lakehouseStats.total_rows / 1000000).toFixed(1) + 'M' : '0'}
                </div>
                <Activity className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-xs text-slate-500 mt-2">12.5 million records</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Your Role</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-slate-900 capitalize">{currentUser?.role}</div>
                <Shield className="w-8 h-8 text-purple-500" />
              </div>
              <p className="text-xs text-slate-500 mt-2">Access level</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-green-600">Active</div>
                <Activity className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-xs text-slate-500 mt-2">Real-time updates</p>
            </CardContent>
          </Card>
        </div>

        {/* Domain Cards */}
        {lakehouseStats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(lakehouseStats.domains).map(([domain, data]) => {
              const icons = {
                agency_banking: TrendingUp,
                ecommerce: ShoppingCart,
                inventory: Package,
                security: Shield
              }
              const Icon = icons[domain]
              
              return (
                <Card key={domain}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base capitalize">{domain.replace('_', ' ')}</CardTitle>
                      <Icon className="w-5 h-5 text-slate-600" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Tables:</span>
                        <span className="font-semibold">{data.table_count}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Rows:</span>
                        <span className="font-semibold">{(data.row_count / 1000000).toFixed(1)}M</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default App

