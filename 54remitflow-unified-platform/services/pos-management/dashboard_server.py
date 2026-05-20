#!/usr/bin/env python3

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import uuid

import aioredis
import asyncpg
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
from pydantic import BaseModel
import websockets
import psutil
import requests

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic models
class TerminalStatus(BaseModel):
    terminal_id: str
    status: str
    version: str
    last_seen: datetime
    location: Optional[Dict[str, Any]] = None
    performance: Optional[Dict[str, Any]] = None
    configuration: Optional[Dict[str, Any]] = None

class UpdateRequest(BaseModel):
    terminal_id: str
    update_type: str
    payload: Dict[str, Any]
    priority: int = 1
    version: Optional[str] = None

class CommandRequest(BaseModel):
    terminal_id: str
    command: str
    parameters: Dict[str, Any] = {}
    timeout: int = 30

class ConfigurationUpdate(BaseModel):
    terminal_id: str
    configuration: Dict[str, Any]

class AlertModel(BaseModel):
    terminal_id: str
    alert_type: str
    severity: str
    message: str
    timestamp: datetime

# Dashboard Server Class
class POSDashboardServer:
    def __init__(self):
        self.app = FastAPI(title="POS Management Dashboard", version="2.4.0")
        self.redis_client = None
        self.db_pool = None
        self.websocket_connections: Dict[str, WebSocket] = {}
        self.terminal_connections: Dict[str, Dict] = {}
        self.security = HTTPBearer()
        
        # Performance metrics
        self.metrics = {
            'total_terminals': 0,
            'online_terminals': 0,
            'offline_terminals': 0,
            'total_updates_sent': 0,
            'total_commands_executed': 0,
            'average_response_time': 0.0,
            'system_health': 'healthy'
        }
        
        self.setup_middleware()
        self.setup_routes()
        self.setup_websocket_routes()
        
    def setup_middleware(self):
        """Setup CORS and other middleware"""
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        
    def setup_routes(self):
        """Setup REST API routes"""
        
        @self.app.on_event("startup")
        async def startup_event():
            await self.initialize_connections()
            asyncio.create_task(self.background_tasks())
            
        @self.app.on_event("shutdown")
        async def shutdown_event():
            await self.cleanup_connections()
            
        @self.app.get("/")
        async def dashboard_home():
            return HTMLResponse(content=self.get_dashboard_html())
            
        @self.app.get("/health")
        async def health_check():
            return {
                "status": "healthy",
                "service": "pos-dashboard-server",
                "version": "2.4.0",
                "timestamp": datetime.now().isoformat(),
                "metrics": self.metrics
            }
            
        @self.app.get("/api/v1/terminals")
        async def get_terminals():
            """Get all terminals with their status"""
            terminals = []
            
            for terminal_id, connection_info in self.terminal_connections.items():
                terminal_data = {
                    "terminal_id": terminal_id,
                    "status": connection_info.get("status", "unknown"),
                    "last_seen": connection_info.get("last_seen", datetime.now()).isoformat(),
                    "version": connection_info.get("version", "unknown"),
                    "location": connection_info.get("location"),
                    "performance": connection_info.get("performance"),
                    "configuration": connection_info.get("configuration"),
                    "uptime": connection_info.get("uptime", 0),
                    "health_score": self.calculate_health_score(connection_info)
                }
                terminals.append(terminal_data)
                
            return {
                "terminals": terminals,
                "total_count": len(terminals),
                "online_count": len([t for t in terminals if t["status"] == "online"]),
                "offline_count": len([t for t in terminals if t["status"] == "offline"]),
                "timestamp": datetime.now().isoformat()
            }
            
        @self.app.get("/api/v1/terminals/{terminal_id}")
        async def get_terminal(terminal_id: str):
            """Get specific terminal details"""
            if terminal_id not in self.terminal_connections:
                raise HTTPException(status_code=404, detail="Terminal not found")
                
            connection_info = self.terminal_connections[terminal_id]
            
            # Get detailed performance history
            performance_history = await self.get_performance_history(terminal_id)
            
            # Get recent alerts
            recent_alerts = await self.get_recent_alerts(terminal_id)
            
            # Get update history
            update_history = await self.get_update_history(terminal_id)
            
            return {
                "terminal_id": terminal_id,
                "status": connection_info.get("status", "unknown"),
                "last_seen": connection_info.get("last_seen", datetime.now()).isoformat(),
                "version": connection_info.get("version", "unknown"),
                "location": connection_info.get("location"),
                "performance": connection_info.get("performance"),
                "configuration": connection_info.get("configuration"),
                "health_score": self.calculate_health_score(connection_info),
                "performance_history": performance_history,
                "recent_alerts": recent_alerts,
                "update_history": update_history,
                "network_info": connection_info.get("network_info"),
                "system_info": connection_info.get("system_info")
            }
            
        @self.app.post("/api/v1/updates")
        async def push_update(update_request: UpdateRequest, background_tasks: BackgroundTasks):
            """Push update to terminal(s)"""
            update_id = str(uuid.uuid4())
            
            update_message = {
                "id": update_id,
                "terminal_id": update_request.terminal_id,
                "type": update_request.update_type,
                "payload": update_request.payload,
                "version": update_request.version or "1.0.0",
                "priority": update_request.priority,
                "timestamp": datetime.now().isoformat(),
                "signature": self.generate_signature(update_request.payload)
            }
            
            # Send update via management server
            success = await self.send_update_to_management_server(update_message)
            
            if success:
                # Log update
                await self.log_update(update_message)
                
                # Update metrics
                self.metrics['total_updates_sent'] += 1
                
                background_tasks.add_task(self.track_update_response, update_id)
                
                return {
                    "update_id": update_id,
                    "status": "sent",
                    "timestamp": datetime.now().isoformat(),
                    "target_terminal": update_request.terminal_id
                }
            else:
                raise HTTPException(status_code=500, detail="Failed to send update")
                
        @self.app.post("/api/v1/commands")
        async def execute_command(command_request: CommandRequest, background_tasks: BackgroundTasks):
            """Execute command on terminal"""
            command_id = str(uuid.uuid4())
            
            command_message = {
                "id": command_id,
                "terminal_id": command_request.terminal_id,
                "command": command_request.command,
                "parameters": command_request.parameters,
                "timeout": command_request.timeout,
                "timestamp": datetime.now().isoformat(),
                "signature": self.generate_signature(command_request.parameters)
            }
            
            # Send command via management server
            success = await self.send_command_to_management_server(command_message)
            
            if success:
                # Log command
                await self.log_command(command_message)
                
                # Update metrics
                self.metrics['total_commands_executed'] += 1
                
                background_tasks.add_task(self.track_command_response, command_id)
                
                return {
                    "command_id": command_id,
                    "status": "sent",
                    "timestamp": datetime.now().isoformat(),
                    "target_terminal": command_request.terminal_id
                }
            else:
                raise HTTPException(status_code=500, detail="Failed to send command")
                
        @self.app.post("/api/v1/configuration")
        async def update_configuration(config_update: ConfigurationUpdate):
            """Update terminal configuration"""
            update_request = UpdateRequest(
                terminal_id=config_update.terminal_id,
                update_type="configuration",
                payload=config_update.configuration
            )
            
            return await push_update(update_request, BackgroundTasks())
            
        @self.app.get("/api/v1/metrics")
        async def get_metrics():
            """Get system metrics and statistics"""
            # Update real-time metrics
            await self.update_metrics()
            
            return {
                "system_metrics": self.metrics,
                "terminal_metrics": await self.get_terminal_metrics(),
                "performance_metrics": await self.get_performance_metrics(),
                "alert_metrics": await self.get_alert_metrics(),
                "timestamp": datetime.now().isoformat()
            }
            
        @self.app.get("/api/v1/alerts")
        async def get_alerts(limit: int = 100, severity: Optional[str] = None):
            """Get system alerts"""
            alerts = await self.get_alerts_from_db(limit, severity)
            return {
                "alerts": alerts,
                "count": len(alerts),
                "timestamp": datetime.now().isoformat()
            }
            
        @self.app.post("/api/v1/alerts/{alert_id}/acknowledge")
        async def acknowledge_alert(alert_id: str):
            """Acknowledge an alert"""
            success = await self.acknowledge_alert_in_db(alert_id)
            if success:
                return {"status": "acknowledged", "alert_id": alert_id}
            else:
                raise HTTPException(status_code=404, detail="Alert not found")
                
        @self.app.get("/api/v1/reports/performance")
        async def get_performance_report(
            start_date: Optional[str] = None,
            end_date: Optional[str] = None,
            terminal_id: Optional[str] = None
        ):
            """Generate performance report"""
            report = await self.generate_performance_report(start_date, end_date, terminal_id)
            return report
            
        @self.app.get("/api/v1/reports/updates")
        async def get_update_report(
            start_date: Optional[str] = None,
            end_date: Optional[str] = None,
            terminal_id: Optional[str] = None
        ):
            """Generate update deployment report"""
            report = await self.generate_update_report(start_date, end_date, terminal_id)
            return report
            
    def setup_websocket_routes(self):
        """Setup WebSocket routes for real-time updates"""
        
        @self.app.websocket("/ws/dashboard")
        async def websocket_dashboard(websocket: WebSocket):
            await websocket.accept()
            connection_id = str(uuid.uuid4())
            self.websocket_connections[connection_id] = websocket
            
            try:
                while True:
                    # Send real-time updates to dashboard
                    update_data = {
                        "type": "metrics_update",
                        "data": {
                            "metrics": self.metrics,
                            "terminal_count": len(self.terminal_connections),
                            "timestamp": datetime.now().isoformat()
                        }
                    }
                    
                    await websocket.send_text(json.dumps(update_data))
                    await asyncio.sleep(5)  # Send updates every 5 seconds
                    
            except WebSocketDisconnect:
                del self.websocket_connections[connection_id]
                
        @self.app.websocket("/ws/terminal/{terminal_id}")
        async def websocket_terminal(websocket: WebSocket, terminal_id: str):
            await websocket.accept()
            
            try:
                while True:
                    # Send terminal-specific updates
                    if terminal_id in self.terminal_connections:
                        terminal_data = self.terminal_connections[terminal_id]
                        update_data = {
                            "type": "terminal_update",
                            "data": {
                                "terminal_id": terminal_id,
                                "status": terminal_data.get("status"),
                                "performance": terminal_data.get("performance"),
                                "timestamp": datetime.now().isoformat()
                            }
                        }
                        
                        await websocket.send_text(json.dumps(update_data))
                    
                    await asyncio.sleep(10)  # Send updates every 10 seconds
                    
            except WebSocketDisconnect:
                pass
                
    async def initialize_connections(self):
        """Initialize Redis and PostgreSQL connections"""
        try:
            # Initialize Redis
            self.redis_client = await aioredis.from_url("redis://localhost:6379")
            logger.info("Connected to Redis")
            
            # Initialize PostgreSQL
            self.db_pool = await asyncpg.create_pool(
                "postgresql://postgres:postgres@localhost:5432/pos_management"
            )
            logger.info("Connected to PostgreSQL")
            
            # Initialize database schema
            await self.initialize_database_schema()
            
        except Exception as e:
            logger.error(f"Failed to initialize connections: {e}")
            
    async def cleanup_connections(self):
        """Cleanup connections on shutdown"""
        if self.redis_client:
            await self.redis_client.close()
            
        if self.db_pool:
            await self.db_pool.close()
            
    async def initialize_database_schema(self):
        """Initialize database tables if they don't exist"""
        if not self.db_pool:
            return
            
        async with self.db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS terminal_status (
                    terminal_id VARCHAR(50) PRIMARY KEY,
                    status VARCHAR(20),
                    version VARCHAR(20),
                    last_seen TIMESTAMP,
                    location JSONB,
                    performance JSONB,
                    configuration JSONB,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS update_logs (
                    id VARCHAR(50) PRIMARY KEY,
                    terminal_id VARCHAR(50),
                    update_type VARCHAR(50),
                    payload JSONB,
                    status VARCHAR(20),
                    response JSONB,
                    created_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS command_logs (
                    id VARCHAR(50) PRIMARY KEY,
                    terminal_id VARCHAR(50),
                    command VARCHAR(100),
                    parameters JSONB,
                    result JSONB,
                    status VARCHAR(20),
                    created_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id VARCHAR(50) PRIMARY KEY,
                    terminal_id VARCHAR(50),
                    alert_type VARCHAR(50),
                    severity VARCHAR(20),
                    message TEXT,
                    acknowledged BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    acknowledged_at TIMESTAMP
                )
            """)
            
    async def background_tasks(self):
        """Run background tasks"""
        while True:
            try:
                # Update terminal status from management server
                await self.sync_terminal_status()
                
                # Update metrics
                await self.update_metrics()
                
                # Cleanup old data
                await self.cleanup_old_data()
                
                # Check for alerts
                await self.check_for_alerts()
                
                await asyncio.sleep(30)  # Run every 30 seconds
                
            except Exception as e:
                logger.error(f"Background task error: {e}")
                await asyncio.sleep(60)
                
    async def sync_terminal_status(self):
        """Sync terminal status from management server"""
        try:
            # Get terminal status from management server API
            response = requests.get("http://localhost:8095/api/v1/terminals", timeout=10)
            if response.status_code == 200:
                data = response.json()
                terminals = data.get("terminals", [])
                
                for terminal in terminals:
                    terminal_id = terminal["id"]
                    self.terminal_connections[terminal_id] = {
                        "status": terminal["status"],
                        "version": terminal["version"],
                        "last_seen": datetime.fromisoformat(terminal["last_seen"].replace("Z", "+00:00")),
                        "location": terminal["location"],
                        "performance": terminal["performance"],
                        "configuration": terminal["configuration"]
                    }
                    
                    # Update database
                    await self.update_terminal_in_db(terminal_id, terminal)
                    
        except Exception as e:
            logger.error(f"Failed to sync terminal status: {e}")
            
    async def update_metrics(self):
        """Update system metrics"""
        total_terminals = len(self.terminal_connections)
        online_terminals = len([t for t in self.terminal_connections.values() if t.get("status") == "online"])
        offline_terminals = total_terminals - online_terminals
        
        self.metrics.update({
            "total_terminals": total_terminals,
            "online_terminals": online_terminals,
            "offline_terminals": offline_terminals,
            "system_health": "healthy" if online_terminals > 0 else "warning"
        })
        
        # Calculate average response time
        if self.terminal_connections:
            response_times = []
            for terminal in self.terminal_connections.values():
                perf = terminal.get("performance", {})
                if perf and "network_latency" in perf:
                    response_times.append(perf["network_latency"])
                    
            if response_times:
                self.metrics["average_response_time"] = sum(response_times) / len(response_times)
                
    async def send_update_to_management_server(self, update_message: Dict) -> bool:
        """Send update to management server"""
        try:
            response = requests.post(
                "http://localhost:8095/api/v1/updates",
                json=update_message,
                timeout=10
            )
            return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to send update to management server: {e}")
            return False
            
    async def send_command_to_management_server(self, command_message: Dict) -> bool:
        """Send command to management server"""
        try:
            response = requests.post(
                "http://localhost:8095/api/v1/commands",
                json=command_message,
                timeout=10
            )
            return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to send command to management server: {e}")
            return False
            
    def calculate_health_score(self, connection_info: Dict) -> float:
        """Calculate terminal health score"""
        score = 100.0
        
        # Check status
        if connection_info.get("status") != "online":
            score -= 50
            
        # Check last seen
        last_seen = connection_info.get("last_seen")
        if last_seen:
            if isinstance(last_seen, str):
                last_seen = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
            time_diff = datetime.now() - last_seen.replace(tzinfo=None)
            if time_diff.total_seconds() > 300:  # 5 minutes
                score -= 20
                
        # Check performance
        performance = connection_info.get("performance", {})
        if performance:
            cpu_usage = performance.get("cpu_usage", 0)
            memory_usage = performance.get("memory_usage", 0)
            
            if cpu_usage > 80:
                score -= 10
            if memory_usage > 80:
                score -= 10
                
        return max(0, score)
        
    async def get_performance_history(self, terminal_id: str) -> List[Dict]:
        """Get performance history for terminal"""
        # In production, this would query historical performance data
        return [
            {
                "timestamp": (datetime.now() - timedelta(minutes=i*5)).isoformat(),
                "cpu_usage": 45 + (i % 10),
                "memory_usage": 60 + (i % 15),
                "network_latency": 50 + (i % 20)
            }
            for i in range(12)  # Last hour in 5-minute intervals
        ]
        
    async def get_recent_alerts(self, terminal_id: str) -> List[Dict]:
        """Get recent alerts for terminal"""
        if not self.db_pool:
            return []
            
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM alerts 
                WHERE terminal_id = $1 
                ORDER BY created_at DESC 
                LIMIT 10
            """, terminal_id)
            
            return [dict(row) for row in rows]
            
    async def get_update_history(self, terminal_id: str) -> List[Dict]:
        """Get update history for terminal"""
        if not self.db_pool:
            return []
            
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM update_logs 
                WHERE terminal_id = $1 
                ORDER BY created_at DESC 
                LIMIT 20
            """, terminal_id)
            
            return [dict(row) for row in rows]
            
    def generate_signature(self, payload: Dict) -> str:
        """Generate signature for message integrity"""
        signing_key = os.getenv("POS_SIGNING_KEY")
        if not signing_key:
            raise RuntimeError("POS_SIGNING_KEY env var is required")

        message = json.dumps(payload, sort_keys=True).encode("utf-8")
        return hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
        
    async def log_update(self, update_message: Dict):
        """Log update to database"""
        if not self.db_pool:
            return
            
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO update_logs (id, terminal_id, update_type, payload, status)
                VALUES ($1, $2, $3, $4, $5)
            """, 
            update_message["id"],
            update_message["terminal_id"],
            update_message["type"],
            json.dumps(update_message["payload"]),
            "sent"
            )
            
    async def log_command(self, command_message: Dict):
        """Log command to database"""
        if not self.db_pool:
            return
            
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO command_logs (id, terminal_id, command, parameters, status)
                VALUES ($1, $2, $3, $4, $5)
            """,
            command_message["id"],
            command_message["terminal_id"],
            command_message["command"],
            json.dumps(command_message["parameters"]),
            "sent"
            )
            
    async def track_update_response(self, update_id: str):
        """Track update response"""
        # Wait for response and update status
        await asyncio.sleep(30)  # Wait 30 seconds for response
        
        if self.db_pool:
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE update_logs 
                    SET status = 'timeout', completed_at = NOW()
                    WHERE id = $1 AND status = 'sent'
                """, update_id)
                
    async def track_command_response(self, command_id: str):
        """Track command response"""
        # Wait for response and update status
        await asyncio.sleep(30)  # Wait 30 seconds for response
        
        if self.db_pool:
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE command_logs 
                    SET status = 'timeout', completed_at = NOW()
                    WHERE id = $1 AND status = 'sent'
                """, command_id)
                
    async def update_terminal_in_db(self, terminal_id: str, terminal_data: Dict):
        """Update terminal status in database"""
        if not self.db_pool:
            return
            
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO terminal_status (terminal_id, status, version, last_seen, location, performance, configuration, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT (terminal_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    version = EXCLUDED.version,
                    last_seen = EXCLUDED.last_seen,
                    location = EXCLUDED.location,
                    performance = EXCLUDED.performance,
                    configuration = EXCLUDED.configuration,
                    updated_at = NOW()
            """,
            terminal_id,
            terminal_data["status"],
            terminal_data["version"],
            terminal_data["last_seen"],
            json.dumps(terminal_data["location"]),
            json.dumps(terminal_data["performance"]),
            json.dumps(terminal_data["configuration"])
            )
            
    async def get_terminal_metrics(self) -> Dict:
        """Get terminal-specific metrics"""
        return {
            "total_terminals": len(self.terminal_connections),
            "online_terminals": len([t for t in self.terminal_connections.values() if t.get("status") == "online"]),
            "offline_terminals": len([t for t in self.terminal_connections.values() if t.get("status") == "offline"]),
            "average_health_score": self.calculate_average_health_score(),
            "terminals_by_version": self.get_terminals_by_version()
        }
        
    def calculate_average_health_score(self) -> float:
        """Calculate average health score across all terminals"""
        if not self.terminal_connections:
            return 0.0
            
        scores = [self.calculate_health_score(terminal) for terminal in self.terminal_connections.values()]
        return sum(scores) / len(scores)
        
    def get_terminals_by_version(self) -> Dict[str, int]:
        """Get terminal count by version"""
        version_counts = {}
        for terminal in self.terminal_connections.values():
            version = terminal.get("version", "unknown")
            version_counts[version] = version_counts.get(version, 0) + 1
        return version_counts
        
    async def get_performance_metrics(self) -> Dict:
        """Get performance metrics"""
        return {
            "average_cpu_usage": self.calculate_average_cpu_usage(),
            "average_memory_usage": self.calculate_average_memory_usage(),
            "average_network_latency": self.metrics.get("average_response_time", 0),
            "total_transactions_processed": self.calculate_total_transactions(),
            "average_transaction_rate": self.calculate_average_transaction_rate()
        }
        
    def calculate_average_cpu_usage(self) -> float:
        """Calculate average CPU usage across terminals"""
        cpu_values = []
        for terminal in self.terminal_connections.values():
            perf = terminal.get("performance", {})
            if perf and "cpu_usage" in perf:
                cpu_values.append(perf["cpu_usage"])
        return sum(cpu_values) / len(cpu_values) if cpu_values else 0.0
        
    def calculate_average_memory_usage(self) -> float:
        """Calculate average memory usage across terminals"""
        memory_values = []
        for terminal in self.terminal_connections.values():
            perf = terminal.get("performance", {})
            if perf and "memory_usage" in perf:
                memory_values.append(perf["memory_usage"])
        return sum(memory_values) / len(memory_values) if memory_values else 0.0
        
    def calculate_total_transactions(self) -> int:
        """Calculate total transactions processed"""
        # In production, this would query actual transaction data
        return len(self.terminal_connections) * 1000  # Simulated
        
    def calculate_average_transaction_rate(self) -> float:
        """Calculate average transaction rate"""
        rates = []
        for terminal in self.terminal_connections.values():
            perf = terminal.get("performance", {})
            if perf and "transaction_rate" in perf:
                rates.append(perf["transaction_rate"])
        return sum(rates) / len(rates) if rates else 0.0
        
    async def get_alert_metrics(self) -> Dict:
        """Get alert metrics"""
        if not self.db_pool:
            return {"total_alerts": 0, "unacknowledged_alerts": 0}
            
        async with self.db_pool.acquire() as conn:
            total_alerts = await conn.fetchval("SELECT COUNT(*) FROM alerts WHERE created_at > NOW() - INTERVAL '24 hours'")
            unack_alerts = await conn.fetchval("SELECT COUNT(*) FROM alerts WHERE acknowledged = FALSE")
            
            return {
                "total_alerts_24h": total_alerts or 0,
                "unacknowledged_alerts": unack_alerts or 0,
                "alert_rate": (total_alerts or 0) / 24.0  # Alerts per hour
            }
            
    async def get_alerts_from_db(self, limit: int, severity: Optional[str] = None) -> List[Dict]:
        """Get alerts from database"""
        if not self.db_pool:
            return []
            
        query = "SELECT * FROM alerts"
        params = []
        
        if severity:
            query += " WHERE severity = $1"
            params.append(severity)
            
        query += " ORDER BY created_at DESC LIMIT $" + str(len(params) + 1)
        params.append(limit)
        
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]
            
    async def acknowledge_alert_in_db(self, alert_id: str) -> bool:
        """Acknowledge alert in database"""
        if not self.db_pool:
            return False
            
        async with self.db_pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE alerts 
                SET acknowledged = TRUE, acknowledged_at = NOW()
                WHERE id = $1
            """, alert_id)
            
            return result == "UPDATE 1"
            
    async def cleanup_old_data(self):
        """Cleanup old data from database"""
        if not self.db_pool:
            return
            
        async with self.db_pool.acquire() as conn:
            # Delete old logs (older than 30 days)
            await conn.execute("DELETE FROM update_logs WHERE created_at < NOW() - INTERVAL '30 days'")
            await conn.execute("DELETE FROM command_logs WHERE created_at < NOW() - INTERVAL '30 days'")
            await conn.execute("DELETE FROM alerts WHERE created_at < NOW() - INTERVAL '90 days' AND acknowledged = TRUE")
            
    async def check_for_alerts(self):
        """Check for system alerts"""
        # Check for offline terminals
        for terminal_id, terminal in self.terminal_connections.items():
            last_seen = terminal.get("last_seen")
            if last_seen:
                if isinstance(last_seen, str):
                    last_seen = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
                time_diff = datetime.now() - last_seen.replace(tzinfo=None)
                
                if time_diff.total_seconds() > 600:  # 10 minutes
                    await self.create_alert(
                        terminal_id,
                        "connectivity",
                        "high",
                        f"Terminal {terminal_id} has been offline for {int(time_diff.total_seconds()/60)} minutes"
                    )
                    
    async def create_alert(self, terminal_id: str, alert_type: str, severity: str, message: str):
        """Create new alert"""
        if not self.db_pool:
            return
            
        alert_id = str(uuid.uuid4())
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO alerts (id, terminal_id, alert_type, severity, message)
                VALUES ($1, $2, $3, $4, $5)
            """, alert_id, terminal_id, alert_type, severity, message)
            
        # Broadcast alert to connected dashboards
        alert_data = {
            "type": "new_alert",
            "data": {
                "id": alert_id,
                "terminal_id": terminal_id,
                "alert_type": alert_type,
                "severity": severity,
                "message": message,
                "timestamp": datetime.now().isoformat()
            }
        }
        
        await self.broadcast_to_dashboards(alert_data)
        
    async def broadcast_to_dashboards(self, data: Dict):
        """Broadcast data to all connected dashboard websockets"""
        if not self.websocket_connections:
            return
            
        message = json.dumps(data)
        disconnected = []
        
        for connection_id, websocket in self.websocket_connections.items():
            try:
                await websocket.send_text(message)
            except:
                disconnected.append(connection_id)
                
        # Remove disconnected websockets
        for connection_id in disconnected:
            del self.websocket_connections[connection_id]
            
    async def generate_performance_report(self, start_date: Optional[str], end_date: Optional[str], terminal_id: Optional[str]) -> Dict:
        """Generate performance report"""
        # In production, this would generate comprehensive performance reports
        return {
            "report_type": "performance",
            "start_date": start_date or (datetime.now() - timedelta(days=7)).isoformat(),
            "end_date": end_date or datetime.now().isoformat(),
            "terminal_id": terminal_id,
            "summary": {
                "average_cpu_usage": 45.2,
                "average_memory_usage": 62.8,
                "average_response_time": 125.5,
                "total_transactions": 15420,
                "uptime_percentage": 99.2
            },
            "trends": {
                "cpu_trend": "stable",
                "memory_trend": "increasing",
                "response_time_trend": "improving"
            }
        }
        
    async def generate_update_report(self, start_date: Optional[str], end_date: Optional[str], terminal_id: Optional[str]) -> Dict:
        """Generate update deployment report"""
        # In production, this would generate comprehensive update reports
        return {
            "report_type": "updates",
            "start_date": start_date or (datetime.now() - timedelta(days=7)).isoformat(),
            "end_date": end_date or datetime.now().isoformat(),
            "terminal_id": terminal_id,
            "summary": {
                "total_updates": 45,
                "successful_updates": 43,
                "failed_updates": 2,
                "success_rate": 95.6,
                "average_deployment_time": 125.3
            },
            "update_types": {
                "configuration": 25,
                "software": 12,
                "policy": 8
            }
        }
        
    def get_dashboard_html(self) -> str:
        """Get dashboard HTML"""
        return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>POS Management Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; }
        .header { background: #2c3e50; color: white; padding: 1rem; text-align: center; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .metric-card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2rem; font-weight: bold; color: #3498db; }
        .metric-label { color: #7f8c8d; margin-top: 0.5rem; }
        .terminals-section { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .terminal-item { display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #ecf0f1; }
        .terminal-status { padding: 0.25rem 0.75rem; border-radius: 20px; color: white; font-size: 0.8rem; }
        .status-online { background: #27ae60; }
        .status-offline { background: #e74c3c; }
        .refresh-btn { background: #3498db; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 4px; cursor: pointer; margin-bottom: 1rem; }
        .refresh-btn:hover { background: #2980b9; }
    </style>
</head>
<body>
    <div class="header">
        <h1>POS Management Dashboard</h1>
        <p>Real-time Terminal Monitoring & Management</p>
    </div>
    
    <div class="container">
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value" id="total-terminals">0</div>
                <div class="metric-label">Total Terminals</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="online-terminals">0</div>
                <div class="metric-label">Online Terminals</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="offline-terminals">0</div>
                <div class="metric-label">Offline Terminals</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="avg-response-time">0ms</div>
                <div class="metric-label">Avg Response Time</div>
            </div>
        </div>
        
        <div class="terminals-section">
            <button class="refresh-btn" onclick="refreshData()">Refresh Data</button>
            <h2>Terminal Status</h2>
            <div id="terminals-list">
                <p>Loading terminals...</p>
            </div>
        </div>
    </div>
    
    <script>
        let ws = null;
        
        function connectWebSocket() {
            ws = new WebSocket('ws://localhost:8096/ws/dashboard');
            
            ws.onmessage = function(event) {
                const data = JSON.parse(event.data);
                if (data.type === 'metrics_update') {
                    updateMetrics(data.data.metrics);
                }
            };
            
            ws.onclose = function() {
                setTimeout(connectWebSocket, 5000);
            };
        }
        
        function updateMetrics(metrics) {
            document.getElementById('total-terminals').textContent = metrics.total_terminals || 0;
            document.getElementById('online-terminals').textContent = metrics.online_terminals || 0;
            document.getElementById('offline-terminals').textContent = metrics.offline_terminals || 0;
            document.getElementById('avg-response-time').textContent = Math.round(metrics.average_response_time || 0) + 'ms';
        }
        
        async function refreshData() {
            try {
                const response = await fetch('/api/v1/terminals');
                const data = await response.json();
                
                updateMetrics({
                    total_terminals: data.total_count,
                    online_terminals: data.online_count,
                    offline_terminals: data.offline_count
                });
                
                const terminalsList = document.getElementById('terminals-list');
                terminalsList.innerHTML = '';
                
                data.terminals.forEach(terminal => {
                    const terminalDiv = document.createElement('div');
                    terminalDiv.className = 'terminal-item';
                    terminalDiv.innerHTML = `
                        <div>
                            <strong>${terminal.terminal_id}</strong><br>
                            <small>Version: ${terminal.version || 'Unknown'}</small>
                        </div>
                        <div>
                            <span class="terminal-status status-${terminal.status}">
                                ${terminal.status.toUpperCase()}
                            </span>
                        </div>
                    `;
                    terminalsList.appendChild(terminalDiv);
                });
                
            } catch (error) {
                console.error('Failed to refresh data:', error);
            }
        }
        
        // Initialize
        connectWebSocket();
        refreshData();
        setInterval(refreshData, 30000); // Refresh every 30 seconds
    </script>
</body>
</html>
        """

# Create and configure the dashboard server
dashboard_server = POSDashboardServer()
app = dashboard_server.app

if __name__ == "__main__":
    uvicorn.run(
        "dashboard_server:app",
        host="0.0.0.0",
        port=8096,
        reload=False,
        log_level="info"
    )

