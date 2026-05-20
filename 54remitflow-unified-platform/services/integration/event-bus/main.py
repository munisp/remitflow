#!/usr/bin/env python3
"""
Event Bus Integration Service
Handles event-driven communication between microservices
"""

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum

import aioredis
import asyncpg
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EventType(str, Enum):
    AGENT_REGISTERED = "agent.registered"
    AGENT_UPDATED = "agent.updated"
    TRANSACTION_CREATED = "transaction.created"
    TRANSACTION_COMPLETED = "transaction.completed"
    TRANSACTION_FAILED = "transaction.failed"
    PAYMENT_INITIATED = "payment.initiated"
    PAYMENT_COMPLETED = "payment.completed"
    FLOAT_ALLOCATED = "float.allocated"
    FLOAT_SETTLED = "float.settled"
    SETTLEMENT_STARTED = "settlement.started"
    SETTLEMENT_COMPLETED = "settlement.completed"
    RISK_ASSESSMENT_COMPLETED = "risk.assessment.completed"
    COMPLIANCE_CHECK_COMPLETED = "compliance.check.completed"
    NOTIFICATION_SENT = "notification.sent"
    SYSTEM_ALERT = "system.alert"

class EventPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"

@dataclass
class Event:
    id: str
    type: EventType
    source_service: str
    target_service: Optional[str]
    priority: EventPriority
    payload: Dict[str, Any]
    metadata: Dict[str, Any]
    created_at: datetime
    scheduled_at: Optional[datetime] = None
    retry_count: int = 0
    max_retries: int = 3

class EventRequest(BaseModel):
    type: EventType
    source_service: str
    target_service: Optional[str] = None
    priority: EventPriority = EventPriority.NORMAL
    payload: Dict[str, Any]
    metadata: Dict[str, Any] = {}
    scheduled_at: Optional[datetime] = None

class EventSubscription(BaseModel):
    service_name: str
    event_types: List[EventType]
    endpoint: str
    active: bool = True

class EventBusService:
    def __init__(self):
        self.app = FastAPI(title="Event Bus Service", version="1.0.0")
        self.redis: Optional[aioredis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self.subscriptions: Dict[str, List[EventSubscription]] = {}
        self.event_handlers: Dict[EventType, List[callable]] = {}
        
        self.setup_routes()
        self.setup_middleware()

    def setup_middleware(self):
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def setup_routes(self):
        @self.app.on_event("startup")
        async def startup():
            await self.initialize()

        @self.app.on_event("shutdown")
        async def shutdown():
            await self.cleanup()

        @self.app.get("/health")
        async def health_check():
            return {
                "status": "healthy",
                "service": "event-bus",
                "version": "1.0.0",
                "timestamp": datetime.now().isoformat(),
                "subscriptions": len(self.subscriptions),
                "event_types": len(EventType)
            }

        @self.app.post("/api/events/publish")
        async def publish_event(event_request: EventRequest, background_tasks: BackgroundTasks):
            event = Event(
                id=str(uuid.uuid4()),
                type=event_request.type,
                source_service=event_request.source_service,
                target_service=event_request.target_service,
                priority=event_request.priority,
                payload=event_request.payload,
                metadata=event_request.metadata,
                created_at=datetime.now(),
                scheduled_at=event_request.scheduled_at
            )
            
            background_tasks.add_task(self.publish_event_async, event)
            
            return {
                "event_id": event.id,
                "status": "published",
                "timestamp": event.created_at.isoformat()
            }

        @self.app.post("/api/events/subscribe")
        async def subscribe_to_events(subscription: EventSubscription):
            await self.add_subscription(subscription)
            return {"status": "subscribed", "service": subscription.service_name}

        @self.app.delete("/api/events/subscribe/{service_name}")
        async def unsubscribe_from_events(service_name: str):
            await self.remove_subscription(service_name)
            return {"status": "unsubscribed", "service": service_name}

        @self.app.get("/api/events/subscriptions")
        async def list_subscriptions():
            return {
                "subscriptions": self.subscriptions,
                "total": sum(len(subs) for subs in self.subscriptions.values())
            }

        @self.app.get("/api/events/history")
        async def get_event_history(
            limit: int = 100,
            event_type: Optional[EventType] = None,
            service: Optional[str] = None
        ):
            events = await self.get_events_from_db(limit, event_type, service)
            return {
                "events": events,
                "count": len(events)
            }

        @self.app.get("/api/events/metrics")
        async def get_event_metrics():
            metrics = await self.calculate_event_metrics()
            return metrics

        @self.app.post("/api/events/replay/{event_id}")
        async def replay_event(event_id: str, background_tasks: BackgroundTasks):
            event = await self.get_event_by_id(event_id)
            if not event:
                raise HTTPException(status_code=404, detail="Event not found")
            
            # Reset retry count for replay
            event.retry_count = 0
            background_tasks.add_task(self.publish_event_async, event)
            
            return {"status": "replaying", "event_id": event_id}

        @self.app.get("/api/events/failed")
        async def get_failed_events():
            failed_events = await self.get_failed_events()
            return {
                "failed_events": failed_events,
                "count": len(failed_events)
            }

    async def initialize(self):
        """Initialize Redis and PostgreSQL connections"""
        try:
            # Initialize Redis
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self.redis = await aioredis.from_url(redis_url, decode_responses=True)
            
            # Initialize PostgreSQL
            db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/remittance")
            self.db_pool = await asyncpg.create_pool(db_url)
            
            # Create tables
            await self.create_tables()
            
            # Load existing subscriptions
            await self.load_subscriptions()
            
            # Start background tasks
            asyncio.create_task(self.process_scheduled_events())
            asyncio.create_task(self.retry_failed_events())
            asyncio.create_task(self.cleanup_old_events())
            
            logger.info("🚌 Event Bus Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Event Bus Service: {e}")
            raise

    async def cleanup(self):
        """Cleanup connections"""
        if self.redis:
            await self.redis.close()
        if self.db_pool:
            await self.db_pool.close()

    async def create_tables(self):
        """Create database tables"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id VARCHAR PRIMARY KEY,
                    type VARCHAR NOT NULL,
                    source_service VARCHAR NOT NULL,
                    target_service VARCHAR,
                    priority VARCHAR NOT NULL,
                    payload JSONB NOT NULL,
                    metadata JSONB NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    scheduled_at TIMESTAMP,
                    processed_at TIMESTAMP,
                    retry_count INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 3,
                    status VARCHAR DEFAULT 'pending',
                    error_message TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
                CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
                CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
                CREATE INDEX IF NOT EXISTS idx_events_scheduled_at ON events(scheduled_at);
                
                CREATE TABLE IF NOT EXISTS event_subscriptions (
                    id SERIAL PRIMARY KEY,
                    service_name VARCHAR NOT NULL,
                    event_types JSONB NOT NULL,
                    endpoint VARCHAR NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_service ON event_subscriptions(service_name);
            """)

    async def load_subscriptions(self):
        """Load subscriptions from database"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM event_subscriptions WHERE active = TRUE")
            
            for row in rows:
                event_types = [EventType(et) for et in row['event_types']]
                subscription = EventSubscription(
                    service_name=row['service_name'],
                    event_types=event_types,
                    endpoint=row['endpoint'],
                    active=row['active']
                )
                
                for event_type in event_types:
                    if event_type not in self.subscriptions:
                        self.subscriptions[event_type] = []
                    self.subscriptions[event_type].append(subscription)

    async def publish_event_async(self, event: Event):
        """Publish event asynchronously"""
        try:
            # Store event in database
            await self.store_event(event)
            
            # If scheduled for future, don't process now
            if event.scheduled_at and event.scheduled_at > datetime.now():
                logger.info(f"📅 Event {event.id} scheduled for {event.scheduled_at}")
                return
            
            # Publish to Redis for real-time processing
            await self.publish_to_redis(event)
            
            # Send to subscribers
            await self.send_to_subscribers(event)
            
            # Mark as processed
            await self.mark_event_processed(event.id)
            
            logger.info(f"📤 Event published: {event.type} from {event.source_service}")
            
        except Exception as e:
            logger.error(f"Failed to publish event {event.id}: {e}")
            await self.mark_event_failed(event.id, str(e))

    async def store_event(self, event: Event):
        """Store event in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO events (
                    id, type, source_service, target_service, priority,
                    payload, metadata, created_at, scheduled_at, retry_count, max_retries
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """, 
                event.id, event.type.value, event.source_service, event.target_service,
                event.priority.value, json.dumps(event.payload), json.dumps(event.metadata),
                event.created_at, event.scheduled_at, event.retry_count, event.max_retries
            )

    async def publish_to_redis(self, event: Event):
        """Publish event to Redis for real-time processing"""
        event_data = {
            "id": event.id,
            "type": event.type.value,
            "source_service": event.source_service,
            "target_service": event.target_service,
            "priority": event.priority.value,
            "payload": event.payload,
            "metadata": event.metadata,
            "created_at": event.created_at.isoformat(),
            "retry_count": event.retry_count
        }
        
        # Publish to general event stream
        await self.redis.publish("events:all", json.dumps(event_data))
        
        # Publish to specific event type stream
        await self.redis.publish(f"events:{event.type.value}", json.dumps(event_data))
        
        # If target service specified, publish to service-specific stream
        if event.target_service:
            await self.redis.publish(f"events:service:{event.target_service}", json.dumps(event_data))

    async def send_to_subscribers(self, event: Event):
        """Send event to all subscribers"""
        if event.type not in self.subscriptions:
            return
        
        subscribers = self.subscriptions[event.type]
        
        for subscription in subscribers:
            if not subscription.active:
                continue
                
            # If target service specified and doesn't match, skip
            if event.target_service and subscription.service_name != event.target_service:
                continue
            
            try:
                await self.send_to_subscriber(subscription, event)
            except Exception as e:
                logger.error(f"Failed to send event to {subscription.service_name}: {e}")

    async def send_to_subscriber(self, subscription: EventSubscription, event: Event):
        """Send event to a specific subscriber"""
        import aiohttp
        
        event_data = {
            "id": event.id,
            "type": event.type.value,
            "source_service": event.source_service,
            "priority": event.priority.value,
            "payload": event.payload,
            "metadata": event.metadata,
            "created_at": event.created_at.isoformat()
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                subscription.endpoint,
                json=event_data,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status >= 400:
                    raise Exception(f"HTTP {response.status}: {await response.text()}")

    async def add_subscription(self, subscription: EventSubscription):
        """Add event subscription"""
        # Store in database
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO event_subscriptions (service_name, event_types, endpoint, active)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (service_name) 
                DO UPDATE SET event_types = $2, endpoint = $3, active = $4, updated_at = NOW()
            """, 
                subscription.service_name,
                json.dumps([et.value for et in subscription.event_types]),
                subscription.endpoint,
                subscription.active
            )
        
        # Update in-memory subscriptions
        for event_type in subscription.event_types:
            if event_type not in self.subscriptions:
                self.subscriptions[event_type] = []
            
            # Remove existing subscription for this service
            self.subscriptions[event_type] = [
                s for s in self.subscriptions[event_type] 
                if s.service_name != subscription.service_name
            ]
            
            # Add new subscription
            self.subscriptions[event_type].append(subscription)

    async def remove_subscription(self, service_name: str):
        """Remove event subscription"""
        # Remove from database
        async with self.db_pool.acquire() as conn:
            await conn.execute(
                "UPDATE event_subscriptions SET active = FALSE WHERE service_name = $1",
                service_name
            )
        
        # Remove from in-memory subscriptions
        for event_type in self.subscriptions:
            self.subscriptions[event_type] = [
                s for s in self.subscriptions[event_type] 
                if s.service_name != service_name
            ]

    async def mark_event_processed(self, event_id: str):
        """Mark event as processed"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE events 
                SET status = 'processed', processed_at = NOW() 
                WHERE id = $1
            """, event_id)

    async def mark_event_failed(self, event_id: str, error_message: str):
        """Mark event as failed"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE events 
                SET status = 'failed', error_message = $2, processed_at = NOW() 
                WHERE id = $1
            """, event_id, error_message)

    async def get_event_by_id(self, event_id: str) -> Optional[Event]:
        """Get event by ID"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM events WHERE id = $1", event_id)
            
            if not row:
                return None
            
            return Event(
                id=row['id'],
                type=EventType(row['type']),
                source_service=row['source_service'],
                target_service=row['target_service'],
                priority=EventPriority(row['priority']),
                payload=row['payload'],
                metadata=row['metadata'],
                created_at=row['created_at'],
                scheduled_at=row['scheduled_at'],
                retry_count=row['retry_count'],
                max_retries=row['max_retries']
            )

    async def get_events_from_db(self, limit: int, event_type: Optional[EventType], service: Optional[str]) -> List[Dict]:
        """Get events from database with filters"""
        query = "SELECT * FROM events WHERE 1=1"
        params = []
        param_count = 0
        
        if event_type:
            param_count += 1
            query += f" AND type = ${param_count}"
            params.append(event_type.value)
        
        if service:
            param_count += 1
            query += f" AND (source_service = ${param_count} OR target_service = ${param_count})"
            params.append(service)
        
        query += f" ORDER BY created_at DESC LIMIT ${param_count + 1}"
        params.append(limit)
        
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            
            return [dict(row) for row in rows]

    async def get_failed_events(self) -> List[Dict]:
        """Get failed events"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM events 
                WHERE status = 'failed' 
                ORDER BY created_at DESC 
                LIMIT 100
            """)
            
            return [dict(row) for row in rows]

    async def calculate_event_metrics(self) -> Dict[str, Any]:
        """Calculate event metrics"""
        async with self.db_pool.acquire() as conn:
            # Total events
            total_events = await conn.fetchval("SELECT COUNT(*) FROM events")
            
            # Events by status
            status_counts = await conn.fetch("""
                SELECT status, COUNT(*) as count 
                FROM events 
                GROUP BY status
            """)
            
            # Events by type (last 24 hours)
            type_counts = await conn.fetch("""
                SELECT type, COUNT(*) as count 
                FROM events 
                WHERE created_at > NOW() - INTERVAL '24 hours'
                GROUP BY type
                ORDER BY count DESC
            """)
            
            # Events per hour (last 24 hours)
            hourly_counts = await conn.fetch("""
                SELECT 
                    DATE_TRUNC('hour', created_at) as hour,
                    COUNT(*) as count
                FROM events 
                WHERE created_at > NOW() - INTERVAL '24 hours'
                GROUP BY hour
                ORDER BY hour
            """)
            
            # Average processing time
            avg_processing_time = await conn.fetchval("""
                SELECT AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) 
                FROM events 
                WHERE processed_at IS NOT NULL
                AND created_at > NOW() - INTERVAL '24 hours'
            """)
            
            return {
                "total_events": total_events,
                "status_distribution": {row['status']: row['count'] for row in status_counts},
                "type_distribution_24h": {row['type']: row['count'] for row in type_counts},
                "hourly_distribution": [
                    {"hour": row['hour'].isoformat(), "count": row['count']} 
                    for row in hourly_counts
                ],
                "avg_processing_time_seconds": float(avg_processing_time or 0),
                "active_subscriptions": sum(len(subs) for subs in self.subscriptions.values()),
                "timestamp": datetime.now().isoformat()
            }

    async def process_scheduled_events(self):
        """Background task to process scheduled events"""
        while True:
            try:
                async with self.db_pool.acquire() as conn:
                    rows = await conn.fetch("""
                        SELECT * FROM events 
                        WHERE status = 'pending' 
                        AND scheduled_at IS NOT NULL 
                        AND scheduled_at <= NOW()
                        LIMIT 100
                    """)
                    
                    for row in rows:
                        event = Event(
                            id=row['id'],
                            type=EventType(row['type']),
                            source_service=row['source_service'],
                            target_service=row['target_service'],
                            priority=EventPriority(row['priority']),
                            payload=row['payload'],
                            metadata=row['metadata'],
                            created_at=row['created_at'],
                            scheduled_at=row['scheduled_at'],
                            retry_count=row['retry_count'],
                            max_retries=row['max_retries']
                        )
                        
                        asyncio.create_task(self.publish_event_async(event))
                
                await asyncio.sleep(10)  # Check every 10 seconds
                
            except Exception as e:
                logger.error(f"Error processing scheduled events: {e}")
                await asyncio.sleep(30)

    async def retry_failed_events(self):
        """Background task to retry failed events"""
        while True:
            try:
                async with self.db_pool.acquire() as conn:
                    rows = await conn.fetch("""
                        SELECT * FROM events 
                        WHERE status = 'failed' 
                        AND retry_count < max_retries
                        AND processed_at < NOW() - INTERVAL '5 minutes'
                        LIMIT 50
                    """)
                    
                    for row in rows:
                        event = Event(
                            id=row['id'],
                            type=EventType(row['type']),
                            source_service=row['source_service'],
                            target_service=row['target_service'],
                            priority=EventPriority(row['priority']),
                            payload=row['payload'],
                            metadata=row['metadata'],
                            created_at=row['created_at'],
                            scheduled_at=row['scheduled_at'],
                            retry_count=row['retry_count'] + 1,
                            max_retries=row['max_retries']
                        )
                        
                        # Update retry count
                        await conn.execute("""
                            UPDATE events 
                            SET retry_count = $2, status = 'pending' 
                            WHERE id = $1
                        """, event.id, event.retry_count)
                        
                        asyncio.create_task(self.publish_event_async(event))
                
                await asyncio.sleep(60)  # Check every minute
                
            except Exception as e:
                logger.error(f"Error retrying failed events: {e}")
                await asyncio.sleep(60)

    async def cleanup_old_events(self):
        """Background task to cleanup old events"""
        while True:
            try:
                async with self.db_pool.acquire() as conn:
                    # Delete events older than 30 days
                    deleted_count = await conn.fetchval("""
                        DELETE FROM events 
                        WHERE created_at < NOW() - INTERVAL '30 days'
                        RETURNING COUNT(*)
                    """)
                    
                    if deleted_count > 0:
                        logger.info(f"🧹 Cleaned up {deleted_count} old events")
                
                await asyncio.sleep(3600)  # Check every hour
                
            except Exception as e:
                logger.error(f"Error cleaning up old events: {e}")
                await asyncio.sleep(3600)

# Create service instance
event_bus_service = EventBusService()
app = event_bus_service.app

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8202"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info"
    )

