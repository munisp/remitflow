import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './App.jsx';
import Dashboard from './App.jsx';
import Agents from './pages/Agents';
import Customers from './pages/Customers';
import Transactions from './pages/Transactions';
import Settings from './pages/Settings';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="agents" element={<Agents />} />
          <Route path="customers" element={<Customers />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;

