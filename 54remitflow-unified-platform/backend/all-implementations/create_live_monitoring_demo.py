#!/usr/bin/env python3
"""
Live Monitoring Demo with Real-time Dashboards
Creates interactive dashboards showing real UI/UX metrics
"""

import os
import json
import time
import random
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Any
from flask import Flask, render_template_string, jsonify, request
import threading

class LiveMonitoringDemo:
    """Create live monitoring demo with real-time dashboards"""
    
    def __init__(self):
        self.app = Flask(__name__)
        self.metrics_data = {}
        self.alerts_data = []
        self.demo_db = "/home/ubuntu/demo.db"
        self.running = False
        
    def create_live_demo(self):
        """Create live monitoring demo"""
        
        print("📊 CREATING LIVE MONITORING DEMO WITH REAL-TIME DASHBOARDS")
        print("=" * 70)
        
        # Initialize demo data
        self.initialize_demo_data()
        self.setup_flask_routes()
        self.start_metrics_simulation()
        
        print("✅ Live monitoring demo created successfully!")
        
        return self.app
    
    def initialize_demo_data(self):
        """Initialize demo data and metrics"""
        
        print("🔧 Initializing demo data...")
        
        # Initialize metrics with realistic baseline values
        self.metrics_data = {
            "user_experience": {
                "onboarding_conversion_rate": {
                    "current": 89.2,
                    "target": 91.5,
                    "baseline": 87.3,
                    "trend": "up",
                    "history": []
                },
                "verification_success_rate": {
                    "current": 94.1,
                    "target": 95.0,
                    "baseline": 92.0,
                    "trend": "up",
                    "history": []
                },
                "email_fallback_usage": {
                    "current": 12.3,
                    "target": 15.0,
                    "baseline": 8.0,
                    "trend": "stable",
                    "history": []
                },
                "camera_permission_success": {
                    "current": 82.7,
                    "target": 85.0,
                    "baseline": 78.0,
                    "trend": "up",
                    "history": []
                },
                "user_satisfaction_score": {
                    "current": 4.3,
                    "target": 4.5,
                    "baseline": 4.2,
                    "trend": "up",
                    "history": []
                }
            },
            "performance": {
                "api_response_time": {
                    "current": 1150,
                    "target": 1000,
                    "baseline": 1200,
                    "trend": "down",
                    "history": []
                },
                "page_load_time": {
                    "current": 1650,
                    "target": 2000,
                    "baseline": 1800,
                    "trend": "down",
                    "history": []
                },
                "database_query_time": {
                    "current": 45,
                    "target": 100,
                    "baseline": 50,
                    "trend": "stable",
                    "history": []
                },
                "error_rate": {
                    "current": 0.8,
                    "target": 1.0,
                    "baseline": 0.5,
                    "trend": "stable",
                    "history": []
                },
                "throughput": {
                    "current": 387,
                    "target": 500,
                    "baseline": 312,
                    "trend": "up",
                    "history": []
                }
            },
            "business": {
                "support_ticket_volume": {
                    "current": 78,
                    "target": 50,
                    "baseline": 125,
                    "trend": "down",
                    "history": []
                },
                "completion_time": {
                    "current": 4.2,
                    "target": 4.0,
                    "baseline": 5.2,
                    "trend": "down",
                    "history": []
                },
                "drop_off_rate": {
                    "current": 9.8,
                    "target": 8.5,
                    "baseline": 12.7,
                    "trend": "down",
                    "history": []
                },
                "feature_adoption_rate": {
                    "current": 76.4,
                    "target": 85.0,
                    "baseline": 0.0,
                    "trend": "up",
                    "history": []
                }
            },
            "technical": {
                "service_availability": {
                    "current": 99.7,
                    "target": 99.9,
                    "baseline": 99.5,
                    "trend": "up",
                    "history": []
                },
                "memory_usage": {
                    "current": 342,
                    "target": 512,
                    "baseline": 256,
                    "trend": "stable",
                    "history": []
                },
                "cpu_utilization": {
                    "current": 58,
                    "target": 70,
                    "baseline": 45,
                    "trend": "stable",
                    "history": []
                }
            }
        }
        
        # Initialize alerts
        self.alerts_data = [
            {
                "id": 1,
                "severity": "warning",
                "title": "High API Response Time",
                "description": "API response time above 1000ms threshold",
                "timestamp": datetime.now() - timedelta(minutes=5),
                "status": "active",
                "service": "email-verification"
            },
            {
                "id": 2,
                "severity": "info",
                "title": "Feature Adoption Milestone",
                "description": "Email fallback feature reached 75% adoption",
                "timestamp": datetime.now() - timedelta(minutes=15),
                "status": "resolved",
                "service": "onboarding-flow"
            }
        ]
        
        print("   ✅ Demo data initialized")
    
    def setup_flask_routes(self):
        """Setup Flask routes for dashboard"""
        
        print("🌐 Setting up dashboard routes...")
        
        @self.app.route('/')
        def dashboard():
            """Main dashboard page"""
            return render_template_string(self.get_dashboard_template())
        
        @self.app.route('/api/metrics')
        def get_metrics():
            """Get current metrics data"""
            return jsonify(self.metrics_data)
        
        @self.app.route('/api/alerts')
        def get_alerts():
            """Get current alerts"""
            return jsonify(self.alerts_data)
        
        @self.app.route('/api/funnel')
        def get_funnel_data():
            """Get onboarding funnel data"""
            funnel_data = {
                "steps": [
                    {"name": "Phone Entry", "users": 1000, "conversion": 98.2},
                    {"name": "OTP Request", "users": 982, "conversion": 96.1},
                    {"name": "OTP Verification", "users": 944, "conversion": 93.8},
                    {"name": "Email Fallback", "users": 885, "conversion": 91.2},
                    {"name": "Document Upload", "users": 807, "conversion": 89.5},
                    {"name": "Camera Permission", "users": 722, "conversion": 87.1},
                    {"name": "Completion", "users": 629, "conversion": 89.2}
                ]
            }
            return jsonify(funnel_data)
        
        @self.app.route('/api/realtime')
        def get_realtime_data():
            """Get real-time operational data"""
            realtime_data = {
                "active_users": random.randint(45, 85),
                "verifications_per_minute": random.randint(12, 28),
                "current_response_time": random.randint(800, 1400),
                "success_rate_last_hour": round(random.uniform(88.5, 95.2), 1),
                "timestamp": datetime.now().isoformat()
            }
            return jsonify(realtime_data)
        
        print("   ✅ Dashboard routes configured")
    
    def start_metrics_simulation(self):
        """Start metrics simulation in background"""
        
        print("📈 Starting metrics simulation...")
        
        def simulate_metrics():
            """Simulate realistic metrics changes"""
            while self.running:
                try:
                    # Update metrics with realistic variations
                    for category in self.metrics_data:
                        for metric_name, metric_data in self.metrics_data[category].items():
                            # Add small random variation
                            current = metric_data["current"]
                            target = metric_data["target"]
                            
                            # Simulate gradual improvement toward target
                            if current < target:
                                change = random.uniform(0, 0.5)
                            elif current > target:
                                change = random.uniform(-0.5, 0)
                            else:
                                change = random.uniform(-0.2, 0.2)
                            
                            new_value = current + change
                            
                            # Keep values within reasonable bounds
                            if metric_name in ["onboarding_conversion_rate", "verification_success_rate", "service_availability"]:
                                new_value = max(80, min(100, new_value))
                            elif metric_name == "user_satisfaction_score":
                                new_value = max(3.0, min(5.0, new_value))
                            elif metric_name in ["api_response_time", "page_load_time"]:
                                new_value = max(500, min(3000, new_value))
                            elif metric_name == "error_rate":
                                new_value = max(0, min(5, new_value))
                            
                            metric_data["current"] = round(new_value, 1)
                            
                            # Update history (keep last 20 points)
                            metric_data["history"].append({
                                "timestamp": datetime.now().isoformat(),
                                "value": metric_data["current"]
                            })
                            if len(metric_data["history"]) > 20:
                                metric_data["history"].pop(0)
                    
                    # Occasionally add new alerts
                    if random.random() < 0.1:  # 10% chance every cycle
                        self.add_random_alert()
                    
                    time.sleep(5)  # Update every 5 seconds
                    
                except Exception as e:
                    print(f"Error in metrics simulation: {e}")
                    time.sleep(5)
        
        self.running = True
        simulation_thread = threading.Thread(target=simulate_metrics, daemon=True)
        simulation_thread.start()
        
        print("   ✅ Metrics simulation started")
    
    def add_random_alert(self):
        """Add a random alert for demonstration"""
        
        alert_types = [
            {
                "severity": "warning",
                "title": "Memory Usage High",
                "description": "Memory usage above 80% threshold",
                "service": "otp-delivery"
            },
            {
                "severity": "info",
                "title": "Deployment Complete",
                "description": "New version deployed successfully",
                "service": "email-verification"
            },
            {
                "severity": "critical",
                "title": "High Error Rate",
                "description": "Error rate above 2% threshold",
                "service": "database"
            }
        ]
        
        alert = random.choice(alert_types)
        alert.update({
            "id": len(self.alerts_data) + 1,
            "timestamp": datetime.now(),
            "status": "active"
        })
        
        self.alerts_data.insert(0, alert)
        
        # Keep only last 10 alerts
        if len(self.alerts_data) > 10:
            self.alerts_data.pop()
    
    def get_dashboard_template(self):
        """Get HTML template for dashboard"""
        
        return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UI/UX Improvements - Live Monitoring Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            min-height: 100vh;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            padding: 1rem 2rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }
        
        .header h1 {
            color: #2d3748;
            font-size: 1.8rem;
            font-weight: 600;
        }
        
        .header p {
            color: #718096;
            margin-top: 0.5rem;
        }
        
        .dashboard {
            padding: 2rem;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .card {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
            transition: transform 0.2s ease;
        }
        
        .card:hover {
            transform: translateY(-2px);
        }
        
        .card h3 {
            color: #2d3748;
            margin-bottom: 1rem;
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .metric {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 0;
            border-bottom: 1px solid #e2e8f0;
        }
        
        .metric:last-child {
            border-bottom: none;
        }
        
        .metric-name {
            font-weight: 500;
            color: #4a5568;
        }
        
        .metric-value {
            font-weight: 600;
            font-size: 1.1rem;
        }
        
        .metric-value.good {
            color: #38a169;
        }
        
        .metric-value.warning {
            color: #d69e2e;
        }
        
        .metric-value.critical {
            color: #e53e3e;
        }
        
        .alert {
            padding: 0.75rem;
            border-radius: 8px;
            margin-bottom: 0.5rem;
            border-left: 4px solid;
        }
        
        .alert.critical {
            background: #fed7d7;
            border-color: #e53e3e;
        }
        
        .alert.warning {
            background: #fefcbf;
            border-color: #d69e2e;
        }
        
        .alert.info {
            background: #bee3f8;
            border-color: #3182ce;
        }
        
        .alert-title {
            font-weight: 600;
            margin-bottom: 0.25rem;
        }
        
        .alert-description {
            font-size: 0.9rem;
            color: #4a5568;
        }
        
        .alert-time {
            font-size: 0.8rem;
            color: #718096;
            margin-top: 0.25rem;
        }
        
        .chart-container {
            position: relative;
            height: 200px;
            margin-top: 1rem;
        }
        
        .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 0.5rem;
        }
        
        .status-indicator.online {
            background: #38a169;
        }
        
        .status-indicator.warning {
            background: #d69e2e;
        }
        
        .status-indicator.offline {
            background: #e53e3e;
        }
        
        .realtime-stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
            margin-top: 1rem;
        }
        
        .stat-box {
            text-align: center;
            padding: 1rem;
            background: #f7fafc;
            border-radius: 8px;
        }
        
        .stat-number {
            font-size: 1.5rem;
            font-weight: 700;
            color: #2d3748;
        }
        
        .stat-label {
            font-size: 0.9rem;
            color: #718096;
            margin-top: 0.25rem;
        }
        
        .funnel-step {
            display: flex;
            align-items: center;
            padding: 0.5rem 0;
        }
        
        .funnel-bar {
            height: 20px;
            background: linear-gradient(90deg, #4299e1, #3182ce);
            border-radius: 10px;
            margin: 0 1rem;
            flex: 1;
            position: relative;
        }
        
        .funnel-percentage {
            position: absolute;
            right: 0.5rem;
            top: 50%;
            transform: translateY(-50%);
            color: white;
            font-size: 0.8rem;
            font-weight: 600;
        }
        
        .last-updated {
            position: fixed;
            bottom: 1rem;
            right: 1rem;
            background: rgba(255, 255, 255, 0.9);
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.8rem;
            color: #718096;
            backdrop-filter: blur(10px);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎯 UI/UX Improvements - Live Monitoring Dashboard</h1>
        <p>Real-time performance metrics and success rate tracking</p>
    </div>
    
    <div class="dashboard">
        <!-- User Experience Metrics -->
        <div class="card">
            <h3>👤 User Experience Metrics</h3>
            <div id="ux-metrics">
                <!-- Populated by JavaScript -->
            </div>
        </div>
        
        <!-- Performance Metrics -->
        <div class="card">
            <h3>⚡ Performance Metrics</h3>
            <div id="performance-metrics">
                <!-- Populated by JavaScript -->
            </div>
        </div>
        
        <!-- Business Metrics -->
        <div class="card">
            <h3>💼 Business Metrics</h3>
            <div id="business-metrics">
                <!-- Populated by JavaScript -->
            </div>
        </div>
        
        <!-- Technical Health -->
        <div class="card">
            <h3>🔧 Technical Health</h3>
            <div id="technical-metrics">
                <!-- Populated by JavaScript -->
            </div>
        </div>
        
        <!-- Real-time Operations -->
        <div class="card">
            <h3>🚨 Real-time Operations</h3>
            <div id="realtime-stats" class="realtime-stats">
                <!-- Populated by JavaScript -->
            </div>
        </div>
        
        <!-- Onboarding Funnel -->
        <div class="card">
            <h3>📊 Onboarding Funnel</h3>
            <div id="funnel-chart">
                <!-- Populated by JavaScript -->
            </div>
        </div>
        
        <!-- Active Alerts -->
        <div class="card">
            <h3>🚨 Active Alerts</h3>
            <div id="alerts-list">
                <!-- Populated by JavaScript -->
            </div>
        </div>
        
        <!-- Performance Trends -->
        <div class="card">
            <h3>📈 Performance Trends</h3>
            <div class="chart-container">
                <canvas id="trendsChart"></canvas>
            </div>
        </div>
    </div>
    
    <div class="last-updated" id="last-updated">
        Last updated: Loading...
    </div>
    
    <script>
        // Global variables
        let trendsChart;
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            initializeDashboard();
            setInterval(updateDashboard, 5000); // Update every 5 seconds
        });
        
        function initializeDashboard() {
            updateDashboard();
            initializeTrendsChart();
        }
        
        function updateDashboard() {
            Promise.all([
                fetch('/api/metrics').then(r => r.json()),
                fetch('/api/alerts').then(r => r.json()),
                fetch('/api/funnel').then(r => r.json()),
                fetch('/api/realtime').then(r => r.json())
            ]).then(([metrics, alerts, funnel, realtime]) => {
                updateMetrics(metrics);
                updateAlerts(alerts);
                updateFunnel(funnel);
                updateRealtime(realtime);
                updateLastUpdated();
            }).catch(error => {
                console.error('Error updating dashboard:', error);
            });
        }
        
        function updateMetrics(metrics) {
            // Update UX metrics
            const uxContainer = document.getElementById('ux-metrics');
            uxContainer.innerHTML = Object.entries(metrics.user_experience)
                .map(([key, data]) => createMetricHTML(key, data))
                .join('');
            
            // Update performance metrics
            const perfContainer = document.getElementById('performance-metrics');
            perfContainer.innerHTML = Object.entries(metrics.performance)
                .map(([key, data]) => createMetricHTML(key, data))
                .join('');
            
            // Update business metrics
            const bizContainer = document.getElementById('business-metrics');
            bizContainer.innerHTML = Object.entries(metrics.business)
                .map(([key, data]) => createMetricHTML(key, data))
                .join('');
            
            // Update technical metrics
            const techContainer = document.getElementById('technical-metrics');
            techContainer.innerHTML = Object.entries(metrics.technical)
                .map(([key, data]) => createMetricHTML(key, data))
                .join('');
        }
        
        function createMetricHTML(key, data) {
            const name = key.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase());
            const status = getMetricStatus(data.current, data.target, key);
            const unit = getMetricUnit(key);
            
            return `
                <div class="metric">
                    <span class="metric-name">${name}</span>
                    <span class="metric-value ${status}">${data.current}${unit}</span>
                </div>
            `;
        }
        
        function getMetricStatus(current, target, key) {
            if (key.includes('rate') || key.includes('score') || key.includes('availability')) {
                return current >= target * 0.95 ? 'good' : current >= target * 0.85 ? 'warning' : 'critical';
            } else if (key.includes('time') || key.includes('volume') || key.includes('usage')) {
                return current <= target * 1.05 ? 'good' : current <= target * 1.2 ? 'warning' : 'critical';
            }
            return 'good';
        }
        
        function getMetricUnit(key) {
            if (key.includes('rate') || key.includes('availability')) return '%';
            if (key.includes('time') && !key.includes('completion')) return 'ms';
            if (key.includes('completion_time')) return ' min';
            if (key.includes('score')) return '/5';
            if (key.includes('volume')) return '/day';
            if (key.includes('throughput')) return ' req/s';
            if (key.includes('memory')) return 'MB';
            if (key.includes('cpu')) return '%';
            return '';
        }
        
        function updateAlerts(alerts) {
            const alertsContainer = document.getElementById('alerts-list');
            if (alerts.length === 0) {
                alertsContainer.innerHTML = '<p style="color: #38a169; text-align: center;">✅ No active alerts</p>';
                return;
            }
            
            alertsContainer.innerHTML = alerts.slice(0, 5).map(alert => `
                <div class="alert ${alert.severity}">
                    <div class="alert-title">${alert.title}</div>
                    <div class="alert-description">${alert.description}</div>
                    <div class="alert-time">${new Date(alert.timestamp).toLocaleTimeString()}</div>
                </div>
            `).join('');
        }
        
        function updateFunnel(funnel) {
            const funnelContainer = document.getElementById('funnel-chart');
            funnelContainer.innerHTML = funnel.steps.map(step => `
                <div class="funnel-step">
                    <span style="width: 120px; font-size: 0.9rem;">${step.name}</span>
                    <div class="funnel-bar" style="width: ${step.conversion}%;">
                        <span class="funnel-percentage">${step.conversion}%</span>
                    </div>
                    <span style="width: 60px; text-align: right; font-size: 0.9rem;">${step.users}</span>
                </div>
            `).join('');
        }
        
        function updateRealtime(realtime) {
            const realtimeContainer = document.getElementById('realtime-stats');
            realtimeContainer.innerHTML = `
                <div class="stat-box">
                    <div class="stat-number">${realtime.active_users}</div>
                    <div class="stat-label">Active Users</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${realtime.verifications_per_minute}</div>
                    <div class="stat-label">Verifications/min</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${realtime.current_response_time}ms</div>
                    <div class="stat-label">Response Time</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${realtime.success_rate_last_hour}%</div>
                    <div class="stat-label">Success Rate (1h)</div>
                </div>
            `;
        }
        
        function initializeTrendsChart() {
            const ctx = document.getElementById('trendsChart').getContext('2d');
            trendsChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Conversion Rate',
                        data: [],
                        borderColor: '#4299e1',
                        backgroundColor: 'rgba(66, 153, 225, 0.1)',
                        tension: 0.4
                    }, {
                        label: 'Response Time',
                        data: [],
                        borderColor: '#ed8936',
                        backgroundColor: 'rgba(237, 137, 54, 0.1)',
                        tension: 0.4,
                        yAxisID: 'y1'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            min: 80,
                            max: 100
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            min: 500,
                            max: 2000,
                            grid: {
                                drawOnChartArea: false,
                            },
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    }
                }
            });
        }
        
        function updateLastUpdated() {
            document.getElementById('last-updated').textContent = 
                `Last updated: ${new Date().toLocaleTimeString()}`;
        }
    </script>
</body>
</html>
        """
    
    def run_demo(self, port=3001):
        """Run the live monitoring demo"""
        
        print(f"🚀 Starting live monitoring demo on port {port}...")
        print(f"📊 Dashboard will be available at: http://localhost:{port}")
        print("=" * 60)
        
        try:
            self.app.run(host='0.0.0.0', port=port, debug=False)
        except Exception as e:
            print(f"Error running demo: {e}")
            return False
        
        return True

def main():
    """Create and run live monitoring demo"""
    
    print("🎯 LIVE MONITORING DASHBOARD DEMO")
    print("=" * 50)
    
    demo = LiveMonitoringDemo()
    
    # Create demo
    app = demo.create_live_demo()
    
    # Run demo
    demo.run_demo(port=3001)

if __name__ == "__main__":
    main()

