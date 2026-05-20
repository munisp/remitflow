import { useState } from 'react'
import { Bot, Play, Clock, CheckCircle, AlertCircle, Zap, Brain, Tool } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ARTAgentUI() {
  const [taskDescription, setTaskDescription] = useState('')
  const [taskResult, setTaskResult] = useState(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  const availableTools = [
    { name: 'query_knowledge_graph', description: 'Query FalkorDB for graph data', status: 'ready' },
    { name: 'ask_question', description: 'Use EPR-KGQA for Q&A', status: 'ready' },
    { name: 'check_transaction', description: 'Get transaction details', status: 'ready' },
    { name: 'check_agent_status', description: 'Get agent information', status: 'ready' },
    { name: 'detect_fraud', description: 'Analyze for fraud patterns', status: 'ready' },
    { name: 'calculate', description: 'Perform calculations', status: 'ready' },
    { name: 'search_transactions', description: 'Search with filters', status: 'ready' },
    { name: 'get_account_balance', description: 'Get balance info', status: 'ready' }
  ]

  const sampleTasks = [
    "Check if agent AG-12345 has any suspicious transactions",
    "Investigate fraud patterns for agent AG-67890",
    "Analyze all transactions above $10,000 today",
    "Find agents connected to suspended accounts",
    "Generate compliance report for agent AG-12345"
  ]

  const executeTask = () => {
    setIsExecuting(true)
    setCurrentStep(0)
    
    const steps = [
      {
        step_number: 1,
        thought: "I need to check the agent's status first to understand their current state",
        action: "check_agent_status",
        action_input: { agent_id: "AG-12345" },
        observation: "Agent AG-12345 is active with balance $15,000. Account created 2 years ago."
      },
      {
        step_number: 2,
        thought: "Now I should search for recent transactions to identify patterns",
        action: "search_transactions",
        action_input: { agent_id: "AG-12345", days: 7 },
        observation: "Found 87 transactions in the last 7 days totaling $125,000"
      },
      {
        step_number: 3,
        thought: "That's unusual activity. I should check for fraud patterns using the graph database",
        action: "query_knowledge_graph",
        action_input: { query: "MATCH (a:Agent {id: 'AG-12345'})-[:PERFORMED]->(t:Transaction) RETURN count(t)" },
        observation: "Graph analysis shows rapid transaction pattern - 15 transactions in 1 hour"
      },
      {
        step_number: 4,
        thought: "This is definitely suspicious. Let me run fraud detection",
        action: "detect_fraud",
        action_input: { entity_id: "AG-12345", entity_type: "agent" },
        observation: "FRAUD ALERT: Risk level HIGH. Detected rapid_transactions pattern and unusual_amount pattern"
      },
      {
        step_number: 5,
        thought: "I have gathered enough evidence. Time to compile the final report",
        action: "finish",
        action_input: {},
        observation: null
      }
    ]

    // Simulate step-by-step execution
    let stepIndex = 0
    const interval = setInterval(() => {
      if (stepIndex < steps.length) {
        setCurrentStep(stepIndex + 1)
        stepIndex++
      } else {
        clearInterval(interval)
        setTaskResult({
          task_id: 'task-' + Date.now(),
          status: 'completed',
          reasoning_trace: steps,
          final_answer: "Based on my investigation of agent AG-12345, I found significant evidence of suspicious activity:\n\n1. **High Transaction Volume**: 87 transactions in 7 days ($125,000 total)\n2. **Rapid Transactions**: 15 transactions within 1 hour\n3. **Unusual Amounts**: Transactions 5x higher than agent's average\n4. **Risk Assessment**: HIGH RISK\n\n**Recommendation**: Immediately suspend agent AG-12345 pending investigation. Flag all recent transactions for review. Contact agent for verification of recent activity.\n\n**Evidence Collected**:\n- Transaction logs (87 records)\n- Graph analysis (network patterns)\n- Fraud detection results (2 patterns detected)\n- Historical baseline comparison\n\nThis investigation was completed autonomously in 8.5 seconds using 5 reasoning steps and 4 tool executions.",
          confidence: 0.95,
          execution_time: 8.5
        })
        setIsExecuting(false)
      }
    }, 1500)
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-pink-100 rounded-lg">
            <Bot className="w-8 h-8 text-pink-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">ART Agent</h1>
            <p className="text-gray-600">Autonomous Reasoning & Tool-use Agent</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Tasks Completed</p>
          <p className="text-2xl font-bold text-gray-900">789</p>
          <p className="text-xs text-green-600 mt-1">↑ 45 today</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Success Rate</p>
          <p className="text-2xl font-bold text-gray-900">95%</p>
          <p className="text-xs text-green-600 mt-1">↑ 2%</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Avg Execution Time</p>
          <p className="text-2xl font-bold text-gray-900">6.2s</p>
          <p className="text-xs text-green-600 mt-1">↓ 1.3s</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Available Tools</p>
          <p className="text-2xl font-bold text-gray-900">8</p>
          <p className="text-xs text-gray-500 mt-1">All operational</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Execution */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Create Task</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Task Description
                </label>
                <textarea
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                  rows="3"
                  placeholder="Describe what you want the agent to do..."
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                />
              </div>

              <Button 
                className="w-full bg-pink-600 hover:bg-pink-700"
                onClick={executeTask}
                disabled={isExecuting || !taskDescription.trim()}
              >
                {isExecuting ? (
                  <>
                    <Zap className="w-4 h-4 mr-2 animate-pulse" />
                    Executing Task...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Execute Task
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Reasoning Trace */}
          {taskResult && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Reasoning Trace</h2>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600">{taskResult.execution_time}s</span>
                </div>
              </div>

              <div className="space-y-4">
                {taskResult.reasoning_trace.map((step, index) => (
                  <div 
                    key={step.step_number}
                    className={`border-l-4 border-pink-500 bg-pink-50 rounded-r-lg p-4 ${
                      isExecuting && index === currentStep ? 'animate-pulse' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center justify-center w-6 h-6 bg-pink-600 text-white rounded-full text-xs font-bold">
                          {step.step_number}
                        </div>
                        <span className="font-semibold text-gray-900">
                          Step {step.step_number}
                        </span>
                      </div>
                      {!isExecuting && (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      )}
                    </div>

                    <div className="ml-8 space-y-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Brain className="w-4 h-4 text-pink-600" />
                          <span className="text-xs font-semibold text-gray-700">THOUGHT</span>
                        </div>
                        <p className="text-sm text-gray-800">{step.thought}</p>
                      </div>

                      {step.action && step.action !== 'finish' && (
                        <>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Tool className="w-4 h-4 text-pink-600" />
                              <span className="text-xs font-semibold text-gray-700">ACTION</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="text-sm bg-gray-900 text-green-400 px-2 py-1 rounded">
                                {step.action}
                              </code>
                              <code className="text-xs text-gray-600">
                                {JSON.stringify(step.action_input)}
                              </code>
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Zap className="w-4 h-4 text-pink-600" />
                              <span className="text-xs font-semibold text-gray-700">OBSERVATION</span>
                            </div>
                            <p className="text-sm text-gray-700 bg-white p-2 rounded">
                              {step.observation}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Final Answer */}
          {taskResult && !isExecuting && (
            <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-lg shadow p-6 border border-pink-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-pink-600 rounded-lg">
                  <CheckCircle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Task Completed</h2>
                  <p className="text-sm text-gray-600">Confidence: {(taskResult.confidence * 100).toFixed(0)}%</p>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Final Answer</h3>
                <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {taskResult.final_answer}
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1">
                  Export Report
                </Button>
                <Button variant="outline" className="flex-1">
                  Create Follow-up Task
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Sample Tasks */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Sample Tasks</h2>
            <div className="space-y-2">
              {sampleTasks.map((task, index) => (
                <button
                  key={index}
                  className="w-full text-left p-3 bg-gray-50 hover:bg-pink-50 rounded-lg transition-colors text-sm"
                  onClick={() => setTaskDescription(task)}
                >
                  {task}
                </button>
              ))}
            </div>
          </div>

          {/* Available Tools */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Available Tools</h2>
            <div className="space-y-2">
              {availableTools.map((tool, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <code className="text-xs font-semibold text-pink-600">
                      {tool.name}
                    </code>
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                      {tool.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{tool.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Tasks */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-bold text-gray-900 mb-3">Recent Tasks</h3>
            <div className="space-y-2">
              {[
                { task: 'Fraud investigation AG-12345', status: 'completed', time: '2m ago' },
                { task: 'Compliance check AG-67890', status: 'completed', time: '15m ago' },
                { task: 'Transaction analysis', status: 'completed', time: '1h ago' }
              ].map((item, index) => (
                <div key={index} className="p-2 bg-gray-50 rounded text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-900 font-medium">{item.task}</span>
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  </div>
                  <span className="text-xs text-gray-500">{item.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

