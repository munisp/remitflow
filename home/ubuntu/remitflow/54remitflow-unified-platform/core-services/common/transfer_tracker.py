"""
Real-Time Transfer Tracking Service

DHL-style tracking for money transfers with multi-channel notifications.
Supports SMS, WhatsApp, Push, and Email notifications.

Tracking states:
- INITIATED: Transfer request received
- PENDING: Awaiting processing
- IN_NETWORK: Transfer in payment network
- AT_DESTINATION: Arrived at receiving institution
- COMPLETED: Successfully delivered
- FAILED: Transfer failed
- REFUNDED: Funds returned to sender
"""

import os
from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import uuid4
from decimal import Decimal
from enum import Enum
from dataclasses import dataclass, field
import asyncio

import httpx

from common.logging_config import get_logger
from common.metrics import MetricsCollector

logger = get_logger(__name__)
metrics = MetricsCollector("transfer_tracker")


class TransferState(Enum):
    INITIATED = "INITIATED"
    PENDING = "PENDING"
    RESERVED = "RESERVED"
    IN_NETWORK = "IN_NETWORK"
    AT_DESTINATION = "AT_DESTINATION"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"
    CANCELLED = "CANCELLED"


class NotificationChannel(Enum):
    SMS = "SMS"
    WHATSAPP = "WHATSAPP"
    PUSH = "PUSH"
    EMAIL = "EMAIL"


@dataclass
class TrackingEvent:
    event_id: str
    transfer_id: str
    state: TransferState
    timestamp: datetime
    description: str
    location: Optional[str] = None
    corridor: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TransferTracking:
    transfer_id: str
    sender_id: str
    recipient_id: str
    amount: Decimal
    source_currency: str
    destination_currency: str
    current_state: TransferState
    events: List[TrackingEvent]
    estimated_completion: Optional[datetime] = None
    actual_completion: Optional[datetime] = None
    corridor: Optional[str] = None
    sender_phone: Optional[str] = None
    recipient_phone: Optional[str] = None
    sender_email: Optional[str] = None
    recipient_email: Optional[str] = None
    notification_preferences: Dict[str, List[NotificationChannel]] = field(default_factory=dict)


class TransferTracker:
    """
    Real-time transfer tracking with multi-channel notifications.
    
    Provides DHL-style tracking experience for money transfers.
    """
    
    STATE_DESCRIPTIONS = {
        TransferState.INITIATED: "Transfer request received",
        TransferState.PENDING: "Processing your transfer",
        TransferState.RESERVED: "Funds reserved from your account",
        TransferState.IN_NETWORK: "Transfer in payment network",
        TransferState.AT_DESTINATION: "Arrived at receiving bank",
        TransferState.COMPLETED: "Successfully delivered",
        TransferState.FAILED: "Transfer failed",
        TransferState.REFUNDED: "Funds returned to sender",
        TransferState.CANCELLED: "Transfer cancelled",
    }
    
    STATE_EMOJIS = {
        TransferState.INITIATED: "📝",
        TransferState.PENDING: "⏳",
        TransferState.RESERVED: "🔒",
        TransferState.IN_NETWORK: "🚀",
        TransferState.AT_DESTINATION: "🏦",
        TransferState.COMPLETED: "✅",
        TransferState.FAILED: "❌",
        TransferState.REFUNDED: "↩️",
        TransferState.CANCELLED: "🚫",
    }
    
    def __init__(self):
        self.transfers: Dict[str, TransferTracking] = {}
        self.http_client: Optional[httpx.AsyncClient] = None
        
        self.sms_gateway_url = os.getenv("SMS_GATEWAY_URL", "https://sms-gateway.example.com")
        self.whatsapp_api_url = os.getenv("WHATSAPP_API_URL", "https://graph.facebook.com/v17.0")
        self.whatsapp_phone_id = os.getenv("WHATSAPP_PHONE_ID", "")
        self.whatsapp_token = os.getenv("WHATSAPP_TOKEN", "")
        self.push_service_url = os.getenv("PUSH_SERVICE_URL", "https://fcm.googleapis.com/fcm/send")
        self.email_service_url = os.getenv("EMAIL_SERVICE_URL", "https://api.sendgrid.com/v3/mail/send")
        
    async def initialize(self):
        self.http_client = httpx.AsyncClient(timeout=30.0)
        logger.info("Transfer tracker initialized")
        
    async def close(self):
        if self.http_client:
            await self.http_client.aclose()
    
    async def create_tracking(
        self,
        transfer_id: str,
        sender_id: str,
        recipient_id: str,
        amount: Decimal,
        source_currency: str,
        destination_currency: str,
        corridor: str,
        estimated_completion: datetime,
        sender_phone: Optional[str] = None,
        recipient_phone: Optional[str] = None,
        sender_email: Optional[str] = None,
        recipient_email: Optional[str] = None,
        notification_preferences: Optional[Dict[str, List[NotificationChannel]]] = None
    ) -> TransferTracking:
        """Create tracking for a new transfer."""
        
        initial_event = TrackingEvent(
            event_id=str(uuid4()),
            transfer_id=transfer_id,
            state=TransferState.INITIATED,
            timestamp=datetime.utcnow(),
            description=self.STATE_DESCRIPTIONS[TransferState.INITIATED],
            corridor=corridor
        )
        
        if notification_preferences is None:
            notification_preferences = {
                "sender": [NotificationChannel.SMS, NotificationChannel.PUSH],
                "recipient": [NotificationChannel.SMS]
            }
        
        tracking = TransferTracking(
            transfer_id=transfer_id,
            sender_id=sender_id,
            recipient_id=recipient_id,
            amount=amount,
            source_currency=source_currency,
            destination_currency=destination_currency,
            current_state=TransferState.INITIATED,
            events=[initial_event],
            estimated_completion=estimated_completion,
            corridor=corridor,
            sender_phone=sender_phone,
            recipient_phone=recipient_phone,
            sender_email=sender_email,
            recipient_email=recipient_email,
            notification_preferences=notification_preferences
        )
        
        self.transfers[transfer_id] = tracking
        
        await self._send_notifications(
            tracking=tracking,
            event=initial_event,
            notify_sender=True,
            notify_recipient=False
        )
        
        metrics.increment("transfers_tracked")
        return tracking
    
    async def update_state(
        self,
        transfer_id: str,
        new_state: TransferState,
        description: Optional[str] = None,
        location: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> TransferTracking:
        """Update transfer state and send notifications."""
        
        tracking = self.transfers.get(transfer_id)
        if not tracking:
            raise ValueError(f"Transfer {transfer_id} not found")
        
        event = TrackingEvent(
            event_id=str(uuid4()),
            transfer_id=transfer_id,
            state=new_state,
            timestamp=datetime.utcnow(),
            description=description or self.STATE_DESCRIPTIONS.get(new_state, str(new_state)),
            location=location,
            corridor=tracking.corridor,
            metadata=metadata or {}
        )
        
        tracking.events.append(event)
        tracking.current_state = new_state
        
        if new_state == TransferState.COMPLETED:
            tracking.actual_completion = datetime.utcnow()
        
        notify_recipient = new_state in [
            TransferState.AT_DESTINATION,
            TransferState.COMPLETED,
            TransferState.FAILED
        ]
        
        await self._send_notifications(
            tracking=tracking,
            event=event,
            notify_sender=True,
            notify_recipient=notify_recipient
        )
        
        metrics.increment(f"state_updates_{new_state.value.lower()}")
        return tracking
    
    async def get_tracking(self, transfer_id: str) -> Optional[TransferTracking]:
        """Get tracking information for a transfer."""
        return self.transfers.get(transfer_id)
    
    async def get_tracking_history(self, transfer_id: str) -> List[TrackingEvent]:
        """Get full tracking history for a transfer."""
        tracking = self.transfers.get(transfer_id)
        if not tracking:
            return []
        return tracking.events
    
    async def get_tracking_summary(self, transfer_id: str) -> Dict[str, Any]:
        """Get human-readable tracking summary."""
        tracking = self.transfers.get(transfer_id)
        if not tracking:
            return {"error": "Transfer not found"}
        
        progress_percent = self._calculate_progress(tracking.current_state)
        
        return {
            "transfer_id": transfer_id,
            "amount": float(tracking.amount),
            "source_currency": tracking.source_currency,
            "destination_currency": tracking.destination_currency,
            "current_state": tracking.current_state.value,
            "state_description": self.STATE_DESCRIPTIONS.get(tracking.current_state),
            "state_emoji": self.STATE_EMOJIS.get(tracking.current_state),
            "progress_percent": progress_percent,
            "corridor": tracking.corridor,
            "estimated_completion": tracking.estimated_completion.isoformat() if tracking.estimated_completion else None,
            "actual_completion": tracking.actual_completion.isoformat() if tracking.actual_completion else None,
            "event_count": len(tracking.events),
            "last_update": tracking.events[-1].timestamp.isoformat() if tracking.events else None,
            "timeline": [
                {
                    "state": event.state.value,
                    "description": event.description,
                    "timestamp": event.timestamp.isoformat(),
                    "emoji": self.STATE_EMOJIS.get(event.state)
                }
                for event in tracking.events
            ]
        }
    
    async def _send_notifications(
        self,
        tracking: TransferTracking,
        event: TrackingEvent,
        notify_sender: bool,
        notify_recipient: bool
    ):
        """Send notifications to sender and/or recipient."""
        
        tasks = []
        
        if notify_sender:
            sender_channels = tracking.notification_preferences.get("sender", [])
            for channel in sender_channels:
                if channel == NotificationChannel.SMS and tracking.sender_phone:
                    tasks.append(self._send_sms(
                        phone=tracking.sender_phone,
                        message=self._format_sender_message(tracking, event)
                    ))
                elif channel == NotificationChannel.WHATSAPP and tracking.sender_phone:
                    tasks.append(self._send_whatsapp(
                        phone=tracking.sender_phone,
                        message=self._format_sender_message(tracking, event)
                    ))
                elif channel == NotificationChannel.EMAIL and tracking.sender_email:
                    tasks.append(self._send_email(
                        email=tracking.sender_email,
                        subject=f"Transfer Update: {event.state.value}",
                        body=self._format_sender_message(tracking, event)
                    ))
        
        if notify_recipient:
            recipient_channels = tracking.notification_preferences.get("recipient", [])
            for channel in recipient_channels:
                if channel == NotificationChannel.SMS and tracking.recipient_phone:
                    tasks.append(self._send_sms(
                        phone=tracking.recipient_phone,
                        message=self._format_recipient_message(tracking, event)
                    ))
                elif channel == NotificationChannel.WHATSAPP and tracking.recipient_phone:
                    tasks.append(self._send_whatsapp(
                        phone=tracking.recipient_phone,
                        message=self._format_recipient_message(tracking, event)
                    ))
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    async def _send_sms(self, phone: str, message: str) -> bool:
        """Send SMS notification."""
        try:
            response = await self.http_client.post(
                f"{self.sms_gateway_url}/send",
                json={
                    "to": phone,
                    "message": message,
                    "sender_id": "REMIT"
                }
            )
            success = response.status_code == 200
            if success:
                metrics.increment("sms_sent")
            return success
        except Exception as e:
            logger.error(f"SMS send failed: {e}")
            return False
    
    async def _send_whatsapp(self, phone: str, message: str) -> bool:
        """Send WhatsApp notification."""
        try:
            response = await self.http_client.post(
                f"{self.whatsapp_api_url}/{self.whatsapp_phone_id}/messages",
                headers={"Authorization": f"Bearer {self.whatsapp_token}"},
                json={
                    "messaging_product": "whatsapp",
                    "to": phone,
                    "type": "text",
                    "text": {"body": message}
                }
            )
            success = response.status_code == 200
            if success:
                metrics.increment("whatsapp_sent")
            return success
        except Exception as e:
            logger.error(f"WhatsApp send failed: {e}")
            return False
    
    async def _send_email(self, email: str, subject: str, body: str) -> bool:
        """Send email notification."""
        try:
            response = await self.http_client.post(
                self.email_service_url,
                headers={"Authorization": f"Bearer {os.getenv('SENDGRID_API_KEY', '')}"},
                json={
                    "personalizations": [{"to": [{"email": email}]}],
                    "from": {"email": "transfers@remittance.com"},
                    "subject": subject,
                    "content": [{"type": "text/plain", "value": body}]
                }
            )
            success = response.status_code in (200, 202)
            if success:
                metrics.increment("email_sent")
            return success
        except Exception as e:
            logger.error(f"Email send failed: {e}")
            return False
    
    def _format_sender_message(self, tracking: TransferTracking, event: TrackingEvent) -> str:
        """Format notification message for sender."""
        emoji = self.STATE_EMOJIS.get(event.state, "")
        
        if event.state == TransferState.INITIATED:
            return f"{emoji} Your transfer of {tracking.amount} {tracking.source_currency} has been initiated. Track: {tracking.transfer_id[:8]}"
        elif event.state == TransferState.RESERVED:
            return f"{emoji} Funds reserved. Your transfer is being processed."
        elif event.state == TransferState.IN_NETWORK:
            return f"{emoji} Your transfer is now in the {tracking.corridor} network."
        elif event.state == TransferState.AT_DESTINATION:
            return f"{emoji} Your transfer has arrived at the recipient's bank."
        elif event.state == TransferState.COMPLETED:
            return f"{emoji} Success! Your transfer of {tracking.amount} {tracking.source_currency} has been delivered."
        elif event.state == TransferState.FAILED:
            return f"{emoji} Your transfer could not be completed. Funds will be refunded."
        elif event.state == TransferState.REFUNDED:
            return f"{emoji} Your funds have been refunded to your account."
        else:
            return f"{emoji} Transfer update: {event.description}"
    
    def _format_recipient_message(self, tracking: TransferTracking, event: TrackingEvent) -> str:
        """Format notification message for recipient."""
        emoji = self.STATE_EMOJIS.get(event.state, "")
        
        if event.state == TransferState.AT_DESTINATION:
            return f"{emoji} You have a pending transfer of {tracking.amount} {tracking.destination_currency}. It will be credited shortly."
        elif event.state == TransferState.COMPLETED:
            return f"{emoji} You have received {tracking.amount} {tracking.destination_currency}!"
        elif event.state == TransferState.FAILED:
            return f"{emoji} A transfer to you could not be completed. Please contact the sender."
        else:
            return f"{emoji} Transfer update: {event.description}"
    
    def _calculate_progress(self, state: TransferState) -> int:
        """Calculate progress percentage based on state."""
        progress_map = {
            TransferState.INITIATED: 10,
            TransferState.PENDING: 20,
            TransferState.RESERVED: 30,
            TransferState.IN_NETWORK: 60,
            TransferState.AT_DESTINATION: 80,
            TransferState.COMPLETED: 100,
            TransferState.FAILED: 0,
            TransferState.REFUNDED: 100,
            TransferState.CANCELLED: 0,
        }
        return progress_map.get(state, 0)


def get_transfer_tracker() -> TransferTracker:
    """Factory function to get transfer tracker instance."""
    return TransferTracker()
