import React, { useState, useEffect } from 'react'
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
  Send,
  RefreshCw
} from 'lucide-react'
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts'

const COLORS = {
  whatsapp: '#25D366',
  sms: '#3B82F6',
  ussd: '#F59E0B',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B'
}

// Mock data (in production, fetch from API)
const mockMetrics = {
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
  ],
  recent_messages: [
    { id: 1, channel: 'whatsapp', recipient: '+234803****567', status: 'delivered', timestamp: '2 mins ago' },
    { id: 2, channel: 'sms', recipient: '+234802****123', status: 'delivered', timestamp: '5 mins ago' },
    { id: 3, channel: 'ussd', recipient: '+234801****890', status: 'delivered', timestamp: '8 mins ago' },
    { id: 4, channel: 'whatsapp', recipient: '+234804****234', status: 'failed', timestamp: '12 mins ago' },
    { id: 5, channel: 'sms', recipient: '+234805****678', status: 'delivered', timestamp: '15 mins ago' }
  ]
}

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

export default function CommunicationsDashboard() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedChannel, setSelectedChannel] = useState('all')

  useEffect(() => {
    // Simulate API call
    setTimeout(() => {
      setMetrics(mockMetrics)
      setLoading(false)
    }, 1000)
  }, [])

  const handleRefresh = () => {
    setLoading(true)
    setTimeout(() => {
      setMetrics(mockMetrics)
      setLoading(false)
    }, 1000)
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

  const channelData = [
    { name: 'WhatsApp', value: metrics.by_channel.whatsapp, color: COLORS.whatsapp },
    { name: 'SMS', value: metrics.by_channel.sms, color: COLORS.sms },
    { name: 'USSD', value: metrics.by_channel.ussd, color: COLORS.ussd }
  ]

  const providerData = [
    { name: "Africa's Talking", value: metrics.by_provider.africas_talking },
    { name: 'Twilio', value: metrics.by_provider.twilio },
    { name: 'Meta WhatsApp', value: metrics.by_provider.meta_whatsapp }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Communication Dashboard
            </h1>
            <p className="text-gray-600">
              Monitor WhatsApp, SMS, and USSD channels in real-time
            </p>
          </div>
          <Button onClick={handleRefresh} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
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
                WhatsApp
              </CardTitle>
              <MessageSquare className="w-4 h-4" style={{ color: COLORS.whatsapp }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {metrics.by_channel.whatsapp.toLocaleString()}
              </div>
              <p className="text-xs text-gray-600 mt-1">
                {metrics.delivery_rate.whatsapp}% delivery rate
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                SMS
              </CardTitle>
              <Mail className="w-4 h-4" style={{ color: COLORS.sms }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {metrics.by_channel.sms.toLocaleString()}
              </div>
              <p className="text-xs text-gray-600 mt-1">
                {metrics.delivery_rate.sms}% delivery rate
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Total Cost
              </CardTitle>
              <DollarSign className="w-4 h-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                ${metrics.total_cost_usd.toFixed(2)}
              </div>
              <p className="text-xs text-gray-600 mt-1">
                This month
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Messages by Channel</CardTitle>
              <CardDescription>Distribution across communication channels</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={channelData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hourly Message Volume</CardTitle>
              <CardDescription>Messages sent per hour by channel</CardDescription>
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

        {/* Provider Status & Recent Messages */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Provider Status</CardTitle>
              <CardDescription>Circuit breaker status for each provider</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(metrics.circuit_breaker_status).map(([provider, status]) => (
                  <div key={provider} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${getCircuitBreakerColor(status)}`} />
                      <span className="font-medium capitalize">{provider.replace('_', ' ')}</span>
                    </div>
                    <Badge variant="outline" className="gap-1">
                      {getCircuitBreakerIcon(status)}
                      {status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Messages</CardTitle>
              <CardDescription>Latest communication activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {metrics.recent_messages.map(msg => (
                  <div key={msg.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {msg.channel === 'whatsapp' && <MessageSquare className="w-4 h-4" style={{ color: COLORS.whatsapp }} />}
                      {msg.channel === 'sms' && <Mail className="w-4 h-4" style={{ color: COLORS.sms }} />}
                      {msg.channel === 'ussd' && <Phone className="w-4 h-4" style={{ color: COLORS.ussd }} />}
                      <div>
                        <p className="text-sm font-medium">{msg.recipient}</p>
                        <p className="text-xs text-muted-foreground">{msg.timestamp}</p>
                      </div>
                    </div>
                    <Badge variant={msg.status === 'delivered' ? 'success' : 'destructive'}>
                      {msg.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

