import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

// Import existing components
import AgentEcommerceDashboard from './components/agent-ecommerce/AgentEcommerceDashboard';
import CustomerStorefront from './components/customer-storefront/CustomerStorefront';
import CommunicationsDashboard from './components/communications/CommunicationsDashboard';

// Import new WhatsApp component
import WhatsAppOrderManagement from './components/whatsapp-orders/WhatsAppOrderManagement';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true); // Set to true for demo

  return (
    <Router>
      <div className="App">
        <Routes>
          {/* Public Routes */}
          <Route path="/shop/*" element={<CustomerStorefront />} />
          
          {/* Protected Routes */}
          <Route 
            path="/admin/ecommerce" 
            element={isAuthenticated ? <AgentEcommerceDashboard /> : <Navigate to="/login" />} 
          />
          
          <Route 
            path="/admin/communications" 
            element={isAuthenticated ? <CommunicationsDashboard /> : <Navigate to="/login" />} 
          />
          
          <Route 
            path="/admin/whatsapp-orders" 
            element={isAuthenticated ? <WhatsAppOrderManagement /> : <Navigate to="/login" />} 
          />
          
          {/* Default route */}
          <Route path="/" element={<Navigate to="/shop" />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;

