#!/usr/bin/env python3
"""
NLP Support Service
Advanced Natural Language Processing platform for remittance network
with multilingual support, sentiment analysis, intent classification, and chatbot capabilities
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union, Tuple
from decimal import Decimal
from enum import Enum
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import numpy as np
import pandas as pd

# NLP Libraries
import nltk
import spacy
from transformers import (
    AutoTokenizer, AutoModelForSequenceClassification,
    AutoModelForQuestionAnswering, pipeline
)
from sentence_transformers import SentenceTransformer
import openai
from textblob import TextBlob
import langdetect
from googletrans import Translator
import re

# Download required NLTK data
try:
    nltk.download('punkt', quiet=True)
    nltk.download('stopwords', quiet=True)
    nltk.download('vader_lexicon', quiet=True)
    nltk.download('wordnet', quiet=True)
except:
    pass

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8138"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# FastAPI app
app = FastAPI(
    title="NLP Support Service",
    description="Advanced Natural Language Processing platform",
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
translator = None

# Enums
class Language(str, Enum):
    ENGLISH = "en"
    YORUBA = "yo"
    HAUSA = "ha"
    IGBO = "ig"
    FRENCH = "fr"
    ARABIC = "ar"
    SWAHILI = "sw"

class IntentType(str, Enum):
    ACCOUNT_INQUIRY = "ACCOUNT_INQUIRY"
    TRANSACTION_INQUIRY = "TRANSACTION_INQUIRY"
    BALANCE_CHECK = "BALANCE_CHECK"
    TRANSFER_REQUEST = "TRANSFER_REQUEST"
    COMPLAINT = "COMPLAINT"
    TECHNICAL_SUPPORT = "TECHNICAL_SUPPORT"
    GENERAL_INQUIRY = "GENERAL_INQUIRY"
    LOAN_INQUIRY = "LOAN_INQUIRY"
    CARD_SERVICES = "CARD_SERVICES"
    BILL_PAYMENT = "BILL_PAYMENT"

class SentimentType(str, Enum):
    VERY_POSITIVE = "VERY_POSITIVE"
    POSITIVE = "POSITIVE"
    NEUTRAL = "NEUTRAL"
    NEGATIVE = "NEGATIVE"
    VERY_NEGATIVE = "VERY_NEGATIVE"

class EntityType(str, Enum):
    PERSON = "PERSON"
    ORGANIZATION = "ORGANIZATION"
    LOCATION = "LOCATION"
    MONEY = "MONEY"
    DATE = "DATE"
    TIME = "TIME"
    ACCOUNT_NUMBER = "ACCOUNT_NUMBER"
    PHONE_NUMBER = "PHONE_NUMBER"

class ConversationStatus(str, Enum):
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    ESCALATED = "ESCALATED"
    PENDING = "PENDING"

# Pydantic models
class TextAnalysisRequest(BaseModel):
    text: str
    language: Optional[Language] = None
    include_sentiment: bool = True
    include_intent: bool = True
    include_entities: bool = True
    include_keywords: bool = True

class TextAnalysisResponse(BaseModel):
    original_text: str
    detected_language: Language
    sentiment: Dict[str, Any]
    intent: Dict[str, Any]
    entities: List[Dict[str, Any]]
    keywords: List[str]
    confidence_scores: Dict[str, float]
    processing_time: float

class TranslationRequest(BaseModel):
    text: str
    source_language: Optional[Language] = None
    target_language: Language

class TranslationResponse(BaseModel):
    original_text: str
    translated_text: str
    source_language: Language
    target_language: Language
    confidence: float

class ChatbotRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    user_id: str
    language: Optional[Language] = None
    context: Optional[Dict[str, Any]] = {}

class ChatbotResponse(BaseModel):
    response: str
    conversation_id: str
    intent: IntentType
    confidence: float
    suggested_actions: List[str]
    requires_human: bool = False

class ConversationSummary(BaseModel):
    conversation_id: str
    user_id: str
    start_time: datetime
    end_time: Optional[datetime]
    message_count: int
    primary_intent: IntentType
    sentiment_trend: List[Dict[str, Any]]
    resolution_status: ConversationStatus
    summary: str

class EntityExtractionResult(BaseModel):
    text: str
    entities: List[Dict[str, Any]]
    relationships: List[Dict[str, Any]]
    confidence: float

# Database initialization
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create text analysis table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS text_analysis (
                    id SERIAL PRIMARY KEY,
                    analysis_id VARCHAR(255) UNIQUE NOT NULL,
                    original_text TEXT NOT NULL,
                    detected_language VARCHAR(10),
                    sentiment JSONB,
                    intent JSONB,
                    entities JSONB,
                    keywords JSONB,
                    confidence_scores JSONB,
                    processing_time DECIMAL(8,4),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_analysis_id (analysis_id),
                    INDEX idx_language (detected_language),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            # Create conversations table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    conversation_id VARCHAR(255) UNIQUE NOT NULL,
                    user_id VARCHAR(255) NOT NULL,
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    end_time TIMESTAMP,
                    message_count INTEGER DEFAULT 0,
                    primary_intent VARCHAR(50),
                    sentiment_trend JSONB,
                    resolution_status VARCHAR(20) DEFAULT 'ACTIVE',
                    summary TEXT,
                    INDEX idx_conversation_id (conversation_id),
                    INDEX idx_user_id (user_id),
                    INDEX idx_status (resolution_status),
                    INDEX idx_start_time (start_time)
                )
            """)
            
            # Create messages table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS conversation_messages (
                    id SERIAL PRIMARY KEY,
                    message_id VARCHAR(255) UNIQUE NOT NULL,
                    conversation_id VARCHAR(255) NOT NULL,
                    sender_type VARCHAR(20) NOT NULL,
                    message_text TEXT NOT NULL,
                    language VARCHAR(10),
                    intent VARCHAR(50),
                    sentiment JSONB,
                    entities JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_message_id (message_id),
                    INDEX idx_conversation_id (conversation_id),
                    INDEX idx_timestamp (timestamp)
                )
            """)
            
            # Create translations table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS translations (
                    id SERIAL PRIMARY KEY,
                    translation_id VARCHAR(255) UNIQUE NOT NULL,
                    original_text TEXT NOT NULL,
                    translated_text TEXT NOT NULL,
                    source_language VARCHAR(10) NOT NULL,
                    target_language VARCHAR(10) NOT NULL,
                    confidence DECIMAL(5,4),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_translation_id (translation_id),
                    INDEX idx_languages (source_language, target_language),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            # Create knowledge base table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS knowledge_base (
                    id SERIAL PRIMARY KEY,
                    kb_id VARCHAR(255) UNIQUE NOT NULL,
                    category VARCHAR(100) NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    keywords JSONB,
                    language VARCHAR(10) DEFAULT 'en',
                    confidence DECIMAL(5,4) DEFAULT 0.8,
                    usage_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_kb_id (kb_id),
                    INDEX idx_category (category),
                    INDEX idx_language (language),
                    INDEX idx_usage_count (usage_count)
                )
            """)
        
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
    global nlp_models, translator
    
    try:
        # Initialize translator
        translator = Translator()
        
        # Load spaCy model for English
        try:
            nlp_models['spacy_en'] = spacy.load("en_core_web_sm")
        except OSError:
            logger.warning("English spaCy model not found, using basic tokenization")
            nlp_models['spacy_en'] = None
        
        # Initialize sentence transformer for embeddings
        nlp_models['sentence_transformer'] = SentenceTransformer('all-MiniLM-L6-v2')
        
        # Initialize sentiment analysis pipeline
        nlp_models['sentiment_pipeline'] = pipeline(
            "sentiment-analysis",
            model="cardiffnlp/twitter-roberta-base-sentiment-latest",
            return_all_scores=True
        )
        
        # Initialize intent classification model (using a general classification model)
        nlp_models['intent_classifier'] = pipeline(
            "zero-shot-classification",
            model="facebook/bart-large-mnli"
        )
        
        # Initialize question answering model
        nlp_models['qa_pipeline'] = pipeline(
            "question-answering",
            model="distilbert-base-cased-distilled-squad"
        )
        
        # Initialize text generation for chatbot
        if OPENAI_API_KEY:
            openai.api_key = OPENAI_API_KEY
            nlp_models['openai_enabled'] = True
        else:
            nlp_models['openai_enabled'] = False
            logger.warning("OpenAI API key not provided, using fallback responses")
        
        # Initialize knowledge base
        await init_knowledge_base()
        
        logger.info("NLP models initialized successfully")
        
    except Exception as e:
        logger.error(f"NLP model initialization failed: {e}")

async def init_knowledge_base():
    """Initialize knowledge base with banking-specific Q&A"""
    try:
        knowledge_items = [
            {
                'category': 'account_services',
                'question': 'How do I check my account balance?',
                'answer': 'You can check your account balance by visiting any of our agent locations, using our mobile app, or calling our customer service line.',
                'keywords': ['balance', 'check', 'account', 'inquiry']
            },
            {
                'category': 'transfers',
                'question': 'How do I transfer money to another account?',
                'answer': 'To transfer money, visit an agent with your ID and recipient details, or use our mobile app for instant transfers.',
                'keywords': ['transfer', 'send', 'money', 'recipient']
            },
            {
                'category': 'deposits',
                'question': 'How do I deposit money into my account?',
                'answer': 'You can deposit money at any agent location. Bring cash and your account details or phone number.',
                'keywords': ['deposit', 'money', 'cash', 'agent']
            },
            {
                'category': 'withdrawals',
                'question': 'How do I withdraw money from my account?',
                'answer': 'Visit any agent location with your ID and account details to withdraw money. Daily limits may apply.',
                'keywords': ['withdraw', 'cash', 'money', 'agent', 'limit']
            },
            {
                'category': 'technical_support',
                'question': 'I forgot my PIN, what should I do?',
                'answer': 'Contact customer service or visit an agent location with your ID to reset your PIN securely.',
                'keywords': ['PIN', 'forgot', 'reset', 'password']
            },
            {
                'category': 'loans',
                'question': 'How can I apply for a loan?',
                'answer': 'Visit an agent location with your ID, proof of income, and bank statements to apply for a loan.',
                'keywords': ['loan', 'apply', 'credit', 'borrow']
            }
        ]
        
        async with db_pool.acquire() as conn:
            for item in knowledge_items:
                kb_id = f"kb_{item['category']}_{len(item['question'])}"
                await conn.execute("""
                    INSERT INTO knowledge_base 
                    (kb_id, category, question, answer, keywords)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (kb_id) DO NOTHING
                """, 
                kb_id, item['category'], item['question'], 
                item['answer'], json.dumps(item['keywords'])
                )
        
        logger.info(f"Knowledge base initialized with {len(knowledge_items)} items")
        
    except Exception as e:
        logger.error(f"Knowledge base initialization failed: {e}")

# NLP processing engine
class NLPEngine:
    """Main NLP processing engine"""
    
    def __init__(self):
        self.intent_labels = [intent.value for intent in IntentType]
        self.conversation_cache = {}
        
    async def analyze_text(self, request: TextAnalysisRequest) -> TextAnalysisResponse:
        """Comprehensive text analysis"""
        try:
            start_time = datetime.now()
            
            # Detect language
            detected_language = await self._detect_language(request.text)
            
            # Initialize results
            sentiment = {}
            intent = {}
            entities = []
            keywords = []
            confidence_scores = {}
            
            # Sentiment analysis
            if request.include_sentiment:
                sentiment = await self._analyze_sentiment(request.text)
                confidence_scores['sentiment'] = sentiment.get('confidence', 0.0)
            
            # Intent classification
            if request.include_intent:
                intent = await self._classify_intent(request.text)
                confidence_scores['intent'] = intent.get('confidence', 0.0)
            
            # Entity extraction
            if request.include_entities:
                entities = await self._extract_entities(request.text)
                confidence_scores['entities'] = np.mean([e.get('confidence', 0.0) for e in entities]) if entities else 0.0
            
            # Keyword extraction
            if request.include_keywords:
                keywords = await self._extract_keywords(request.text)
                confidence_scores['keywords'] = 0.8  # Default confidence for keywords
            
            processing_time = (datetime.now() - start_time).total_seconds()
            
            response = TextAnalysisResponse(
                original_text=request.text,
                detected_language=detected_language,
                sentiment=sentiment,
                intent=intent,
                entities=entities,
                keywords=keywords,
                confidence_scores=confidence_scores,
                processing_time=processing_time
            )
            
            # Store analysis
            await self._store_analysis(response)
            
            return response
            
        except Exception as e:
            logger.error(f"Text analysis failed: {e}")
            raise HTTPException(status_code=500, detail=f"Text analysis failed: {str(e)}")
    
    async def translate_text(self, request: TranslationRequest) -> TranslationResponse:
        """Translate text between languages"""
        try:
            # Detect source language if not provided
            if not request.source_language:
                source_lang = await self._detect_language(request.text)
            else:
                source_lang = request.source_language
            
            # Perform translation
            if source_lang == request.target_language:
                translated_text = request.text
                confidence = 1.0
            else:
                translated_text, confidence = await self._translate(
                    request.text, source_lang.value, request.target_language.value
                )
            
            response = TranslationResponse(
                original_text=request.text,
                translated_text=translated_text,
                source_language=source_lang,
                target_language=request.target_language,
                confidence=confidence
            )
            
            # Store translation
            await self._store_translation(response)
            
            return response
            
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")
    
    async def process_chatbot_message(self, request: ChatbotRequest) -> ChatbotResponse:
        """Process chatbot conversation"""
        try:
            # Generate or use existing conversation ID
            if not request.conversation_id:
                conversation_id = f"conv_{request.user_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
                await self._create_conversation(conversation_id, request.user_id)
            else:
                conversation_id = request.conversation_id
            
            # Analyze user message
            analysis = await self.analyze_text(TextAnalysisRequest(
                text=request.message,
                language=request.language
            ))
            
            # Determine intent
            intent = IntentType(analysis.intent.get('label', 'GENERAL_INQUIRY'))
            confidence = analysis.intent.get('confidence', 0.5)
            
            # Generate response
            response_text, suggested_actions, requires_human = await self._generate_response(
                request.message, intent, analysis, request.context
            )
            
            # Store message
            await self._store_message(
                conversation_id, 'user', request.message, 
                analysis.detected_language, intent, analysis.sentiment, analysis.entities
            )
            
            await self._store_message(
                conversation_id, 'bot', response_text,
                analysis.detected_language, intent, {}, []
            )
            
            # Update conversation
            await self._update_conversation(conversation_id, intent, analysis.sentiment)
            
            return ChatbotResponse(
                response=response_text,
                conversation_id=conversation_id,
                intent=intent,
                confidence=confidence,
                suggested_actions=suggested_actions,
                requires_human=requires_human
            )
            
        except Exception as e:
            logger.error(f"Chatbot processing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Chatbot processing failed: {str(e)}")
    
    async def extract_entities(self, text: str) -> EntityExtractionResult:
        """Extract entities and relationships from text"""
        try:
            entities = await self._extract_entities(text)
            relationships = await self._extract_relationships(text, entities)
            
            # Calculate overall confidence
            confidence = np.mean([e.get('confidence', 0.0) for e in entities]) if entities else 0.0
            
            return EntityExtractionResult(
                text=text,
                entities=entities,
                relationships=relationships,
                confidence=confidence
            )
            
        except Exception as e:
            logger.error(f"Entity extraction failed: {e}")
            raise HTTPException(status_code=500, detail=f"Entity extraction failed: {str(e)}")
    
    # Helper methods
    async def _detect_language(self, text: str) -> Language:
        """Detect language of text"""
        try:
            detected = langdetect.detect(text)
            
            # Map to supported languages
            language_map = {
                'en': Language.ENGLISH,
                'yo': Language.YORUBA,
                'ha': Language.HAUSA,
                'ig': Language.IGBO,
                'fr': Language.FRENCH,
                'ar': Language.ARABIC,
                'sw': Language.SWAHILI
            }
            
            return language_map.get(detected, Language.ENGLISH)
            
        except Exception as e:
            logger.warning(f"Language detection failed: {e}")
            return Language.ENGLISH
    
    async def _analyze_sentiment(self, text: str) -> Dict[str, Any]:
        """Analyze sentiment of text"""
        try:
            # Use transformer model
            results = nlp_models['sentiment_pipeline'](text)
            
            # Process results
            sentiment_scores = {}
            for result in results[0]:
                label = result['label'].lower()
                score = result['score']
                
                if 'positive' in label:
                    sentiment_scores['positive'] = score
                elif 'negative' in label:
                    sentiment_scores['negative'] = score
                else:
                    sentiment_scores['neutral'] = score
            
            # Determine overall sentiment
            max_label = max(sentiment_scores, key=sentiment_scores.get)
            max_score = sentiment_scores[max_label]
            
            # Map to sentiment types
            if max_label == 'positive':
                if max_score > 0.8:
                    sentiment_type = SentimentType.VERY_POSITIVE
                else:
                    sentiment_type = SentimentType.POSITIVE
            elif max_label == 'negative':
                if max_score > 0.8:
                    sentiment_type = SentimentType.VERY_NEGATIVE
                else:
                    sentiment_type = SentimentType.NEGATIVE
            else:
                sentiment_type = SentimentType.NEUTRAL
            
            return {
                'type': sentiment_type.value,
                'confidence': max_score,
                'scores': sentiment_scores
            }
            
        except Exception as e:
            logger.error(f"Sentiment analysis failed: {e}")
            return {
                'type': SentimentType.NEUTRAL.value,
                'confidence': 0.5,
                'scores': {'neutral': 0.5}
            }
    
    async def _classify_intent(self, text: str) -> Dict[str, Any]:
        """Classify intent of text"""
        try:
            # Use zero-shot classification
            result = nlp_models['intent_classifier'](text, self.intent_labels)
            
            return {
                'label': result['labels'][0],
                'confidence': result['scores'][0],
                'all_scores': dict(zip(result['labels'], result['scores']))
            }
            
        except Exception as e:
            logger.error(f"Intent classification failed: {e}")
            return {
                'label': IntentType.GENERAL_INQUIRY.value,
                'confidence': 0.5,
                'all_scores': {}
            }
    
    async def _extract_entities(self, text: str) -> List[Dict[str, Any]]:
        """Extract named entities from text"""
        try:
            entities = []
            
            # Use spaCy if available
            if nlp_models['spacy_en']:
                doc = nlp_models['spacy_en'](text)
                for ent in doc.ents:
                    entities.append({
                        'text': ent.text,
                        'label': ent.label_,
                        'start': ent.start_char,
                        'end': ent.end_char,
                        'confidence': 0.8  # Default confidence for spaCy
                    })
            
            # Extract banking-specific entities
            banking_entities = await self._extract_banking_entities(text)
            entities.extend(banking_entities)
            
            return entities
            
        except Exception as e:
            logger.error(f"Entity extraction failed: {e}")
            return []
    
    async def _extract_banking_entities(self, text: str) -> List[Dict[str, Any]]:
        """Extract banking-specific entities"""
        entities = []
        
        # Account number pattern (10 digits)
        account_pattern = r'\b\d{10}\b'
        for match in re.finditer(account_pattern, text):
            entities.append({
                'text': match.group(),
                'label': EntityType.ACCOUNT_NUMBER.value,
                'start': match.start(),
                'end': match.end(),
                'confidence': 0.9
            })
        
        # Phone number pattern
        phone_pattern = r'\b(?:\+234|0)[789]\d{9}\b'
        for match in re.finditer(phone_pattern, text):
            entities.append({
                'text': match.group(),
                'label': EntityType.PHONE_NUMBER.value,
                'start': match.start(),
                'end': match.end(),
                'confidence': 0.9
            })
        
        # Money amount pattern
        money_pattern = r'\b(?:₦|NGN|naira)\s*[\d,]+(?:\.\d{2})?\b'
        for match in re.finditer(money_pattern, text, re.IGNORECASE):
            entities.append({
                'text': match.group(),
                'label': EntityType.MONEY.value,
                'start': match.start(),
                'end': match.end(),
                'confidence': 0.85
            })
        
        return entities
    
    async def _extract_keywords(self, text: str) -> List[str]:
        """Extract keywords from text"""
        try:
            # Simple keyword extraction using NLTK
            from nltk.corpus import stopwords
            from nltk.tokenize import word_tokenize
            from collections import Counter
            
            # Tokenize and remove stopwords
            tokens = word_tokenize(text.lower())
            stop_words = set(stopwords.words('english'))
            
            # Filter tokens
            keywords = [word for word in tokens if word.isalpha() and word not in stop_words and len(word) > 2]
            
            # Get most common keywords
            keyword_freq = Counter(keywords)
            top_keywords = [word for word, freq in keyword_freq.most_common(10)]
            
            return top_keywords
            
        except Exception as e:
            logger.error(f"Keyword extraction failed: {e}")
            return []
    
    async def _translate(self, text: str, source_lang: str, target_lang: str) -> Tuple[str, float]:
        """Translate text using Google Translate"""
        try:
            result = translator.translate(text, src=source_lang, dest=target_lang)
            return result.text, 0.8  # Default confidence
            
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return text, 0.0
    
    async def _generate_response(self, message: str, intent: IntentType, 
                               analysis: TextAnalysisResponse, context: Dict) -> Tuple[str, List[str], bool]:
        """Generate chatbot response"""
        try:
            # Check knowledge base first
            kb_response = await self._search_knowledge_base(message, intent)
            if kb_response:
                return kb_response, [], False
            
            # Generate response based on intent
            if intent == IntentType.BALANCE_CHECK:
                response = "To check your account balance, please visit any agent location with your ID or use our mobile app."
                actions = ["Visit agent", "Download mobile app"]
                requires_human = False
                
            elif intent == IntentType.TRANSFER_REQUEST:
                response = "To transfer money, I'll need to connect you with an agent who can help you securely."
                actions = ["Connect to agent", "Visit agent location"]
                requires_human = True
                
            elif intent == IntentType.COMPLAINT:
                response = "I understand your concern. Let me connect you with a customer service representative who can help resolve this issue."
                actions = ["Connect to human agent", "File formal complaint"]
                requires_human = True
                
            elif intent == IntentType.TECHNICAL_SUPPORT:
                response = "For technical support, I can help with basic issues or connect you with our technical team."
                actions = ["Basic troubleshooting", "Connect to technical support"]
                requires_human = False
                
            else:
                response = "Thank you for your message. How can I assist you with your banking needs today?"
                actions = ["Check balance", "Transfer money", "Find agent location"]
                requires_human = False
            
            # Use OpenAI for more sophisticated responses if available
            if nlp_models['openai_enabled'] and requires_human == False:
                try:
                    openai_response = await self._generate_openai_response(message, intent, context)
                    if openai_response:
                        response = openai_response
                except Exception as e:
                    logger.warning(f"OpenAI response generation failed: {e}")
            
            return response, actions, requires_human
            
        except Exception as e:
            logger.error(f"Response generation failed: {e}")
            return "I apologize, but I'm having trouble processing your request. Please try again or contact customer service.", [], True
    
    async def _generate_openai_response(self, message: str, intent: IntentType, context: Dict) -> Optional[str]:
        """Generate response using OpenAI"""
        try:
            prompt = f"""
            You are a helpful banking assistant for an remittance network in Nigeria.
            User message: {message}
            Detected intent: {intent.value}
            
            Provide a helpful, professional response that:
            1. Addresses the user's specific need
            2. Provides clear next steps
            3. Is culturally appropriate for Nigerian banking customers
            4. Keeps responses concise (under 100 words)
            
            Response:
            """
            
            response = openai.Completion.create(
                engine="text-davinci-003",
                prompt=prompt,
                max_tokens=150,
                temperature=0.7
            )
            
            return response.choices[0].text.strip()
            
        except Exception as e:
            logger.error(f"OpenAI response generation failed: {e}")
            return None
    
    async def _search_knowledge_base(self, message: str, intent: IntentType) -> Optional[str]:
        """Search knowledge base for relevant answers"""
        try:
            # Simple keyword matching
            message_lower = message.lower()
            
            async with db_pool.acquire() as conn:
                # Search by keywords
                kb_items = await conn.fetch("""
                    SELECT question, answer, keywords FROM knowledge_base
                    WHERE language = 'en'
                    ORDER BY usage_count DESC
                """)
                
                for item in kb_items:
                    keywords = json.loads(item['keywords'] or '[]')
                    if any(keyword.lower() in message_lower for keyword in keywords):
                        # Update usage count
                        await conn.execute("""
                            UPDATE knowledge_base 
                            SET usage_count = usage_count + 1
                            WHERE question = $1
                        """, item['question'])
                        
                        return item['answer']
            
            return None
            
        except Exception as e:
            logger.error(f"Knowledge base search failed: {e}")
            return None
    
    async def _extract_relationships(self, text: str, entities: List[Dict]) -> List[Dict[str, Any]]:
        """Extract relationships between entities"""
        relationships = []
        
        # Simple relationship extraction based on proximity and patterns
        for i, entity1 in enumerate(entities):
            for j, entity2 in enumerate(entities[i+1:], i+1):
                # Check if entities are close to each other
                distance = abs(entity1['start'] - entity2['start'])
                if distance < 50:  # Within 50 characters
                    relationships.append({
                        'entity1': entity1['text'],
                        'entity2': entity2['text'],
                        'relationship': 'proximity',
                        'confidence': 0.6
                    })
        
        return relationships
    
    # Storage methods
    async def _store_analysis(self, analysis: TextAnalysisResponse):
        """Store text analysis results"""
        try:
            analysis_id = f"analysis_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO text_analysis 
                    (analysis_id, original_text, detected_language, sentiment, intent,
                     entities, keywords, confidence_scores, processing_time)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """, 
                analysis_id, analysis.original_text, analysis.detected_language.value,
                json.dumps(analysis.sentiment), json.dumps(analysis.intent),
                json.dumps(analysis.entities), json.dumps(analysis.keywords),
                json.dumps(analysis.confidence_scores), analysis.processing_time
                )
                
        except Exception as e:
            logger.error(f"Analysis storage failed: {e}")
    
    async def _store_translation(self, translation: TranslationResponse):
        """Store translation results"""
        try:
            translation_id = f"trans_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO translations 
                    (translation_id, original_text, translated_text, source_language,
                     target_language, confidence)
                    VALUES ($1, $2, $3, $4, $5, $6)
                """, 
                translation_id, translation.original_text, translation.translated_text,
                translation.source_language.value, translation.target_language.value,
                translation.confidence
                )
                
        except Exception as e:
            logger.error(f"Translation storage failed: {e}")
    
    async def _create_conversation(self, conversation_id: str, user_id: str):
        """Create new conversation"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO conversations (conversation_id, user_id)
                VALUES ($1, $2)
                ON CONFLICT (conversation_id) DO NOTHING
            """, conversation_id, user_id)
    
    async def _store_message(self, conversation_id: str, sender_type: str, message_text: str,
                           language: Language, intent: IntentType, sentiment: Dict, entities: List):
        """Store conversation message"""
        try:
            message_id = f"msg_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO conversation_messages 
                    (message_id, conversation_id, sender_type, message_text, language,
                     intent, sentiment, entities)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, 
                message_id, conversation_id, sender_type, message_text,
                language.value, intent.value, json.dumps(sentiment), json.dumps(entities)
                )
                
        except Exception as e:
            logger.error(f"Message storage failed: {e}")
    
    async def _update_conversation(self, conversation_id: str, intent: IntentType, sentiment: Dict):
        """Update conversation metadata"""
        try:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE conversations 
                    SET message_count = message_count + 1,
                        primary_intent = COALESCE(primary_intent, $2)
                    WHERE conversation_id = $1
                """, conversation_id, intent.value)
                
        except Exception as e:
            logger.error(f"Conversation update failed: {e}")

# Initialize NLP engine
nlp_engine = NLPEngine()

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
            "service": "nlp-support",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "nlp_models": "loaded" if nlp_models else "not_loaded",
            "openai_enabled": nlp_models.get('openai_enabled', False)
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/analyze", response_model=TextAnalysisResponse)
async def analyze_text(request: TextAnalysisRequest):
    """Analyze text for sentiment, intent, entities, and keywords"""
    return await nlp_engine.analyze_text(request)

@app.post("/api/v1/translate", response_model=TranslationResponse)
async def translate_text(request: TranslationRequest):
    """Translate text between languages"""
    return await nlp_engine.translate_text(request)

@app.post("/api/v1/chat", response_model=ChatbotResponse)
async def chat_with_bot(request: ChatbotRequest):
    """Process chatbot conversation"""
    return await nlp_engine.process_chatbot_message(request)

@app.post("/api/v1/entities", response_model=EntityExtractionResult)
async def extract_entities(text: str):
    """Extract entities and relationships from text"""
    return await nlp_engine.extract_entities(text)

@app.get("/api/v1/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get conversation details"""
    try:
        async with db_pool.acquire() as conn:
            # Get conversation
            conversation = await conn.fetchrow("""
                SELECT * FROM conversations WHERE conversation_id = $1
            """, conversation_id)
            
            if not conversation:
                raise HTTPException(status_code=404, detail="Conversation not found")
            
            # Get messages
            messages = await conn.fetch("""
                SELECT * FROM conversation_messages 
                WHERE conversation_id = $1 
                ORDER BY timestamp ASC
            """, conversation_id)
            
            return {
                "conversation_id": conversation['conversation_id'],
                "user_id": conversation['user_id'],
                "start_time": conversation['start_time'].isoformat(),
                "message_count": conversation['message_count'],
                "primary_intent": conversation['primary_intent'],
                "resolution_status": conversation['resolution_status'],
                "messages": [
                    {
                        "message_id": msg['message_id'],
                        "sender_type": msg['sender_type'],
                        "message_text": msg['message_text'],
                        "language": msg['language'],
                        "intent": msg['intent'],
                        "timestamp": msg['timestamp'].isoformat()
                    }
                    for msg in messages
                ]
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get conversation: {str(e)}")

@app.get("/api/v1/languages")
async def get_supported_languages():
    """Get list of supported languages"""
    return {
        "languages": [
            {"code": lang.value, "name": lang.name.title()}
            for lang in Language
        ]
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

