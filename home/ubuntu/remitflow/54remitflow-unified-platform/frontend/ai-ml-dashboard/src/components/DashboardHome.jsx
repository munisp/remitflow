import { useState, useEffect } from 'react'
import { 
  Brain, Code, Network, MessageSquare, Bot,
  TrendingUp, Shield, Zap, Activity, CheckCircle,
  AlertCircle, Clock
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function DashboardHome() {
  const [stats, setStats] = useState({
    cocoindex: { status: 'healthy', snippets: 1234, searches: 5678 },
    falkordb: { status: 'healthy', nodes: 10000, edges: 25000 },
    ollama: { status: 'healthy', models: 3, requests: 8901 },
    kgqa: { status: 'healthy', questions: 3456, accuracy: 0.89 },
    artAgent: { status: 'healthy', tasks: 789, success: 0.95 }
  })

  const services = [
    {
      name: 'CocoIndex',
      icon: Code,
      color: 'purple',
      description: 'Semantic code search and indexing',
      metrics: [
        { label: 'Code Snippets', value: stats.cocoindex.snippets.toLocaleString() },
        { label: 'Searches Today', value: stats.cocoindex.searches.toLocaleString() }
      ],
      path: '/cocoindex'
    },
    {
      name: 'FalkorDB',
      icon: Network,
      color: 'green',
      description: 'Graph database for fraud detection',
      metrics: [
        { label: 'Graph Nodes', value: stats.falkordb.nodes.toLocaleString() },
        { label: 'Relationships', value: stats.falkordb.edges.toLocaleString() }
      ],
      path: '/falkordb'
    },
    {
      name: 'Ollama',
      icon: Brain,
      color: 'orange',
      description: 'Local LLM inference',
      metrics: [
        { label: 'Active Models', value: stats.ollama.models },
        { label: 'Requests Today', value: stats.ollama.requests.toLocaleString() }
      ],
      path: '/ollama'
    },
    {
      name: 'EPR-KGQA',
      icon: MessageSquare,
      color: 'cyan',
      description: 'Knowledge graph Q&A',
      metrics: [
        { label: 'Questions Answered', value: stats.kgqa.questions.toLocaleString() },
        { label: 'Accuracy', value: `${(stats.kgqa.accuracy * 100).toFixed(1)}%` }
      ],
      path: '/kgqa'
    },
    {
      name: 'ART Agent',
      icon: Bot,
      color: 'pink',
      description: 'Autonomous reasoning agents',
      metrics: [
        { label: 'Tasks Completed', value: stats.artAgent.tasks.toLocaleString() },
        { label: 'Success Rate', value: `${(stats.artAgent.success * 100).toFixed(1)}%` }
      ],
      path: '/art-agent'
    }
  ]

  const recentActivity = [
    { 
      service: 'ART Agent', 
      action: 'Completed fraud investigation for AG-12345', 
      time: '2 minutes ago',
      status: 'success'
    },
    { 
      service: 'FalkorDB', 
      action: 'Detected suspicious transaction pattern', 
      time: '5 minutes ago',
      status: 'warning'
    },
    { 
      service: 'Ollama', 
      action: 'Analyzed 45 customer queries', 
      time: '10 minutes ago',
      status: 'success'
    },
    { 
      service: 'EPR-KGQA', 
      action: 'Answered compliance question', 
      time: '15 minutes ago',
      status: 'success'
    },
    { 
      service: 'CocoIndex', 
      action: 'Indexed 23 new code snippets', 
      time: '20 minutes ago',
      status: 'success'
    }
  ]

  const colorMap = {
    purple: 'bg-purple-500',
    green: 'bg-green-500',
    orange: 'bg-orange-500',
    cyan: 'bg-cyan-500',
    pink: 'bg-pink-500'
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI/ML Services Dashboard</h1>
        <p className="text-gray-600">Monitor and manage intelligent banking services</p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Activity className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Requests</p>
                <p className="text-2xl font-bold text-gray-900">18,274</p>
              </div>
            </div>
            <TrendingUp className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-sm text-green-600">↑ 23% from yesterday</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <Shield className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Fraud Detected</p>
                <p className="text-2xl font-bold text-gray-900">12</p>
              </div>
            </div>
            <AlertCircle className="w-5 h-5 text-orange-500" />
          </div>
          <p className="text-sm text-gray-600">Last 24 hours</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <Zap className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Avg Response Time</p>
                <p className="text-2xl font-bold text-gray-900">145ms</p>
              </div>
            </div>
            <TrendingUp className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-sm text-green-600">↓ 12% faster</p>
        </div>
      </div>

      {/* Services Grid */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">AI/ML Services</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service) => {
            const Icon = service.icon
            return (
              <div key={service.name} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 ${colorMap[service.color]} bg-opacity-10 rounded-lg`}>
                      <Icon className={`w-6 h-6 text-${service.color}-600`} />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{service.name}</h3>
                      <div className="flex items-center gap-1 mt-1">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-xs text-green-600">Healthy</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 mb-4">{service.description}</p>
                
                <div className="space-y-2 mb-4">
                  {service.metrics.map((metric) => (
                    <div key={metric.label} className="flex justify-between text-sm">
                      <span className="text-gray-600">{metric.label}</span>
                      <span className="font-semibold text-gray-900">{metric.value}</span>
                    </div>
                  ))}
                </div>
                
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={() => window.location.href = service.path}
                >
                  Open Dashboard
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activity</h2>
        <div className="space-y-4">
          {recentActivity.map((activity, index) => (
            <div key={index} className="flex items-start gap-4 pb-4 border-b last:border-b-0">
              <div className={`p-2 rounded-lg ${
                activity.status === 'success' ? 'bg-green-100' : 'bg-orange-100'
              }`}>
                {activity.status === 'success' ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-orange-600" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-900">{activity.service}</p>
                  <div className="flex items-center gap-1 text-gray-500 text-sm">
                    <Clock className="w-4 h-4" />
                    <span>{activity.time}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-1">{activity.action}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

