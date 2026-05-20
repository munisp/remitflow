"""
3DS Authentication - Secure card authentication
"""

import logging
from typing import Dict
from datetime import datetime, timedelta
import uuid
import random

logger = logging.getLogger(__name__)


class ThreeDSAuthenticator:
    """3D Secure authentication manager"""
    
    def __init__(self):
        self.auth_sessions: Dict[str, Dict] = {}
        logger.info("3DS authenticator initialized")
    
    def initiate_authentication(
        self,
        card_id: str,
        amount: float,
        merchant: str
    ) -> Dict:
        """Initiate 3DS authentication"""
        
        session_id = str(uuid.uuid4())
        otp = "".join([str(random.randint(0, 9)) for _ in range(6)])
        
        session = {
            "session_id": session_id,
            "card_id": card_id,
            "amount": amount,
            "merchant": merchant,
            "otp": otp,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": (datetime.utcnow() + timedelta(minutes=5)).isoformat()
        }
        
        self.auth_sessions[session_id] = session
        logger.info(f"3DS session initiated: {session_id}")
        
        return {
            "session_id": session_id,
            "otp_sent": True,
            "expires_in": 300
        }
    
    def verify_authentication(self, session_id: str, otp: str) -> Dict:
        """Verify 3DS authentication"""
        
        session = self.auth_sessions.get(session_id)
        
        if not session:
            return {"success": False, "error": "Invalid session"}
        
        if datetime.fromisoformat(session["expires_at"]) < datetime.utcnow():
            return {"success": False, "error": "Session expired"}
        
        if session["otp"] == otp:
            session["status"] = "verified"
            logger.info(f"3DS verification successful: {session_id}")
            return {
                "success": True,
                "session_id": session_id,
                "verified": True
            }
        else:
            return {"success": False, "error": "Invalid OTP"}
    
    def get_session(self, session_id: str) -> Dict:
        """Get authentication session"""
        return self.auth_sessions.get(session_id)
