import { useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { 
  Handshake, 
  TrendingUp, 
  Users, 
  DollarSign, 
  Package, 
  BarChart3,
  FileText,
  Settings,
  Bell,
  CheckCircle,
  Clock,
  Award,
  ShoppingCart
} from 'lucide-react'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')

  const partnerData = {
    name: 'TechCorp Solutions',
    id: 'PARTNER-001',
    tier: 'Gold',
    totalRevenue: 245678,
    activeAgents: 142,
    totalAgents: 156,
    totalTransactions: 12456,
    commissionRate: 3.5,
    pendingPayouts: 12345
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800">
      <header className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Handshake className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold">Partner Portal</h1>
                <p className="text-sm text-muted-foreground">{partnerData.name}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Badge className="bg-yellow-100 text-yellow-700">
                <Award className="h-3 w-3 mr-1" />
                {partnerData.tier} Partner
              </Badge>
              <Button variant="outline" size="icon">
                <Bell className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${(partnerData.totalRevenue / 1000).toFixed(1)}K</div>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="text-green-600">↑ 18%</span> from last month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Active Agents</CardTitle>
              <Users className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{partnerData.activeAgents}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {partnerData.totalAgents} total agents
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Transactions</CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{partnerData.totalTransactions.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="text-green-600">↑ 12%</span> from last month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Pending Payouts</CardTitle>
              <Clock className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${(partnerData.pendingPayouts / 1000).toFixed(1)}K</div>
              <p className="text-xs text-muted-foreground mt-1">
                Next payout in 5 days
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

export default App
