"""
Idempotency Service - Prevents duplicate transactions on retry
Critical for offline-first architecture where clients may retry failed requests
"""

from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import logging

logger = logging.getLogger(__name__)


class IdempotencyService:
    """
    Handles idempotency for transaction operations.
    
    Pattern:
    1. Client generates unique idempotency_key (UUID) for each transaction intent
    2. On first request: process transaction, store result with key
    3. On duplicate request: return stored result without reprocessing
    4. Keys expire after 24 hours to prevent unbounded storage growth
    """
    
    def __init__(self, db: Session):
        self.db = db
        self.default_ttl_hours = 24
    
    async def check_idempotency(
        self, 
        idempotency_key: str, 
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Check if a request with this idempotency key has already been processed.
        
        Returns:
            None if this is a new request
            Dict with transaction_id and response if duplicate
        """
        from .models import IdempotencyRecord
        
        # Composite key: user_id + idempotency_key for security
        composite_key = f"{user_id}:{idempotency_key}"
        
        record = self.db.query(IdempotencyRecord).filter(
            IdempotencyRecord.idempotency_key == composite_key
        ).first()
        
        if record is None:
            return None
        
        # Check if expired
        if record.expires_at < datetime.utcnow():
            # Clean up expired record
            self.db.delete(record)
            self.db.commit()
            return None
        
        logger.info(f"Idempotency hit: key={idempotency_key}, txn={record.transaction_id}")
        
        return {
            "transaction_id": record.transaction_id,
            "response": record.response_data,
            "created_at": record.created_at.isoformat(),
            "is_duplicate": True
        }
    
    async def store_idempotency(
        self,
        idempotency_key: str,
        user_id: str,
        transaction_id: str,
        response_data: Dict[str, Any],
        ttl_hours: Optional[int] = None
    ) -> None:
        """
        Store the result of a processed request for future duplicate detection.
        """
        from .models import IdempotencyRecord
        
        composite_key = f"{user_id}:{idempotency_key}"
        ttl = ttl_hours or self.default_ttl_hours
        expires_at = datetime.utcnow() + timedelta(hours=ttl)
        
        record = IdempotencyRecord(
            idempotency_key=composite_key,
            transaction_id=transaction_id,
            user_id=user_id,
            response_data=response_data,
            created_at=datetime.utcnow(),
            expires_at=expires_at
        )
        
        try:
            self.db.add(record)
            self.db.commit()
            logger.info(f"Idempotency stored: key={idempotency_key}, txn={transaction_id}")
        except IntegrityError:
            # Race condition: another request already stored this key
            self.db.rollback()
            logger.warning(f"Idempotency race condition: key={idempotency_key}")
    
    async def cleanup_expired(self) -> int:
        """
        Remove expired idempotency records.
        Should be called periodically (e.g., daily cron job).
        
        Returns:
            Number of records deleted
        """
        from .models import IdempotencyRecord
        
        result = self.db.query(IdempotencyRecord).filter(
            IdempotencyRecord.expires_at < datetime.utcnow()
        ).delete()
        
        self.db.commit()
        logger.info(f"Cleaned up {result} expired idempotency records")
        
        return result


def generate_idempotency_key() -> str:
    """Generate a unique idempotency key for client use."""
    import uuid
    return str(uuid.uuid4())
