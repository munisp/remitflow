#!/usr/bin/env python3
"""
Communication Platform Service
Advanced communication platform with AI-powered messaging, chatbots, and omnichannel support
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
from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import openai
from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
import nltk
from nltk.sentiment import SentimentIntensityAnalyzer
import spacy

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8131"))

# AI Configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
openai.api_key = OPENAI_API_KEY

# FastAPI app
app = FastAPI(
    title="Communication Platform",
    description="Advanced communication platform with AI-powered messaging and chatbots",
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
nlp_models = {}
sentiment_analyzer = None
nlp_processor = None

# Enums
class ConversationStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    RESOLVED = "RESOLVED"
    ESCALATED = "ESCALATED"

class MessageSource(str, Enum):
    USER = "USER"
    AGENT = "AGENT"
    BOT = "BOT"
    SYSTEM = "SYSTEM"

class IntentType(str, Enum):
    ACCOUNT_INQUIRY = "ACCOUNT_INQUIRY"
    TRANSACTION_SUPPORT = "TRANSACTION_SUPPORT"
    TECHNICAL_SUPPORT = "TECHNICAL_SUPPORT"
    COMPLAINT = "COMPLAINT"
    GENERAL_INQUIRY = "GENERAL_INQUIRY"
    EMERGENCY = "EMERGENCY"

class ChannelType(str, Enum):
    WEBCHAT = "WEBCHAT"
    WHATSAPP = "WHATSAPP"
    TELEGRAM = "TELEGRAM"
    SMS = "SMS"
    EMAIL = "EMAIL"
    VOICE = "VOICE"

# Pydantic models
class ChatMessage(BaseModel):
    message_id: Optional[str] = None
    conversation_id: str
    sender_id: str
    source: MessageSource
    channel: ChannelType
    content: str
    intent: Optional[IntentType] = None
    sentiment: Optional[str] = None
    confidence: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None

class ConversationRequest(BaseModel):
    conversation_id: Optional[str] = None
    user_id: str
    channel: ChannelType
    initial_message: str
    context: Optional[Dict[str, Any]] = None

class BotResponse(BaseModel):
    message_id: str
    conversation_id: str
    response: str
    intent: IntentType
    confidence: float
    suggested_actions: List[str]
    requires_human: bool = False

class ConversationSummary(BaseModel):
    conversation_id: str
    user_id: str
    channel: ChannelType
    status: ConversationStatus
    message_count: int
    start_time: datetime
    last_activity: datetime
    resolution_time: Optional[datetime] = None
    satisfaction_score: Optional[float] = None

class IntentAnalysis(BaseModel):
    intent: IntentType
    confidence: float
    entities: Dict[str, Any]
    sentiment: str
    urgency_level: str

# Database functions
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    conversation_id VARCHAR(255) UNIQUE NOT NULL,
                    user_id VARCHAR(255) NOT NULL,
                    channel VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'ACTIVE',
                    assigned_agent_id VARCHAR(255),
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolution_time TIMESTAMP,
                    satisfaction_score DECIMAL(3,2),
                    context JSONB,
                    summary TEXT,
                    INDEX idx_conversation_id (conversation_id),
                    INDEX idx_user_id (user_id),
                    INDEX idx_status (status),
                    INDEX idx_channel (channel)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    message_id VARCHAR(255) UNIQUE NOT NULL,
                    conversation_id VARCHAR(255) NOT NULL,
                    sender_id VARCHAR(255) NOT NULL,
                    source VARCHAR(20) NOT NULL,
                    channel VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    intent VARCHAR(50),
                    sentiment VARCHAR(20),
                    confidence DECIMAL(5,4),
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_message_id (message_id),
                    INDEX idx_conversation_id (conversation_id),
                    INDEX idx_sender_id (sender_id),
                    INDEX idx_created_at (created_at),
                    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS bot_knowledge_base (
                    id SERIAL PRIMARY KEY,
                    intent VARCHAR(50) NOT NULL,
                    question_pattern TEXT NOT NULL,
                    response_template TEXT NOT NULL,
                    confidence_threshold DECIMAL(3,2) DEFAULT 0.8,
                    requires_human BOOLEAN DEFAULT FALSE,
                    context_required JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_intent (intent)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS conversation_analytics (
                    id SERIAL PRIMARY KEY,
                    conversation_id VARCHAR(255) NOT NULL,
                    metric_name VARCHAR(100) NOT NULL,
                    metric_value DECIMAL(10,4),
                    metric_data JSONB,
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_conversation_id (conversation_id),
                    INDEX idx_metric_name (metric_name),
                    INDEX idx_recorded_at (recorded_at)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_performance (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) NOT NULL,
                    date DATE DEFAULT CURRENT_DATE,
                    conversations_handled INTEGER DEFAULT 0,
                    average_response_time DECIMAL(8,2),
                    customer_satisfaction DECIMAL(3,2),
                    resolution_rate DECIMAL(5,4),
                    escalation_rate DECIMAL(5,4),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_date (date),
                    UNIQUE(agent_id, date)
                )
            """)
        
        # Initialize knowledge base
        await init_knowledge_base()
        
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

async def init_nlp_models():
    """Initialize NLP models"""
    global nlp_models, sentiment_analyzer, nlp_processor
    
    try:
        # Download required NLTK data
        nltk.download('vader_lexicon', quiet=True)
        nltk.download('punkt', quiet=True)
        
        # Initialize sentiment analyzer
        sentiment_analyzer = SentimentIntensityAnalyzer()
        
        # Initialize spaCy model
        try:
            nlp_processor = spacy.load("en_core_web_sm")
        except OSError:
            logger.warning("spaCy model not found, using basic NLP")
            nlp_processor = None
        
        # Initialize intent classification model
        try:
            nlp_models['intent_classifier'] = pipeline(
                "text-classification",
                model="microsoft/DialoGPT-medium",
                return_all_scores=True
            )
        except Exception as e:
            logger.warning(f"Intent classifier not available: {e}")
        
        logger.info("NLP models initialized successfully")
        
    except Exception as e:
        logger.error(f"NLP initialization failed: {e}")

async def init_knowledge_base():
    """Initialize bot knowledge base"""
    knowledge_entries = [
        {
            "intent": "ACCOUNT_INQUIRY",
            "question_pattern": "account balance|check balance|my balance",
            "response_template": "I can help you check your account balance. Let me retrieve that information for you.",
            "requires_human": False
        },
        {
            "intent": "TRANSACTION_SUPPORT",
            "question_pattern": "transaction failed|payment error|transfer problem",
            "response_template": "I understand you're having issues with a transaction. Let me help you resolve this.",
            "requires_human": False
        },
        {
            "intent": "TECHNICAL_SUPPORT",
            "question_pattern": "app not working|login problem|technical issue",
            "response_template": "I can help with technical issues. Let me guide you through some troubleshooting steps.",
            "requires_human": False
        },
        {
            "intent": "COMPLAINT",
            "question_pattern": "complaint|dissatisfied|poor service|problem with",
            "response_template": "I'm sorry to hear about your concern. Let me connect you with a specialist who can help resolve this issue.",
            "requires_human": True
        },
        {
            "intent": "EMERGENCY",
            "question_pattern": "emergency|urgent|stolen card|fraud|suspicious",
            "response_template": "This appears to be an urgent matter. I'm immediately connecting you with our emergency support team.",
            "requires_human": True
        }
    ]
    
    try:
        async with db_pool.acquire() as conn:
            for entry in knowledge_entries:
                await conn.execute("""
                    INSERT INTO bot_knowledge_base 
                    (intent, question_pattern, response_template, requires_human)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT DO NOTHING
                """, 
                entry["intent"], entry["question_pattern"], 
                entry["response_template"], entry["requires_human"]
                )
        
        logger.info("Knowledge base initialized")
        
    except Exception as e:
        logger.error(f"Failed to initialize knowledge base: {e}")

# AI-powered communication engine
class CommunicationPlatform:
    """Main communication platform with AI capabilities"""
    
    def __init__(self):
        self.active_conversations = {}
        
    async def start_conversation(self, request: ConversationRequest) -> ConversationSummary:
        """Start a new conversation"""
        try:
            # Generate conversation ID if not provided
            if not request.conversation_id:
                request.conversation_id = f"conv_{datetime.now().strftime('%Y%m%d%H%M%S')}_{request.user_id}"
            
            # Store conversation in database
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO conversations 
                    (conversation_id, user_id, channel, context)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (conversation_id) DO UPDATE SET
                    last_activity = CURRENT_TIMESTAMP
                """, 
                request.conversation_id, request.user_id, request.channel.value,
                json.dumps(request.context) if request.context else None
                )
            
            # Process initial message
            initial_message = ChatMessage(
                conversation_id=request.conversation_id,
                sender_id=request.user_id,
                source=MessageSource.USER,
                channel=request.channel,
                content=request.initial_message
            )
            
            await self.process_message(initial_message)
            
            # Return conversation summary
            return ConversationSummary(
                conversation_id=request.conversation_id,
                user_id=request.user_id,
                channel=request.channel,
                status=ConversationStatus.ACTIVE,
                message_count=1,
                start_time=datetime.now(),
                last_activity=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"Failed to start conversation: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to start conversation: {str(e)}")
    
    async def process_message(self, message: ChatMessage) -> BotResponse:
        """Process incoming message and generate response"""
        try:
            # Generate message ID if not provided
            if not message.message_id:
                message.message_id = f"msg_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            # Analyze message intent and sentiment
            analysis = await self._analyze_message(message.content)
            message.intent = analysis.intent
            message.sentiment = analysis.sentiment
            message.confidence = analysis.confidence
            
            # Store message
            await self._store_message(message)
            
            # Generate bot response
            bot_response = await self._generate_bot_response(message, analysis)
            
            # Store bot response
            bot_message = ChatMessage(
                conversation_id=message.conversation_id,
                sender_id="bot",
                source=MessageSource.BOT,
                channel=message.channel,
                content=bot_response.response,
                intent=bot_response.intent,
                confidence=bot_response.confidence
            )
            
            await self._store_message(bot_message)
            
            # Update conversation activity
            await self._update_conversation_activity(message.conversation_id)
            
            return bot_response
            
        except Exception as e:
            logger.error(f"Failed to process message: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to process message: {str(e)}")
    
    async def _analyze_message(self, content: str) -> IntentAnalysis:
        """Analyze message for intent, sentiment, and entities"""
        try:
            # Sentiment analysis
            sentiment_scores = sentiment_analyzer.polarity_scores(content)
            
            if sentiment_scores['compound'] >= 0.05:
                sentiment = 'positive'
            elif sentiment_scores['compound'] <= -0.05:
                sentiment = 'negative'
            else:
                sentiment = 'neutral'
            
            # Intent classification
            intent, confidence = await self._classify_intent(content)
            
            # Entity extraction
            entities = {}
            if nlp_processor:
                doc = nlp_processor(content)
                for ent in doc.ents:
                    entities[ent.label_] = ent.text
            
            # Urgency detection
            urgency_keywords = ['urgent', 'emergency', 'asap', 'immediately', 'critical']
            urgency_level = 'high' if any(keyword in content.lower() for keyword in urgency_keywords) else 'normal'
            
            return IntentAnalysis(
                intent=intent,
                confidence=confidence,
                entities=entities,
                sentiment=sentiment,
                urgency_level=urgency_level
            )
            
        except Exception as e:
            logger.error(f"Message analysis failed: {e}")
            return IntentAnalysis(
                intent=IntentType.GENERAL_INQUIRY,
                confidence=0.5,
                entities={},
                sentiment='neutral',
                urgency_level='normal'
            )
    
    async def _classify_intent(self, content: str) -> tuple:
        """Classify message intent"""
        try:
            # Simple keyword-based classification
            content_lower = content.lower()
            
            if any(word in content_lower for word in ['balance', 'account', 'money']):
                return IntentType.ACCOUNT_INQUIRY, 0.8
            elif any(word in content_lower for word in ['transaction', 'payment', 'transfer', 'failed']):
                return IntentType.TRANSACTION_SUPPORT, 0.8
            elif any(word in content_lower for word in ['app', 'login', 'technical', 'error', 'bug']):
                return IntentType.TECHNICAL_SUPPORT, 0.8
            elif any(word in content_lower for word in ['complaint', 'dissatisfied', 'poor', 'bad']):
                return IntentType.COMPLAINT, 0.9
            elif any(word in content_lower for word in ['emergency', 'urgent', 'fraud', 'stolen']):
                return IntentType.EMERGENCY, 0.95
            else:
                return IntentType.GENERAL_INQUIRY, 0.6
                
        except Exception as e:
            logger.error(f"Intent classification failed: {e}")
            return IntentType.GENERAL_INQUIRY, 0.5
    
    async def _generate_bot_response(self, message: ChatMessage, analysis: IntentAnalysis) -> BotResponse:
        """Generate bot response based on message analysis"""
        try:
            # Get response template from knowledge base
            async with db_pool.acquire() as conn:
                kb_entry = await conn.fetchrow("""
                    SELECT * FROM bot_knowledge_base 
                    WHERE intent = $1 
                    ORDER BY confidence_threshold DESC 
                    LIMIT 1
                """, analysis.intent.value)
            
            if kb_entry:
                response_template = kb_entry['response_template']
                requires_human = kb_entry['requires_human']
            else:
                response_template = "I understand your inquiry. Let me help you with that."
                requires_human = False
            
            # Generate personalized response using OpenAI if available
            if OPENAI_API_KEY and analysis.confidence > 0.7:
                try:
                    personalized_response = await self._generate_ai_response(
                        message.content, analysis, response_template
                    )
                    response_text = personalized_response
                except Exception as e:
                    logger.warning(f"AI response generation failed: {e}")
                    response_text = response_template
            else:
                response_text = response_template
            
            # Generate suggested actions
            suggested_actions = self._generate_suggested_actions(analysis.intent)
            
            # Check if human escalation is needed
            if analysis.urgency_level == 'high' or analysis.intent == IntentType.EMERGENCY:
                requires_human = True
            
            return BotResponse(
                message_id=f"bot_msg_{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
                conversation_id=message.conversation_id,
                response=response_text,
                intent=analysis.intent,
                confidence=analysis.confidence,
                suggested_actions=suggested_actions,
                requires_human=requires_human
            )
            
        except Exception as e:
            logger.error(f"Bot response generation failed: {e}")
            return BotResponse(
                message_id=f"bot_msg_{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
                conversation_id=message.conversation_id,
                response="I apologize, but I'm having trouble processing your request. Let me connect you with a human agent.",
                intent=IntentType.GENERAL_INQUIRY,
                confidence=0.5,
                suggested_actions=["Connect with human agent"],
                requires_human=True
            )
    
    async def _generate_ai_response(self, user_message: str, analysis: IntentAnalysis, template: str) -> str:
        """Generate AI-powered response using OpenAI"""
        try:
            prompt = f"""
            You are a helpful banking assistant. A customer has sent this message: "{user_message}"
            
            Intent: {analysis.intent.value}
            Sentiment: {analysis.sentiment}
            Urgency: {analysis.urgency_level}
            
            Base response template: "{template}"
            
            Generate a personalized, helpful response that addresses the customer's specific concern.
            Keep it concise, professional, and empathetic.
            """
            
            response = await openai.ChatCompletion.acreate(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are a professional banking customer service assistant."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=150,
                temperature=0.7
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            logger.error(f"OpenAI response generation failed: {e}")
            return template
    
    def _generate_suggested_actions(self, intent: IntentType) -> List[str]:
        """Generate suggested actions based on intent"""
        action_map = {
            IntentType.ACCOUNT_INQUIRY: [
                "Check account balance",
                "View transaction history",
                "Download statement"
            ],
            IntentType.TRANSACTION_SUPPORT: [
                "Check transaction status",
                "Retry transaction",
                "Contact support"
            ],
            IntentType.TECHNICAL_SUPPORT: [
                "Restart app",
                "Clear cache",
                "Update app",
                "Contact technical support"
            ],
            IntentType.COMPLAINT: [
                "File formal complaint",
                "Speak to supervisor",
                "Request callback"
            ],
            IntentType.EMERGENCY: [
                "Block card immediately",
                "Report fraud",
                "Emergency contact"
            ],
            IntentType.GENERAL_INQUIRY: [
                "Browse FAQ",
                "Contact support",
                "Schedule callback"
            ]
        }
        
        return action_map.get(intent, ["Contact support"])
    
    async def _store_message(self, message: ChatMessage):
        """Store message in database"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO chat_messages 
                (message_id, conversation_id, sender_id, source, channel, content, 
                 intent, sentiment, confidence, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (message_id) DO NOTHING
            """, 
            message.message_id, message.conversation_id, message.sender_id,
            message.source.value, message.channel.value, message.content,
            message.intent.value if message.intent else None,
            message.sentiment, message.confidence,
            json.dumps(message.metadata) if message.metadata else None
            )
    
    async def _update_conversation_activity(self, conversation_id: str):
        """Update conversation last activity"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE conversations 
                SET last_activity = CURRENT_TIMESTAMP
                WHERE conversation_id = $1
            """, conversation_id)
    
    async def get_conversation_history(self, conversation_id: str, limit: int = 50) -> List[Dict]:
        """Get conversation message history"""
        try:
            async with db_pool.acquire() as conn:
                messages = await conn.fetch("""
                    SELECT * FROM chat_messages 
                    WHERE conversation_id = $1 
                    ORDER BY created_at ASC 
                    LIMIT $2
                """, conversation_id, limit)
                
                return [
                    {
                        "message_id": row['message_id'],
                        "sender_id": row['sender_id'],
                        "source": row['source'],
                        "content": row['content'],
                        "intent": row['intent'],
                        "sentiment": row['sentiment'],
                        "confidence": float(row['confidence']) if row['confidence'] else None,
                        "created_at": row['created_at'].isoformat()
                    }
                    for row in messages
                ]
                
        except Exception as e:
            logger.error(f"Failed to get conversation history: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to get history: {str(e)}")
    
    async def escalate_to_human(self, conversation_id: str, agent_id: str) -> Dict:
        """Escalate conversation to human agent"""
        try:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE conversations 
                    SET status = 'ESCALATED', assigned_agent_id = $1
                    WHERE conversation_id = $2
                """, agent_id, conversation_id)
            
            # Send notification to agent
            await redis_client.lpush(
                f"agent_queue:{agent_id}",
                json.dumps({
                    "type": "conversation_escalated",
                    "conversation_id": conversation_id,
                    "timestamp": datetime.now().isoformat()
                })
            )
            
            return {
                "conversation_id": conversation_id,
                "status": "escalated",
                "assigned_agent": agent_id,
                "escalated_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to escalate conversation: {e}")
            raise HTTPException(status_code=500, detail=f"Escalation failed: {str(e)}")
    
    async def get_analytics_summary(self, start_date: datetime, end_date: datetime) -> Dict:
        """Get communication analytics summary"""
        try:
            async with db_pool.acquire() as conn:
                # Conversation metrics
                conv_metrics = await conn.fetchrow("""
                    SELECT 
                        COUNT(*) as total_conversations,
                        COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) as resolved_conversations,
                        COUNT(CASE WHEN status = 'ESCALATED' THEN 1 END) as escalated_conversations,
                        AVG(EXTRACT(EPOCH FROM (resolution_time - start_time))/60) as avg_resolution_minutes
                    FROM conversations
                    WHERE start_time BETWEEN $1 AND $2
                """, start_date, end_date)
                
                # Message metrics
                msg_metrics = await conn.fetchrow("""
                    SELECT 
                        COUNT(*) as total_messages,
                        COUNT(CASE WHEN source = 'BOT' THEN 1 END) as bot_messages,
                        COUNT(CASE WHEN source = 'AGENT' THEN 1 END) as agent_messages
                    FROM chat_messages cm
                    JOIN conversations c ON cm.conversation_id = c.conversation_id
                    WHERE c.start_time BETWEEN $1 AND $2
                """, start_date, end_date)
                
                # Intent distribution
                intent_dist = await conn.fetch("""
                    SELECT intent, COUNT(*) as count
                    FROM chat_messages cm
                    JOIN conversations c ON cm.conversation_id = c.conversation_id
                    WHERE c.start_time BETWEEN $1 AND $2 AND intent IS NOT NULL
                    GROUP BY intent
                    ORDER BY count DESC
                """, start_date, end_date)
                
                # Sentiment analysis
                sentiment_dist = await conn.fetch("""
                    SELECT sentiment, COUNT(*) as count
                    FROM chat_messages cm
                    JOIN conversations c ON cm.conversation_id = c.conversation_id
                    WHERE c.start_time BETWEEN $1 AND $2 AND sentiment IS NOT NULL
                    GROUP BY sentiment
                """, start_date, end_date)
                
                return {
                    "period": {
                        "start": start_date.isoformat(),
                        "end": end_date.isoformat()
                    },
                    "conversations": {
                        "total": conv_metrics['total_conversations'],
                        "resolved": conv_metrics['resolved_conversations'],
                        "escalated": conv_metrics['escalated_conversations'],
                        "resolution_rate": (conv_metrics['resolved_conversations'] / conv_metrics['total_conversations'] * 100) if conv_metrics['total_conversations'] > 0 else 0,
                        "avg_resolution_minutes": float(conv_metrics['avg_resolution_minutes']) if conv_metrics['avg_resolution_minutes'] else 0
                    },
                    "messages": {
                        "total": msg_metrics['total_messages'],
                        "bot_messages": msg_metrics['bot_messages'],
                        "agent_messages": msg_metrics['agent_messages'],
                        "automation_rate": (msg_metrics['bot_messages'] / msg_metrics['total_messages'] * 100) if msg_metrics['total_messages'] > 0 else 0
                    },
                    "intent_distribution": {row['intent']: row['count'] for row in intent_dist},
                    "sentiment_distribution": {row['sentiment']: row['count'] for row in sentiment_dist}
                }
                
        except Exception as e:
            logger.error(f"Failed to get analytics: {e}")
            raise HTTPException(status_code=500, detail=f"Analytics failed: {str(e)}")

# Initialize communication platform
comm_platform = CommunicationPlatform()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()
    await init_nlp_models()

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
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
            "service": "communication-platform",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "nlp_models": "loaded" if sentiment_analyzer else "not_loaded",
            "openai": "configured" if OPENAI_API_KEY else "not_configured"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/conversations", response_model=ConversationSummary)
async def start_conversation(request: ConversationRequest):
    """Start a new conversation"""
    return await comm_platform.start_conversation(request)

@app.post("/api/v1/messages", response_model=BotResponse)
async def send_message(message: ChatMessage):
    """Send a message and get bot response"""
    return await comm_platform.process_message(message)

@app.get("/api/v1/conversations/{conversation_id}/history")
async def get_conversation_history(conversation_id: str, limit: int = 50):
    """Get conversation message history"""
    return await comm_platform.get_conversation_history(conversation_id, limit)

@app.post("/api/v1/conversations/{conversation_id}/escalate")
async def escalate_conversation(conversation_id: str, agent_id: str):
    """Escalate conversation to human agent"""
    return await comm_platform.escalate_to_human(conversation_id, agent_id)

@app.get("/api/v1/analytics/summary")
async def get_analytics_summary(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
):
    """Get communication analytics summary"""
    if not start_date:
        start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    if not end_date:
        end_date = datetime.now()
    
    return await comm_platform.get_analytics_summary(start_date, end_date)

@app.get("/api/v1/conversations")
async def list_conversations(
    user_id: Optional[str] = None,
    status: Optional[ConversationStatus] = None,
    limit: int = 100
):
    """List conversations"""
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM conversations WHERE 1=1"
            params = []
            
            if user_id:
                query += f" AND user_id = ${len(params) + 1}"
                params.append(user_id)
            
            if status:
                query += f" AND status = ${len(params) + 1}"
                params.append(status.value)
            
            query += f" ORDER BY last_activity DESC LIMIT ${len(params) + 1}"
            params.append(limit)
            
            conversations = await conn.fetch(query, *params)
            
            return [
                {
                    "conversation_id": row['conversation_id'],
                    "user_id": row['user_id'],
                    "channel": row['channel'],
                    "status": row['status'],
                    "start_time": row['start_time'].isoformat(),
                    "last_activity": row['last_activity'].isoformat(),
                    "assigned_agent_id": row['assigned_agent_id']
                }
                for row in conversations
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list conversations: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

