"""
Batch Payments Service

Supports bulk payment processing for businesses:
- CSV/API upload for 10-10,000 payments
- Scheduled/recurring transfers
- Multi-corridor routing per payment
- Progress tracking and reporting

Use cases:
- Payroll processing
- Vendor payments
- Bulk disbursements
- Recurring payments (rent, school fees, subscriptions)
"""

import csv
import io
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from uuid import uuid4
from decimal import Decimal
from enum import Enum
from dataclasses import dataclass

from common.logging_config import get_logger
from common.metrics import MetricsCollector
from common.corridor_router import CorridorRouter, RoutingStrategy

logger = get_logger(__name__)
metrics = MetricsCollector("batch_payments")


class BatchStatus(Enum):
    PENDING = "PENDING"
    VALIDATING = "VALIDATING"
    VALIDATED = "VALIDATED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    PARTIALLY_COMPLETED = "PARTIALLY_COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class PaymentStatus(Enum):
    PENDING = "PENDING"
    VALIDATED = "VALIDATED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class RecurrenceType(Enum):
    ONCE = "ONCE"
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    BIWEEKLY = "BIWEEKLY"
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    YEARLY = "YEARLY"


@dataclass
class BatchPayment:
    payment_id: str
    batch_id: str
    recipient_name: str
    recipient_account: str
    recipient_bank: Optional[str]
    recipient_country: str
    amount: Decimal
    currency: str
    reference: Optional[str]
    status: PaymentStatus
    corridor: Optional[str] = None
    transfer_id: Optional[str] = None
    error_message: Optional[str] = None
    processed_at: Optional[datetime] = None


@dataclass
class PaymentBatch:
    batch_id: str
    user_id: str
    name: str
    description: Optional[str]
    source_currency: str
    payments: List[BatchPayment]
    status: BatchStatus
    total_amount: Decimal
    total_payments: int
    completed_payments: int
    failed_payments: int
    created_at: datetime
    scheduled_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    recurrence: RecurrenceType = RecurrenceType.ONCE
    next_run_at: Optional[datetime] = None
    routing_strategy: RoutingStrategy = RoutingStrategy.BALANCED


@dataclass
class ScheduledPayment:
    schedule_id: str
    user_id: str
    recipient_name: str
    recipient_account: str
    recipient_bank: Optional[str]
    recipient_country: str
    amount: Decimal
    source_currency: str
    destination_currency: str
    recurrence: RecurrenceType
    next_run_at: datetime
    last_run_at: Optional[datetime]
    reference: Optional[str]
    is_active: bool
    created_at: datetime
    run_count: int = 0
    max_runs: Optional[int] = None


class BatchPaymentService:
    """
    Batch payment processing service for businesses.
    
    Supports CSV upload, API batch creation, and scheduled/recurring payments.
    """
    
    MAX_BATCH_SIZE = 10000
    MIN_BATCH_SIZE = 1
    
    CSV_COLUMNS = [
        "recipient_name",
        "recipient_account",
        "recipient_bank",
        "recipient_country",
        "amount",
        "currency",
        "reference"
    ]
    
    def __init__(self):
        self.batches: Dict[str, PaymentBatch] = {}
        self.scheduled_payments: Dict[str, ScheduledPayment] = {}
        self.corridor_router = CorridorRouter()
        
    async def create_batch_from_csv(
        self,
        user_id: str,
        csv_content: str,
        batch_name: str,
        source_currency: str,
        description: Optional[str] = None,
        scheduled_at: Optional[datetime] = None,
        recurrence: RecurrenceType = RecurrenceType.ONCE,
        routing_strategy: RoutingStrategy = RoutingStrategy.BALANCED
    ) -> PaymentBatch:
        """Create a payment batch from CSV content."""
        
        payments = await self._parse_csv(csv_content)
        
        if len(payments) > self.MAX_BATCH_SIZE:
            raise ValueError(f"Batch size exceeds maximum of {self.MAX_BATCH_SIZE}")
        
        if len(payments) < self.MIN_BATCH_SIZE:
            raise ValueError(f"Batch must contain at least {self.MIN_BATCH_SIZE} payment")
        
        return await self.create_batch(
            user_id=user_id,
            payments=payments,
            batch_name=batch_name,
            source_currency=source_currency,
            description=description,
            scheduled_at=scheduled_at,
            recurrence=recurrence,
            routing_strategy=routing_strategy
        )
    
    async def create_batch(
        self,
        user_id: str,
        payments: List[Dict[str, Any]],
        batch_name: str,
        source_currency: str,
        description: Optional[str] = None,
        scheduled_at: Optional[datetime] = None,
        recurrence: RecurrenceType = RecurrenceType.ONCE,
        routing_strategy: RoutingStrategy = RoutingStrategy.BALANCED
    ) -> PaymentBatch:
        """Create a payment batch from a list of payments."""
        
        batch_id = str(uuid4())
        
        batch_payments = []
        total_amount = Decimal("0")
        
        for idx, payment_data in enumerate(payments):
            payment = BatchPayment(
                payment_id=f"{batch_id}-{idx:05d}",
                batch_id=batch_id,
                recipient_name=payment_data.get("recipient_name", ""),
                recipient_account=payment_data.get("recipient_account", ""),
                recipient_bank=payment_data.get("recipient_bank"),
                recipient_country=payment_data.get("recipient_country", ""),
                amount=Decimal(str(payment_data.get("amount", 0))),
                currency=payment_data.get("currency", source_currency),
                reference=payment_data.get("reference"),
                status=PaymentStatus.PENDING
            )
            batch_payments.append(payment)
            total_amount += payment.amount
        
        batch = PaymentBatch(
            batch_id=batch_id,
            user_id=user_id,
            name=batch_name,
            description=description,
            source_currency=source_currency,
            payments=batch_payments,
            status=BatchStatus.PENDING,
            total_amount=total_amount,
            total_payments=len(batch_payments),
            completed_payments=0,
            failed_payments=0,
            created_at=datetime.utcnow(),
            scheduled_at=scheduled_at,
            recurrence=recurrence,
            routing_strategy=routing_strategy
        )
        
        if recurrence != RecurrenceType.ONCE and scheduled_at:
            batch.next_run_at = self._calculate_next_run(scheduled_at, recurrence)
        
        self.batches[batch_id] = batch
        
        metrics.increment("batches_created")
        metrics.increment("batch_payments_total", len(batch_payments))
        
        logger.info(f"Created batch {batch_id} with {len(batch_payments)} payments")
        
        return batch
    
    async def validate_batch(self, batch_id: str) -> PaymentBatch:
        """Validate all payments in a batch."""
        
        batch = self.batches.get(batch_id)
        if not batch:
            raise ValueError(f"Batch {batch_id} not found")
        
        batch.status = BatchStatus.VALIDATING
        
        validation_errors = []
        
        for payment in batch.payments:
            errors = await self._validate_payment(payment, batch.source_currency)
            
            if errors:
                payment.status = PaymentStatus.FAILED
                payment.error_message = "; ".join(errors)
                validation_errors.append({
                    "payment_id": payment.payment_id,
                    "errors": errors
                })
            else:
                payment.status = PaymentStatus.VALIDATED
                
                route = await self.corridor_router.route_transfer(
                    source_country="NG",
                    destination_country=payment.recipient_country,
                    source_currency=batch.source_currency,
                    destination_currency=payment.currency,
                    amount=payment.amount,
                    strategy=batch.routing_strategy
                )
                payment.corridor = route.selected_corridor.value
        
        if validation_errors:
            if len(validation_errors) == len(batch.payments):
                batch.status = BatchStatus.FAILED
            else:
                batch.status = BatchStatus.VALIDATED
        else:
            batch.status = BatchStatus.VALIDATED
        
        return batch
    
    async def process_batch(self, batch_id: str) -> PaymentBatch:
        """Process all validated payments in a batch."""
        
        batch = self.batches.get(batch_id)
        if not batch:
            raise ValueError(f"Batch {batch_id} not found")
        
        if batch.status not in [BatchStatus.VALIDATED, BatchStatus.PENDING]:
            raise ValueError(f"Batch {batch_id} is not ready for processing")
        
        batch.status = BatchStatus.PROCESSING
        batch.started_at = datetime.utcnow()
        
        for payment in batch.payments:
            if payment.status not in [PaymentStatus.VALIDATED, PaymentStatus.PENDING]:
                continue
            
            try:
                payment.status = PaymentStatus.PROCESSING
                
                transfer_id = str(uuid4())
                payment.transfer_id = transfer_id
                payment.status = PaymentStatus.COMPLETED
                payment.processed_at = datetime.utcnow()
                batch.completed_payments += 1
                
                metrics.increment("batch_payments_completed")
                
            except Exception as e:
                payment.status = PaymentStatus.FAILED
                payment.error_message = str(e)
                batch.failed_payments += 1
                metrics.increment("batch_payments_failed")
        
        if batch.failed_payments == 0:
            batch.status = BatchStatus.COMPLETED
        elif batch.completed_payments > 0:
            batch.status = BatchStatus.PARTIALLY_COMPLETED
        else:
            batch.status = BatchStatus.FAILED
        
        batch.completed_at = datetime.utcnow()
        
        if batch.recurrence != RecurrenceType.ONCE:
            batch.next_run_at = self._calculate_next_run(
                batch.completed_at,
                batch.recurrence
            )
        
        return batch
    
    async def get_batch(self, batch_id: str) -> Optional[PaymentBatch]:
        """Get a batch by ID."""
        return self.batches.get(batch_id)
    
    async def get_batch_summary(self, batch_id: str) -> Dict[str, Any]:
        """Get a summary of a batch."""
        batch = self.batches.get(batch_id)
        if not batch:
            return {"error": "Batch not found"}
        
        return {
            "batch_id": batch.batch_id,
            "name": batch.name,
            "status": batch.status.value,
            "total_amount": float(batch.total_amount),
            "source_currency": batch.source_currency,
            "total_payments": batch.total_payments,
            "completed_payments": batch.completed_payments,
            "failed_payments": batch.failed_payments,
            "pending_payments": batch.total_payments - batch.completed_payments - batch.failed_payments,
            "progress_percent": int((batch.completed_payments / batch.total_payments) * 100) if batch.total_payments > 0 else 0,
            "created_at": batch.created_at.isoformat(),
            "scheduled_at": batch.scheduled_at.isoformat() if batch.scheduled_at else None,
            "started_at": batch.started_at.isoformat() if batch.started_at else None,
            "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
            "recurrence": batch.recurrence.value,
            "next_run_at": batch.next_run_at.isoformat() if batch.next_run_at else None
        }
    
    async def get_user_batches(
        self,
        user_id: str,
        status: Optional[BatchStatus] = None,
        limit: int = 50
    ) -> List[PaymentBatch]:
        """Get all batches for a user."""
        batches = [
            b for b in self.batches.values()
            if b.user_id == user_id
        ]
        
        if status:
            batches = [b for b in batches if b.status == status]
        
        batches.sort(key=lambda x: x.created_at, reverse=True)
        return batches[:limit]
    
    async def cancel_batch(self, batch_id: str) -> PaymentBatch:
        """Cancel a pending or scheduled batch."""
        batch = self.batches.get(batch_id)
        if not batch:
            raise ValueError(f"Batch {batch_id} not found")
        
        if batch.status in [BatchStatus.COMPLETED, BatchStatus.PROCESSING]:
            raise ValueError(f"Cannot cancel batch in {batch.status.value} status")
        
        batch.status = BatchStatus.CANCELLED
        
        for payment in batch.payments:
            if payment.status in [PaymentStatus.PENDING, PaymentStatus.VALIDATED]:
                payment.status = PaymentStatus.SKIPPED
        
        return batch
    
    async def create_scheduled_payment(
        self,
        user_id: str,
        recipient_name: str,
        recipient_account: str,
        recipient_country: str,
        amount: Decimal,
        source_currency: str,
        destination_currency: str,
        recurrence: RecurrenceType,
        first_run_at: datetime,
        recipient_bank: Optional[str] = None,
        reference: Optional[str] = None,
        max_runs: Optional[int] = None
    ) -> ScheduledPayment:
        """Create a scheduled recurring payment."""
        
        schedule_id = str(uuid4())
        
        scheduled = ScheduledPayment(
            schedule_id=schedule_id,
            user_id=user_id,
            recipient_name=recipient_name,
            recipient_account=recipient_account,
            recipient_bank=recipient_bank,
            recipient_country=recipient_country,
            amount=amount,
            source_currency=source_currency,
            destination_currency=destination_currency,
            recurrence=recurrence,
            next_run_at=first_run_at,
            last_run_at=None,
            reference=reference,
            is_active=True,
            created_at=datetime.utcnow(),
            max_runs=max_runs
        )
        
        self.scheduled_payments[schedule_id] = scheduled
        
        metrics.increment("scheduled_payments_created")
        
        return scheduled
    
    async def get_scheduled_payment(self, schedule_id: str) -> Optional[ScheduledPayment]:
        """Get a scheduled payment by ID."""
        return self.scheduled_payments.get(schedule_id)
    
    async def get_user_scheduled_payments(
        self,
        user_id: str,
        active_only: bool = True
    ) -> List[ScheduledPayment]:
        """Get all scheduled payments for a user."""
        payments = [
            p for p in self.scheduled_payments.values()
            if p.user_id == user_id
        ]
        
        if active_only:
            payments = [p for p in payments if p.is_active]
        
        payments.sort(key=lambda x: x.next_run_at)
        return payments
    
    async def cancel_scheduled_payment(self, schedule_id: str) -> ScheduledPayment:
        """Cancel a scheduled payment."""
        scheduled = self.scheduled_payments.get(schedule_id)
        if not scheduled:
            raise ValueError(f"Scheduled payment {schedule_id} not found")
        
        scheduled.is_active = False
        return scheduled
    
    async def process_due_scheduled_payments(self) -> List[str]:
        """Process all scheduled payments that are due."""
        now = datetime.utcnow()
        processed = []
        
        for scheduled in self.scheduled_payments.values():
            if not scheduled.is_active:
                continue
            
            if scheduled.next_run_at > now:
                continue
            
            if scheduled.max_runs and scheduled.run_count >= scheduled.max_runs:
                scheduled.is_active = False
                continue
            
            try:
                scheduled.last_run_at = now
                scheduled.run_count += 1
                scheduled.next_run_at = self._calculate_next_run(now, scheduled.recurrence)
                
                processed.append(scheduled.schedule_id)
                metrics.increment("scheduled_payments_processed")
                
            except Exception as e:
                logger.error(f"Failed to process scheduled payment {scheduled.schedule_id}: {e}")
        
        return processed
    
    async def _parse_csv(self, csv_content: str) -> List[Dict[str, Any]]:
        """Parse CSV content into payment list."""
        payments = []
        
        reader = csv.DictReader(io.StringIO(csv_content))
        
        for row in reader:
            payment = {
                "recipient_name": row.get("recipient_name", "").strip(),
                "recipient_account": row.get("recipient_account", "").strip(),
                "recipient_bank": row.get("recipient_bank", "").strip() or None,
                "recipient_country": row.get("recipient_country", "").strip().upper(),
                "amount": row.get("amount", "0").strip(),
                "currency": row.get("currency", "").strip().upper(),
                "reference": row.get("reference", "").strip() or None
            }
            payments.append(payment)
        
        return payments
    
    async def _validate_payment(
        self,
        payment: BatchPayment,
        source_currency: str
    ) -> List[str]:
        """Validate a single payment."""
        errors = []
        
        if not payment.recipient_name:
            errors.append("Recipient name is required")
        
        if not payment.recipient_account:
            errors.append("Recipient account is required")
        
        if not payment.recipient_country:
            errors.append("Recipient country is required")
        elif len(payment.recipient_country) != 2:
            errors.append("Recipient country must be 2-letter ISO code")
        
        if payment.amount <= 0:
            errors.append("Amount must be greater than 0")
        
        if not payment.currency:
            errors.append("Currency is required")
        
        return errors
    
    def _calculate_next_run(
        self,
        from_date: datetime,
        recurrence: RecurrenceType
    ) -> datetime:
        """Calculate next run date based on recurrence."""
        if recurrence == RecurrenceType.DAILY:
            return from_date + timedelta(days=1)
        elif recurrence == RecurrenceType.WEEKLY:
            return from_date + timedelta(weeks=1)
        elif recurrence == RecurrenceType.BIWEEKLY:
            return from_date + timedelta(weeks=2)
        elif recurrence == RecurrenceType.MONTHLY:
            return from_date + timedelta(days=30)
        elif recurrence == RecurrenceType.QUARTERLY:
            return from_date + timedelta(days=90)
        elif recurrence == RecurrenceType.YEARLY:
            return from_date + timedelta(days=365)
        else:
            return from_date
    
    def generate_csv_template(self) -> str:
        """Generate CSV template for batch upload."""
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(self.CSV_COLUMNS)
        writer.writerow([
            "John Doe",
            "1234567890",
            "First Bank",
            "NG",
            "50000",
            "NGN",
            "Salary Jan 2025"
        ])
        return output.getvalue()


def get_batch_payment_service() -> BatchPaymentService:
    """Factory function to get batch payment service instance."""
    return BatchPaymentService()
