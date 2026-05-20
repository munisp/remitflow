import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom'
import { 
  Brain, Search, Network, MessageSquare, Bot, 
  Code, Database, Sparkles, Activity, Settings
} from 'lucide-react'
import './App.css'

// Import components (we'll create these)
import CocoIndexUI from './components/CocoIndexUI'
import FalkorDBUI from './components/FalkorDBUI'
import OllamaUI from './components/OllamaUI'
import EPRKGQAui from './components/EPRKGQAui'
import ARTAgentUI from './components/ARTAgentUI'
import DashboardHome from './components/DashboardHome'

function Navigation() {
  const location = useLocation()
  
  const navItems = [
    { path: '/', icon: Activity, label: 'Dashboard', color: 'text-blue-500' },
    { path: '/cocoindex', icon: Code, label: 'CocoIndex', color: 'text-purple-500' },
    { path: '/falkordb', icon: Network, label: 'FalkorDB', color: 'text-green-500' },
    { path: '/ollama', icon: Brain, label: 'Ollama', color: 'text-orange-500' },
    { path: '/kgqa', icon: MessageSquare, label: 'EPR-KGQA', color: 'text-cyan-500' },
    { path: '/art-agent', icon: Bot, label: 'ART Agent', color: 'text-pink-500' },
  ]

  return (
    <nav className="w-64 bg-gray-900 text-white min-h-screen p-6 flex flex-col">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="w-8 h-8 text-yellow-400" />
          <h1 className="text-2xl font-bold">AI/ML Hub</h1>
        </div>
        <p className="text-gray-400 text-sm">Intelligent Banking Platform</p>
      </div>

      <div className="space-y-2 flex-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.path
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive 
                  ? 'bg-gray-800 border-l-4 border-blue-500' 
                  : 'hover:bg-gray-800 border-l-4 border-transparent'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? item.color : 'text-gray-400'}`} />
              <span className={isActive ? 'font-semibold' : 'text-gray-300'}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>

      <div className="mt-auto pt-6 border-t border-gray-800">
        <div className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white cursor-pointer">
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </div>
      </div>
    </nav>
  )
}

function App() {
  return (
    <Router>
      <div className="flex min-h-screen bg-gray-50">
        <Navigation />
        
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardHome />} />
            <Route path="/cocoindex" element={<CocoIndexUI />} />
            <Route path="/falkordb" element={<FalkorDBUI />} />
            <Route path="/ollama" element={<OllamaUI />} />
            <Route path="/kgqa" element={<EPRKGQAui />} />
            <Route path="/art-agent" element={<ARTAgentUI />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App

