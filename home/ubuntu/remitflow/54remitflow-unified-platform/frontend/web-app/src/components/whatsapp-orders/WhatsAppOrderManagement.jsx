import React, { useState, useEffect } from 'react';
import './WhatsAppOrderManagement.css';

const WhatsAppOrderManagement = () => {
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [stats, setStats] = useState({
    todayOrders: 47,
    pendingResponses: 12,
    conversionRate: 68,
    revenue: 285000,
    avgResponseTime: 2.3
  });

  // Sample orders data
  const sampleOrders = [
    {
      id: 'WA-001',
      customer: {
        name: 'Ada Obi',
        phone: '+234 803 123 4567',
        avatar: 'AO'
      },
      items: [
        { name: 'Paracetamol 500mg', quantity: 1, price: 500 },
        { name: 'Multivitamin Complex', quantity: 1, price: 3500 }
      ],
      total: 4000,
      status: 'new',
      time: '2 min ago',
      messages: [
        { sender: 'customer', text: 'Hi, I need something for a headache', time: '10:30' },
        { sender: 'store', text: 'Good morning! I\'m sorry to hear that. 😊\n\nFor headaches, we recommend:\n1. Paracetamol 500mg (₦500)\n2. Ibuprofen 400mg (₦800)', time: '10:31' },
        { sender: 'customer', text: 'I\'ll take option 1, and do you have multivitamins?', time: '10:32' },
        { sender: 'store', text: 'Perfect! Yes, we have Multivitamin Complex for ₦3,500.\n\nYour cart:\n• Paracetamol 500mg x1 - ₦500\n• Multivitamin Complex x1 - ₦3,500\n\nTotal: ₦4,000 (FREE delivery!)', time: '10:32' }
      ]
    },
    {
      id: 'WA-002',
      customer: {
        name: 'Chidi Ike',
        phone: '+234 801 234 5678',
        avatar: 'CI'
      },
      items: [
        { name: 'Digital Thermometer', quantity: 1, price: 2500 },
        { name: 'Hand Sanitizer', quantity: 2, price: 1200 }
      ],
      total: 4900,
      status: 'processing',
      time: '15 min ago',
      messages: []
    },
    {
      id: 'WA-003',
      customer: {
        name: 'Funmi Nwosu',
        phone: '+234 802 345 6789',
        avatar: 'FN'
      },
      items: [
        { name: 'Ibuprofen 400mg', quantity: 2, price: 800 },
        { name: 'Vitamin C 500mg', quantity: 1, price: 2500 }
      ],
      total: 4100,
      status: 'shipped',
      time: '1 hour ago',
      messages: []
    },
    {
      id: 'WA-004',
      customer: {
        name: 'Tunde Musa',
        phone: '+234 805 456 7890',
        avatar: 'TM'
      },
      items: [
        { name: 'Baby Wipes', quantity: 3, price: 800 },
        { name: 'Antibiotics (Prescription)', quantity: 1, price: 4500 }
      ],
      total: 6900,
      status: 'new',
      time: '5 min ago',
      messages: []
    },
    {
      id: 'WA-005',
      customer: {
        name: 'Blessing Okoro',
        phone: '+234 807 567 8901',
        avatar: 'BO'
      },
      items: [
        { name: 'Multivitamin Complex', quantity: 2, price: 3500 }
      ],
      total: 7000,
      status: 'delivered',
      time: '3 hours ago',
      messages: []
    }
  ];

  useEffect(() => {
    setOrders(sampleOrders);
  }, []);

  const getFilteredOrders = () => {
    if (filter === 'all') return orders;
    return orders.filter(order => order.status === filter);
  };

  const getStatusBadge = (status) => {
    const badges = {
      new: { text: 'New Order', class: 'status-badge new' },
      processing: { text: 'Processing', class: 'status-badge processing' },
      shipped: { text: 'Shipped', class: 'status-badge shipped' },
      delivered: { text: 'Delivered', class: 'status-badge delivered' }
    };
    return badges[status] || badges.new;
  };

  const openChat = (order) => {
    setSelectedOrder(order);
    setChatOpen(true);
  };

  const closeChat = () => {
    setChatOpen(false);
  };

  const handleQuickAction = (action) => {
    console.log(`Quick action: ${action} for order ${selectedOrder?.id}`);
    // Implement quick action logic here
    // This would call the backend API
  };

  const formatCurrency = (amount) => {
    return `₦${amount.toLocaleString()}`;
  };

  return (
    <div className="whatsapp-order-management">
      {/* Header */}
      <div className="wom-header">
        <h1>WhatsApp Order Management</h1>
        <div className="whatsapp-status">
          <div className="status-dot"></div>
          <span><strong>WhatsApp Connected</strong></span>
          <span className="status-phone">+234 803 123 4567</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <h3>WhatsApp Orders Today</h3>
          <div className="stat-value">{stats.todayOrders}</div>
          <div className="stat-change positive">↑ 23% from yesterday</div>
        </div>

        <div className="stat-card">
          <h3>Pending Responses</h3>
          <div className="stat-value">{stats.pendingResponses}</div>
          <div className="stat-change">Avg response: {stats.avgResponseTime} min</div>
        </div>

        <div className="stat-card">
          <h3>Conversion Rate</h3>
          <div className="stat-value">{stats.conversionRate}%</div>
          <div className="stat-change positive">↑ 5% this week</div>
        </div>

        <div className="stat-card">
          <h3>Revenue (WhatsApp)</h3>
          <div className="stat-value">{formatCurrency(stats.revenue)}</div>
          <div className="stat-change positive">↑ 18% from last week</div>
        </div>
      </div>

      {/* Orders Section */}
      <div className="orders-section">
        <div className="section-header">
          <h2>Recent WhatsApp Orders</h2>
          <div className="filters">
            <button 
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button 
              className={`filter-btn ${filter === 'new' ? 'active' : ''}`}
              onClick={() => setFilter('new')}
            >
              New
            </button>
            <button 
              className={`filter-btn ${filter === 'processing' ? 'active' : ''}`}
              onClick={() => setFilter('processing')}
            >
              Processing
            </button>
            <button 
              className={`filter-btn ${filter === 'shipped' ? 'active' : ''}`}
              onClick={() => setFilter('shipped')}
            >
              Shipped
            </button>
            <button 
              className={`filter-btn ${filter === 'delivered' ? 'active' : ''}`}
              onClick={() => setFilter('delivered')}
            >
              Delivered
            </button>
          </div>
        </div>

        <table className="orders-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {getFilteredOrders().map(order => (
              <tr key={order.id}>
                <td><strong>#{order.id}</strong></td>
                <td>
                  <div className="customer-info">
                    <div className="customer-avatar">{order.customer.avatar}</div>
                    <div className="customer-details">
                      <h4>{order.customer.name}</h4>
                      <p>{order.customer.phone}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="order-items">
                    {order.items.map((item, idx) => (
                      <div key={idx}>
                        {item.name} x{item.quantity}
                      </div>
                    ))}
                  </div>
                </td>
                <td><strong>{formatCurrency(order.total)}</strong></td>
                <td>
                  <span className={getStatusBadge(order.status).class}>
                    {getStatusBadge(order.status).text}
                  </span>
                </td>
                <td>{order.time}</td>
                <td>
                  <div className="action-buttons">
                    <button 
                      className="action-btn whatsapp"
                      onClick={() => openChat(order)}
                    >
                      💬 Chat
                    </button>
                    <button className="action-btn view">View</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Chat Panel */}
      {chatOpen && selectedOrder && (
        <div className="chat-panel open">
          <div className="chat-header">
            <h3>{selectedOrder.customer.name}</h3>
            <button className="close-chat" onClick={closeChat}>×</button>
          </div>

          <div className="chat-messages">
            {selectedOrder.messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.sender}`}>
                <div className="message-bubble">
                  {msg.text}
                </div>
                <div className="message-time">{msg.time}</div>
              </div>
            ))}
          </div>

          <div className="quick-actions">
            <button 
              className="quick-action-btn"
              onClick={() => handleQuickAction('confirm')}
            >
              ✅ Confirm Order
            </button>
            <button 
              className="quick-action-btn"
              onClick={() => handleQuickAction('ship')}
            >
              📦 Mark Shipped
            </button>
            <button 
              className="quick-action-btn"
              onClick={() => handleQuickAction('tracking')}
            >
              🚚 Send Tracking
            </button>
            <button 
              className="quick-action-btn"
              onClick={() => handleQuickAction('payment')}
            >
              💳 Send Payment
            </button>
            <button 
              className="quick-action-btn"
              onClick={() => handleQuickAction('info')}
            >
              📋 Request Info
            </button>
            <button 
              className="quick-action-btn"
              onClick={() => handleQuickAction('cancel')}
            >
              ❌ Cancel Order
            </button>
          </div>

          <div className="chat-input">
            <input type="text" placeholder="Type a message..." />
            <button className="send-btn">▶</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppOrderManagement;

