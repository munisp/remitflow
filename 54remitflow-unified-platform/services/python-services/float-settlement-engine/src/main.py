#!/usr/bin/env python3
"""
Float Settlement Engine
Automated settlement processing and reconciliation for agent float facilities
"""

import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
import json
from decimal import Decimal
from enum import Enum

import uvicorn
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
import redis
from celery import Celery
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from starlette.responses import Response
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Metrics
settlements_processed = Counter('settlements_processed_total', 'Total settlements processed')
settlements_failed = Counter('settlements_failed_total', 'Total settlements failed')
settlement_duration = Histogram('settlement_duration_seconds', 'Settlement processing duration')
outstanding_settlements = Gauge('outstanding_settlements_count', 'Number of outstanding settlements')
total_outstanding_amount = Gauge('total_outstanding_amount', 'Total outstanding settlement amount')

# FastAPI app
app = FastAPI(
    title="Float Settlement Engine",
    description="Automated settlement processing and reconciliation",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Celery for background tasks
celery_app = Celery(
    'settlement_engine',
    broker=os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0'),
    backend=os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')
)

# ==========================================
# ENUMS AND MODELS
# ==========================================

class SettlementStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"
    CANCELLED = "cancelled"

class SettlementType(str, Enum):
    REGULAR = "regular"
    EMERGENCY = "emergency"
    MANUAL = "manual"
    AUTOMATED = "automated"

class PaymentMethod(str, Enum):
    AUTO_DEDUCTION = "auto_deduction"
    BANK_TRANSFER = "bank_transfer"
    MOBILE_MONEY = "mobile_money"
    CASH_DEPOSIT = "cash_deposit"

class SettlementRequest(BaseModel):
    agent_id: str = Field(..., description="Agent UUID")
    settlement_type: SettlementType = Field(default=SettlementType.REGULAR)
    payment_method: PaymentMethod = Field(default=PaymentMethod.AUTO_DEDUCTION)
    amount: Optional[float] = Field(None, description="Specific amount to settle")
    force_settlement: bool = Field(default=False, description="Force settlement even if conditions not met")
    notes: Optional[str] = Field(None, description="Settlement notes")

class SettlementResponse(BaseModel):
    settlement_id: str
    agent_id: str
    status: SettlementStatus
    outstanding_amount: float
    settlement_amount: float
    interest_charged: float
    fees_charged: float
    penalty_charged: float
    total_amount_due: float
    payment_method: PaymentMethod
    scheduled_date: datetime
    due_date: datetime
    created_at: datetime
    message: str

class BulkSettlementRequest(BaseModel):
    agent_ids: List[str] = Field(..., description="List of agent UUIDs")
    settlement_type: SettlementType = Field(default=SettlementType.AUTOMATED)
    payment_method: PaymentMethod = Field(default=PaymentMethod.AUTO_DEDUCTION)
    dry_run: bool = Field(default=False, description="Perform dry run without actual processing")

# ==========================================
# SETTLEMENT ENGINE
# ==========================================

class SettlementEngine:
    def __init__(self):
        self.db_engine = None
        self.redis_client = None
        self.settlement_rules = {}
        self.notification_service = None
        
    async def initialize(self):
        """Initialize database connections and settlement rules"""
        await self._init_database()
        await self._init_redis()
        await self._load_settlement_rules()
        await self._init_notification_service()
        logger.info("Settlement Engine initialized successfully")
    
    async def _init_database(self):
        """Initialize database connection"""
        db_url = (
            f"postgresql://{os.getenv('DB_USER', 'postgres')}:"
            f"{os.getenv('DB_PASSWORD', 'password')}@"
            f"{os.getenv('DB_HOST', 'localhost')}:"
            f"{os.getenv('DB_PORT', '5432')}/"
            f"{os.getenv('DB_NAME', 'remittance')}"
        )
        self.db_engine = create_engine(db_url)
        logger.info("Database connection initialized")
    
    async def _init_redis(self):
        """Initialize Redis connection"""
        self.redis_client = redis.Redis(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', '6379')),
            password=os.getenv('REDIS_PASSWORD', ''),
            decode_responses=True
        )
        logger.info("Redis connection initialized")
    
    async def _load_settlement_rules(self):
        """Load settlement rules and configurations"""
        self.settlement_rules = {
            'daily_settlement_time': '18:00',  # 6 PM
            'weekly_settlement_day': 'friday',
            'monthly_settlement_day': 28,
            'grace_period_days': 3,
            'penalty_rate_daily': 0.001,  # 0.1% per day
            'max_penalty_rate': 0.05,     # 5% maximum
            'auto_settlement_threshold': 100000,  # ₦100k
            'emergency_settlement_fee': 1000,     # ₦1k
            'settlement_retry_attempts': 3,
            'settlement_retry_delay_hours': 2,
        }
        logger.info("Settlement rules loaded")
    
    async def _init_notification_service(self):
        """Initialize notification service"""
        self.notification_service = NotificationService()
        logger.info("Notification service initialized")
    
    async def process_settlement(self, request: SettlementRequest) -> SettlementResponse:
        """Process a single settlement request"""
        
        with settlement_duration.time():
            try:
                # Get agent float data
                float_data = await self._get_agent_float_data(request.agent_id)
                if not float_data:
                    raise HTTPException(status_code=404, detail="Agent float facility not found")
                
                # Validate settlement eligibility
                await self._validate_settlement_eligibility(float_data, request)
                
                # Calculate settlement amounts
                settlement_calculation = await self._calculate_settlement_amounts(float_data, request)
                
                # Create settlement record
                settlement_record = await self._create_settlement_record(
                    float_data, request, settlement_calculation
                )
                
                # Process payment
                payment_result = await self._process_payment(settlement_record, request.payment_method)
                
                # Update settlement status based on payment result
                if payment_result['success']:
                    await self._complete_settlement(settlement_record, payment_result)
                    settlements_processed.inc()
                    status = SettlementStatus.COMPLETED
                    message = "Settlement completed successfully"
                else:
                    await self._handle_settlement_failure(settlement_record, payment_result)
                    settlements_failed.inc()
                    status = SettlementStatus.FAILED
                    message = f"Settlement failed: {payment_result.get('error', 'Unknown error')}"
                
                # Send notifications
                await self._send_settlement_notification(settlement_record, status)
                
                # Update metrics
                await self._update_settlement_metrics()
                
                return SettlementResponse(
                    settlement_id=settlement_record['settlement_ref'],
                    agent_id=request.agent_id,
                    status=status,
                    outstanding_amount=settlement_calculation['outstanding_amount'],
                    settlement_amount=settlement_calculation['settlement_amount'],
                    interest_charged=settlement_calculation['interest_charged'],
                    fees_charged=settlement_calculation['fees_charged'],
                    penalty_charged=settlement_calculation['penalty_charged'],
                    total_amount_due=settlement_calculation['total_amount_due'],
                    payment_method=request.payment_method,
                    scheduled_date=settlement_record['scheduled_date'],
                    due_date=settlement_record['due_date'],
                    created_at=settlement_record['created_at'],
                    message=message
                )
                
            except Exception as e:
                logger.error(f"Settlement processing failed for agent {request.agent_id}: {e}")
                settlements_failed.inc()
                raise HTTPException(status_code=500, detail=str(e))
    
    async def process_bulk_settlements(self, request: BulkSettlementRequest) -> Dict:
        """Process bulk settlements for multiple agents"""
        
        results = {
            'total_agents': len(request.agent_ids),
            'successful_settlements': 0,
            'failed_settlements': 0,
            'total_amount_settled': 0.0,
            'settlements': []
        }
        
        for agent_id in request.agent_ids:
            try:
                settlement_request = SettlementRequest(
                    agent_id=agent_id,
                    settlement_type=request.settlement_type,
                    payment_method=request.payment_method
                )
                
                if request.dry_run:
                    # Perform dry run calculation
                    settlement_result = await self._dry_run_settlement(agent_id)
                else:
                    # Process actual settlement
                    settlement_result = await self.process_settlement(settlement_request)
                
                if settlement_result.status == SettlementStatus.COMPLETED:
                    results['successful_settlements'] += 1
                    results['total_amount_settled'] += settlement_result.settlement_amount
                else:
                    results['failed_settlements'] += 1
                
                results['settlements'].append({
                    'agent_id': agent_id,
                    'status': settlement_result.status,
                    'amount': settlement_result.settlement_amount,
                    'message': settlement_result.message
                })
                
            except Exception as e:
                logger.error(f"Bulk settlement failed for agent {agent_id}: {e}")
                results['failed_settlements'] += 1
                results['settlements'].append({
                    'agent_id': agent_id,
                    'status': SettlementStatus.FAILED,
                    'amount': 0.0,
                    'message': str(e)
                })
        
        return results
    
    async def schedule_automated_settlements(self) -> Dict:
        """Schedule automated settlements based on rules"""
        
        # Get agents due for settlement
        agents_due = await self._get_agents_due_for_settlement()
        
        scheduled_count = 0
        for agent in agents_due:
            try:
                # Schedule settlement task
                celery_app.send_task(
                    'settlement_engine.process_agent_settlement',
                    args=[agent['agent_id']],
                    countdown=300  # 5 minutes delay
                )
                scheduled_count += 1
                
            except Exception as e:
                logger.error(f"Failed to schedule settlement for agent {agent['agent_id']}: {e}")
        
        return {
            'agents_due': len(agents_due),
            'scheduled_settlements': scheduled_count,
            'timestamp': datetime.now().isoformat()
        }
    
    async def _get_agent_float_data(self, agent_id: str) -> Optional[Dict]:
        """Get agent float facility data"""
        query = text("""
            SELECT 
                af.*,
                a.agent_tier, a.status as agent_status,
                COUNT(ft.id) as transaction_count,
                COALESCE(SUM(CASE WHEN ft.type = 'utilization' THEN ft.amount ELSE 0 END), 0) as total_utilization,
                MAX(ft.created_at) as last_transaction_date
            FROM agent_floats af
            JOIN agent_onboarding a ON af.agent_id = a.agent_id
            LEFT JOIN float_transactions ft ON af.id = ft.agent_float_id
            WHERE af.agent_id = :agent_id
            GROUP BY af.id, a.agent_tier, a.status
        """)
        
        try:
            with self.db_engine.connect() as conn:
                result = conn.execute(query, {"agent_id": agent_id}).fetchone()
                if result:
                    return dict(result._mapping)
        except Exception as e:
            logger.error(f"Error fetching agent float data: {e}")
        
        return None
    
    async def _validate_settlement_eligibility(self, float_data: Dict, request: SettlementRequest):
        """Validate if agent is eligible for settlement"""
        
        # Check if float facility is active
        if float_data['status'] != 'active':
            raise HTTPException(
                status_code=400,
                detail=f"Float facility is not active: {float_data['status']}"
            )
        
        # Check if there's outstanding amount
        if float_data['utilized_amount'] <= 0 and not request.force_settlement:
            raise HTTPException(
                status_code=400,
                detail="No outstanding amount to settle"
            )
        
        # Check settlement frequency rules
        if not request.force_settlement:
            await self._check_settlement_frequency(float_data)
    
    async def _check_settlement_frequency(self, float_data: Dict):
        """Check if settlement frequency rules are met"""
        
        last_settlement = float_data.get('last_settlement_date')
        settlement_frequency = float_data.get('settlement_frequency', 'daily')
        
        if last_settlement:
            time_since_last = datetime.now() - last_settlement
            
            if settlement_frequency == 'daily' and time_since_last.days < 1:
                raise HTTPException(
                    status_code=400,
                    detail="Daily settlement already processed"
                )
            elif settlement_frequency == 'weekly' and time_since_last.days < 7:
                raise HTTPException(
                    status_code=400,
                    detail="Weekly settlement not yet due"
                )
    
    async def _calculate_settlement_amounts(self, float_data: Dict, request: SettlementRequest) -> Dict:
        """Calculate settlement amounts including interest and fees"""
        
        outstanding_amount = float(float_data['utilized_amount'])
        settlement_amount = request.amount if request.amount else outstanding_amount
        
        # Ensure settlement amount doesn't exceed outstanding
        settlement_amount = min(settlement_amount, outstanding_amount)
        
        # Calculate interest
        interest_rate = float(float_data.get('interest_rate', 0.03))
        days_outstanding = float_data.get('days_outstanding', 0)
        daily_interest_rate = interest_rate / 365
        interest_charged = outstanding_amount * daily_interest_rate * days_outstanding
        
        # Calculate fees
        fee_rate = float(float_data.get('fee_rate', 0.005))
        fees_charged = settlement_amount * fee_rate
        
        # Calculate penalties for overdue settlements
        penalty_charged = 0.0
        grace_period = self.settlement_rules['grace_period_days']
        if days_outstanding > grace_period:
            overdue_days = days_outstanding - grace_period
            penalty_rate = min(
                self.settlement_rules['penalty_rate_daily'] * overdue_days,
                self.settlement_rules['max_penalty_rate']
            )
            penalty_charged = outstanding_amount * penalty_rate
        
        # Add emergency settlement fee if applicable
        if request.settlement_type == SettlementType.EMERGENCY:
            fees_charged += self.settlement_rules['emergency_settlement_fee']
        
        total_amount_due = settlement_amount + interest_charged + fees_charged + penalty_charged
        
        return {
            'outstanding_amount': outstanding_amount,
            'settlement_amount': settlement_amount,
            'interest_charged': interest_charged,
            'fees_charged': fees_charged,
            'penalty_charged': penalty_charged,
            'total_amount_due': total_amount_due,
            'days_outstanding': days_outstanding
        }
    
    async def _create_settlement_record(self, float_data: Dict, request: SettlementRequest, 
                                      calculation: Dict) -> Dict:
        """Create settlement record in database"""
        
        settlement_ref = f"FST_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{request.agent_id[:8]}"
        
        settlement_data = {
            'agent_float_id': float_data['id'],
            'agent_id': request.agent_id,
            'settlement_ref': settlement_ref,
            'settlement_type': request.settlement_type.value,
            'outstanding_float': calculation['outstanding_amount'],
            'settlement_amount': calculation['settlement_amount'],
            'interest_charged': calculation['interest_charged'],
            'fees_charged': calculation['fees_charged'],
            'penalty_charged': calculation['penalty_charged'],
            'total_amount_due': calculation['total_amount_due'],
            'currency': float_data.get('currency', 'NGN'),
            'status': SettlementStatus.PENDING.value,
            'settlement_method': request.payment_method.value,
            'scheduled_date': datetime.now(),
            'due_date': datetime.now() + timedelta(days=1),
            'notes': request.notes or '',
            'created_at': datetime.now()
        }
        
        # Insert settlement record
        insert_query = text("""
            INSERT INTO float_settlements (
                agent_float_id, agent_id, settlement_ref, settlement_type,
                outstanding_float, settlement_amount, interest_charged, fees_charged,
                penalty_charged, total_amount_due, currency, status, settlement_method,
                scheduled_date, due_date, notes, created_at
            ) VALUES (
                :agent_float_id, :agent_id, :settlement_ref, :settlement_type,
                :outstanding_float, :settlement_amount, :interest_charged, :fees_charged,
                :penalty_charged, :total_amount_due, :currency, :status, :settlement_method,
                :scheduled_date, :due_date, :notes, :created_at
            ) RETURNING id
        """)
        
        try:
            with self.db_engine.connect() as conn:
                result = conn.execute(insert_query, settlement_data)
                settlement_id = result.fetchone()[0]
                settlement_data['id'] = settlement_id
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to create settlement record: {e}")
            raise
        
        return settlement_data
    
    async def _process_payment(self, settlement_record: Dict, payment_method: PaymentMethod) -> Dict:
        """Process payment for settlement"""
        
        try:
            if payment_method == PaymentMethod.AUTO_DEDUCTION:
                return await self._process_auto_deduction(settlement_record)
            elif payment_method == PaymentMethod.BANK_TRANSFER:
                return await self._process_bank_transfer(settlement_record)
            elif payment_method == PaymentMethod.MOBILE_MONEY:
                return await self._process_mobile_money(settlement_record)
            else:
                return {
                    'success': False,
                    'error': f"Unsupported payment method: {payment_method}"
                }
                
        except Exception as e:
            logger.error(f"Payment processing failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    async def _process_auto_deduction(self, settlement_record: Dict) -> Dict:
        """Process automatic deduction from agent's account"""
        
        # Simulate auto-deduction process
        # In production, this would integrate with the core banking system
        
        agent_id = settlement_record['agent_id']
        amount = settlement_record['total_amount_due']
        
        # Check agent's available balance (simulated)
        available_balance = await self._get_agent_available_balance(agent_id)
        
        if available_balance >= amount:
            # Simulate successful deduction
            await asyncio.sleep(0.1)  # Simulate processing time
            
            payment_ref = f"AD_{datetime.now().strftime('%Y%m%d%H%M%S')}_{agent_id[:8]}"
            
            return {
                'success': True,
                'payment_reference': payment_ref,
                'amount_processed': amount,
                'processing_fee': 0.0,
                'method': 'auto_deduction'
            }
        else:
            return {
                'success': False,
                'error': f"Insufficient balance: {available_balance} < {amount}",
                'available_balance': available_balance,
                'required_amount': amount
            }
    
    async def _process_bank_transfer(self, settlement_record: Dict) -> Dict:
        """Process bank transfer settlement"""
        
        # Simulate bank transfer initiation
        await asyncio.sleep(0.2)  # Simulate processing time
        
        payment_ref = f"BT_{datetime.now().strftime('%Y%m%d%H%M%S')}_{settlement_record['agent_id'][:8]}"
        
        return {
            'success': True,
            'payment_reference': payment_ref,
            'amount_processed': settlement_record['total_amount_due'],
            'processing_fee': 50.0,  # ₦50 bank transfer fee
            'method': 'bank_transfer',
            'status': 'pending_confirmation'
        }
    
    async def _process_mobile_money(self, settlement_record: Dict) -> Dict:
        """Process mobile money settlement"""
        
        # Simulate mobile money processing
        await asyncio.sleep(0.15)  # Simulate processing time
        
        payment_ref = f"MM_{datetime.now().strftime('%Y%m%d%H%M%S')}_{settlement_record['agent_id'][:8]}"
        
        return {
            'success': True,
            'payment_reference': payment_ref,
            'amount_processed': settlement_record['total_amount_due'],
            'processing_fee': 25.0,  # ₦25 mobile money fee
            'method': 'mobile_money'
        }
    
    async def _get_agent_available_balance(self, agent_id: str) -> float:
        """Get agent's available balance for auto-deduction"""
        
        # This would integrate with the cash management service
        # For now, simulate based on agent's transaction history
        
        query = text("""
            SELECT COALESCE(SUM(amount), 0) as total_deposits
            FROM cash_movements 
            WHERE agent_id = :agent_id 
            AND type = 'deposit'
            AND created_at > NOW() - INTERVAL '30 days'
        """)
        
        try:
            with self.db_engine.connect() as conn:
                result = conn.execute(query, {"agent_id": agent_id}).fetchone()
                if result:
                    # Simulate available balance as 70% of recent deposits
                    return float(result.total_deposits) * 0.7
        except Exception as e:
            logger.error(f"Error fetching agent balance: {e}")
        
        return 0.0
    
    async def _complete_settlement(self, settlement_record: Dict, payment_result: Dict):
        """Complete successful settlement"""
        
        # Update settlement record
        update_query = text("""
            UPDATE float_settlements 
            SET status = :status,
                amount_settled = :amount_settled,
                payment_reference = :payment_reference,
                processed_at = :processed_at,
                completed_at = :completed_at
            WHERE id = :settlement_id
        """)
        
        # Update agent float record
        float_update_query = text("""
            UPDATE agent_floats 
            SET utilized_amount = utilized_amount - :settlement_amount,
                available_float = available_float + :settlement_amount,
                last_settlement_date = :settlement_date,
                total_settlements = total_settlements + 1,
                successful_settlements = successful_settlements + 1,
                days_outstanding = 0
            WHERE id = :agent_float_id
        """)
        
        try:
            with self.db_engine.connect() as conn:
                # Update settlement
                conn.execute(update_query, {
                    'status': SettlementStatus.COMPLETED.value,
                    'amount_settled': payment_result['amount_processed'],
                    'payment_reference': payment_result['payment_reference'],
                    'processed_at': datetime.now(),
                    'completed_at': datetime.now(),
                    'settlement_id': settlement_record['id']
                })
                
                # Update float
                conn.execute(float_update_query, {
                    'settlement_amount': settlement_record['settlement_amount'],
                    'settlement_date': datetime.now(),
                    'agent_float_id': settlement_record['agent_float_id']
                })
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to complete settlement: {e}")
            raise
    
    async def _handle_settlement_failure(self, settlement_record: Dict, payment_result: Dict):
        """Handle failed settlement"""
        
        # Update settlement record with failure details
        update_query = text("""
            UPDATE float_settlements 
            SET status = :status,
                failure_reason = :failure_reason,
                failed_at = :failed_at,
                retry_count = retry_count + 1
            WHERE id = :settlement_id
        """)
        
        # Update agent float record
        float_update_query = text("""
            UPDATE agent_floats 
            SET failed_settlements = failed_settlements + 1
            WHERE id = :agent_float_id
        """)
        
        try:
            with self.db_engine.connect() as conn:
                conn.execute(update_query, {
                    'status': SettlementStatus.FAILED.value,
                    'failure_reason': payment_result.get('error', 'Unknown error'),
                    'failed_at': datetime.now(),
                    'settlement_id': settlement_record['id']
                })
                
                conn.execute(float_update_query, {
                    'agent_float_id': settlement_record['agent_float_id']
                })
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to handle settlement failure: {e}")
    
    async def _send_settlement_notification(self, settlement_record: Dict, status: SettlementStatus):
        """Send settlement notification to agent"""
        
        try:
            await self.notification_service.send_settlement_notification(
                agent_id=settlement_record['agent_id'],
                settlement_ref=settlement_record['settlement_ref'],
                amount=settlement_record['total_amount_due'],
                status=status.value
            )
        except Exception as e:
            logger.warning(f"Failed to send settlement notification: {e}")
    
    async def _update_settlement_metrics(self):
        """Update settlement metrics"""
        
        try:
            # Count outstanding settlements
            query = text("""
                SELECT 
                    COUNT(*) as outstanding_count,
                    COALESCE(SUM(total_amount_due - amount_settled), 0) as outstanding_amount
                FROM float_settlements 
                WHERE status IN ('pending', 'processing', 'failed')
            """)
            
            with self.db_engine.connect() as conn:
                result = conn.execute(query).fetchone()
                if result:
                    outstanding_settlements.set(result.outstanding_count)
                    total_outstanding_amount.set(float(result.outstanding_amount))
                    
        except Exception as e:
            logger.error(f"Failed to update settlement metrics: {e}")
    
    async def _get_agents_due_for_settlement(self) -> List[Dict]:
        """Get agents due for settlement"""
        
        query = text("""
            SELECT 
                af.agent_id,
                af.settlement_frequency,
                af.last_settlement_date,
                af.utilized_amount,
                af.days_outstanding
            FROM agent_floats af
            WHERE af.status = 'active'
            AND af.utilized_amount > 0
            AND (
                (af.settlement_frequency = 'daily' AND af.last_settlement_date < CURRENT_DATE)
                OR (af.settlement_frequency = 'weekly' AND af.last_settlement_date < CURRENT_DATE - INTERVAL '7 days')
                OR (af.settlement_frequency = 'monthly' AND af.last_settlement_date < CURRENT_DATE - INTERVAL '30 days')
                OR af.days_outstanding > :max_days_outstanding
            )
        """)
        
        try:
            with self.db_engine.connect() as conn:
                results = conn.execute(query, {
                    'max_days_outstanding': self.settlement_rules.get('grace_period_days', 7)
                }).fetchall()
                
                return [dict(row._mapping) for row in results]
                
        except Exception as e:
            logger.error(f"Error fetching agents due for settlement: {e}")
            return []
    
    async def _dry_run_settlement(self, agent_id: str) -> SettlementResponse:
        """Perform dry run settlement calculation"""
        
        float_data = await self._get_agent_float_data(agent_id)
        if not float_data:
            raise HTTPException(status_code=404, detail="Agent float facility not found")
        
        request = SettlementRequest(agent_id=agent_id)
        calculation = await self._calculate_settlement_amounts(float_data, request)
        
        return SettlementResponse(
            settlement_id="DRY_RUN",
            agent_id=agent_id,
            status=SettlementStatus.PENDING,
            outstanding_amount=calculation['outstanding_amount'],
            settlement_amount=calculation['settlement_amount'],
            interest_charged=calculation['interest_charged'],
            fees_charged=calculation['fees_charged'],
            penalty_charged=calculation['penalty_charged'],
            total_amount_due=calculation['total_amount_due'],
            payment_method=PaymentMethod.AUTO_DEDUCTION,
            scheduled_date=datetime.now(),
            due_date=datetime.now() + timedelta(days=1),
            created_at=datetime.now(),
            message="Dry run calculation completed"
        )

# ==========================================
# NOTIFICATION SERVICE
# ==========================================

class NotificationService:
    def __init__(self):
        self.smtp_server = os.getenv('SMTP_SERVER', 'localhost')
        self.smtp_port = int(os.getenv('SMTP_PORT', '587'))
        self.smtp_username = os.getenv('SMTP_USERNAME', '')
        self.smtp_password = os.getenv('SMTP_PASSWORD', '')
    
    async def send_settlement_notification(self, agent_id: str, settlement_ref: str, 
                                         amount: float, status: str):
        """Send settlement notification via email/SMS"""
        
        # This would integrate with actual notification services
        logger.info(f"Settlement notification sent to agent {agent_id}: {settlement_ref} - {status}")

# Global settlement engine instance
settlement_engine = SettlementEngine()

# ==========================================
# CELERY TASKS
# ==========================================

@celery_app.task
def process_agent_settlement(agent_id: str):
    """Celery task to process agent settlement"""
    
    async def _process():
        request = SettlementRequest(
            agent_id=agent_id,
            settlement_type=SettlementType.AUTOMATED
        )
        return await settlement_engine.process_settlement(request)
    
    return asyncio.run(_process())

@celery_app.task
def process_daily_settlements():
    """Celery task to process daily settlements"""
    
    async def _process():
        return await settlement_engine.schedule_automated_settlements()
    
    return asyncio.run(_process())

# ==========================================
# API ENDPOINTS
# ==========================================

@app.on_event("startup")
async def startup_event():
    """Initialize the settlement engine on startup"""
    await settlement_engine.initialize()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "float-settlement-engine",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(generate_latest(), media_type="text/plain")

@app.post("/settle", response_model=SettlementResponse)
async def process_settlement(request: SettlementRequest, background_tasks: BackgroundTasks):
    """Process a settlement request"""
    
    try:
        result = await settlement_engine.process_settlement(request)
        
        # Update metrics in background
        background_tasks.add_task(settlement_engine._update_settlement_metrics)
        
        return result
        
    except Exception as e:
        logger.error(f"Settlement processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/bulk-settle")
async def process_bulk_settlements(request: BulkSettlementRequest):
    """Process bulk settlements"""
    
    try:
        return await settlement_engine.process_bulk_settlements(request)
        
    except Exception as e:
        logger.error(f"Bulk settlement processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/schedule-automated")
async def schedule_automated_settlements():
    """Schedule automated settlements"""
    
    try:
        return await settlement_engine.schedule_automated_settlements()
        
    except Exception as e:
        logger.error(f"Automated settlement scheduling failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/agents/{agent_id}/settlement-due")
async def check_settlement_due(agent_id: str):
    """Check if agent is due for settlement"""
    
    try:
        dry_run_result = await settlement_engine._dry_run_settlement(agent_id)
        
        return {
            "agent_id": agent_id,
            "settlement_due": dry_run_result.outstanding_amount > 0,
            "outstanding_amount": dry_run_result.outstanding_amount,
            "total_amount_due": dry_run_result.total_amount_due,
            "interest_charged": dry_run_result.interest_charged,
            "fees_charged": dry_run_result.fees_charged,
            "penalty_charged": dry_run_result.penalty_charged
        }
        
    except Exception as e:
        logger.error(f"Settlement due check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/settlements")
async def list_settlements(
    status: Optional[str] = None,
    agent_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    """List settlements with filters"""
    
    query = "SELECT * FROM float_settlements WHERE 1=1"
    params = {}
    
    if status:
        query += " AND status = :status"
        params['status'] = status
    
    if agent_id:
        query += " AND agent_id = :agent_id"
        params['agent_id'] = agent_id
    
    query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
    params['limit'] = limit
    params['offset'] = offset
    
    try:
        with settlement_engine.db_engine.connect() as conn:
            results = conn.execute(text(query), params).fetchall()
            
            return {
                "settlements": [dict(row._mapping) for row in results],
                "count": len(results),
                "limit": limit,
                "offset": offset
            }
            
    except Exception as e:
        logger.error(f"Failed to list settlements: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8002")),
        reload=os.getenv("ENVIRONMENT") == "development",
        log_level="info"
    )

