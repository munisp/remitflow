"""
Rate Alert Manager - Threshold-based rate notifications
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from decimal import Decimal
from enum import Enum
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class AlertType(str, Enum):
    """Alert trigger types"""
    ABOVE = "above"
    BELOW = "below"
    CHANGE_PERCENT = "change_percent"
    VOLATILITY = "volatility"


class AlertStatus(str, Enum):
    """Alert status"""
    ACTIVE = "active"
    TRIGGERED = "triggered"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class RateAlert(BaseModel):
    """Rate alert model"""
    alert_id: str
    user_id: str
    from_currency: str
    to_currency: str
    alert_type: AlertType
    threshold_value: Decimal
    current_rate: Optional[Decimal] = None
    status: AlertStatus = AlertStatus.ACTIVE
    notification_channels: List[str] = ["email"]
    created_at: datetime
    triggered_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class AlertManager:
    """Manages rate alerts and notifications"""
    
    def __init__(self):
        self.alerts: Dict[str, RateAlert] = {}
        self.triggered_alerts: List[RateAlert] = []
    
    def create_alert(
        self,
        user_id: str,
        from_currency: str,
        to_currency: str,
        alert_type: AlertType,
        threshold_value: Decimal,
        notification_channels: Optional[List[str]] = None,
        expires_at: Optional[datetime] = None
    ) -> RateAlert:
        """Create new rate alert"""
        
        import uuid
        alert_id = str(uuid.uuid4())
        
        alert = RateAlert(
            alert_id=alert_id,
            user_id=user_id,
            from_currency=from_currency,
            to_currency=to_currency,
            alert_type=alert_type,
            threshold_value=threshold_value,
            notification_channels=notification_channels or ["email"],
            created_at=datetime.utcnow(),
            expires_at=expires_at
        )
        
        self.alerts[alert_id] = alert
        logger.info(f"Alert created: {alert_id} for {user_id} - {from_currency}/{to_currency}")
        
        return alert
    
    def get_alert(self, alert_id: str) -> Optional[RateAlert]:
        """Get alert by ID"""
        return self.alerts.get(alert_id)
    
    def get_user_alerts(
        self,
        user_id: str,
        status: Optional[AlertStatus] = None
    ) -> List[RateAlert]:
        """Get all alerts for user"""
        
        user_alerts = [
            alert for alert in self.alerts.values()
            if alert.user_id == user_id
        ]
        
        if status:
            user_alerts = [a for a in user_alerts if a.status == status]
        
        return user_alerts
    
    def cancel_alert(self, alert_id: str) -> bool:
        """Cancel alert"""
        
        if alert_id not in self.alerts:
            return False
        
        self.alerts[alert_id].status = AlertStatus.CANCELLED
        logger.info(f"Alert cancelled: {alert_id}")
        return True
    
    def check_alerts(
        self,
        from_currency: str,
        to_currency: str,
        current_rate: Decimal,
        previous_rate: Optional[Decimal] = None
    ) -> List[RateAlert]:
        """Check if any alerts should be triggered"""
        
        triggered = []
        
        for alert in self.alerts.values():
            # Skip if not active
            if alert.status != AlertStatus.ACTIVE:
                continue
            
            # Skip if expired
            if alert.expires_at and datetime.utcnow() > alert.expires_at:
                alert.status = AlertStatus.EXPIRED
                continue
            
            # Skip if different currency pair
            if alert.from_currency != from_currency or alert.to_currency != to_currency:
                continue
            
            # Check threshold
            should_trigger = False
            
            if alert.alert_type == AlertType.ABOVE:
                should_trigger = current_rate >= alert.threshold_value
            
            elif alert.alert_type == AlertType.BELOW:
                should_trigger = current_rate <= alert.threshold_value
            
            elif alert.alert_type == AlertType.CHANGE_PERCENT and previous_rate:
                change_percent = abs((current_rate - previous_rate) / previous_rate * 100)
                should_trigger = change_percent >= alert.threshold_value
            
            if should_trigger:
                alert.status = AlertStatus.TRIGGERED
                alert.triggered_at = datetime.utcnow()
                alert.current_rate = current_rate
                triggered.append(alert)
                self.triggered_alerts.append(alert)
                
                logger.info(
                    f"Alert triggered: {alert.alert_id} - "
                    f"{from_currency}/{to_currency} = {current_rate} "
                    f"({alert.alert_type}: {alert.threshold_value})"
                )
        
        return triggered
    
    def get_triggered_alerts(
        self,
        user_id: Optional[str] = None,
        limit: int = 100
    ) -> List[RateAlert]:
        """Get recently triggered alerts"""
        
        alerts = self.triggered_alerts[-limit:]
        
        if user_id:
            alerts = [a for a in alerts if a.user_id == user_id]
        
        return alerts
    
    async def send_notifications(self, alert: RateAlert) -> None:
        """Send notifications for triggered alert"""
        
        for channel in alert.notification_channels:
            try:
                if channel == "email":
                    await self._send_email_notification(alert)
                elif channel == "sms":
                    await self._send_sms_notification(alert)
                elif channel == "push":
                    await self._send_push_notification(alert)
                else:
                    logger.warning(f"Unknown notification channel: {channel}")
            except Exception as e:
                logger.error(f"Failed to send {channel} notification: {e}")
    
    async def _send_email_notification(self, alert: RateAlert) -> None:
        """Send email notification"""
        logger.info(f"Sending email notification for alert {alert.alert_id}")
        # TODO: Integrate with email service
    
    async def _send_sms_notification(self, alert: RateAlert) -> None:
        """Send SMS notification"""
        logger.info(f"Sending SMS notification for alert {alert.alert_id}")
        # TODO: Integrate with SMS service
    
    async def _send_push_notification(self, alert: RateAlert) -> None:
        """Send push notification"""
        logger.info(f"Sending push notification for alert {alert.alert_id}")
        # TODO: Integrate with push notification service
    
    def cleanup_expired(self) -> int:
        """Remove expired alerts"""
        
        now = datetime.utcnow()
        expired_count = 0
        
        for alert in self.alerts.values():
            if alert.expires_at and now > alert.expires_at:
                if alert.status == AlertStatus.ACTIVE:
                    alert.status = AlertStatus.EXPIRED
                    expired_count += 1
        
        if expired_count > 0:
            logger.info(f"Expired {expired_count} alerts")
        
        return expired_count
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get alert statistics"""
        
        total = len(self.alerts)
        active = sum(1 for a in self.alerts.values() if a.status == AlertStatus.ACTIVE)
        triggered = sum(1 for a in self.alerts.values() if a.status == AlertStatus.TRIGGERED)
        expired = sum(1 for a in self.alerts.values() if a.status == AlertStatus.EXPIRED)
        cancelled = sum(1 for a in self.alerts.values() if a.status == AlertStatus.CANCELLED)
        
        return {
            "total_alerts": total,
            "active": active,
            "triggered": triggered,
            "expired": expired,
            "cancelled": cancelled,
            "recently_triggered": len(self.triggered_alerts[-100:])
        }
