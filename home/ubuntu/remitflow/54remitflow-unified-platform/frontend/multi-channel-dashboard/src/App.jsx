import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { 
  MessageSquare, Mail, Phone, Send, TrendingUp, AlertCircle, 
  CheckCircle, XCircle, Activity, Users, BarChart3, Settings,
  Smartphone, MessageCircle, Instagram, Twitter, Gamepad2,
  ShoppingBag, Globe, Zap
} from 'lucide-react'
import './App.css'

// Channel icons mapping
const channelIcons = {
  whatsapp: MessageCircle,
  sms: Smartphone,
  email: Mail,
  telegram: Send,
  discord: MessageSquare,
  voice_ai: Phone,
  messenger: MessageCircle,
  instagram: Instagram,
  rcs: MessageSquare,
  tiktok: Activity,
  voice_assistant: Phone,
  twitter: Twitter,
  snapchat: Activity,
  wechat: MessageCircle,
  jumia: ShoppingBag,
  konga: ShoppingBag,
  amazon: ShoppingBag,
  ebay: ShoppingBag,
  metaverse: Globe,
  gaming: Gamepad2,
  ussd: Phone
}

function App() {
  const [channels, setChannels] = useState([])
  const [stats, setStats] = useState(null)
  const [messages, setMessages] = useState([])
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [loading, setLoading] = useState(true)

  // Mock data for demonstration
  useEffect(() => {
    // Simulate API call
    setTimeout(() => {
      setChannels([
        { name: 'whatsapp', status: 'healthy', sent: 1247, delivered: 1198, failed: 49, deliveryRate: 96.1 },
        { name: 'sms', status: 'healthy', sent: 856, delivered: 823, failed: 33, deliveryRate: 96.1 },
        { name: 'email', status: 'healthy', sent: 2341, delivered: 2298, failed: 43, deliveryRate: 98.2 },
        { name: 'telegram', status: 'healthy', sent: 534, delivered: 521, failed: 13, deliveryRate: 97.6 },
        { name: 'discord', status: 'healthy', sent: 189, delivered: 184, failed: 5, deliveryRate: 97.4 },
        { name: 'voice_ai', status: 'healthy', sent: 423, delivered: 401, failed: 22, deliveryRate: 94.8 },
        { name: 'messenger', status: 'healthy', sent: 678, delivered: 659, failed: 19, deliveryRate: 97.2 },
        { name: 'instagram', status: 'healthy', sent: 892, delivered: 871, failed: 21, deliveryRate: 97.6 },
        { name: 'rcs', status: 'healthy', sent: 234, delivered: 227, failed: 7, deliveryRate: 97.0 },
        { name: 'tiktok', status: 'healthy', sent: 456, delivered: 441, failed: 15, deliveryRate: 96.7 },
        { name: 'voice_assistant', status: 'healthy', sent: 123, delivered: 118, failed: 5, deliveryRate: 95.9 },
        { name: 'twitter', status: 'healthy', sent: 345, delivered: 332, failed: 13, deliveryRate: 96.2 },
        { name: 'snapchat', status: 'healthy', sent: 267, delivered: 258, failed: 9, deliveryRate: 96.6 },
        { name: 'wechat', status: 'healthy', sent: 89, delivered: 86, failed: 3, deliveryRate: 96.6 },
        { name: 'jumia', status: 'healthy', sent: 145, delivered: 142, failed: 3, deliveryRate: 97.9 },
        { name: 'konga', status: 'healthy', sent: 98, delivered: 95, failed: 3, deliveryRate: 96.9 },
        { name: 'amazon', status: 'healthy', sent: 67, delivered: 65, failed: 2, deliveryRate: 97.0 },
        { name: 'ebay', status: 'healthy', sent: 45, delivered: 44, failed: 1, deliveryRate: 97.8 },
        { name: 'metaverse', status: 'healthy', sent: 23, delivered: 22, failed: 1, deliveryRate: 95.7 },
        { name: 'gaming', status: 'healthy', sent: 78, delivered: 76, failed: 2, deliveryRate: 97.4 },
        { name: 'ussd', status: 'healthy', sent: 1123, delivered: 1089, failed: 34, deliveryRate: 97.0 }
      ])

      const totalSent = 10253
      const totalDelivered = 9950
      const totalFailed = 303

      setStats({
        totalMessages: totalSent,
        totalDelivered: totalDelivered,
        totalFailed: totalFailed,
        deliveryRate: ((totalDelivered / totalSent) * 100).toFixed(1),
        activeChannels: 21,
        avgResponseTime: '2.3s'
      })

      setMessages([
        { id: 1, channel: 'whatsapp', recipient: 'Ada Obi', type: 'order_confirmation', status: 'delivered', time: '2 min ago' },
        { id: 2, channel: 'email', recipient: 'John Doe', type: 'shipping_update', status: 'delivered', time: '5 min ago' },
        { id: 3, channel: 'telegram', recipient: 'Jane Smith', type: 'promotional', status: 'delivered', time: '8 min ago' },
        { id: 4, channel: 'sms', recipient: 'Mike Johnson', type: 'payment_request', status: 'failed', time: '10 min ago' },
        { id: 5, channel: 'instagram', recipient: 'Sarah Williams', type: 'support', status: 'delivered', time: '12 min ago' }
      ])

      setLoading(false)
    }, 1000)
  }, [])

  const getStatusColor = (status) => {
    return status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
  }

  const getDeliveryRateColor = (rate) => {
    if (rate >= 97) return 'text-green-600'
    if (rate >= 95) return 'text-yellow-600'
    return 'text-red-600'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Multi-Channel Communication Hub</h1>
            <p className="text-gray-600">Manage all 21 communication channels from one dashboard</p>
          </div>
          <Button className="bg-purple-600 hover:bg-purple-700">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="border-l-4 border-l-purple-600">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Total Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-3xl font-bold">{stats?.totalMessages.toLocaleString()}</p>
              <TrendingUp className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-xs text-gray-500 mt-2">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-600">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Delivered</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-3xl font-bold">{stats?.totalDelivered.toLocaleString()}</p>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-xs text-green-600 mt-2">{stats?.deliveryRate}% delivery rate</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-600">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-3xl font-bold">{stats?.totalFailed}</p>
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <p className="text-xs text-gray-500 mt-2">Needs attention</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-600">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Active Channels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-3xl font-bold">{stats?.activeChannels}</p>
              <Activity className="w-8 h-8 text-blue-600" />
            </div>
            <p className="text-xs text-gray-500 mt-2">All operational</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="channels" className="space-y-6">
        <TabsList className="bg-white p-1">
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="messages">Recent Messages</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Channels Tab */}
        <TabsContent value="channels" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Communication Channels</CardTitle>
              <CardDescription>Monitor and manage all 21 integrated channels</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {channels.map((channel) => {
                  const Icon = channelIcons[channel.name] || MessageSquare
                  return (
                    <Card 
                      key={channel.name}
                      className="hover:shadow-lg transition-shadow cursor-pointer"
                      onClick={() => setSelectedChannel(channel)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Icon className="w-5 h-5 text-purple-600" />
                            <span className="font-semibold capitalize">{channel.name.replace('_', ' ')}</span>
                          </div>
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(channel.status)}`} />
                        </div>
                        
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Sent:</span>
                            <span className="font-medium">{channel.sent}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Delivered:</span>
                            <span className="font-medium text-green-600">{channel.delivered}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Failed:</span>
                            <span className="font-medium text-red-600">{channel.failed}</span>
                          </div>
                          <div className="flex justify-between pt-2 border-t">
                            <span className="text-gray-600">Rate:</span>
                            <span className={`font-bold ${getDeliveryRateColor(channel.deliveryRate)}`}>
                              {channel.deliveryRate}%
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Messages</CardTitle>
              <CardDescription>Latest messages across all channels</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {messages.map((message) => {
                  const Icon = channelIcons[message.channel] || MessageSquare
                  return (
                    <div key={message.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-4">
                        <Icon className="w-5 h-5 text-purple-600" />
                        <div>
                          <p className="font-medium">{message.recipient}</p>
                          <p className="text-sm text-gray-600 capitalize">{message.type.replace('_', ' ')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant={message.status === 'delivered' ? 'default' : 'destructive'}>
                          {message.status}
                        </Badge>
                        <span className="text-sm text-gray-500">{message.time}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Performing Channels</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {channels
                    .sort((a, b) => b.deliveryRate - a.deliveryRate)
                    .slice(0, 5)
                    .map((channel, index) => {
                      const Icon = channelIcons[channel.name] || MessageSquare
                      return (
                        <div key={channel.name} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-gray-300">#{index + 1}</span>
                            <Icon className="w-5 h-5 text-purple-600" />
                            <span className="font-medium capitalize">{channel.name.replace('_', ' ')}</span>
                          </div>
                          <span className="font-bold text-green-600">{channel.deliveryRate}%</span>
                        </div>
                      )
                    })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Channel Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {channels
                    .sort((a, b) => b.sent - a.sent)
                    .slice(0, 5)
                    .map((channel) => {
                      const Icon = channelIcons[channel.name] || MessageSquare
                      const percentage = ((channel.sent / stats.totalMessages) * 100).toFixed(1)
                      return (
                        <div key={channel.name} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4 text-purple-600" />
                              <span className="capitalize">{channel.name.replace('_', ' ')}</span>
                            </div>
                            <span className="font-medium">{percentage}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-purple-600 h-2 rounded-full transition-all"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Selected Channel Detail Modal */}
      {selectedChannel && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedChannel(null)}
        >
          <Card className="max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="capitalize">{selectedChannel.name.replace('_', ' ')} Details</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setSelectedChannel(null)}>×</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Total Sent</p>
                  <p className="text-2xl font-bold">{selectedChannel.sent}</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Delivered</p>
                  <p className="text-2xl font-bold text-green-600">{selectedChannel.delivered}</p>
                </div>
                <div className="p-4 bg-red-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Failed</p>
                  <p className="text-2xl font-bold text-red-600">{selectedChannel.failed}</p>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Delivery Rate</p>
                  <p className="text-2xl font-bold text-blue-600">{selectedChannel.deliveryRate}%</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1">View Logs</Button>
                <Button variant="outline" className="flex-1">Configure</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default App

