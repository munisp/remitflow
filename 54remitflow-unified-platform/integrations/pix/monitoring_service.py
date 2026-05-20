"""
Monitoring Service for Failed Login Attempts
Tracks, analyzes, and alerts on suspicious authentication activity
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from collections import defaultdict
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests
import json

from .models_audit_log import AuditLog, EventType, SeverityLevel
from .models_auth import User
from .config import settings

logger = logging.getLogger(__name__)


class MonitoringMetrics:
    """In-memory metrics storage for Prometheus-style monitoring"""
    
    def __init__(self):
        self.failed_login_count = 0
        self.successful_login_count = 0
        self.locked_accounts_count = 0
        self.suspicious_ips = set()
        self.failed_attempts_by_ip = defaultdict(int)
        self.failed_attempts_by_username = defaultdict(int)
        self.last_reset = datetime.utcnow()
    
    def reset_hourly_metrics(self):
        """Reset metrics every hour"""
        if datetime.utcnow() - self.last_reset > timedelta(hours=1):
            self.failed_attempts_by_ip.clear()
            self.failed_attempts_by_username.clear()
            self.last_reset = datetime.utcnow()
            logger.info("Hourly metrics reset completed")
    
    def record_failed_login(self, username: str, ip_address: str):
        """Record a failed login attempt"""
        self.failed_login_count += 1
        self.failed_attempts_by_ip[ip_address] += 1
        self.failed_attempts_by_username[username] += 1
        self.reset_hourly_metrics()
    
    def record_successful_login(self):
        """Record a successful login"""
        self.successful_login_count += 1
    
    def record_account_locked(self):
        """Record an account lock event"""
        self.locked_accounts_count += 1
    
    def mark_ip_suspicious(self, ip_address: str):
        """Mark an IP as suspicious"""
        self.suspicious_ips.add(ip_address)
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get current metrics"""
        return {
            "failed_login_count": self.failed_login_count,
            "successful_login_count": self.successful_login_count,
            "locked_accounts_count": self.locked_accounts_count,
            "suspicious_ips_count": len(self.suspicious_ips),
            "failed_attempts_by_ip": dict(self.failed_attempts_by_ip),
            "failed_attempts_by_username": dict(self.failed_attempts_by_username),
            "last_reset": self.last_reset.isoformat()
        }


# Global metrics instance
metrics = MonitoringMetrics()


class AlertThresholds:
    """Configurable alert thresholds"""
    
    # Failed login thresholds
    FAILED_LOGINS_PER_IP_HOUR = 10  # Alert if IP has 10+ failed logins in 1 hour
    FAILED_LOGINS_PER_USERNAME_HOUR = 5  # Alert if username has 5+ failed logins in 1 hour
    FAILED_LOGINS_TOTAL_HOUR = 50  # Alert if total failed logins exceed 50 in 1 hour
    
    # Account lock thresholds
    LOCKED_ACCOUNTS_HOUR = 5  # Alert if 5+ accounts locked in 1 hour
    
    # Suspicious pattern thresholds
    UNIQUE_USERNAMES_PER_IP = 5  # Alert if IP tries 5+ different usernames
    DISTRIBUTED_ATTACK_IPS = 10  # Alert if 10+ IPs target same username


class MonitoringService:
    """Service for monitoring and alerting on failed login attempts"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def record_failed_login(self, username: str, ip_address: str, user_agent: str, reason: str):
        """
        Record a failed login attempt and check for suspicious activity
        """
        # Update metrics
        metrics.record_failed_login(username, ip_address)
        
        # Check for suspicious patterns
        self._check_ip_threshold(ip_address)
        self._check_username_threshold(username)
        self._check_distributed_attack(username)
        self._check_credential_stuffing(ip_address)
        
        logger.info(f"Failed login recorded: username={username}, ip={ip_address}, reason={reason}")
    
    def record_successful_login(self, username: str, ip_address: str):
        """Record a successful login"""
        metrics.record_successful_login()
        logger.info(f"Successful login recorded: username={username}, ip={ip_address}")
    
    def record_account_locked(self, username: str, ip_address: str):
        """Record an account lock event"""
        metrics.record_account_locked()
        
        # Check if too many accounts are being locked
        self._check_account_lock_threshold()
        
        # Send alert
        self._send_alert(
            alert_type="account_locked",
            subject=f"Account Locked: {username}",
            message=f"Account '{username}' has been locked due to multiple failed login attempts from IP {ip_address}.",
            severity="warning",
            context={"username": username, "ip_address": ip_address}
        )
        
        logger.warning(f"Account locked: username={username}, ip={ip_address}")
    
    def _check_ip_threshold(self, ip_address: str):
        """Check if IP has exceeded failed login threshold"""
        count = metrics.failed_attempts_by_ip[ip_address]
        
        if count >= AlertThresholds.FAILED_LOGINS_PER_IP_HOUR:
            metrics.mark_ip_suspicious(ip_address)
            
            self._send_alert(
                alert_type="ip_threshold_exceeded",
                subject=f"Suspicious Activity: IP {ip_address}",
                message=f"IP address {ip_address} has {count} failed login attempts in the last hour.",
                severity="critical",
                context={"ip_address": ip_address, "failed_attempts": count}
            )
            
            logger.critical(f"IP threshold exceeded: {ip_address} ({count} attempts)")
    
    def _check_username_threshold(self, username: str):
        """Check if username has exceeded failed login threshold"""
        count = metrics.failed_attempts_by_username[username]
        
        if count >= AlertThresholds.FAILED_LOGINS_PER_USERNAME_HOUR:
            self._send_alert(
                alert_type="username_threshold_exceeded",
                subject=f"Account Under Attack: {username}",
                message=f"Username '{username}' has {count} failed login attempts in the last hour. Possible brute force attack.",
                severity="critical",
                context={"username": username, "failed_attempts": count}
            )
            
            logger.critical(f"Username threshold exceeded: {username} ({count} attempts)")
    
    def _check_account_lock_threshold(self):
        """Check if too many accounts are being locked"""
        count = metrics.locked_accounts_count
        
        if count >= AlertThresholds.LOCKED_ACCOUNTS_HOUR:
            self._send_alert(
                alert_type="mass_account_lockout",
                subject="Mass Account Lockout Detected",
                message=f"{count} accounts have been locked in the last hour. Possible coordinated attack.",
                severity="critical",
                context={"locked_accounts": count}
            )
            
            logger.critical(f"Mass account lockout detected: {count} accounts locked")
    
    def _check_distributed_attack(self, username: str):
        """Check if username is being targeted from multiple IPs (distributed attack)"""
        one_hour_ago = datetime.utcnow() - timedelta(hours=1)
        
        # Count unique IPs targeting this username
        unique_ips = self.db.query(func.count(func.distinct(AuditLog.ip_address))).filter(
            and_(
                AuditLog.username == username,
                AuditLog.event_type == EventType.LOGIN_FAILED,
                AuditLog.created_at >= one_hour_ago
            )
        ).scalar()
        
        if unique_ips >= AlertThresholds.DISTRIBUTED_ATTACK_IPS:
            self._send_alert(
                alert_type="distributed_attack",
                subject=f"Distributed Attack Detected: {username}",
                message=f"Username '{username}' is being targeted from {unique_ips} different IP addresses. Possible distributed brute force attack.",
                severity="critical",
                context={"username": username, "unique_ips": unique_ips}
            )
            
            logger.critical(f"Distributed attack detected: {username} targeted from {unique_ips} IPs")
    
    def _check_credential_stuffing(self, ip_address: str):
        """Check if IP is trying multiple usernames (credential stuffing)"""
        one_hour_ago = datetime.utcnow() - timedelta(hours=1)
        
        # Count unique usernames tried from this IP
        unique_usernames = self.db.query(func.count(func.distinct(AuditLog.username))).filter(
            and_(
                AuditLog.ip_address == ip_address,
                AuditLog.event_type == EventType.LOGIN_FAILED,
                AuditLog.created_at >= one_hour_ago
            )
        ).scalar()
        
        if unique_usernames >= AlertThresholds.UNIQUE_USERNAMES_PER_IP:
            metrics.mark_ip_suspicious(ip_address)
            
            self._send_alert(
                alert_type="credential_stuffing",
                subject=f"Credential Stuffing Detected: IP {ip_address}",
                message=f"IP {ip_address} has attempted to login with {unique_usernames} different usernames. Possible credential stuffing attack.",
                severity="critical",
                context={"ip_address": ip_address, "unique_usernames": unique_usernames}
            )
            
            logger.critical(f"Credential stuffing detected: IP {ip_address} tried {unique_usernames} usernames")
    
    def _send_alert(self, alert_type: str, subject: str, message: str, severity: str, context: Dict[str, Any]):
        """
        Send alert via email and webhook
        """
        # Send email alert
        if hasattr(settings, 'ALERT_EMAIL_ENABLED') and settings.ALERT_EMAIL_ENABLED:
            self._send_email_alert(subject, message, severity, context)
        
        # Send webhook alert
        if hasattr(settings, 'ALERT_WEBHOOK_URL') and settings.ALERT_WEBHOOK_URL:
            self._send_webhook_alert(alert_type, subject, message, severity, context)
        
        # Log alert
        logger.warning(f"Alert sent: {alert_type} - {subject}")
    
    def _send_email_alert(self, subject: str, message: str, severity: str, context: Dict[str, Any]):
        """Send email alert"""
        try:
            if not hasattr(settings, 'SMTP_HOST') or not settings.SMTP_HOST:
                logger.warning("SMTP not configured, skipping email alert")
                return
            
            msg = MIMEMultipart('alternative')
            msg['Subject'] = f"[{severity.upper()}] {subject}"
            msg['From'] = settings.SMTP_FROM_EMAIL
            msg['To'] = settings.ALERT_EMAIL_TO
            
            # Create HTML email
            html = f"""
            <html>
              <body>
                <h2 style="color: {'red' if severity == 'critical' else 'orange'};">{subject}</h2>
                <p>{message}</p>
                <h3>Details:</h3>
                <ul>
                  {''.join(f'<li><strong>{k}:</strong> {v}</li>' for k, v in context.items())}
                </ul>
                <p><em>Timestamp: {datetime.utcnow().isoformat()}</em></p>
              </body>
            </html>
            """
            
            msg.attach(MIMEText(html, 'html'))
            
            # Send email
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                if settings.SMTP_USE_TLS:
                    server.starttls()
                if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)
            
            logger.info(f"Email alert sent: {subject}")
        
        except Exception as e:
            logger.error(f"Failed to send email alert: {e}")
    
    def _send_webhook_alert(self, alert_type: str, subject: str, message: str, severity: str, context: Dict[str, Any]):
        """Send webhook alert (Slack, Discord, PagerDuty, etc.)"""
        try:
            payload = {
                "alert_type": alert_type,
                "subject": subject,
                "message": message,
                "severity": severity,
                "context": context,
                "timestamp": datetime.utcnow().isoformat(),
                "service": "PIX Integration Service"
            }
            
            response = requests.post(
                settings.ALERT_WEBHOOK_URL,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=5
            )
            
            if response.status_code == 200:
                logger.info(f"Webhook alert sent: {subject}")
            else:
                logger.error(f"Webhook alert failed: {response.status_code}")
        
        except Exception as e:
            logger.error(f"Failed to send webhook alert: {e}")
    
    def get_failed_login_stats(self, hours: int = 24) -> Dict[str, Any]:
        """Get failed login statistics for the last N hours"""
        start_time = datetime.utcnow() - timedelta(hours=hours)
        
        # Total failed logins
        total_failed = self.db.query(func.count(AuditLog.id)).filter(
            and_(
                AuditLog.event_type == EventType.LOGIN_FAILED,
                AuditLog.created_at >= start_time
            )
        ).scalar()
        
        # Failed logins by IP
        failed_by_ip = self.db.query(
            AuditLog.ip_address,
            func.count(AuditLog.id).label('count')
        ).filter(
            and_(
                AuditLog.event_type == EventType.LOGIN_FAILED,
                AuditLog.created_at >= start_time
            )
        ).group_by(AuditLog.ip_address).order_by(func.count(AuditLog.id).desc()).limit(10).all()
        
        # Failed logins by username
        failed_by_username = self.db.query(
            AuditLog.username,
            func.count(AuditLog.id).label('count')
        ).filter(
            and_(
                AuditLog.event_type == EventType.LOGIN_FAILED,
                AuditLog.created_at >= start_time
            )
        ).group_by(AuditLog.username).order_by(func.count(AuditLog.id).desc()).limit(10).all()
        
        # Locked accounts
        locked_accounts = self.db.query(func.count(AuditLog.id)).filter(
            and_(
                AuditLog.event_type == EventType.ACCOUNT_LOCKED,
                AuditLog.created_at >= start_time
            )
        ).scalar()
        
        return {
            "period_hours": hours,
            "total_failed_logins": total_failed,
            "locked_accounts": locked_accounts,
            "top_ips": [{"ip": ip, "count": count} for ip, count in failed_by_ip],
            "top_usernames": [{"username": username, "count": count} for username, count in failed_by_username],
            "current_metrics": metrics.get_metrics()
        }
    
    def get_suspicious_ips(self, hours: int = 24) -> List[Dict[str, Any]]:
        """Get list of suspicious IP addresses"""
        start_time = datetime.utcnow() - timedelta(hours=hours)
        
        suspicious = self.db.query(
            AuditLog.ip_address,
            func.count(AuditLog.id).label('failed_attempts'),
            func.count(func.distinct(AuditLog.username)).label('unique_usernames'),
            func.max(AuditLog.created_at).label('last_attempt')
        ).filter(
            and_(
                AuditLog.event_type == EventType.LOGIN_FAILED,
                AuditLog.created_at >= start_time
            )
        ).group_by(AuditLog.ip_address).having(
            or_(
                func.count(AuditLog.id) >= AlertThresholds.FAILED_LOGINS_PER_IP_HOUR,
                func.count(func.distinct(AuditLog.username)) >= AlertThresholds.UNIQUE_USERNAMES_PER_IP
            )
        ).order_by(func.count(AuditLog.id).desc()).all()
        
        return [
            {
                "ip_address": ip,
                "failed_attempts": attempts,
                "unique_usernames": usernames,
                "last_attempt": last.isoformat(),
                "risk_level": "critical" if attempts >= 20 or usernames >= 10 else "high"
            }
            for ip, attempts, usernames, last in suspicious
        ]
    
    def get_targeted_accounts(self, hours: int = 24) -> List[Dict[str, Any]]:
        """Get list of accounts under attack"""
        start_time = datetime.utcnow() - timedelta(hours=hours)
        
        targeted = self.db.query(
            AuditLog.username,
            func.count(AuditLog.id).label('failed_attempts'),
            func.count(func.distinct(AuditLog.ip_address)).label('unique_ips'),
            func.max(AuditLog.created_at).label('last_attempt')
        ).filter(
            and_(
                AuditLog.event_type == EventType.LOGIN_FAILED,
                AuditLog.created_at >= start_time
            )
        ).group_by(AuditLog.username).having(
            or_(
                func.count(AuditLog.id) >= AlertThresholds.FAILED_LOGINS_PER_USERNAME_HOUR,
                func.count(func.distinct(AuditLog.ip_address)) >= AlertThresholds.DISTRIBUTED_ATTACK_IPS
            )
        ).order_by(func.count(AuditLog.id).desc()).all()
        
        return [
            {
                "username": username,
                "failed_attempts": attempts,
                "unique_ips": ips,
                "last_attempt": last.isoformat(),
                "attack_type": "distributed" if ips >= AlertThresholds.DISTRIBUTED_ATTACK_IPS else "brute_force"
            }
            for username, attempts, ips, last in targeted
        ]


def get_monitoring_service(db: Session) -> MonitoringService:
    """Dependency injection for MonitoringService"""
    return MonitoringService(db)
