#!/usr/bin/env python3
"""
Natural Language Processing Service for Customer Support
Provides intelligent chatbot, sentiment analysis, and automated support capabilities
"""

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Union
import logging
from datetime import datetime, timedelta
import json
import re
import numpy as np
import pandas as pd
from dataclasses import dataclass, asdict
import asyncio
import threading
import time
import uuid
from enum import Enum

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.append(str(project_root))

try:
    # Flask and web framework
    from flask import Flask, request, jsonify, g
    from flask_cors import CORS
    
    # NLP libraries
    import nltk
    from nltk.tokenize import word_tokenize, sent_tokenize
    from nltk.corpus import stopwords
    from nltk.stem import WordNetLemmatizer
    from nltk.sentiment import SentimentIntensityAnalyzer
    
    # Advanced NLP
    import spacy
    from transformers import (
        AutoTokenizer, AutoModelForSequenceClassification,
        AutoModelForQuestionAnswering, pipeline,
        BertTokenizer, BertForSequenceClassification
    )
    
    # Machine Learning
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.naive_bayes import MultinomialNB
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import classification_report, accuracy_score
    from sklearn.pipeline import Pipeline
    
    # Deep Learning
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    
    # Text processing
    import textblob
    from textstat import flesch_reading_ease, flesch_kincaid_grade
    
    # Data processing
    import redis
    import psycopg2
    from psycopg2.extras import RealDictCursor
    
    # Monitoring
    import mlflow
    import mlflow.sklearn
    import mlflow.pytorch
    
    # Language detection
    from langdetect import detect, DetectorFactory
    DetectorFactory.seed = 0
    
except ImportError as e:
    logger.info(f"Required packages not installed: {e}")
    logger.info("Please install: pip install nltk spacy transformers torch scikit-learn textblob textstat langdetect mlflow redis psycopg2-binary")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Download required NLTK data
try:
    nltk.download('punkt', quiet=True)
    nltk.download('stopwords', quiet=True)
    nltk.download('wordnet', quiet=True)
    nltk.download('vader_lexicon', quiet=True)
except:
    pass

class SentimentLabel(Enum):
    """Sentiment classification labels"""
    VERY_POSITIVE = "very_positive"
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    VERY_NEGATIVE = "very_negative"

class IntentLabel(Enum):
    """Customer intent classification labels"""
    ACCOUNT_INQUIRY = "account_inquiry"
    TRANSACTION_ISSUE = "transaction_issue"
    TECHNICAL_SUPPORT = "technical_support"
    COMPLAINT = "complaint"
    PRODUCT_INQUIRY = "product_inquiry"
    LOAN_APPLICATION = "loan_application"
    CARD_SERVICES = "card_services"
    GENERAL_INQUIRY = "general_inquiry"

class UrgencyLevel(Enum):
    """Support ticket urgency levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

@dataclass
class ChatMessage:
    """Chat message data structure"""
    message_id: str
    customer_id: str
    message: str
    timestamp: datetime
    language: str
    sentiment: SentimentLabel
    intent: IntentLabel
    confidence: float
    entities: Dict[str, Any]
    response: str
    response_time_ms: int

@dataclass
class SentimentAnalysis:
    """Sentiment analysis result"""
    text: str
    sentiment: SentimentLabel
    confidence: float
    scores: Dict[str, float]
    emotions: Dict[str, float]
    language: str

@dataclass
class IntentClassification:
    """Intent classification result"""
    text: str
    intent: IntentLabel
    confidence: float
    entities: Dict[str, Any]
    suggested_actions: List[str]

@dataclass
class SupportTicket:
    """Support ticket data structure"""
    ticket_id: str
    customer_id: str
    subject: str
    description: str
    category: str
    urgency: UrgencyLevel
    sentiment: SentimentLabel
    language: str
    assigned_agent: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime
    resolution_time_hours: Optional[float]

class CustomerSupportChatbot:
    """Intelligent chatbot for customer support"""
    
    def __init__(self):
        # Load pre-trained models
        self.sentiment_analyzer = SentimentIntensityAnalyzer()
        self.lemmatizer = WordNetLemmatizer()
        
        # Load spaCy model for NER
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except OSError:
            logger.warning("spaCy English model not found. Install with: python -m spacy download en_core_web_sm")
            self.nlp = None
        
        # Initialize transformers models
        self._load_transformer_models()
        
        # Knowledge base
        self.knowledge_base = self._load_knowledge_base()
        
        # Response templates
        self.response_templates = self._load_response_templates()
    
    def _load_transformer_models(self):
        """Load transformer models for advanced NLP"""
        try:
            # Sentiment analysis model
            self.sentiment_model = pipeline(
                "sentiment-analysis",
                model="cardiffnlp/twitter-roberta-base-sentiment-latest",
                return_all_scores=True
            )
            
            # Question answering model
            self.qa_model = pipeline(
                "question-answering",
                model="distilbert-base-cased-distilled-squad"
            )
            
            # Intent classification model (using a general classification model)
            self.intent_tokenizer = AutoTokenizer.from_pretrained("microsoft/DialoGPT-medium")
            
            logger.info("Transformer models loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load transformer models: {e}")
            self.sentiment_model = None
            self.qa_model = None
            self.intent_tokenizer = None
    
    def _load_knowledge_base(self) -> Dict[str, str]:
        """Load knowledge base for FAQ responses"""
        return {
            "account_balance": "To check your account balance, you can use our mobile app, visit any agent location, or call our customer service line.",
            "transaction_limit": "Daily transaction limits vary by account type. Standard accounts have a limit of $5,000 per day.",
            "lost_card": "If you've lost your card, please contact us immediately to block it. We can issue a replacement card within 3-5 business days.",
            "mobile_banking": "Our mobile banking app is available for iOS and Android. You can download it from your device's app store.",
            "agent_locations": "You can find nearby agent locations using our mobile app or website's agent locator feature.",
            "fees": "We offer competitive fees with no hidden charges. Please check our fee schedule on our website or mobile app.",
            "loan_application": "You can apply for a loan through our mobile app, website, or by visiting any agent location.",
            "customer_service": "Our customer service is available 24/7. You can reach us through this chat, phone, or email.",
            "technical_issue": "For technical issues, please try restarting the app. If the problem persists, our technical team will assist you.",
            "complaint": "We take all complaints seriously. Your feedback will be forwarded to our customer care team for immediate attention."
        }
    
    def _load_response_templates(self) -> Dict[str, List[str]]:
        """Load response templates for different intents"""
        return {
            "greeting": [
                "Hello! Welcome to Remittance Platform. How can I assist you today?",
                "Hi there! I'm here to help you with your banking needs. What can I do for you?",
                "Good day! Thank you for contacting Remittance Platform. How may I help you?"
            ],
            "account_inquiry": [
                "I'd be happy to help you with your account inquiry. {}",
                "Let me assist you with your account question. {}",
                "I can help you with that account information. {}"
            ],
            "transaction_issue": [
                "I understand you're having a transaction issue. Let me help you resolve this. {}",
                "I'm here to help with your transaction concern. {}",
                "Let me assist you with this transaction matter. {}"
            ],
            "technical_support": [
                "I can help you with technical issues. {}",
                "Let me guide you through resolving this technical problem. {}",
                "I'm here to provide technical assistance. {}"
            ],
            "complaint": [
                "I sincerely apologize for any inconvenience. Your complaint is important to us. {}",
                "Thank you for bringing this to our attention. I'll ensure your concern is addressed. {}",
                "I understand your frustration. Let me help resolve this issue for you. {}"
            ],
            "fallback": [
                "I'm not sure I understand. Could you please rephrase your question?",
                "I'd like to help, but I need more information. Can you provide more details?",
                "Let me connect you with a human agent who can better assist you with this inquiry."
            ]
        }
    
    def process_message(self, customer_id: str, message: str) -> ChatMessage:
        """Process incoming customer message"""
        try:
            message_id = str(uuid.uuid4())
            start_time = time.time()
            
            # Detect language
            language = self._detect_language(message)
            
            # Analyze sentiment
            sentiment = self._analyze_sentiment(message)
            
            # Classify intent
            intent_result = self._classify_intent(message)
            
            # Extract entities
            entities = self._extract_entities(message)
            
            # Generate response
            response = self._generate_response(message, intent_result.intent, entities)
            
            end_time = time.time()
            response_time_ms = int((end_time - start_time) * 1000)
            
            return ChatMessage(
                message_id=message_id,
                customer_id=customer_id,
                message=message,
                timestamp=datetime.now(),
                language=language,
                sentiment=sentiment.sentiment,
                intent=intent_result.intent,
                confidence=intent_result.confidence,
                entities=entities,
                response=response,
                response_time_ms=response_time_ms
            )
            
        except Exception as e:
            logger.error(f"Failed to process message: {e}")
            return self._default_chat_message(customer_id, message)
    
    def _detect_language(self, text: str) -> str:
        """Detect language of the text"""
        try:
            return detect(text)
        except:
            return "en"  # Default to English
    
    def _analyze_sentiment(self, text: str) -> SentimentAnalysis:
        """Analyze sentiment of the text"""
        try:
            # NLTK VADER sentiment
            vader_scores = self.sentiment_analyzer.polarity_scores(text)
            
            # Transformer-based sentiment (if available)
            transformer_scores = {}
            if self.sentiment_model:
                try:
                    results = self.sentiment_model(text)
                    for result in results[0]:
                        transformer_scores[result['label'].lower()] = result['score']
                except:
                    pass
            
            # Combine scores
            compound_score = vader_scores['compound']
            
            # Determine sentiment label
            if compound_score >= 0.5:
                sentiment = SentimentLabel.VERY_POSITIVE
            elif compound_score >= 0.1:
                sentiment = SentimentLabel.POSITIVE
            elif compound_score > -0.1:
                sentiment = SentimentLabel.NEUTRAL
            elif compound_score > -0.5:
                sentiment = SentimentLabel.NEGATIVE
            else:
                sentiment = SentimentLabel.VERY_NEGATIVE
            
            confidence = abs(compound_score)
            
            return SentimentAnalysis(
                text=text,
                sentiment=sentiment,
                confidence=confidence,
                scores=vader_scores,
                emotions=transformer_scores,
                language=self._detect_language(text)
            )
            
        except Exception as e:
            logger.error(f"Failed to analyze sentiment: {e}")
            return SentimentAnalysis(
                text=text,
                sentiment=SentimentLabel.NEUTRAL,
                confidence=0.5,
                scores={},
                emotions={},
                language="en"
            )
    
    def _classify_intent(self, text: str) -> IntentClassification:
        """Classify customer intent"""
        try:
            text_lower = text.lower()
            
            # Rule-based intent classification
            intent_keywords = {
                IntentLabel.ACCOUNT_INQUIRY: ['balance', 'account', 'statement', 'history', 'check'],
                IntentLabel.TRANSACTION_ISSUE: ['transaction', 'transfer', 'payment', 'failed', 'error', 'pending'],
                IntentLabel.TECHNICAL_SUPPORT: ['app', 'login', 'password', 'technical', 'bug', 'error', 'not working'],
                IntentLabel.COMPLAINT: ['complaint', 'problem', 'issue', 'angry', 'frustrated', 'terrible', 'bad'],
                IntentLabel.PRODUCT_INQUIRY: ['product', 'service', 'offer', 'new', 'features', 'information'],
                IntentLabel.LOAN_APPLICATION: ['loan', 'credit', 'borrow', 'apply', 'application', 'financing'],
                IntentLabel.CARD_SERVICES: ['card', 'debit', 'credit', 'lost', 'stolen', 'block', 'activate'],
                IntentLabel.GENERAL_INQUIRY: ['help', 'question', 'how', 'what', 'when', 'where', 'why']
            }
            
            # Calculate intent scores
            intent_scores = {}
            for intent, keywords in intent_keywords.items():
                score = sum(1 for keyword in keywords if keyword in text_lower)
                if score > 0:
                    intent_scores[intent] = score / len(keywords)
            
            # Determine best intent
            if intent_scores:
                best_intent = max(intent_scores.keys(), key=lambda k: intent_scores[k])
                confidence = intent_scores[best_intent]
            else:
                best_intent = IntentLabel.GENERAL_INQUIRY
                confidence = 0.5
            
            # Generate suggested actions
            suggested_actions = self._get_suggested_actions(best_intent)
            
            return IntentClassification(
                text=text,
                intent=best_intent,
                confidence=confidence,
                entities={},
                suggested_actions=suggested_actions
            )
            
        except Exception as e:
            logger.error(f"Failed to classify intent: {e}")
            return IntentClassification(
                text=text,
                intent=IntentLabel.GENERAL_INQUIRY,
                confidence=0.5,
                entities={},
                suggested_actions=[]
            )
    
    def _extract_entities(self, text: str) -> Dict[str, Any]:
        """Extract named entities from text"""
        try:
            entities = {}
            
            if self.nlp:
                doc = self.nlp(text)
                
                for ent in doc.ents:
                    entity_type = ent.label_
                    entity_text = ent.text
                    
                    if entity_type not in entities:
                        entities[entity_type] = []
                    entities[entity_type].append(entity_text)
            
            # Extract specific banking entities using regex
            
            # Account numbers (simplified pattern)
            account_pattern = r'\b\d{8,12}\b'
            accounts = re.findall(account_pattern, text)
            if accounts:
                entities['ACCOUNT_NUMBER'] = accounts
            
            # Transaction IDs
            transaction_pattern = r'\b[A-Z]{2,3}\d{6,10}\b'
            transactions = re.findall(transaction_pattern, text)
            if transactions:
                entities['TRANSACTION_ID'] = transactions
            
            # Amounts
            amount_pattern = r'\$?\d+(?:,\d{3})*(?:\.\d{2})?'
            amounts = re.findall(amount_pattern, text)
            if amounts:
                entities['AMOUNT'] = amounts
            
            return entities
            
        except Exception as e:
            logger.error(f"Failed to extract entities: {e}")
            return {}
    
    def _generate_response(self, message: str, intent: IntentLabel, entities: Dict[str, Any]) -> str:
        """Generate appropriate response based on intent and entities"""
        try:
            # Check knowledge base first
            message_lower = message.lower()
            for key, response in self.knowledge_base.items():
                if key in message_lower:
                    return response
            
            # Use question answering model if available
            if self.qa_model and intent in [IntentLabel.ACCOUNT_INQUIRY, IntentLabel.PRODUCT_INQUIRY]:
                try:
                    context = " ".join(self.knowledge_base.values())
                    result = self.qa_model(question=message, context=context)
                    if result['score'] > 0.5:
                        return result['answer']
                except:
                    pass
            
            # Use template-based responses
            intent_key = intent.value
            if intent_key in self.response_templates:
                templates = self.response_templates[intent_key]
                template = np.random.choice(templates)
                
                # Fill template with entity information
                entity_info = self._format_entities(entities)
                return template.format(entity_info)
            
            # Fallback response
            return np.random.choice(self.response_templates["fallback"])
            
        except Exception as e:
            logger.error(f"Failed to generate response: {e}")
            return "I apologize, but I'm having trouble processing your request. Please try again or contact our support team."
    
    def _format_entities(self, entities: Dict[str, Any]) -> str:
        """Format extracted entities for response"""
        if not entities:
            return ""
        
        formatted_parts = []
        
        if 'ACCOUNT_NUMBER' in entities:
            formatted_parts.append(f"regarding account {entities['ACCOUNT_NUMBER'][0]}")
        
        if 'TRANSACTION_ID' in entities:
            formatted_parts.append(f"for transaction {entities['TRANSACTION_ID'][0]}")
        
        if 'AMOUNT' in entities:
            formatted_parts.append(f"involving amount {entities['AMOUNT'][0]}")
        
        return " ".join(formatted_parts)
    
    def _get_suggested_actions(self, intent: IntentLabel) -> List[str]:
        """Get suggested actions for intent"""
        actions = {
            IntentLabel.ACCOUNT_INQUIRY: [
                "Check account balance",
                "View transaction history",
                "Download statement"
            ],
            IntentLabel.TRANSACTION_ISSUE: [
                "Check transaction status",
                "Contact support",
                "File dispute"
            ],
            IntentLabel.TECHNICAL_SUPPORT: [
                "Restart application",
                "Clear cache",
                "Contact technical support"
            ],
            IntentLabel.COMPLAINT: [
                "File formal complaint",
                "Escalate to supervisor",
                "Request callback"
            ],
            IntentLabel.LOAN_APPLICATION: [
                "Start loan application",
                "Check eligibility",
                "Schedule appointment"
            ]
        }
        
        return actions.get(intent, ["Contact customer support"])
    
    def _default_chat_message(self, customer_id: str, message: str) -> ChatMessage:
        """Return default chat message in case of errors"""
        return ChatMessage(
            message_id=str(uuid.uuid4()),
            customer_id=customer_id,
            message=message,
            timestamp=datetime.now(),
            language="en",
            sentiment=SentimentLabel.NEUTRAL,
            intent=IntentLabel.GENERAL_INQUIRY,
            confidence=0.5,
            entities={},
            response="I apologize, but I'm having trouble processing your request. Please contact our support team.",
            response_time_ms=1000
        )

class NLPSupportService:
    """Natural Language Processing service for customer support"""
    
    def __init__(self, 
                 redis_host: str = "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")", 
                 redis_port: int = 6379,
                 postgres_config: Dict[str, str] = None):
        
        self.redis_client = redis.Redis(host=redis_host, port=redis_port, decode_responses=True)
        self.postgres_config = postgres_config or {
            'host': 'os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")")',
            'port': '5432',
            'database': 'remittance',
            'user': 'postgres',
            'password': 'password'
        }
        
        # Initialize chatbot
        self.chatbot = CustomerSupportChatbot()
        
        # ML models for classification
        self.intent_classifier = None
        self.sentiment_classifier = None
        self.urgency_classifier = None
        
        # Text processing
        self.vectorizer = TfidfVectorizer(max_features=5000, stop_words='english')
        
        # Initialize MLflow
        mlflow.set_tracking_uri("http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")")"):5000")
        mlflow.set_experiment("nlp_support")
        
        self._initialize_models()
    
    def _initialize_models(self):
        """Initialize NLP models"""
        try:
            # Intent classification model
            self.intent_classifier = Pipeline([
                ('tfidf', TfidfVectorizer(max_features=5000, stop_words='english')),
                ('classifier', MultinomialNB())
            ])
            
            # Sentiment classification model
            self.sentiment_classifier = Pipeline([
                ('tfidf', TfidfVectorizer(max_features=3000, stop_words='english')),
                ('classifier', LogisticRegression())
            ])
            
            # Urgency classification model
            self.urgency_classifier = Pipeline([
                ('tfidf', TfidfVectorizer(max_features=2000, stop_words='english')),
                ('classifier', RandomForestClassifier(n_estimators=100))
            ])
            
            logger.info("NLP models initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize NLP models: {e}")
            raise
    
    def process_chat_message(self, customer_id: str, message: str) -> ChatMessage:
        """Process chat message through chatbot"""
        try:
            chat_message = self.chatbot.process_message(customer_id, message)
            
            # Store chat message
            self._store_chat_message(chat_message)
            
            return chat_message
            
        except Exception as e:
            logger.error(f"Failed to process chat message: {e}")
            raise
    
    def analyze_text_sentiment(self, text: str) -> SentimentAnalysis:
        """Analyze sentiment of text"""
        try:
            return self.chatbot._analyze_sentiment(text)
            
        except Exception as e:
            logger.error(f"Failed to analyze sentiment: {e}")
            raise
    
    def classify_support_ticket(self, ticket_text: str) -> Dict[str, Any]:
        """Classify support ticket for routing and prioritization"""
        try:
            # Analyze sentiment
            sentiment_analysis = self.analyze_text_sentiment(ticket_text)
            
            # Classify intent
            intent_result = self.chatbot._classify_intent(ticket_text)
            
            # Determine urgency
            urgency = self._determine_urgency(ticket_text, sentiment_analysis)
            
            # Extract entities
            entities = self.chatbot._extract_entities(ticket_text)
            
            # Generate routing recommendations
            routing_recommendations = self._get_routing_recommendations(intent_result.intent, urgency)
            
            return {
                'sentiment': asdict(sentiment_analysis),
                'intent': asdict(intent_result),
                'urgency': urgency.value,
                'entities': entities,
                'routing_recommendations': routing_recommendations,
                'auto_response_suggested': self._should_auto_respond(intent_result.intent, urgency)
            }
            
        except Exception as e:
            logger.error(f"Failed to classify support ticket: {e}")
            raise
    
    def _determine_urgency(self, text: str, sentiment: SentimentAnalysis) -> UrgencyLevel:
        """Determine urgency level of support ticket"""
        try:
            text_lower = text.lower()
            
            # Critical keywords
            critical_keywords = ['fraud', 'stolen', 'hacked', 'emergency', 'urgent', 'immediately', 'asap']
            high_keywords = ['problem', 'issue', 'error', 'failed', 'not working', 'broken']
            
            # Check for critical keywords
            if any(keyword in text_lower for keyword in critical_keywords):
                return UrgencyLevel.CRITICAL
            
            # Check sentiment
            if sentiment.sentiment in [SentimentLabel.VERY_NEGATIVE, SentimentLabel.NEGATIVE]:
                if any(keyword in text_lower for keyword in high_keywords):
                    return UrgencyLevel.HIGH
                else:
                    return UrgencyLevel.MEDIUM
            
            # Check for high priority keywords
            if any(keyword in text_lower for keyword in high_keywords):
                return UrgencyLevel.MEDIUM
            
            return UrgencyLevel.LOW
            
        except Exception as e:
            logger.error(f"Failed to determine urgency: {e}")
            return UrgencyLevel.MEDIUM
    
    def _get_routing_recommendations(self, intent: IntentLabel, urgency: UrgencyLevel) -> List[str]:
        """Get routing recommendations for support ticket"""
        recommendations = []
        
        # Route based on intent
        if intent == IntentLabel.TECHNICAL_SUPPORT:
            recommendations.append("Route to Technical Support Team")
        elif intent == IntentLabel.LOAN_APPLICATION:
            recommendations.append("Route to Loan Processing Team")
        elif intent == IntentLabel.COMPLAINT:
            recommendations.append("Route to Customer Relations Team")
        elif intent == IntentLabel.CARD_SERVICES:
            recommendations.append("Route to Card Services Team")
        else:
            recommendations.append("Route to General Support Team")
        
        # Route based on urgency
        if urgency == UrgencyLevel.CRITICAL:
            recommendations.append("Escalate to Senior Agent Immediately")
            recommendations.append("Send SMS/Email Alert to Customer")
        elif urgency == UrgencyLevel.HIGH:
            recommendations.append("Assign to Experienced Agent")
            recommendations.append("Set 2-hour Response SLA")
        
        return recommendations
    
    def _should_auto_respond(self, intent: IntentLabel, urgency: UrgencyLevel) -> bool:
        """Determine if ticket should receive auto-response"""
        # Auto-respond to low urgency, common inquiries
        auto_respond_intents = [
            IntentLabel.ACCOUNT_INQUIRY,
            IntentLabel.PRODUCT_INQUIRY,
            IntentLabel.GENERAL_INQUIRY
        ]
        
        return intent in auto_respond_intents and urgency in [UrgencyLevel.LOW, UrgencyLevel.MEDIUM]
    
    def generate_auto_response(self, ticket_text: str, classification: Dict[str, Any]) -> str:
        """Generate automatic response for support ticket"""
        try:
            intent = IntentLabel(classification['intent']['intent'])
            
            # Use chatbot to generate response
            response = self.chatbot._generate_response(
                ticket_text, 
                intent, 
                classification['entities']
            )
            
            # Add professional closing
            response += "\n\nIf you need further assistance, please don't hesitate to contact us. We're here to help!"
            
            return response
            
        except Exception as e:
            logger.error(f"Failed to generate auto response: {e}")
            return "Thank you for contacting us. We have received your inquiry and will respond shortly."
    
    def create_support_ticket(self, customer_id: str, subject: str, description: str) -> SupportTicket:
        """Create and classify support ticket"""
        try:
            ticket_id = f"TKT-{int(time.time())}-{customer_id[:4]}"
            
            # Classify ticket
            classification = self.classify_support_ticket(description)
            
            # Create ticket
            ticket = SupportTicket(
                ticket_id=ticket_id,
                customer_id=customer_id,
                subject=subject,
                description=description,
                category=classification['intent']['intent'],
                urgency=UrgencyLevel(classification['urgency']),
                sentiment=SentimentLabel(classification['sentiment']['sentiment']),
                language=classification['sentiment']['language'],
                assigned_agent=None,
                status="open",
                created_at=datetime.now(),
                updated_at=datetime.now(),
                resolution_time_hours=None
            )
            
            # Store ticket
            self._store_support_ticket(ticket)
            
            return ticket
            
        except Exception as e:
            logger.error(f"Failed to create support ticket: {e}")
            raise
    
    def _store_chat_message(self, chat_message: ChatMessage):
        """Store chat message in database"""
        try:
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO chat_messages 
                        (message_id, customer_id, message, timestamp, language, 
                         sentiment, intent, confidence, entities, response, response_time_ms)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        chat_message.message_id,
                        chat_message.customer_id,
                        chat_message.message,
                        chat_message.timestamp,
                        chat_message.language,
                        chat_message.sentiment.value,
                        chat_message.intent.value,
                        chat_message.confidence,
                        json.dumps(chat_message.entities),
                        chat_message.response,
                        chat_message.response_time_ms
                    ))
                    conn.commit()
            
        except Exception as e:
            logger.error(f"Failed to store chat message: {e}")
    
    def _store_support_ticket(self, ticket: SupportTicket):
        """Store support ticket in database"""
        try:
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO support_tickets 
                        (ticket_id, customer_id, subject, description, category, 
                         urgency, sentiment, language, status, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        ticket.ticket_id,
                        ticket.customer_id,
                        ticket.subject,
                        ticket.description,
                        ticket.category,
                        ticket.urgency.value,
                        ticket.sentiment.value,
                        ticket.language,
                        ticket.status,
                        ticket.created_at,
                        ticket.updated_at
                    ))
                    conn.commit()
            
        except Exception as e:
            logger.error(f"Failed to store support ticket: {e}")
    
    def get_chat_analytics(self, customer_id: Optional[str] = None, 
                          days: int = 30) -> Dict[str, Any]:
        """Get chat analytics and insights"""
        try:
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Base query
                    where_clause = "WHERE timestamp >= %s"
                    params = [datetime.now() - timedelta(days=days)]
                    
                    if customer_id:
                        where_clause += " AND customer_id = %s"
                        params.append(customer_id)
                    
                    # Get chat statistics
                    cursor.execute(f"""
                        SELECT 
                            COUNT(*) as total_messages,
                            AVG(response_time_ms) as avg_response_time,
                            COUNT(DISTINCT customer_id) as unique_customers,
                            sentiment,
                            intent,
                            language
                        FROM chat_messages 
                        {where_clause}
                        GROUP BY sentiment, intent, language
                    """, params)
                    
                    results = cursor.fetchall()
                    
                    # Process results
                    analytics = {
                        'total_messages': sum(r['total_messages'] for r in results),
                        'avg_response_time_ms': np.mean([r['avg_response_time'] for r in results if r['avg_response_time']]),
                        'unique_customers': len(set(r['unique_customers'] for r in results)),
                        'sentiment_distribution': {},
                        'intent_distribution': {},
                        'language_distribution': {}
                    }
                    
                    # Calculate distributions
                    for result in results:
                        sentiment = result['sentiment']
                        intent = result['intent']
                        language = result['language']
                        count = result['total_messages']
                        
                        analytics['sentiment_distribution'][sentiment] = analytics['sentiment_distribution'].get(sentiment, 0) + count
                        analytics['intent_distribution'][intent] = analytics['intent_distribution'].get(intent, 0) + count
                        analytics['language_distribution'][language] = analytics['language_distribution'].get(language, 0) + count
                    
                    return analytics
            
        except Exception as e:
            logger.error(f"Failed to get chat analytics: {e}")
            return {}
    
    def train_models(self, training_data: pd.DataFrame):
        """Train NLP models with historical data"""
        try:
            with mlflow.start_run():
                # Train intent classifier
                if 'text' in training_data.columns and 'intent' in training_data.columns:
                    X_intent = training_data['text']
                    y_intent = training_data['intent']
                    
                    X_train, X_test, y_train, y_test = train_test_split(
                        X_intent, y_intent, test_size=0.2, random_state=42
                    )
                    
                    self.intent_classifier.fit(X_train, y_train)
                    intent_accuracy = self.intent_classifier.score(X_test, y_test)
                    
                    mlflow.log_metric("intent_accuracy", intent_accuracy)
                
                # Train sentiment classifier
                if 'text' in training_data.columns and 'sentiment' in training_data.columns:
                    X_sentiment = training_data['text']
                    y_sentiment = training_data['sentiment']
                    
                    X_train, X_test, y_train, y_test = train_test_split(
                        X_sentiment, y_sentiment, test_size=0.2, random_state=42
                    )
                    
                    self.sentiment_classifier.fit(X_train, y_train)
                    sentiment_accuracy = self.sentiment_classifier.score(X_test, y_test)
                    
                    mlflow.log_metric("sentiment_accuracy", sentiment_accuracy)
                
                # Save models
                mlflow.sklearn.log_model(self.intent_classifier, "intent_classifier")
                mlflow.sklearn.log_model(self.sentiment_classifier, "sentiment_classifier")
                
                logger.info("NLP models trained successfully")
                
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise

# Flask API
app = Flask(__name__)
CORS(app)

# Initialize NLP support service
nlp_service = NLPSupportService()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'nlp_support',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/chat', methods=['POST'])
def chat():
    """Process chat message"""
    try:
        data = request.get_json()
        customer_id = data['customer_id']
        message = data['message']
        
        chat_message = nlp_service.process_chat_message(customer_id, message)
        
        return jsonify(asdict(chat_message))
        
    except Exception as e:
        logger.error(f"Chat processing failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/sentiment', methods=['POST'])
def analyze_sentiment():
    """Analyze text sentiment"""
    try:
        data = request.get_json()
        text = data['text']
        
        sentiment_analysis = nlp_service.analyze_text_sentiment(text)
        
        return jsonify(asdict(sentiment_analysis))
        
    except Exception as e:
        logger.error(f"Sentiment analysis failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/ticket/create', methods=['POST'])
def create_ticket():
    """Create support ticket"""
    try:
        data = request.get_json()
        customer_id = data['customer_id']
        subject = data['subject']
        description = data['description']
        
        ticket = nlp_service.create_support_ticket(customer_id, subject, description)
        
        return jsonify(asdict(ticket))
        
    except Exception as e:
        logger.error(f"Ticket creation failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/ticket/classify', methods=['POST'])
def classify_ticket():
    """Classify support ticket"""
    try:
        data = request.get_json()
        ticket_text = data['text']
        
        classification = nlp_service.classify_support_ticket(ticket_text)
        
        return jsonify(classification)
        
    except Exception as e:
        logger.error(f"Ticket classification failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/auto-response', methods=['POST'])
def generate_auto_response():
    """Generate automatic response"""
    try:
        data = request.get_json()
        ticket_text = data['text']
        
        classification = nlp_service.classify_support_ticket(ticket_text)
        response = nlp_service.generate_auto_response(ticket_text, classification)
        
        return jsonify({
            'response': response,
            'classification': classification
        })
        
    except Exception as e:
        logger.error(f"Auto response generation failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/analytics/chat', methods=['GET'])
def get_chat_analytics():
    """Get chat analytics"""
    try:
        customer_id = request.args.get('customer_id')
        days = int(request.args.get('days', 30))
        
        analytics = nlp_service.get_chat_analytics(customer_id, days)
        
        return jsonify(analytics)
        
    except Exception as e:
        logger.error(f"Chat analytics failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/train', methods=['POST'])
def train_models():
    """Train NLP models"""
    try:
        # Create sample training data
        n_samples = 5000
        
        # Sample texts and labels
        sample_texts = [
            "What is my account balance?",
            "I can't log into the app",
            "My transaction failed",
            "I want to apply for a loan",
            "This service is terrible",
            "How do I transfer money?",
            "My card was stolen",
            "What are your fees?",
            "I need help with mobile banking",
            "I want to file a complaint"
        ]
        
        sample_intents = [
            "account_inquiry", "technical_support", "transaction_issue",
            "loan_application", "complaint", "account_inquiry",
            "card_services", "product_inquiry", "technical_support", "complaint"
        ]
        
        sample_sentiments = [
            "neutral", "negative", "negative", "positive", "very_negative",
            "neutral", "negative", "neutral", "neutral", "negative"
        ]
        
        # Generate training data
        training_data = pd.DataFrame({
            'text': np.random.choice(sample_texts, n_samples),
            'intent': np.random.choice(sample_intents, n_samples),
            'sentiment': np.random.choice(sample_sentiments, n_samples)
        })
        
        # Train models
        nlp_service.train_models(training_data)
        
        return jsonify({'status': 'training_completed'})
        
    except Exception as e:
        logger.error(f"Model training failed: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5004, debug = False)

