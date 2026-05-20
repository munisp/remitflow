import { useState } from 'react'
import { Search, Code, Upload, TrendingUp, FileCode, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CocoIndexUI() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState(null)
  const [newSnippet, setNewSnippet] = useState({
    code: '',
    language: 'python',
    description: '',
    tags: ''
  })

  const handleSearch = async () => {
    setIsSearching(true)
    
    // Simulate API call
    setTimeout(() => {
      setSearchResults([
        {
          id: 1,
          code: `def detect_fraud(transaction):\n    # Check transaction amount\n    if transaction.amount > 10000:\n        return True\n    return False`,
          language: 'python',
          description: 'Basic fraud detection function',
          similarity: 0.95,
          file: 'fraud-detection/detector.py',
          function: 'detect_fraud'
        },
        {
          id: 2,
          code: `async function checkFraud(txn) {\n    const riskScore = await calculateRisk(txn);\n    return riskScore > 0.8;\n}`,
          language: 'javascript',
          description: 'Async fraud check with risk scoring',
          similarity: 0.87,
          file: 'services/fraud.js',
          function: 'checkFraud'
        },
        {
          id: 3,
          code: `class FraudDetector:\n    def analyze(self, data):\n        features = self.extract_features(data)\n        return self.model.predict(features)`,
          language: 'python',
          description: 'ML-based fraud detector class',
          similarity: 0.82,
          file: 'ml/fraud_detector.py',
          function: 'FraudDetector.analyze'
        }
      ])
      setIsSearching(false)
    }, 1000)
  }

  const handleCopy = (code, index) => {
    navigator.clipboard.writeText(code)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  const handleAddSnippet = () => {
    console.log('Adding snippet:', newSnippet)
    alert('Code snippet added successfully!')
    setNewSnippet({ code: '', language: 'python', description: '', tags: '' })
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-purple-100 rounded-lg">
            <Code className="w-8 h-8 text-purple-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">CocoIndex</h1>
            <p className="text-gray-600">Semantic Code Search & Indexing</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Total Snippets</p>
          <p className="text-2xl font-bold text-gray-900">1,234</p>
          <p className="text-xs text-green-600 mt-1">↑ 12 today</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Languages</p>
          <p className="text-2xl font-bold text-gray-900">5</p>
          <p className="text-xs text-gray-500 mt-1">Python, JS, Go, etc.</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Searches Today</p>
          <p className="text-2xl font-bold text-gray-900">5,678</p>
          <p className="text-xs text-green-600 mt-1">↑ 23%</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Avg Response</p>
          <p className="text-2xl font-bold text-gray-900">85ms</p>
          <p className="text-xs text-green-600 mt-1">↓ 15ms</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Search Section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Semantic Code Search</h2>
            
            <div className="flex gap-2 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by meaning: 'fraud detection algorithm'..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button 
                onClick={handleSearch} 
                disabled={isSearching}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Found {searchResults.length} results for "{searchQuery}"
                </p>
                
                {searchResults.map((result, index) => (
                  <div key={result.id} className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <FileCode className="w-4 h-4 text-purple-600" />
                          <span className="font-semibold text-gray-900">{result.function}</span>
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                            {result.language}
                          </span>
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                            {(result.similarity * 100).toFixed(0)}% match
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{result.file}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(result.code, index)}
                      >
                        {copiedIndex === index ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    
                    <p className="text-sm text-gray-700 mb-3">{result.description}</p>
                    
                    <pre className="bg-gray-900 text-gray-100 p-3 rounded text-sm overflow-x-auto">
                      <code>{result.code}</code>
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Add Snippet Section */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add Code Snippet</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Language
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  value={newSnippet.language}
                  onChange={(e) => setNewSnippet({...newSnippet, language: e.target.value})}
                >
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                  <option value="go">Go</option>
                  <option value="java">Java</option>
                  <option value="typescript">TypeScript</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Brief description..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  value={newSnippet.description}
                  onChange={(e) => setNewSnippet({...newSnippet, description: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Code
                </label>
                <textarea
                  placeholder="Paste your code here..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                  rows="8"
                  value={newSnippet.code}
                  onChange={(e) => setNewSnippet({...newSnippet, code: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="fraud, detection, ml"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  value={newSnippet.tags}
                  onChange={(e) => setNewSnippet({...newSnippet, tags: e.target.value})}
                />
              </div>

              <Button 
                className="w-full bg-purple-600 hover:bg-purple-700"
                onClick={handleAddSnippet}
              >
                <Upload className="w-4 h-4 mr-2" />
                Add Snippet
              </Button>
            </div>
          </div>

          {/* Popular Tags */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-bold text-gray-900 mb-3">Popular Tags</h3>
            <div className="flex flex-wrap gap-2">
              {['fraud-detection', 'authentication', 'payment', 'validation', 'api', 'database'].map(tag => (
                <span 
                  key={tag}
                  className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm cursor-pointer hover:bg-purple-200"
                  onClick={() => setSearchQuery(tag)}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

