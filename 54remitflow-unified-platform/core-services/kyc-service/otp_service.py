"""
OTP Service - Redis-backed OTP generation, delivery, and verification

Supports:
- SMS delivery via Africa's Talking API
- Email delivery via SMTP (SendGrid, SES, or generic SMTP)
- Redis-backed code storage with TTL expiry
- Rate limiting per user/phone/email
- Audit logging of all OTP events
"""

import os
import random
import string
import hashlib
import hmac
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import Optional, Dict, Any

import httpx
import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/10")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

OTP_LENGTH = int(os.getenv("OTP_LENGTH", "6"))
OTP_TTL_SECONDS = int(os.getenv("OTP_TTL_SECONDS", "300"))
OTP_MAX_ATTEMPTS = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
OTP_RATE_LIMIT_SECONDS = int(os.getenv("OTP_RATE_LIMIT_SECONDS", "60"))

AT_API_KEY = os.getenv("AFRICASTALKING_API_KEY", "")
AT_USERNAME = os.getenv("AFRICASTALKING_USERNAME", "")
AT_SENDER_ID = os.getenv("AFRICASTALKING_SENDER_ID", "")
AT_API_URL = os.getenv("AFRICASTALKING_API_URL", "https://api.africastalking.com/version1/messaging")

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "noreply@remittance.com")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Remittance Platform")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send"

EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "smtp")


def _get_redis() -> redis.Redis:
    return redis.from_url(REDIS_URL, decode_responses=True)


def _generate_otp(length: int = OTP_LENGTH) -> str:
    return "".join(random.choices(string.digits, k=length))


def _hash_otp(otp: str, salt: str) -> str:
    return hashlib.sha256(f"{otp}:{salt}".encode()).hexdigest()


class OTPService:
    def __init__(self):
        self.redis = _get_redis()

    def _key(self, channel: str, identifier: str) -> str:
        return f"otp:{channel}:{identifier}"

    def _rate_key(self, channel: str, identifier: str) -> str:
        return f"otp_rate:{channel}:{identifier}"

    def _attempts_key(self, channel: str, identifier: str) -> str:
        return f"otp_attempts:{channel}:{identifier}"

    def generate(self, channel: str, identifier: str, user_id: str) -> Dict[str, Any]:
        rate_key = self._rate_key(channel, identifier)
        if self.redis.exists(rate_key):
            ttl = self.redis.ttl(rate_key)
            return {
                "sent": False,
                "error": "rate_limited",
                "message": f"Please wait {ttl} seconds before requesting a new code",
                "retry_after": ttl,
            }

        otp = _generate_otp()
        salt = os.urandom(16).hex()
        hashed = _hash_otp(otp, salt)

        key = self._key(channel, identifier)
        self.redis.hset(key, mapping={
            "hash": hashed,
            "salt": salt,
            "user_id": user_id,
            "created_at": datetime.utcnow().isoformat(),
        })
        self.redis.expire(key, OTP_TTL_SECONDS)

        self.redis.delete(self._attempts_key(channel, identifier))

        self.redis.set(rate_key, "1", ex=OTP_RATE_LIMIT_SECONDS)

        logger.info(
            "OTP generated",
            extra={"channel": channel, "identifier": identifier, "user_id": user_id},
        )

        return {"sent": True, "otp": otp, "expires_in": OTP_TTL_SECONDS}

    def verify(self, channel: str, identifier: str, otp: str) -> Dict[str, Any]:
        attempts_key = self._attempts_key(channel, identifier)
        attempts = int(self.redis.get(attempts_key) or 0)

        if attempts >= OTP_MAX_ATTEMPTS:
            key = self._key(channel, identifier)
            self.redis.delete(key)
            self.redis.delete(attempts_key)
            return {
                "verified": False,
                "error": "max_attempts",
                "message": "Maximum verification attempts exceeded. Request a new code.",
            }

        key = self._key(channel, identifier)
        data = self.redis.hgetall(key)

        if not data:
            return {
                "verified": False,
                "error": "expired_or_not_found",
                "message": "Code has expired or was not found. Request a new code.",
            }

        stored_hash = data["hash"]
        salt = data["salt"]
        computed_hash = _hash_otp(otp, salt)

        if not hmac.compare_digest(stored_hash, computed_hash):
            self.redis.incr(attempts_key)
            self.redis.expire(attempts_key, OTP_TTL_SECONDS)
            remaining = OTP_MAX_ATTEMPTS - attempts - 1
            return {
                "verified": False,
                "error": "invalid_code",
                "message": f"Invalid code. {remaining} attempts remaining.",
                "attempts_remaining": remaining,
            }

        self.redis.delete(key)
        self.redis.delete(attempts_key)

        logger.info(
            "OTP verified",
            extra={"channel": channel, "identifier": identifier, "user_id": data.get("user_id")},
        )

        return {"verified": True, "user_id": data.get("user_id")}


async def send_sms_otp(phone: str, otp: str) -> Dict[str, Any]:
    if ENVIRONMENT in ("development", "test") and not AT_API_KEY:
        logger.info(f"[DEV] SMS OTP for {phone}: {otp}")
        return {"delivered": True, "provider": "dev_log", "message_id": "dev"}

    if not AT_API_KEY or not AT_USERNAME:
        raise ValueError(
            "Africa's Talking credentials not configured. "
            "Set AFRICASTALKING_API_KEY and AFRICASTALKING_USERNAME."
        )

    message = f"Your verification code is: {otp}. It expires in {OTP_TTL_SECONDS // 60} minutes. Do not share this code."

    payload = {
        "username": AT_USERNAME,
        "to": phone,
        "message": message,
    }
    if AT_SENDER_ID:
        payload["from"] = AT_SENDER_ID

    headers = {
        "apiKey": AT_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(AT_API_URL, data=payload, headers=headers, timeout=15.0)
            response.raise_for_status()
            data = response.json()

            sms_data = data.get("SMSMessageData", {})
            recipients = sms_data.get("Recipients", [])
            if recipients:
                recipient = recipients[0]
                status_code = recipient.get("statusCode")
                if status_code in (100, 101):
                    return {
                        "delivered": True,
                        "provider": "africastalking",
                        "message_id": recipient.get("messageId"),
                        "cost": recipient.get("cost"),
                    }
                return {
                    "delivered": False,
                    "provider": "africastalking",
                    "error": recipient.get("status"),
                    "status_code": status_code,
                }
            return {"delivered": False, "provider": "africastalking", "error": "No recipients in response"}

        except httpx.HTTPError as e:
            logger.error(f"Africa's Talking SMS failed: {e}")
            raise


async def send_email_otp(email: str, otp: str) -> Dict[str, Any]:
    if ENVIRONMENT in ("development", "test") and not SMTP_HOST and not SENDGRID_API_KEY:
        logger.info(f"[DEV] Email OTP for {email}: {otp}")
        return {"delivered": True, "provider": "dev_log", "message_id": "dev"}

    subject = "Your Verification Code"
    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">Verification Code</h2>
        <p>Your verification code is:</p>
        <div style="background: #f0f0f0; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">{otp}</span>
        </div>
        <p style="color: #666;">This code expires in {OTP_TTL_SECONDS // 60} minutes. Do not share this code with anyone.</p>
        <p style="color: #999; font-size: 12px;">If you did not request this code, please ignore this email.</p>
    </div>
    """

    if EMAIL_PROVIDER == "sendgrid" and SENDGRID_API_KEY:
        return await _send_via_sendgrid(email, subject, html_body)
    elif SMTP_HOST:
        return await _send_via_smtp(email, subject, html_body)
    else:
        raise ValueError(
            "Email delivery not configured. Set SMTP_HOST or SENDGRID_API_KEY."
        )


async def _send_via_sendgrid(to_email: str, subject: str, html_body: str) -> Dict[str, Any]:
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": SMTP_FROM_EMAIL, "name": SMTP_FROM_NAME},
        "subject": subject,
        "content": [{"type": "text/html", "value": html_body}],
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                SENDGRID_API_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {SENDGRID_API_KEY}",
                    "Content-Type": "application/json",
                },
                timeout=15.0,
            )
            if response.status_code in (200, 202):
                message_id = response.headers.get("X-Message-Id", "")
                return {"delivered": True, "provider": "sendgrid", "message_id": message_id}
            return {
                "delivered": False,
                "provider": "sendgrid",
                "error": response.text,
                "status_code": response.status_code,
            }
        except httpx.HTTPError as e:
            logger.error(f"SendGrid email failed: {e}")
            raise


async def _send_via_smtp(to_email: str, subject: str, html_body: str) -> Dict[str, Any]:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    try:
        if SMTP_USE_TLS:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
            server.starttls()
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)

        if SMTP_USERNAME and SMTP_PASSWORD:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)

        server.sendmail(SMTP_FROM_EMAIL, [to_email], msg.as_string())
        server.quit()

        return {"delivered": True, "provider": "smtp", "message_id": msg["Message-ID"] or ""}
    except Exception as e:
        logger.error(f"SMTP email failed: {e}")
        raise
