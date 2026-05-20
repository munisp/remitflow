import { useState } from 'react'
import { MessageSquare, HelpCircle, Lightbulb, TrendingUp, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function EPRKGQAui() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const sampleQuestions = [
    "What is the balance of agent AG-12345?",
    "Who performed transaction TXN-67890?",
    "How many transactions did agent AG-12345 make today?",
    "Show all agents with suspicious activity",
    "When did agent AG-12345 last transact?",
    "Which agents are connected to suspended accounts?"
  ]

  const askQuestion = () => {
    setIsProcessing(true)
    
    // Simulate API call
    setTimeout(() => {
      setAnswer({
        question: question,
        answer: "Based on the knowledge graph analysis, agent AG-12345 has a current balance of $10,500.00 as of October 14, 2025. This agent has completed 87 transactions in the last 7 days with a total volume of $125,000. The account status is active with no fraud flags.",
        confidence: 0.89,
        entities: [
          { id: 'AG-12345', type: 'agent' }
        ],
        reasoning_path: [
          "1. Identified question type: property_query",
          "2. Extracted entities: ['agent']",
          "3. Extracted relations: ['has_balance']",
          "4. Generated Cypher query: MATCH (e:Agent {id: 'AG-12345'}) RETURN e",
          "5. Executed query and retrieved results",
          "6. Generated natural language answer"
        ],
        sources: ['knowledge_graph', 'banking_domain_kb'],
        timestamp: new Date().toISOString()
      })
      setIsProcessing(false)
    }, 1500)
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-cyan-100 rounded-lg">
            <MessageSquare className="w-8 h-8 text-cyan-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">EPR-KGQA</h1>
            <p className="text-gray-600">Knowledge Graph Question Answering</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Questions Answered</p>
          <p className="text-2xl font-bold text-gray-900">3,456</p>
          <p className="text-xs text-green-600 mt-1">↑ 234 today</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Accuracy Rate</p>
          <p className="text-2xl font-bold text-gray-900">89%</p>
          <p className="text-xs text-green-600 mt-1">↑ 2% this week</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Avg Response Time</p>
          <p className="text-2xl font-bold text-gray-900">180ms</p>
          <p className="text-xs text-green-600 mt-1">↓ 20ms</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Question Types</p>
          <p className="text-2xl font-bold text-gray-900">6</p>
          <p className="text-xs text-gray-500 mt-1">Entity, Property, Temporal...</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Question Interface */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Ask a Question</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Question
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Ask anything about agents, transactions, accounts..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && askQuestion()}
                  />
                  <Button 
                    className="bg-cyan-600 hover:bg-cyan-700 px-6"
                    onClick={askQuestion}
                    disabled={isProcessing || !question.trim()}
                  >
                    {isProcessing ? 'Processing...' : 'Ask'}
                  </Button>
                </div>
              </div>

              {/* Answer Display */}
              {answer && (
                <div className="mt-6 p-6 bg-gradient-to-br from-cyan-50 to-blue-50 rounded-lg border border-cyan-200">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="p-2 bg-cyan-600 rounded-lg">
                      <Lightbulb className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900 mb-2">Answer</h3>
                      <p className="text-gray-800 leading-relaxed">{answer.answer}</p>
                    </div>
                  </div>

                  {/* Confidence */}
                  <div className="mb-4 p-3 bg-white rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Confidence Score</span>
                      <span className="text-sm font-bold text-cyan-600">
                        {(answer.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-cyan-600 h-2 rounded-full transition-all" 
                        style={{width: `${answer.confidence * 100}%`}}
                      ></div>
                    </div>
                  </div>

                  {/* Entities */}
                  {answer.entities.length > 0 && (
                    <div className="mb-4 p-3 bg-white rounded-lg">
                      <h4 className="text-sm font-semibold text-gray-900 mb-2">Extracted Entities</h4>
                      <div className="flex flex-wrap gap-2">
                        {answer.entities.map((entity, index) => (
                          <span 
                            key={index}
                            className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-full text-sm"
                          >
                            {entity.type}: {entity.id}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reasoning Path */}
                  <div className="p-3 bg-white rounded-lg">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Reasoning Process</h4>
                    <ol className="space-y-1">
                      {answer.reasoning_path.map((step, index) => (
                        <li key={index} className="text-xs text-gray-700 flex items-start gap-2">
                          <CheckCircle className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Sources */}
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
                    <span>Sources:</span>
                    {answer.sources.map((source, index) => (
                      <span key={index} className="px-2 py-1 bg-gray-100 rounded">
                        {source}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Question Types */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Supported Question Types</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { type: 'Entity Query', example: 'Who performed transaction X?', icon: '👤' },
                { type: 'Property Query', example: 'What is the balance of agent Y?', icon: '💰' },
                { type: 'Temporal Query', example: 'When did agent Z last transact?', icon: '⏰' },
                { type: 'Verification', example: 'Is agent X active?', icon: '✓' },
                { type: 'Aggregation', example: 'How many transactions did agent Y make?', icon: '📊' },
                { type: 'Explanation', example: 'Why was transaction Z flagged?', icon: '❓' }
              ].map((item, index) => (
                <div key={index} className="p-3 border border-gray-200 rounded-lg hover:border-cyan-300 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{item.icon}</span>
                    <span className="font-semibold text-gray-900 text-sm">{item.type}</span>
                  </div>
                  <p className="text-xs text-gray-600 italic">"{item.example}"</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sample Questions Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Sample Questions</h2>
            <div className="space-y-2">
              {sampleQuestions.map((q, index) => (
                <button
                  key={index}
                  className="w-full text-left p-3 bg-gray-50 hover:bg-cyan-50 rounded-lg transition-colors group"
                  onClick={() => setQuestion(q)}
                >
                  <div className="flex items-start gap-2">
                    <HelpCircle className="w-4 h-4 text-cyan-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-700 group-hover:text-cyan-700">
                      {q}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-lg shadow p-6 border border-cyan-200">
            <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-cyan-600" />
              Tips for Better Results
            </h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-cyan-600">•</span>
                <span>Be specific with entity IDs (e.g., AG-12345)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-600">•</span>
                <span>Use natural language, no SQL needed</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-600">•</span>
                <span>Ask one question at a time</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-600">•</span>
                <span>Include time ranges for better accuracy</span>
              </li>
            </ul>
          </div>

          {/* Recent Questions */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-bold text-gray-900 mb-3">Recent Questions</h3>
            <div className="space-y-2">
              {[
                'Balance of AG-12345',
                'Transactions today',
                'Suspended agents'
              ].map((q, index) => (
                <div key={index} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                  {q}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

