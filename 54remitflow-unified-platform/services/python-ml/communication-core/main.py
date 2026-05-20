#!/usr/bin/env python3
"""
Communication Core Service
Core communication infrastructure for remittance network
Handles SMS, email, push notifications, and real-time messaging
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
import uvicorn
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests
import websockets
from twilio.rest import Client as TwilioClient

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8130"))

# Communication service configurations
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")

FCM_SERVER_KEY = os.getenv("FCM_SERVER_KEY", "")

# FastAPI app
app = FastAPI(
    title="Communication Core",
    description="Core communication infrastructure for remittance network",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
db_pool = None
redis_client = None
twilio_client = None
active_websockets = {}

# Enums
class MessageType(str, Enum):
    SMS = "SMS"
    EMAIL = "EMAIL"
    PUSH = "PUSH"
    WEBSOCKET = "WEBSOCKET"
    WHATSAPP = "WHATSAPP"

class MessageStatus(str, Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    READ = "READ"

class MessagePriority(str, Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    URGENT = "URGENT"

# Pydantic models
class MessageRequest(BaseModel):
    message_id: Optional[str] = None
    recipient_id: str
    message_type: MessageType
    subject: Optional[str] = None
    content: str
    priority: MessagePriority = MessagePriority.NORMAL
    scheduled_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None

class BulkMessageRequest(BaseModel):
    batch_id: str
    messages: List[MessageRequest]
    send_immediately: bool = True

class MessageResponse(BaseModel):
    message_id: str
    status: MessageStatus
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    error_message: Optional[str] = None

class NotificationTemplate(BaseModel):
    template_id: str
    name: str
    message_type: MessageType
    subject_template: Optional[str] = None
    content_template: str
    variables: List[str]
    is_active: bool = True

class CommunicationPreferences(BaseModel):
    user_id: str
    email_enabled: bool = True
    sms_enabled: bool = True
    push_enabled: bool = True
    whatsapp_enabled: bool = False
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None

# Database functions
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    message_id VARCHAR(255) UNIQUE NOT NULL,
                    recipient_id VARCHAR(255) NOT NULL,
                    message_type VARCHAR(20) NOT NULL,
                    subject TEXT,
                    content TEXT NOT NULL,
                    priority VARCHAR(10) DEFAULT 'NORMAL',
                    status VARCHAR(20) DEFAULT 'PENDING',
                    scheduled_at TIMESTAMP,
                    sent_at TIMESTAMP,
                    delivered_at TIMESTAMP,
                    read_at TIMESTAMP,
                    error_message TEXT,
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_message_id (message_id),
                    INDEX idx_recipient_id (recipient_id),
                    INDEX idx_status (status),
                    INDEX idx_message_type (message_type),
                    INDEX idx_scheduled_at (scheduled_at)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS notification_templates (
                    id SERIAL PRIMARY KEY,
                    template_id VARCHAR(255) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    message_type VARCHAR(20) NOT NULL,
                    subject_template TEXT,
                    content_template TEXT NOT NULL,
                    variables JSONB,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_template_id (template_id),
                    INDEX idx_message_type (message_type),
                    INDEX idx_is_active (is_active)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS communication_preferences (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) UNIQUE NOT NULL,
                    email_enabled BOOLEAN DEFAULT TRUE,
                    sms_enabled BOOLEAN DEFAULT TRUE,
                    push_enabled BOOLEAN DEFAULT TRUE,
                    whatsapp_enabled BOOLEAN DEFAULT FALSE,
                    quiet_hours_start TIME,
                    quiet_hours_end TIME,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_id (user_id)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS message_batches (
                    id SERIAL PRIMARY KEY,
                    batch_id VARCHAR(255) UNIQUE NOT NULL,
                    total_messages INTEGER DEFAULT 0,
                    sent_messages INTEGER DEFAULT 0,
                    failed_messages INTEGER DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'PENDING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    INDEX idx_batch_id (batch_id),
                    INDEX idx_status (status)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS user_contacts (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    contact_type VARCHAR(20) NOT NULL,
                    contact_value VARCHAR(255) NOT NULL,
                    is_verified BOOLEAN DEFAULT FALSE,
                    is_primary BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_id (user_id),
                    INDEX idx_contact_type (contact_type),
                    UNIQUE(user_id, contact_type, contact_value)
                )
            """)
        
        # Initialize default templates
        await init_default_templates()
        
        logger.info("Database initialized successfully")
        
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

async def init_redis():
    """Initialize Redis connection"""
    global redis_client
    
    try:
        redis_client = await aioredis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Redis connection established")
        
    except Exception as e:
        logger.error(f"Redis initialization failed: {e}")
        raise

async def init_twilio():
    """Initialize Twilio client"""
    global twilio_client
    
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
        try:
            twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            logger.info("Twilio client initialized")
        except Exception as e:
            logger.error(f"Twilio initialization failed: {e}")
    else:
        logger.warning("Twilio credentials not provided")

async def init_default_templates():
    """Initialize default notification templates"""
    default_templates = [
        {
            "template_id": "TRANSACTION_ALERT",
            "name": "Transaction Alert",
            "message_type": "SMS",
            "content_template": "Transaction Alert: {amount} {currency} {transaction_type} on {date}. Balance: {balance}. Ref: {reference}",
            "variables": ["amount", "currency", "transaction_type", "date", "balance", "reference"]
        },
        {
            "template_id": "WELCOME_EMAIL",
            "name": "Welcome Email",
            "message_type": "EMAIL",
            "subject_template": "Welcome to Remittance Platform",
            "content_template": "Dear {name}, Welcome to our Remittance Platform! Your account has been successfully created. Agent ID: {agent_id}",
            "variables": ["name", "agent_id"]
        },
        {
            "template_id": "LOW_BALANCE_ALERT",
            "name": "Low Balance Alert",
            "message_type": "PUSH",
            "content_template": "Low Balance Alert: Your current balance is {balance} {currency}. Please top up your account.",
            "variables": ["balance", "currency"]
        },
        {
            "template_id": "COMPLIANCE_ALERT",
            "name": "Compliance Alert",
            "message_type": "EMAIL",
            "subject_template": "Compliance Alert - Action Required",
            "content_template": "Dear {name}, A compliance issue has been detected on your account. Issue: {issue}. Please contact support immediately.",
            "variables": ["name", "issue"]
        }
    ]
    
    try:
        async with db_pool.acquire() as conn:
            for template in default_templates:
                await conn.execute("""
                    INSERT INTO notification_templates 
                    (template_id, name, message_type, subject_template, content_template, variables)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (template_id) DO NOTHING
                """, 
                template["template_id"], template["name"], template["message_type"],
                template.get("subject_template"), template["content_template"],
                json.dumps(template["variables"])
                )
        
        logger.info("Default notification templates initialized")
        
    except Exception as e:
        logger.error(f"Failed to initialize default templates: {e}")

# Communication engine
class CommunicationEngine:
    """Main communication processing engine"""
    
    def __init__(self):
        self.message_queue = asyncio.Queue()
        self.is_processing = False
        
    async def start_processing(self):
        """Start background message processing"""
        if not self.is_processing:
            self.is_processing = True
            asyncio.create_task(self._process_messages())
            logger.info("Message processing started")
    
    async def stop_processing(self):
        """Stop background message processing"""
        self.is_processing = False
        logger.info("Message processing stopped")
    
    async def _process_messages(self):
        """Background task to process messages"""
        while self.is_processing:
            try:
                # Get pending messages
                pending_messages = await self._get_pending_messages()
                
                for message in pending_messages:
                    await self._process_single_message(message)
                
                # Process scheduled messages
                await self._process_scheduled_messages()
                
                # Wait before next cycle
                await asyncio.sleep(5)
                
            except Exception as e:
                logger.error(f"Message processing error: {e}")
                await asyncio.sleep(10)
    
    async def _get_pending_messages(self) -> List[Dict]:
        """Get pending messages from database"""
        try:
            async with db_pool.acquire() as conn:
                messages = await conn.fetch("""
                    SELECT * FROM messages 
                    WHERE status = 'PENDING' AND (scheduled_at IS NULL OR scheduled_at <= CURRENT_TIMESTAMP)
                    ORDER BY priority DESC, created_at ASC 
                    LIMIT 100
                """)
                
                return [dict(message) for message in messages]
                
        except Exception as e:
            logger.error(f"Failed to get pending messages: {e}")
            return []
    
    async def _process_scheduled_messages(self):
        """Process scheduled messages that are due"""
        try:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE messages 
                    SET status = 'PENDING'
                    WHERE status = 'SCHEDULED' AND scheduled_at <= CURRENT_TIMESTAMP
                """)
                
        except Exception as e:
            logger.error(f"Failed to process scheduled messages: {e}")
    
    async def send_message(self, request: MessageRequest) -> MessageResponse:
        """Send a single message"""
        try:
            # Generate message ID if not provided
            if not request.message_id:
                request.message_id = f"msg_{datetime.now().strftime('%Y%m%d%H%M%S')}_{request.recipient_id}"
            
            # Check user preferences
            preferences = await self._get_user_preferences(request.recipient_id)
            if not self._is_message_allowed(request, preferences):
                return MessageResponse(
                    message_id=request.message_id,
                    status=MessageStatus.FAILED,
                    error_message="Message blocked by user preferences"
                )
            
            # Store message in database
            await self._store_message(request)
            
            # Send immediately if not scheduled
            if not request.scheduled_at or request.scheduled_at <= datetime.now():
                result = await self._send_message_now(request)
            else:
                result = MessageResponse(
                    message_id=request.message_id,
                    status=MessageStatus.PENDING
                )
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            return MessageResponse(
                message_id=request.message_id or "unknown",
                status=MessageStatus.FAILED,
                error_message=str(e)
            )
    
    async def _send_message_now(self, request: MessageRequest) -> MessageResponse:
        """Send message immediately"""
        try:
            if request.message_type == MessageType.SMS:
                result = await self._send_sms(request)
            elif request.message_type == MessageType.EMAIL:
                result = await self._send_email(request)
            elif request.message_type == MessageType.PUSH:
                result = await self._send_push_notification(request)
            elif request.message_type == MessageType.WEBSOCKET:
                result = await self._send_websocket_message(request)
            elif request.message_type == MessageType.WHATSAPP:
                result = await self._send_whatsapp(request)
            else:
                raise ValueError(f"Unsupported message type: {request.message_type}")
            
            # Update message status
            await self._update_message_status(
                request.message_id, 
                result.status, 
                result.error_message
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to send message {request.message_id}: {e}")
            await self._update_message_status(
                request.message_id, 
                MessageStatus.FAILED, 
                str(e)
            )
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.FAILED,
                error_message=str(e)
            )
    
    async def _send_sms(self, request: MessageRequest) -> MessageResponse:
        """Send SMS message"""
        try:
            if not twilio_client:
                raise Exception("Twilio client not initialized")
            
            # Get recipient phone number
            phone_number = await self._get_user_contact(request.recipient_id, "PHONE")
            if not phone_number:
                raise Exception("Recipient phone number not found")
            
            # Send SMS via Twilio
            message = twilio_client.messages.create(
                body=request.content,
                from_=TWILIO_PHONE_NUMBER,
                to=phone_number
            )
            
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.SENT,
                sent_at=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"SMS sending failed: {e}")
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.FAILED,
                error_message=str(e)
            )
    
    async def _send_email(self, request: MessageRequest) -> MessageResponse:
        """Send email message"""
        try:
            # Get recipient email
            email = await self._get_user_contact(request.recipient_id, "EMAIL")
            if not email:
                raise Exception("Recipient email not found")
            
            # Create email message
            msg = MIMEMultipart()
            msg['From'] = SMTP_USERNAME
            msg['To'] = email
            msg['Subject'] = request.subject or "Remittance Platform Notification"
            
            msg.attach(MIMEText(request.content, 'plain'))
            
            # Send email
            server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
            server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            text = msg.as_string()
            server.sendmail(SMTP_USERNAME, email, text)
            server.quit()
            
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.SENT,
                sent_at=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"Email sending failed: {e}")
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.FAILED,
                error_message=str(e)
            )
    
    async def _send_push_notification(self, request: MessageRequest) -> MessageResponse:
        """Send push notification"""
        try:
            # Get FCM token
            fcm_token = await self._get_user_contact(request.recipient_id, "FCM_TOKEN")
            if not fcm_token:
                raise Exception("FCM token not found")
            
            # Send push notification via FCM
            headers = {
                'Authorization': f'key={FCM_SERVER_KEY}',
                'Content-Type': 'application/json'
            }
            
            payload = {
                'to': fcm_token,
                'notification': {
                    'title': request.subject or 'Remittance Platform',
                    'body': request.content
                },
                'data': request.metadata or {}
            }
            
            response = requests.post(
                'https://fcm.googleapis.com/fcm/send',
                headers=headers,
                json=payload
            )
            
            if response.status_code == 200:
                return MessageResponse(
                    message_id=request.message_id,
                    status=MessageStatus.SENT,
                    sent_at=datetime.now()
                )
            else:
                raise Exception(f"FCM error: {response.text}")
                
        except Exception as e:
            logger.error(f"Push notification failed: {e}")
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.FAILED,
                error_message=str(e)
            )
    
    async def _send_websocket_message(self, request: MessageRequest) -> MessageResponse:
        """Send WebSocket message"""
        try:
            if request.recipient_id in active_websockets:
                websocket = active_websockets[request.recipient_id]
                await websocket.send_text(json.dumps({
                    'message_id': request.message_id,
                    'subject': request.subject,
                    'content': request.content,
                    'timestamp': datetime.now().isoformat(),
                    'metadata': request.metadata
                }))
                
                return MessageResponse(
                    message_id=request.message_id,
                    status=MessageStatus.DELIVERED,
                    sent_at=datetime.now(),
                    delivered_at=datetime.now()
                )
            else:
                # Store for later delivery when user connects
                await redis_client.lpush(
                    f"websocket_queue:{request.recipient_id}",
                    json.dumps(request.dict(), default=str)
                )
                
                return MessageResponse(
                    message_id=request.message_id,
                    status=MessageStatus.PENDING
                )
                
        except Exception as e:
            logger.error(f"WebSocket message failed: {e}")
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.FAILED,
                error_message=str(e)
            )
    
    async def _send_whatsapp(self, request: MessageRequest) -> MessageResponse:
        """Send WhatsApp message"""
        try:
            # Get WhatsApp number
            whatsapp_number = await self._get_user_contact(request.recipient_id, "WHATSAPP")
            if not whatsapp_number:
                raise Exception("WhatsApp number not found")
            
            # Send via Twilio WhatsApp API
            if twilio_client:
                message = twilio_client.messages.create(
                    body=request.content,
                    from_='whatsapp:' + TWILIO_PHONE_NUMBER,
                    to='whatsapp:' + whatsapp_number
                )
                
                return MessageResponse(
                    message_id=request.message_id,
                    status=MessageStatus.SENT,
                    sent_at=datetime.now()
                )
            else:
                raise Exception("WhatsApp service not configured")
                
        except Exception as e:
            logger.error(f"WhatsApp message failed: {e}")
            return MessageResponse(
                message_id=request.message_id,
                status=MessageStatus.FAILED,
                error_message=str(e)
            )
    
    async def _process_single_message(self, message: Dict):
        """Process a single message from the queue"""
        try:
            request = MessageRequest(**message)
            await self._send_message_now(request)
            
        except Exception as e:
            logger.error(f"Failed to process message {message.get('message_id')}: {e}")
    
    async def _store_message(self, request: MessageRequest):
        """Store message in database"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO messages 
                (message_id, recipient_id, message_type, subject, content, priority, 
                 scheduled_at, metadata, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (message_id) DO UPDATE SET
                content = EXCLUDED.content,
                scheduled_at = EXCLUDED.scheduled_at,
                updated_at = CURRENT_TIMESTAMP
            """, 
            request.message_id, request.recipient_id, request.message_type.value,
            request.subject, request.content, request.priority.value,
            request.scheduled_at, json.dumps(request.metadata) if request.metadata else None,
            'SCHEDULED' if request.scheduled_at and request.scheduled_at > datetime.now() else 'PENDING'
            )
    
    async def _update_message_status(self, message_id: str, status: MessageStatus, error_message: str = None):
        """Update message status"""
        async with db_pool.acquire() as conn:
            if status == MessageStatus.SENT:
                await conn.execute("""
                    UPDATE messages 
                    SET status = $1, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE message_id = $2
                """, status.value, message_id)
            elif status == MessageStatus.DELIVERED:
                await conn.execute("""
                    UPDATE messages 
                    SET status = $1, delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE message_id = $2
                """, status.value, message_id)
            elif status == MessageStatus.FAILED:
                await conn.execute("""
                    UPDATE messages 
                    SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
                    WHERE message_id = $3
                """, status.value, error_message, message_id)
    
    async def _get_user_preferences(self, user_id: str) -> Dict:
        """Get user communication preferences"""
        try:
            async with db_pool.acquire() as conn:
                prefs = await conn.fetchrow("""
                    SELECT * FROM communication_preferences WHERE user_id = $1
                """, user_id)
                
                if prefs:
                    return dict(prefs)
                else:
                    # Return default preferences
                    return {
                        'email_enabled': True,
                        'sms_enabled': True,
                        'push_enabled': True,
                        'whatsapp_enabled': False
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get user preferences: {e}")
            return {'email_enabled': True, 'sms_enabled': True, 'push_enabled': True}
    
    async def _get_user_contact(self, user_id: str, contact_type: str) -> Optional[str]:
        """Get user contact information"""
        try:
            async with db_pool.acquire() as conn:
                contact = await conn.fetchval("""
                    SELECT contact_value FROM user_contacts 
                    WHERE user_id = $1 AND contact_type = $2 AND is_verified = TRUE
                    ORDER BY is_primary DESC, created_at ASC
                    LIMIT 1
                """, user_id, contact_type)
                
                return contact
                
        except Exception as e:
            logger.error(f"Failed to get user contact: {e}")
            return None
    
    def _is_message_allowed(self, request: MessageRequest, preferences: Dict) -> bool:
        """Check if message is allowed based on user preferences"""
        if request.message_type == MessageType.EMAIL and not preferences.get('email_enabled', True):
            return False
        elif request.message_type == MessageType.SMS and not preferences.get('sms_enabled', True):
            return False
        elif request.message_type == MessageType.PUSH and not preferences.get('push_enabled', True):
            return False
        elif request.message_type == MessageType.WHATSAPP and not preferences.get('whatsapp_enabled', False):
            return False
        
        # Check quiet hours
        quiet_start = preferences.get('quiet_hours_start')
        quiet_end = preferences.get('quiet_hours_end')
        
        if quiet_start and quiet_end and request.priority != MessagePriority.URGENT:
            current_time = datetime.now().time()
            if quiet_start <= current_time <= quiet_end:
                return False
        
        return True
    
    async def send_bulk_messages(self, request: BulkSettlementRequest) -> Dict:
        """Send bulk messages"""
        try:
            # Create batch record
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO message_batches (batch_id, total_messages, status)
                    VALUES ($1, $2, 'PROCESSING')
                """, request.batch_id, len(request.messages))
            
            results = []
            sent_count = 0
            failed_count = 0
            
            # Process messages
            for message in request.messages:
                try:
                    result = await self.send_message(message)
                    results.append(result.dict())
                    
                    if result.status in [MessageStatus.SENT, MessageStatus.DELIVERED]:
                        sent_count += 1
                    else:
                        failed_count += 1
                        
                except Exception as e:
                    results.append({
                        'message_id': message.message_id or 'unknown',
                        'status': 'FAILED',
                        'error_message': str(e)
                    })
                    failed_count += 1
            
            # Update batch status
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE message_batches 
                    SET sent_messages = $1, failed_messages = $2, 
                        status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
                    WHERE batch_id = $3
                """, sent_count, failed_count, request.batch_id)
            
            return {
                'batch_id': request.batch_id,
                'total_messages': len(request.messages),
                'sent_messages': sent_count,
                'failed_messages': failed_count,
                'success_rate': (sent_count / len(request.messages)) * 100,
                'results': results
            }
            
        except Exception as e:
            logger.error(f"Bulk message processing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Bulk processing failed: {str(e)}")

# Initialize communication engine
comm_engine = CommunicationEngine()

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        active_websockets[user_id] = websocket
        
        # Send queued messages
        await self._send_queued_messages(user_id)
    
    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in active_websockets:
            del active_websockets[user_id]
    
    async def _send_queued_messages(self, user_id: str):
        """Send queued WebSocket messages"""
        try:
            while True:
                message_data = await redis_client.rpop(f"websocket_queue:{user_id}")
                if not message_data:
                    break
                
                message = json.loads(message_data)
                websocket = self.active_connections.get(user_id)
                if websocket:
                    await websocket.send_text(json.dumps(message))
                    
        except Exception as e:
            logger.error(f"Failed to send queued messages: {e}")

manager = ConnectionManager()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()
    await init_twilio()
    await comm_engine.start_processing()

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    await comm_engine.stop_processing()
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check database
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        # Check Redis
        await redis_client.ping()
        
        return {
            "status": "healthy",
            "service": "communication-core",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "twilio": "configured" if twilio_client else "not_configured",
            "processing": comm_engine.is_processing,
            "active_websockets": len(active_websockets)
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/send-message", response_model=MessageResponse)
async def send_message(request: MessageRequest):
    """Send a single message"""
    return await comm_engine.send_message(request)

@app.post("/api/v1/send-bulk-messages")
async def send_bulk_messages(request: BulkMessageRequest):
    """Send bulk messages"""
    return await comm_engine.send_bulk_messages(request)

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time messaging"""
    await manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming WebSocket messages if needed
            logger.info(f"Received WebSocket message from {user_id}: {data}")
    except WebSocketDisconnect:
        manager.disconnect(user_id)

@app.get("/api/v1/messages/{message_id}")
async def get_message_status(message_id: str):
    """Get message status"""
    try:
        async with db_pool.acquire() as conn:
            message = await conn.fetchrow("""
                SELECT * FROM messages WHERE message_id = $1
            """, message_id)
            
            if not message:
                raise HTTPException(status_code=404, detail="Message not found")
            
            return {
                "message_id": message['message_id'],
                "recipient_id": message['recipient_id'],
                "message_type": message['message_type'],
                "status": message['status'],
                "created_at": message['created_at'].isoformat(),
                "sent_at": message['sent_at'].isoformat() if message['sent_at'] else None,
                "delivered_at": message['delivered_at'].isoformat() if message['delivered_at'] else None,
                "error_message": message['error_message']
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get message: {str(e)}")

@app.get("/api/v1/templates")
async def list_templates():
    """List notification templates"""
    try:
        async with db_pool.acquire() as conn:
            templates = await conn.fetch("""
                SELECT * FROM notification_templates WHERE is_active = TRUE
                ORDER BY name
            """)
            
            return [
                {
                    "template_id": row['template_id'],
                    "name": row['name'],
                    "message_type": row['message_type'],
                    "subject_template": row['subject_template'],
                    "content_template": row['content_template'],
                    "variables": json.loads(row['variables'])
                }
                for row in templates
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list templates: {str(e)}")

@app.post("/api/v1/templates")
async def create_template(template: NotificationTemplate):
    """Create notification template"""
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO notification_templates 
                (template_id, name, message_type, subject_template, content_template, variables, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, 
            template.template_id, template.name, template.message_type.value,
            template.subject_template, template.content_template,
            json.dumps(template.variables), template.is_active
            )
        
        return {"message": "Template created successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create template: {str(e)}")

@app.get("/api/v1/preferences/{user_id}")
async def get_user_preferences(user_id: str):
    """Get user communication preferences"""
    try:
        preferences = await comm_engine._get_user_preferences(user_id)
        return preferences
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get preferences: {str(e)}")

@app.post("/api/v1/preferences")
async def update_user_preferences(preferences: CommunicationPreferences):
    """Update user communication preferences"""
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO communication_preferences 
                (user_id, email_enabled, sms_enabled, push_enabled, whatsapp_enabled, 
                 quiet_hours_start, quiet_hours_end)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_id) DO UPDATE SET
                email_enabled = EXCLUDED.email_enabled,
                sms_enabled = EXCLUDED.sms_enabled,
                push_enabled = EXCLUDED.push_enabled,
                whatsapp_enabled = EXCLUDED.whatsapp_enabled,
                quiet_hours_start = EXCLUDED.quiet_hours_start,
                quiet_hours_end = EXCLUDED.quiet_hours_end,
                updated_at = CURRENT_TIMESTAMP
            """, 
            preferences.user_id, preferences.email_enabled, preferences.sms_enabled,
            preferences.push_enabled, preferences.whatsapp_enabled,
            preferences.quiet_hours_start, preferences.quiet_hours_end
            )
        
        return {"message": "Preferences updated successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update preferences: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

