import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { 
  MessageSquare, 
  Mail, 
  Phone, 
  TrendingUp, 
  DollarSign, 
  CheckCircle, 
  XCircle, 
  Clock,
  Activity,
  AlertCircle,
  BarChart3,
  Send
} from 'lucide-react'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import './App.css'

function App() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedChannel, setSelectedChannel] = useState('all')

  // Mock data (in production, fetch from API)
  useEffect(() => {
    // Simulate API call
    setTimeout(() => {
      setMetrics({
        total_messages: 12458,
        by_channel: {
          whatsapp: 7234,
          sms: 4128,
          ussd: 1096
        },
        by_provider: {
          africas_talking: 8456,
          twilio: 2892,
          meta_whatsapp: 1110
        },
        total_cost_usd: 124.56,
        delivery_rate: {
          whatsapp: 98.2,
          sms: 87.5,
          ussd: 99.8
        },
        circuit_breaker_status: {
          africas_talking: 'closed',
          twilio: 'closed',
          meta_whatsapp: 'half-open'
        },
        hourly_stats: [
          { hour: '00:00', whatsapp: 45, sms: 23, ussd: 12 },
          { hour: '04:00', whatsapp: 32, sms: 18, ussd: 8 },
          { hour: '08:00', whatsapp: 156, sms: 89, ussd: 34 },
          { hour: '12:00', whatsapp: 234, sms: 145, ussd: 56 },
          { hour: '16:00', whatsapp: 198, sms: 112, ussd: 45 },
          { hour: '20:00', whatsapp: 167, sms: 98, ussd: 38 }
        ]
      })
      setLoading(false)
    }, 1000)
  }, [])

  const COLORS = {
    whatsapp: '#25D366',
    sms: '#3B82F6',
    ussd: '#F59E0B',
    success: '#10B981',
    error: '#EF4444',
    warning: '#F59E0B'
  }

  const channelData = metrics ? [
    { name: 'WhatsApp', value: metrics.by_channel.whatsapp, color: COLORS.whatsapp },
    { name: 'SMS', value: metrics.by_channel.sms, color: COLORS.sms },
    { name: 'USSD', value: metrics.by_channel.ussd, color: COLORS.ussd }
  ] : []

  const providerData = metrics ? [
    { name: "Africa's Talking", value: metrics.by_provider.africas_talking },
    { name: 'Twilio', value: metrics.by_provider.twilio },
    { name: 'Meta WhatsApp', value: metrics.by_provider.meta_whatsapp }
  ] : []

  const getCircuitBreakerColor = (status) => {
    switch (status) {
      case 'closed': return 'bg-green-500'
      case 'open': return 'bg-red-500'
      case 'half-open': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  const getCircuitBreakerIcon = (status) => {
    switch (status) {
      case 'closed': return <CheckCircle className="w-4 h-4" />
      case 'open': return <XCircle className="w-4 h-4" />
      case 'half-open': return <AlertCircle className="w-4 h-4" />
      default: return <Clock className="w-4 h-4" />
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-16 h-16 animate-pulse text-blue-600 mx-auto mb-4" />
          <p className="text-lg text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Communication Dashboard
          </h1>
          <p className="text-gray-600">
            Monitor WhatsApp, SMS, and USSD channels in real-time
          </p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Total Messages
              </CardTitle>
              <Send className="w-4 h-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {metrics.total_messages.toLocaleString()}
              </div>
              <p className="text-xs text-green-600 mt-1 flex items-center">
                <TrendingUp className="w-3 h-3 mr-1" />
                +12.5% from last week
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                WhatsApp Delivery
              </CardTitle>
              <MessageSquare className="w-4 h-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {metrics.delivery_rate.whatsapp}%
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {metrics.by_channel.whatsapp.toLocaleString()} messages
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                SMS Delivery
              </CardTitle>
              <Mail className="w-4 h-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {metrics.delivery_rate.sms}%
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {metrics.by_channel.sms.toLocaleString()} messages
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Total Cost
              </CardTitle>
              <DollarSign className="w-4 h-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                ${metrics.total_cost_usd.toFixed(2)}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Avg: ${(metrics.total_cost_usd / metrics.total_messages * 1000).toFixed(3)}/msg
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-white">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="health">System Health</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Channel Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Channel Distribution</CardTitle>
                  <CardDescription>Messages sent by channel</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={channelData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {channelData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-4 space-y-2">
                    {channelData.map((channel) => (
                      <div key={channel.name} className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div 
                            className="w-3 h-3 rounded-full mr-2" 
                            style={{ backgroundColor: channel.color }}
                          />
                          <span className="text-sm text-gray-600">{channel.name}</span>
                        </div>
                        <span className="text-sm font-semibold">{channel.value.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Hourly Traffic */}
              <Card>
                <CardHeader>
                  <CardTitle>24-Hour Traffic</CardTitle>
                  <CardDescription>Message volume by hour</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={metrics.hourly_stats}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="whatsapp" stroke={COLORS.whatsapp} strokeWidth={2} />
                      <Line type="monotone" dataKey="sms" stroke={COLORS.sms} strokeWidth={2} />
                      <Line type="monotone" dataKey="ussd" stroke={COLORS.ussd} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Provider Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Provider Usage</CardTitle>
                <CardDescription>Messages sent by provider</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={providerData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3B82F6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Channels Tab */}
          <TabsContent value="channels" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* WhatsApp */}
              <Card className="border-l-4 border-l-green-500">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <MessageSquare className="w-5 h-5 mr-2 text-green-600" />
                    WhatsApp
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Delivery Rate</span>
                      <span className="text-sm font-semibold">{metrics.delivery_rate.whatsapp}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full" 
                        style={{ width: `${metrics.delivery_rate.whatsapp}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Total Sent</span>
                      <span className="font-semibold">{metrics.by_channel.whatsapp.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Cost/Message</span>
                      <span className="font-semibold">$0.005</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Open Rate</span>
                      <span className="font-semibold text-green-600">98%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* SMS */}
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Mail className="w-5 h-5 mr-2 text-blue-600" />
                    SMS
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Delivery Rate</span>
                      <span className="text-sm font-semibold">{metrics.delivery_rate.sms}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full" 
                        style={{ width: `${metrics.delivery_rate.sms}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Total Sent</span>
                      <span className="font-semibold">{metrics.by_channel.sms.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Cost/Message</span>
                      <span className="font-semibold">$0.006</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Open Rate</span>
                      <span className="font-semibold text-blue-600">85%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* USSD */}
              <Card className="border-l-4 border-l-yellow-500">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Phone className="w-5 h-5 mr-2 text-yellow-600" />
                    USSD
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Delivery Rate</span>
                      <span className="text-sm font-semibold">{metrics.delivery_rate.ussd}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-yellow-500 h-2 rounded-full" 
                        style={{ width: `${metrics.delivery_rate.ussd}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Total Sessions</span>
                      <span className="font-semibold">{metrics.by_channel.ussd.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Cost/Session</span>
                      <span className="font-semibold">$0.008</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Completion Rate</span>
                      <span className="font-semibold text-yellow-600">100%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Providers Tab */}
          <TabsContent value="providers" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {Object.entries(metrics.by_provider).map(([provider, count]) => (
                <Card key={provider}>
                  <CardHeader>
                    <CardTitle className="capitalize">{provider.replace('_', ' ')}</CardTitle>
                    <CardDescription>Messages sent</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold mb-4">{count.toLocaleString()}</div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Percentage</span>
                        <span className="font-semibold">
                          {((count / metrics.total_messages) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Status</span>
                        <Badge className={getCircuitBreakerColor(metrics.circuit_breaker_status[provider])}>
                          {metrics.circuit_breaker_status[provider]}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* System Health Tab */}
          <TabsContent value="health" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Circuit Breaker Status</CardTitle>
                <CardDescription>Provider health monitoring</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(metrics.circuit_breaker_status).map(([provider, status]) => (
                    <div key={provider} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        {getCircuitBreakerIcon(status)}
                        <div>
                          <p className="font-semibold capitalize">{provider.replace('_', ' ')}</p>
                          <p className="text-sm text-gray-500">
                            {status === 'closed' && 'Operating normally'}
                            {status === 'open' && 'Temporarily disabled due to failures'}
                            {status === 'half-open' && 'Testing recovery'}
                          </p>
                        </div>
                      </div>
                      <Badge className={getCircuitBreakerColor(status)}>
                        {status.toUpperCase()}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>System Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">API Status</span>
                    <Badge className="bg-green-500">Online</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Database</span>
                    <Badge className="bg-green-500">Connected</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Redis Cache</span>
                    <Badge className="bg-green-500">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Queue</span>
                    <Badge className="bg-green-500">Processing</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Performance Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Avg Response Time</span>
                    <span className="font-semibold">145ms</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Success Rate</span>
                    <span className="font-semibold text-green-600">99.2%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Uptime (24h)</span>
                    <span className="font-semibold">99.9%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Active Sessions</span>
                    <span className="font-semibold">234</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App

