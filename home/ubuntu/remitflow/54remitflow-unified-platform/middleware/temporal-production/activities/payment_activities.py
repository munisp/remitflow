"""
Payment Activities for Nigerian Remittance Platform
Implements atomic operations for payment processing workflow
"""

import asyncio
import logging
from typing import Dict, Any
from datetime import datetime
from temporalio import activity

# Configure logging
logger = logging.getLogger(__name__)


@activity.defn
async def validate_payment(payment_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate payment data and business rules
    
    Args:
        payment_data: Payment information
    
    Returns:
        Dict with validation result
    """
    activity.logger.info(f"Validating payment: {payment_data.get('payment_id')}")
    
    try:
        # Validate required fields
        required_fields = ['payment_id', 'sender_id', 'recipient_id', 'amount', 'currency']
        for field in required_fields:
            if field not in payment_data or not payment_data[field]:
                return {
                    "valid": False,
                    "error": f"Missing required field: {field}"
                }
        
        # Validate amount
        amount = float(payment_data.get('amount', 0))
        if amount <= 0:
            return {
                "valid": False,
                "error": "Amount must be greater than zero"
            }
        
        if amount > 1000000:  # Max transaction limit
            return {
                "valid": False,
                "error": "Amount exceeds maximum transaction limit"
            }
        
        # Validate currency
        supported_currencies = ['NGN', 'USD', 'EUR', 'GBP', 'CNY', 'BRL']
        if payment_data.get('currency') not in supported_currencies:
            return {
                "valid": False,
                "error": f"Unsupported currency: {payment_data.get('currency')}"
            }
        
        # Validate sender != recipient
        if payment_data.get('sender_id') == payment_data.get('recipient_id'):
            return {
                "valid": False,
                "error": "Sender and recipient cannot be the same"
            }
        
        activity.logger.info(f"Payment validation successful: {payment_data.get('payment_id')}")
        
        return {
            "valid": True,
            "validated_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        activity.logger.error(f"Payment validation error: {str(e)}")
        return {
            "valid": False,
            "error": f"Validation error: {str(e)}"
        }


@activity.defn
async def check_fraud(payment_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check payment for fraud indicators
    
    Args:
        payment_data: Payment information
    
    Returns:
        Dict with fraud check result
    """
    activity.logger.info(f"Checking fraud for payment: {payment_data.get('payment_id')}")
    
    try:
        # Simulate fraud detection (in production, this would call the fraud detection service)
        fraud_score = 0.0
        fraud_indicators = []
        
        # Check amount patterns
        amount = float(payment_data.get('amount', 0))
        if amount > 500000:
            fraud_score += 0.3
            fraud_indicators.append("high_amount")
        
        # Check velocity (would query database in production)
        # For now, simulate
        fraud_score += 0.1  # Base score
        
        # Determine if fraudulent
        is_fraudulent = fraud_score > 0.7
        
        result = {
            "is_fraudulent": is_fraudulent,
            "fraud_score": fraud_score,
            "indicators": fraud_indicators,
            "checked_at": datetime.utcnow().isoformat()
        }
        
        if is_fraudulent:
            result["reason"] = f"Fraud score {fraud_score} exceeds threshold"
        
        activity.logger.info(
            f"Fraud check completed: {payment_data.get('payment_id')} - "
            f"Score: {fraud_score}, Fraudulent: {is_fraudulent}"
        )
        
        return result
        
    except Exception as e:
        activity.logger.error(f"Fraud check error: {str(e)}")
        # Fail safe: allow transaction on error
        return {
            "is_fraudulent": False,
            "fraud_score": 0.0,
            "error": str(e)
        }


@activity.defn
async def process_payment(payment_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process payment through TigerBeetle
    
    Args:
        payment_data: Payment information
    
    Returns:
        Dict with processing result
    """
    activity.logger.info(f"Processing payment via TigerBeetle: {payment_data.get('payment_id')}")
    
    try:
        # In production, this would interact with TigerBeetle
        # For now, simulate successful processing
        
        transaction_id = f"TB-{payment_data.get('payment_id')}-{int(datetime.utcnow().timestamp())}"
        
        # Simulate TigerBeetle transfer
        await asyncio.sleep(0.1)  # Simulate network call
        
        activity.logger.info(
            f"Payment processed successfully: {payment_data.get('payment_id')} - "
            f"Transaction ID: {transaction_id}"
        )
        
        return {
            "success": True,
            "transaction_id": transaction_id,
            "processed_at": datetime.utcnow().isoformat(),
            "amount": payment_data.get('amount'),
            "currency": payment_data.get('currency')
        }
        
    except Exception as e:
        activity.logger.error(f"Payment processing error: {str(e)}")
        return {
            "success": False,
            "error": f"Processing failed: {str(e)}"
        }


@activity.defn
async def settle_payment(settlement_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Settle payment through payment corridor
    
    Args:
        settlement_data: Settlement information
    
    Returns:
        Dict with settlement result
    """
    activity.logger.info(
        f"Settling payment: {settlement_data.get('payment_id')} "
        f"via {settlement_data.get('corridor')}"
    )
    
    try:
        # In production, this would interact with payment corridors (PAPSS, CIPS, etc.)
        # For now, simulate successful settlement
        
        settlement_id = f"SETTLE-{settlement_data.get('payment_id')}-{int(datetime.utcnow().timestamp())}"
        
        # Simulate corridor settlement
        await asyncio.sleep(0.2)  # Simulate network call
        
        activity.logger.info(
            f"Payment settled successfully: {settlement_data.get('payment_id')} - "
            f"Settlement ID: {settlement_id}"
        )
        
        return {
            "success": True,
            "settlement_id": settlement_id,
            "settled_at": datetime.utcnow().isoformat(),
            "corridor": settlement_data.get('corridor')
        }
        
    except Exception as e:
        activity.logger.error(f"Settlement error: {str(e)}")
        return {
            "success": False,
            "error": f"Settlement failed: {str(e)}"
        }


@activity.defn
async def refund_payment(refund_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Refund a payment
    
    Args:
        refund_data: Refund information
    
    Returns:
        Dict with refund result
    """
    activity.logger.info(
        f"Refunding payment: {refund_data.get('payment_id')} - "
        f"Reason: {refund_data.get('reason')}"
    )
    
    try:
        # In production, this would reverse the TigerBeetle transaction
        # For now, simulate successful refund
        
        refund_id = f"REFUND-{refund_data.get('payment_id')}-{int(datetime.utcnow().timestamp())}"
        
        # Simulate refund processing
        await asyncio.sleep(0.15)  # Simulate network call
        
        activity.logger.info(
            f"Payment refunded successfully: {refund_data.get('payment_id')} - "
            f"Refund ID: {refund_id}"
        )
        
        return {
            "success": True,
            "refund_id": refund_id,
            "refunded_at": datetime.utcnow().isoformat(),
            "reason": refund_data.get('reason')
        }
        
    except Exception as e:
        activity.logger.error(f"Refund error: {str(e)}")
        return {
            "success": False,
            "error": f"Refund failed: {str(e)}"
        }


@activity.defn
async def send_notification(notification_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Send notification to user
    
    Args:
        notification_data: Notification information
    
    Returns:
        Dict with notification result
    """
    activity.logger.info(
        f"Sending notification to user: {notification_data.get('user_id')} - "
        f"Type: {notification_data.get('type')}"
    )
    
    try:
        # In production, this would send via notification service
        # For now, simulate successful notification
        
        notification_id = f"NOTIF-{notification_data.get('user_id')}-{int(datetime.utcnow().timestamp())}"
        
        # Simulate notification sending
        await asyncio.sleep(0.05)  # Simulate network call
        
        activity.logger.info(
            f"Notification sent successfully: {notification_id}"
        )
        
        return {
            "success": True,
            "notification_id": notification_id,
            "sent_at": datetime.utcnow().isoformat(),
            "type": notification_data.get('type')
        }
        
    except Exception as e:
        activity.logger.error(f"Notification error: {str(e)}")
        return {
            "success": False,
            "error": f"Notification failed: {str(e)}"
        }

