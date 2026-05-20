import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Database, TrendingUp, ShoppingCart, Package, Shield, Activity, Table, BarChart3, LineChart, PieChart, Layers, GitBranch, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [lakehouseStats, setLakehouseStats] = useState(null)
  const [selectedDomain, setSelectedDomain] = useState('agency_banking')

  // Simulated lakehouse data
  const mockLakehouseStats = {
    total_tables: 48,
    total_rows: 12500000,
    total_size_gb: 156.8,
    domains: {
      agency_banking: {
        table_count: 12,
        row_count: 5000000,
        layers: {
          bronze: { table_count: 3, row_count: 2000000 },
          silver: { table_count: 4, row_count: 1800000 },
          gold: { table_count: 3, row_count: 1000000 },
          platinum: { table_count: 2, row_count: 200000 }
        }
      },
      ecommerce: {
        table_count: 12,
        row_count: 3500000,
        layers: {
          bronze: { table_count: 3, row_count: 1500000 },
          silver: { table_count: 4, row_count: 1200000 },
          gold: { table_count: 3, row_count: 700000 },
          platinum: { table_count: 2, row_count: 100000 }
        }
      },
      inventory: {
        table_count: 12,
        row_count: 2500000,
        layers: {
          bronze: { table_count: 3, row_count: 1000000 },
          silver: { table_count: 4, row_count: 900000 },
          gold: { table_count: 3, row_count: 500000 },
          platinum: { table_count: 2, row_count: 100000 }
        }
      },
      security: {
        table_count: 12,
        row_count: 1500000,
        layers: {
          bronze: { table_count: 3, row_count: 800000 },
          silver: { table_count: 4, row_count: 500000 },
          gold: { table_count: 3, row_count: 150000 },
          platinum: { table_count: 2, row_count: 50000 }
        }
      }
    }
  }

  // Fetch lakehouse stats from API
  const fetchLakehouseStats = async () => {
    try {
      const response = await fetch('http://localhost:8070/analytics/summary')
      if (response.ok) {
        const data = await response.json()
        setLakehouseStats(data)
      } else {
        console.warn('API not available, using mock data')
        setLakehouseStats(mockLakehouseStats)
      }
    } catch (error) {
      console.warn('Failed to fetch lakehouse stats, using mock data:', error)
      setLakehouseStats(mockLakehouseStats)
    }
  }

  useEffect(() => {
    fetchLakehouseStats()
    // Refresh every 30 seconds
    const interval = setInterval(fetchLakehouseStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const domainIcons = {
    agency_banking: TrendingUp,
    ecommerce: ShoppingCart,
    inventory: Package,
    security: Shield
  }

  const layerColors = {
    bronze: 'bg-amber-500',
    silver: 'bg-gray-400',
    gold: 'bg-yellow-500',
    platinum: 'bg-purple-500'
  }

  const recentPipelines = [
    { id: 1, name: 'Agency Banking → Bronze', status: 'completed', rows: 125000, duration: '2.3s', timestamp: '2 min ago' },
    { id: 2, name: 'E-commerce → Silver', status: 'completed', rows: 84500, duration: '1.8s', timestamp: '5 min ago' },
    { id: 3, name: 'Inventory → Gold', status: 'running', rows: 45000, duration: '1.2s', timestamp: 'now' },
    { id: 4, name: 'Security → Platinum', status: 'completed', rows: 12000, duration: '0.9s', timestamp: '8 min ago' },
    { id: 5, name: 'Agency Banking → Gold', status: 'failed', rows: 0, duration: '0.0s', timestamp: '10 min ago' }
  ]

  const dataQualityChecks = [
    { table: 'transactions_cleaned', checks: 5, passed: 5, score: 100 },
    { table: 'orders_cleaned', checks: 5, passed: 5, score: 100 },
    { table: 'stock_cleaned', checks: 5, passed: 4, score: 80 },
    { table: 'events_classified', checks: 5, passed: 5, score: 100 }
  ]

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
                <p className="text-sm text-slate-500">Data Lake + Warehouse = Lakehouse</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Activity className="w-3 h-3 mr-1" />
                Operational
              </Badge>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                Delta Lake
              </Badge>
              <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                Iceberg
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="catalog">Data Catalog</TabsTrigger>
            <TabsTrigger value="pipelines">ETL Pipelines</TabsTrigger>
            <TabsTrigger value="quality">Data Quality</TabsTrigger>
            <TabsTrigger value="lineage">Lineage</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">Total Tables</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="text-3xl font-bold text-slate-900">{lakehouseStats?.total_tables || 0}</div>
                    <Table className="w-8 h-8 text-blue-500" />
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
                    <div className="text-3xl font-bold text-slate-900">{(lakehouseStats?.total_rows / 1000000).toFixed(1)}M</div>
                    <BarChart3 className="w-8 h-8 text-green-500" />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">12.5 million records</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">Storage Size</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="text-3xl font-bold text-slate-900">{lakehouseStats?.total_size_gb.toFixed(1)} GB</div>
                    <Database className="w-8 h-8 text-purple-500" />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Compressed format</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">Data Quality</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="text-3xl font-bold text-slate-900">98.5%</div>
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Quality score</p>
                </CardContent>
              </Card>
            </div>

            {/* Domain Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {lakehouseStats && Object.entries(lakehouseStats.domains).map(([domain, data]) => {
                const Icon = domainIcons[domain]
                return (
                  <Card key={domain} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setSelectedDomain(domain)}>
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
                        <div className="mt-3 space-y-1">
                          {Object.entries(data.layers).map(([layer, layerData]) => (
                            <div key={layer} className="flex items-center space-x-2">
                              <div className={`w-2 h-2 rounded-full ${layerColors[layer]}`}></div>
                              <span className="text-xs text-slate-600 capitalize">{layer}:</span>
                              <span className="text-xs font-medium">{layerData.table_count} tables</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Recent Pipelines */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Pipeline Runs</CardTitle>
                <CardDescription>Latest ETL/ELT pipeline executions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentPipelines.map(pipeline => (
                    <div key={pipeline.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                      <div className="flex items-center space-x-3">
                        <div className={`w-2 h-2 rounded-full ${
                          pipeline.status === 'completed' ? 'bg-green-500' :
                          pipeline.status === 'running' ? 'bg-blue-500 animate-pulse' :
                          'bg-red-500'
                        }`}></div>
                        <div>
                          <div className="font-medium text-sm">{pipeline.name}</div>
                          <div className="text-xs text-slate-500">{pipeline.rows.toLocaleString()} rows • {pipeline.duration}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="text-xs text-slate-500">{pipeline.timestamp}</span>
                        <Badge variant={pipeline.status === 'completed' ? 'default' : pipeline.status === 'running' ? 'secondary' : 'destructive'}>
                          {pipeline.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Data Catalog Tab */}
          <TabsContent value="catalog" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Data Catalog</CardTitle>
                <CardDescription>Browse all tables in the lakehouse</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {lakehouseStats && Object.entries(lakehouseStats.domains).map(([domain, data]) => (
                    <div key={domain} className="border border-slate-200 rounded-lg p-4">
                      <div className="flex items-center space-x-2 mb-3">
                        {React.createElement(domainIcons[domain], { className: "w-5 h-5 text-slate-600" })}
                        <h3 className="font-semibold capitalize">{domain.replace('_', ' ')}</h3>
                        <Badge>{data.table_count} tables</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {Object.entries(data.layers).map(([layer, layerData]) => (
                          <div key={layer} className="bg-slate-50 p-3 rounded">
                            <div className="flex items-center space-x-2 mb-2">
                              <div className={`w-3 h-3 rounded-full ${layerColors[layer]}`}></div>
                              <span className="text-sm font-medium capitalize">{layer}</span>
                            </div>
                            <div className="text-xs text-slate-600">
                              <div>{layerData.table_count} tables</div>
                              <div>{(layerData.row_count / 1000).toFixed(0)}K rows</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pipelines Tab */}
          <TabsContent value="pipelines" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>ETL/ELT Pipelines</CardTitle>
                <CardDescription>Manage data pipelines across all layers</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentPipelines.map(pipeline => (
                    <div key={pipeline.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-blue-300 transition-colors">
                      <div className="flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          pipeline.status === 'completed' ? 'bg-green-100' :
                          pipeline.status === 'running' ? 'bg-blue-100' :
                          'bg-red-100'
                        }`}>
                          {pipeline.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-green-600" /> :
                           pipeline.status === 'running' ? <Activity className="w-5 h-5 text-blue-600 animate-spin" /> :
                           <AlertCircle className="w-5 h-5 text-red-600" />}
                        </div>
                        <div>
                          <div className="font-medium">{pipeline.name}</div>
                          <div className="text-sm text-slate-500">
                            {pipeline.rows.toLocaleString()} rows processed in {pipeline.duration}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-500">{pipeline.timestamp}</span>
                        <Button size="sm" variant="outline">View Logs</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Data Quality Tab */}
          <TabsContent value="quality" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Data Quality Checks</CardTitle>
                <CardDescription>Monitor data quality across all tables</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dataQualityChecks.map((check, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          check.score === 100 ? 'bg-green-100' : 'bg-yellow-100'
                        }`}>
                          <span className={`text-lg font-bold ${
                            check.score === 100 ? 'text-green-600' : 'text-yellow-600'
                          }`}>{check.score}</span>
                        </div>
                        <div>
                          <div className="font-medium">{check.table}</div>
                          <div className="text-sm text-slate-500">
                            {check.passed}/{check.checks} checks passed
                          </div>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">Run Checks</Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lineage Tab */}
          <TabsContent value="lineage" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Data Lineage</CardTitle>
                <CardDescription>Track data flow across layers</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center p-12">
                  <div className="text-center space-y-4">
                    <GitBranch className="w-16 h-16 text-slate-300 mx-auto" />
                    <div>
                      <h3 className="text-lg font-semibold text-slate-700">Data Lineage Visualization</h3>
                      <p className="text-sm text-slate-500 mt-2">
                        Interactive lineage graph showing data flow from Bronze → Silver → Gold → Platinum
                      </p>
                    </div>
                    <Button>Explore Lineage</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App

