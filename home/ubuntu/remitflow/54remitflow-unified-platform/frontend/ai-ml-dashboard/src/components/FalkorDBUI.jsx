import { useState } from 'react'
import { Network, Search, AlertTriangle, TrendingUp, Users, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function FalkorDBUI() {
  const [cypherQuery, setCypherQuery] = useState('')
  const [queryResults, setQueryResults] = useState(null)
  const [selectedAgent, setSelectedAgent] = useState('AG-12345')
  const [fraudPatterns, setFraudPatterns] = useState([])

  const detectFraud = async () => {
    // Simulate API call
    setFraudPatterns([
      {
        type: 'rapid_transactions',
        severity: 'high',
        description: 'More than 10 transactions in the last hour',
        count: 15,
        timeframe: '1 hour'
      },
      {
        type: 'unusual_amount',
        severity: 'medium',
        description: 'Transaction amount 5x higher than average',
        amount: 50000,
        average: 10000
      }
    ])
  }

  const executeQuery = () => {
    // Simulate query execution
    setQueryResults({
      nodes: 25,
      relationships: 48,
      executionTime: 45,
      data: [
        { agent: 'AG-12345', transactions: 87, totalAmount: 125000 },
        { agent: 'AG-67890', transactions: 45, totalAmount: 67000 },
        { agent: 'AG-11111', transactions: 32, totalAmount: 45000 }
      ]
    })
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-green-100 rounded-lg">
            <Network className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">FalkorDB</h1>
            <p className="text-gray-600">Graph Database & Fraud Detection</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Graph Nodes</p>
          <p className="text-2xl font-bold text-gray-900">10,000</p>
          <p className="text-xs text-gray-500 mt-1">Agents, Transactions, Accounts</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Relationships</p>
          <p className="text-2xl font-bold text-gray-900">25,000</p>
          <p className="text-xs text-gray-500 mt-1">Connections mapped</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Fraud Patterns</p>
          <p className="text-2xl font-bold text-red-600">12</p>
          <p className="text-xs text-red-600 mt-1">↑ Detected today</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Query Time</p>
          <p className="text-2xl font-bold text-gray-900">45ms</p>
          <p className="text-xs text-green-600 mt-1">↓ 10ms faster</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cypher Query Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Cypher Query Console</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Query
              </label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 font-mono text-sm"
                rows="6"
                placeholder="MATCH (a:Agent)-[:PERFORMED]->(t:Transaction)&#10;WHERE t.amount > 10000&#10;RETURN a, t"
                value={cypherQuery}
                onChange={(e) => setCypherQuery(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button 
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={executeQuery}
              >
                Execute Query
              </Button>
              <Button variant="outline">
                Clear
              </Button>
            </div>

            {/* Query Results */}
            {queryResults && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Query Results</h3>
                  <span className="text-sm text-gray-600">
                    {queryResults.executionTime}ms
                  </span>
                </div>
                
                <div className="text-sm text-gray-600 mb-3">
                  Found {queryResults.nodes} nodes and {queryResults.relationships} relationships
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left">Agent</th>
                        <th className="px-3 py-2 text-left">Transactions</th>
                        <th className="px-3 py-2 text-left">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queryResults.data.map((row, index) => (
                        <tr key={index} className="border-t">
                          <td className="px-3 py-2">{row.agent}</td>
                          <td className="px-3 py-2">{row.transactions}</td>
                          <td className="px-3 py-2">${row.totalAmount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Sample Queries */}
          <div className="mt-6">
            <h3 className="font-semibold text-gray-900 mb-2">Sample Queries</h3>
            <div className="space-y-2">
              {[
                'MATCH (a:Agent) RETURN a LIMIT 10',
                'MATCH (a:Agent)-[:PERFORMED]->(t:Transaction) WHERE t.amount > 10000 RETURN a, t',
                'MATCH path = shortestPath((a:Agent)-[*]-(b:Agent)) RETURN path'
              ].map((query, index) => (
                <button
                  key={index}
                  className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-sm font-mono"
                  onClick={() => setCypherQuery(query)}
                >
                  {query}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Fraud Detection Section */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Fraud Pattern Detection</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Agent ID
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="AG-12345"
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                />
              </div>

              <Button 
                className="w-full bg-red-600 hover:bg-red-700"
                onClick={detectFraud}
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                Detect Fraud Patterns
              </Button>

              {/* Fraud Patterns Results */}
              {fraudPatterns.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">Detected Patterns</h3>
                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
                      HIGH RISK
                    </span>
                  </div>

                  {fraudPatterns.map((pattern, index) => (
                    <div key={index} className="p-4 border-l-4 border-red-500 bg-red-50 rounded">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-red-600" />
                          <span className="font-semibold text-gray-900">
                            {pattern.type.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        <span className={`px-2 py-1 text-xs rounded ${
                          pattern.severity === 'high' 
                            ? 'bg-red-100 text-red-700' 
                            : 'bg-orange-100 text-orange-700'
                        }`}>
                          {pattern.severity.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{pattern.description}</p>
                      {pattern.count && (
                        <p className="text-xs text-gray-600 mt-2">
                          Count: {pattern.count} in {pattern.timeframe}
                        </p>
                      )}
                      {pattern.amount && (
                        <p className="text-xs text-gray-600 mt-2">
                          Amount: ${pattern.amount.toLocaleString()} (avg: ${pattern.average.toLocaleString()})
                        </p>
                      )}
                    </div>
                  ))}

                  <Button variant="outline" className="w-full">
                    Generate Full Report
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Graph Visualization */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Network Visualization</h2>
            
            <div className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
              <div className="text-center text-gray-500">
                <Network className="w-12 h-12 mx-auto mb-2" />
                <p className="text-sm">Graph visualization</p>
                <p className="text-xs">Select a query to visualize</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-gray-600">Agents</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-gray-600">Transactions</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                <span className="text-gray-600">Accounts</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                <span className="text-gray-600">Customers</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

