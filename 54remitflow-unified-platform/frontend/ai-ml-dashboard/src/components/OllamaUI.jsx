import { useState } from 'react'
import { Brain, Send, Download, Zap, MessageSquare, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function OllamaUI() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I\'m your banking AI assistant. How can I help you today?' }
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [selectedModel, setSelectedModel] = useState('llama2')
  const [analysisText, setAnalysisText] = useState('')
  const [analysisResult, setAnalysisResult] = useState(null)

  const models = [
    { id: 'llama2', name: 'Llama 2', size: '7B', status: 'ready' },
    { id: 'mistral', name: 'Mistral', size: '7B', status: 'ready' },
    { id: 'codellama', name: 'CodeLlama', size: '7B', status: 'ready' }
  ]

  const handleSendMessage = () => {
    if (!input.trim()) return

    const userMessage = { role: 'user', content: input }
    setMessages([...messages, userMessage])
    setInput('')
    setIsTyping(true)

    // Simulate AI response
    setTimeout(() => {
      const aiResponse = {
        role: 'assistant',
        content: `I understand you're asking about "${input}". Based on our banking platform data, here's what I found:\n\n1. Transaction processing follows PCI DSS compliance\n2. All agents must complete KYC verification\n3. Fraud detection runs in real-time\n\nWould you like more specific information?`
      }
      setMessages(prev => [...prev, aiResponse])
      setIsTyping(false)
    }, 1500)
  }

  const analyzeFraud = () => {
    setAnalysisResult({
      riskLevel: 'HIGH',
      confidence: 0.95,
      patterns: [
        'Emotional manipulation keywords detected',
        'Urgency pressure tactics identified',
        'International transfer red flag',
        'Pattern matches known scam database'
      ],
      recommendation: 'Flag for immediate review and contact customer for verification'
    })
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-orange-100 rounded-lg">
            <Brain className="w-8 h-8 text-orange-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Ollama</h1>
            <p className="text-gray-600">Local LLM Inference & AI Assistant</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Active Models</p>
          <p className="text-2xl font-bold text-gray-900">3</p>
          <p className="text-xs text-gray-500 mt-1">Llama2, Mistral, CodeLlama</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Requests Today</p>
          <p className="text-2xl font-bold text-gray-900">8,901</p>
          <p className="text-xs text-green-600 mt-1">↑ 18%</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Avg Response Time</p>
          <p className="text-2xl font-bold text-gray-900">2.3s</p>
          <p className="text-xs text-green-600 mt-1">↓ 0.5s</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Privacy Status</p>
          <p className="text-2xl font-bold text-green-600">100%</p>
          <p className="text-xs text-gray-500 mt-1">All data on-premises</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat Interface */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow flex flex-col" style={{height: '600px'}}>
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageSquare className="w-5 h-5 text-orange-600" />
              <h2 className="text-xl font-bold text-gray-900">Banking AI Assistant</h2>
            </div>
            <select
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.size})
                </option>
              ))}
            </select>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    message.role === 'user'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg p-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ask about banking procedures, compliance, fraud detection..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <Button 
                className="bg-orange-600 hover:bg-orange-700"
                onClick={handleSendMessage}
                disabled={isTyping}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Models */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Available Models</h2>
            <div className="space-y-3">
              {models.map(model => (
                <div key={model.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-semibold text-gray-900">{model.name}</p>
                    <p className="text-xs text-gray-600">{model.size} parameters</p>
                  </div>
                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                    {model.status}
                  </span>
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full mt-4">
              <Download className="w-4 h-4 mr-2" />
              Pull New Model
            </Button>
          </div>

          {/* Fraud Analysis */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Fraud Analysis</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Transaction Narrative
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                  rows="4"
                  placeholder="Enter transaction description or customer message..."
                  value={analysisText}
                  onChange={(e) => setAnalysisText(e.target.value)}
                />
              </div>

              <Button 
                className="w-full bg-orange-600 hover:bg-orange-700"
                onClick={analyzeFraud}
              >
                <Zap className="w-4 h-4 mr-2" />
                Analyze with AI
              </Button>

              {analysisResult && (
                <div className="mt-4 p-4 border-l-4 border-red-500 bg-red-50 rounded">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900">Risk Assessment</span>
                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
                      {analysisResult.riskLevel}
                    </span>
                  </div>
                  
                  <div className="mb-3">
                    <p className="text-sm text-gray-600 mb-1">Confidence</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-red-600 h-2 rounded-full" 
                          style={{width: `${analysisResult.confidence * 100}%`}}
                        ></div>
                      </div>
                      <span className="text-sm font-semibold">{(analysisResult.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-900 mb-2">Detected Patterns:</p>
                    <ul className="text-xs space-y-1">
                      {analysisResult.patterns.map((pattern, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span className="text-red-600">•</span>
                          <span className="text-gray-700">{pattern}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-2 bg-white rounded text-xs">
                    <p className="font-semibold text-gray-900 mb-1">Recommendation:</p>
                    <p className="text-gray-700">{analysisResult.recommendation}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

