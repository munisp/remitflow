#!/usr/bin/env python3
"""
Advanced WhatsApp Webhook Handler
Provides intelligent message processing, auto-responses, and business logic integration
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import aiohttp
import asyncpg
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import PlainTextResponse
import uvicorn
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import openai

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Prometheus metrics
webhook_events_total = Counter('whatsapp_webhook_events_total', 'Total webhook events', ['event_type', 'status'])
message_processing_time = Histogram('whatsapp_message_processing_seconds', 'Message processing time')
auto_responses_sent = Counter('whatsapp_auto_responses_total', 'Auto responses sent', ['response_type'])
active_conversations = Gauge('whatsapp_active_conversations', 'Active conversations')
ai_responses_generated = Counter('whatsapp_ai_responses_total', 'AI responses generated', ['model'])

class WhatsAppWebhookHandler:
    """Advanced WhatsApp webhook handler with AI integration"""
    
    def __init__(self):
        self.app = FastAPI(title="WhatsApp Webhook Handler", version="1.0.0")
        self.webhook_verify_token = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
        self.webhook_secret = os.getenv("WHATSAPP_WEBHOOK_SECRET")
        self.access_token = os.getenv("WHATSAPP_ACCESS_TOKEN")
        self.phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        
        # Database and Redis connections
        self.db_pool = None
        self.redis_client = None
        
        # AI client
        if self.openai_api_key:
            openai.api_key = self.openai_api_key
        
        # Business logic configuration
        self.auto_response_enabled = True
        self.ai_assistant_enabled = True
        self.business_hours = {
            'start': 8,  # 8 AM
            'end': 18,   # 6 PM
            'timezone': 'Africa/Lagos'
        }
        
        # Nigerian banking keywords for intelligent routing
        self.banking_keywords = {
            'balance': ['balance', 'bal', 'account balance', 'check balance'],
            'transfer': ['transfer', 'send money', 'pay', 'payment'],
            'deposit': ['deposit', 'fund', 'add money', 'credit'],
            'withdrawal': ['withdraw', 'cash out', 'debit'],
            'loan': ['loan', 'credit', 'borrow', 'advance'],
            'kyc': ['kyc', 'verification', 'verify', 'documents'],
            'help': ['help', 'support', 'assistance', 'problem'],
            'agent': ['agent', 'location', 'nearest', 'find agent']
        }
        
        # Auto-response templates
        self.response_templates = {
            'welcome': "Welcome to Remittance Platform! 🏦\n\nI'm your AI assistant. How can I help you today?\n\n• Check Balance\n• Transfer Money\n• Find Agent\n• Get Support\n\nReply with your choice or ask any question!",
            'balance_inquiry': "To check your account balance, please provide:\n1. Your account number\n2. Last 4 digits of your phone number\n\nOr visit any of our 50,000+ agents nationwide.",
            'transfer_help': "To transfer money:\n1. Dial *737*Amount*AccountNumber#\n2. Visit any agent location\n3. Use our mobile app\n\nTransfer fees start from ₦10. Need help finding an agent?",
            'agent_location': "To find the nearest agent:\n1. Share your location\n2. Tell me your area/LGA\n3. Visit remittance-platform.ng/locations\n\nWe have 50,000+ agents across Nigeria!",
            'business_hours': "Our customer service is available:\n📞 24/7 for emergencies\n🏢 8AM - 6PM for general inquiries\n\nFor immediate assistance, visit any agent or use our USSD *737#",
            'kyc_reminder': "Your KYC documents need updating! 📋\n\nRequired documents:\n• Valid ID (NIN, Passport, Driver's License)\n• Utility bill\n• Passport photo\n\nVisit any agent or update online at remittance-platform.ng/kyc",
            'loan_info': "💰 Get instant loans up to ₦500,000!\n\nRequirements:\n• Active account (3+ months)\n• Regular transactions\n• Valid KYC\n\nApply: *737*59# or visit any agent",
            'error': "I'm sorry, I didn't understand that. Please try again or contact our support team.\n\n📞 Call: 0700-REMIT\n💬 WhatsApp: +234-800-REMIT\n🌐 Web: remittance-platform.ng/support"
        }
        
        self.setup_routes()
    
    async def initialize(self):
        """Initialize database and Redis connections"""
        try:
            # Initialize database connection pool
            self.db_pool = await asyncpg.create_pool(
                os.getenv("DATABASE_URL"),
                min_size=5,
                max_size=20
            )
            
            # Initialize Redis connection
            self.redis_client = redis.from_url(
                os.getenv("REDIS_URL", "redis://localhost:6379"),
                decode_responses=True
            )
            
            # Test connections
            async with self.db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            
            await self.redis_client.ping()
            
            logger.info("Database and Redis connections initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize connections: {e}")
            raise
    
    def setup_routes(self):
        """Setup FastAPI routes"""
        
        @self.app.get("/health")
        async def health_check():
            return {
                "status": "healthy",
                "service": "whatsapp-webhook-handler",
                "timestamp": datetime.utcnow().isoformat()
            }
        
        @self.app.get("/metrics")
        async def metrics():
            return PlainTextResponse(generate_latest())
        
        @self.app.get("/webhooks/whatsapp")
        async def webhook_verification(request: Request):
            return await self.verify_webhook(request)
        
        @self.app.post("/webhooks/whatsapp")
        async def webhook_event(request: Request, background_tasks: BackgroundTasks):
            return await self.handle_webhook_event(request, background_tasks)
        
        @self.app.get("/conversations/active")
        async def get_active_conversations():
            return await self.get_active_conversations_stats()
        
        @self.app.post("/send/auto-response")
        async def send_auto_response(data: dict):
            return await self.send_intelligent_response(
                data["phone"], data["message_type"], data.get("context", {})
            )
    
    async def verify_webhook(self, request: Request):
        """Verify webhook subscription"""
        mode = request.query_params.get("hub.mode")
        token = request.query_params.get("hub.verify_token")
        challenge = request.query_params.get("hub.challenge")
        
        if mode == "subscribe" and token == self.webhook_verify_token:
            logger.info("Webhook verified successfully")
            return PlainTextResponse(challenge)
        
        logger.warning(f"Webhook verification failed: mode={mode}, token={token}")
        raise HTTPException(status_code=403, detail="Forbidden")
    
    async def handle_webhook_event(self, request: Request, background_tasks: BackgroundTasks):
        """Handle incoming webhook events"""
        try:
            # Verify signature if secret is configured
            if self.webhook_secret:
                signature = request.headers.get("X-Hub-Signature-256", "")
                body = await request.body()
                if not self.verify_signature(body, signature):
                    raise HTTPException(status_code=403, detail="Invalid signature")
            
            # Parse webhook data
            webhook_data = await request.json()
            
            # Process event in background
            background_tasks.add_task(self.process_webhook_event, webhook_data)
            
            webhook_events_total.labels(event_type="received", status="success").inc()
            return {"status": "received"}
            
        except Exception as e:
            logger.error(f"Webhook event handling failed: {e}")
            webhook_events_total.labels(event_type="received", status="error").inc()
            raise HTTPException(status_code=500, detail="Internal server error")
    
    def verify_signature(self, body: bytes, signature: str) -> bool:
        """Verify webhook signature"""
        if not signature.startswith("sha256="):
            return False
        
        signature = signature[7:]  # Remove "sha256=" prefix
        
        expected_signature = hmac.new(
            self.webhook_secret.encode(),
            body,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)
    
    @message_processing_time.time()
    async def process_webhook_event(self, webhook_data: Dict[str, Any]):
        """Process webhook event with intelligent routing"""
        try:
            for entry in webhook_data.get("entry", []):
                for change in entry.get("changes", []):
                    if change.get("field") == "messages":
                        value = change.get("value", {})
                        
                        # Process incoming messages
                        for message in value.get("messages", []):
                            await self.process_incoming_message(message, value.get("metadata", {}))
                        
                        # Process status updates
                        for status in value.get("statuses", []):
                            await self.process_status_update(status)
            
            webhook_events_total.labels(event_type="processed", status="success").inc()
            
        except Exception as e:
            logger.error(f"Webhook event processing failed: {e}")
            webhook_events_total.labels(event_type="processed", status="error").inc()
    
    async def process_incoming_message(self, message: Dict[str, Any], metadata: Dict[str, Any]):
        """Process incoming message with intelligent auto-response"""
        try:
            message_id = message.get("id")
            sender_phone = message.get("from")
            message_type = message.get("type")
            timestamp = message.get("timestamp")
            
            # Extract message content
            content = ""
            if message_type == "text":
                content = message.get("text", {}).get("body", "")
            elif message_type in ["image", "document", "audio", "video"]:
                media_obj = message.get(message_type, {})
                content = media_obj.get("caption", "")
            
            # Store message in database
            await self.store_incoming_message({
                "whatsapp_id": message_id,
                "sender_phone": sender_phone,
                "message_type": message_type,
                "content": content,
                "timestamp": datetime.fromtimestamp(int(timestamp)),
                "metadata": metadata
            })
            
            # Update conversation tracking
            await self.update_conversation_tracking(sender_phone)
            
            # Determine if auto-response is needed
            if self.should_send_auto_response(sender_phone, content, message_type):
                await self.send_intelligent_response(sender_phone, content, {
                    "message_type": message_type,
                    "timestamp": timestamp
                })
            
            logger.info(f"Processed incoming message from {sender_phone}: {message_type}")
            
        except Exception as e:
            logger.error(f"Failed to process incoming message: {e}")
    
    async def process_status_update(self, status: Dict[str, Any]):
        """Process message status update"""
        try:
            message_id = status.get("id")
            status_value = status.get("status")
            timestamp = status.get("timestamp")
            recipient_id = status.get("recipient_id")
            
            # Update message status in database
            await self.update_message_status(message_id, status_value, timestamp)
            
            # Publish status update to Redis for real-time updates
            await self.redis_client.lpush("message_status_updates", json.dumps({
                "message_id": message_id,
                "status": status_value,
                "timestamp": timestamp,
                "recipient_id": recipient_id
            }))
            
            logger.info(f"Updated message status: {message_id} -> {status_value}")
            
        except Exception as e:
            logger.error(f"Failed to process status update: {e}")
    
    async def store_incoming_message(self, message_data: Dict[str, Any]):
        """Store incoming message in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO incoming_messages 
                (whatsapp_id, sender_phone, message_type, content, received_at, metadata, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (whatsapp_id) DO NOTHING
            """, 
                message_data["whatsapp_id"],
                message_data["sender_phone"],
                message_data["message_type"],
                message_data["content"],
                message_data["timestamp"],
                json.dumps(message_data["metadata"]),
                datetime.utcnow()
            )
    
    async def update_message_status(self, message_id: str, status: str, timestamp: str):
        """Update message status in database"""
        status_time = datetime.fromtimestamp(int(timestamp))
        
        async with self.db_pool.acquire() as conn:
            if status == "delivered":
                await conn.execute("""
                    UPDATE whatsapp_messages 
                    SET status = $1, delivered_at = $2, updated_at = $3
                    WHERE whatsapp_id = $4
                """, status, status_time, datetime.utcnow(), message_id)
            elif status == "read":
                await conn.execute("""
                    UPDATE whatsapp_messages 
                    SET status = $1, read_at = $2, updated_at = $3
                    WHERE whatsapp_id = $4
                """, status, status_time, datetime.utcnow(), message_id)
            elif status == "failed":
                await conn.execute("""
                    UPDATE whatsapp_messages 
                    SET status = $1, updated_at = $2
                    WHERE whatsapp_id = $3
                """, status, datetime.utcnow(), message_id)
    
    async def update_conversation_tracking(self, phone: str):
        """Update conversation tracking for analytics"""
        await self.redis_client.setex(f"conversation:{phone}", 3600, "active")
        
        # Update active conversations gauge
        active_count = await self.redis_client.eval("""
            local keys = redis.call('keys', 'conversation:*')
            return #keys
        """, 0)
        active_conversations.set(active_count)
    
    def should_send_auto_response(self, phone: str, content: str, message_type: str) -> bool:
        """Determine if auto-response should be sent"""
        if not self.auto_response_enabled:
            return False
        
        # Don't auto-respond to media messages unless they have text
        if message_type != "text" and not content:
            return False
        
        # Check if we've recently responded to this user
        recent_response_key = f"recent_response:{phone}"
        if self.redis_client and self.redis_client.exists(recent_response_key):
            return False
        
        return True
    
    async def send_intelligent_response(self, phone: str, user_message: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Send intelligent auto-response based on message content"""
        try:
            # Classify message intent
            intent = self.classify_message_intent(user_message.lower())
            
            # Generate appropriate response
            if intent == "greeting" or intent == "welcome":
                response = self.response_templates["welcome"]
                response_type = "welcome"
            elif intent == "balance":
                response = self.response_templates["balance_inquiry"]
                response_type = "balance_help"
            elif intent == "transfer":
                response = self.response_templates["transfer_help"]
                response_type = "transfer_help"
            elif intent == "agent":
                response = self.response_templates["agent_location"]
                response_type = "agent_location"
            elif intent == "kyc":
                response = self.response_templates["kyc_reminder"]
                response_type = "kyc_help"
            elif intent == "loan":
                response = self.response_templates["loan_info"]
                response_type = "loan_info"
            elif intent == "help":
                if self.is_business_hours():
                    response = await self.generate_ai_response(user_message, context)
                    response_type = "ai_response"
                else:
                    response = self.response_templates["business_hours"]
                    response_type = "business_hours"
            else:
                # Use AI for complex queries during business hours
                if self.ai_assistant_enabled and self.is_business_hours():
                    response = await self.generate_ai_response(user_message, context)
                    response_type = "ai_response"
                else:
                    response = self.response_templates["error"]
                    response_type = "fallback"
            
            # Send response via WhatsApp API
            success = await self.send_whatsapp_message(phone, response)
            
            if success:
                # Set cooldown to prevent spam
                await self.redis_client.setex(f"recent_response:{phone}", 300, "sent")  # 5 minutes
                auto_responses_sent.labels(response_type=response_type).inc()
                
                logger.info(f"Sent auto-response to {phone}: {response_type}")
                return {"status": "sent", "response_type": response_type}
            else:
                return {"status": "failed", "error": "Failed to send message"}
                
        except Exception as e:
            logger.error(f"Failed to send intelligent response: {e}")
            return {"status": "error", "error": str(e)}
    
    def classify_message_intent(self, message: str) -> str:
        """Classify message intent using keyword matching"""
        message_lower = message.lower()
        
        # Check for greetings
        greetings = ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"]
        if any(greeting in message_lower for greeting in greetings):
            return "greeting"
        
        # Check banking keywords
        for intent, keywords in self.banking_keywords.items():
            if any(keyword in message_lower for keyword in keywords):
                return intent
        
        # Default to help for unclassified messages
        return "help"
    
    async def generate_ai_response(self, user_message: str, context: Dict[str, Any]) -> str:
        """Generate AI response using OpenAI"""
        try:
            if not self.openai_api_key:
                return self.response_templates["error"]
            
            # Prepare context for AI
            system_prompt = """You are a helpful AI assistant for Remittance Platform, Nigeria's leading financial inclusion platform. 

Key information:
- We have 50,000+ agents nationwide
- Services: Banking, transfers, deposits, withdrawals, loans, KYC
- USSD code: *737#
- Website: remittance-platform.ng
- We're CBN licensed and regulated

Guidelines:
- Be helpful, professional, and concise
- Provide specific Nigerian banking information
- Always offer multiple ways to get help (agent, USSD, app, website)
- Use Nigerian context and terminology
- Keep responses under 160 characters when possible
- Include relevant emojis for engagement

If you can't help with something, direct them to customer service or an agent."""

            response = await openai.ChatCompletion.acreate(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                max_tokens=150,
                temperature=0.7
            )
            
            ai_response = response.choices[0].message.content.strip()
            ai_responses_generated.labels(model="gpt-3.5-turbo").inc()
            
            return ai_response
            
        except Exception as e:
            logger.error(f"AI response generation failed: {e}")
            return self.response_templates["error"]
    
    async def send_whatsapp_message(self, phone: str, message: str) -> bool:
        """Send message via WhatsApp Business API"""
        try:
            url = f"https://graph.facebook.com/v18.0/{self.phone_number_id}/messages"
            
            payload = {
                "messaging_product": "whatsapp",
                "to": phone,
                "type": "text",
                "text": {"body": message}
            }
            
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json"
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        return True
                    else:
                        logger.error(f"WhatsApp API error: {response.status} - {await response.text()}")
                        return False
                        
        except Exception as e:
            logger.error(f"Failed to send WhatsApp message: {e}")
            return False
    
    def is_business_hours(self) -> bool:
        """Check if current time is within business hours"""
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(self.business_hours['timezone'])
            current_time = datetime.now(tz)
            current_hour = current_time.hour
            
            return self.business_hours['start'] <= current_hour < self.business_hours['end']
        except:
            # Fallback to UTC if timezone handling fails
            current_hour = datetime.utcnow().hour
            return 6 <= current_hour < 16  # Approximate Nigerian business hours in UTC
    
    async def get_active_conversations_stats(self) -> Dict[str, Any]:
        """Get active conversations statistics"""
        try:
            # Get active conversations count
            active_count = await self.redis_client.eval("""
                local keys = redis.call('keys', 'conversation:*')
                return #keys
            """, 0)
            
            # Get message statistics from last 24 hours
            async with self.db_pool.acquire() as conn:
                stats = await conn.fetchrow("""
                    SELECT 
                        COUNT(*) as total_messages,
                        COUNT(DISTINCT sender_phone) as unique_senders,
                        COUNT(CASE WHEN processed = true THEN 1 END) as processed_messages
                    FROM incoming_messages 
                    WHERE created_at >= NOW() - INTERVAL '24 hours'
                """)
            
            return {
                "active_conversations": active_count,
                "last_24h_stats": {
                    "total_messages": stats["total_messages"],
                    "unique_senders": stats["unique_senders"],
                    "processed_messages": stats["processed_messages"]
                },
                "timestamp": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to get conversation stats: {e}")
            return {"error": str(e)}

# Global handler instance
webhook_handler = WhatsAppWebhookHandler()

# FastAPI app instance
app = webhook_handler.app

@app.on_event("startup")
async def startup_event():
    """Initialize connections on startup"""
    await webhook_handler.initialize()
    logger.info("WhatsApp Webhook Handler started successfully")

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up connections on shutdown"""
    if webhook_handler.db_pool:
        await webhook_handler.db_pool.close()
    if webhook_handler.redis_client:
        await webhook_handler.redis_client.close()
    logger.info("WhatsApp Webhook Handler shut down successfully")

if __name__ == "__main__":
    # Load environment variables
    required_env_vars = [
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_PHONE_NUMBER_ID",
        "DATABASE_URL",
        "REDIS_URL"
    ]
    
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    if missing_vars:
        logger.error(f"Missing required environment variables: {missing_vars}")
        exit(1)
    
    # Run the application
    uvicorn.run(
        "webhook_handler:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8081")),
        reload=False,
        workers=1
    )

