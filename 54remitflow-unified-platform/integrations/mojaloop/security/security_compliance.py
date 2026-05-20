"""
Security and Compliance Module for Mojaloop
Implements authentication, authorization, encryption, and audit logging
"""

import hashlib
import hmac
import jwt
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from enum import Enum
import secrets
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
import json

logger = logging.getLogger(__name__)


class UserRole(Enum):
    """User roles for authorization"""
    ADMIN = "ADMIN"
    OPERATOR = "OPERATOR"
    VIEWER = "VIEWER"
    PARTICIPANT = "PARTICIPANT"


class Permission(Enum):
    """System permissions"""
    CREATE_PARTICIPANT = "create_participant"
    VIEW_PARTICIPANT = "view_participant"
    CREATE_QUOTE = "create_quote"
    VIEW_QUOTE = "view_quote"
    CREATE_TRANSFER = "create_transfer"
    VIEW_TRANSFER = "view_transfer"
    FULFILL_TRANSFER = "fulfill_transfer"
    ABORT_TRANSFER = "abort_transfer"
    VIEW_SETTLEMENT = "view_settlement"
    PROCESS_SETTLEMENT = "process_settlement"
    VIEW_AUDIT_LOG = "view_audit_log"
    MANAGE_SYSTEM = "manage_system"


# Role-Permission mapping
ROLE_PERMISSIONS = {
    UserRole.ADMIN: [p for p in Permission],  # All permissions
    UserRole.OPERATOR: [
        Permission.CREATE_PARTICIPANT,
        Permission.VIEW_PARTICIPANT,
        Permission.CREATE_QUOTE,
        Permission.VIEW_QUOTE,
        Permission.CREATE_TRANSFER,
        Permission.VIEW_TRANSFER,
        Permission.FULFILL_TRANSFER,
        Permission.ABORT_TRANSFER,
        Permission.VIEW_SETTLEMENT,
    ],
    UserRole.VIEWER: [
        Permission.VIEW_PARTICIPANT,
        Permission.VIEW_QUOTE,
        Permission.VIEW_TRANSFER,
        Permission.VIEW_SETTLEMENT,
    ],
    UserRole.PARTICIPANT: [
        Permission.CREATE_QUOTE,
        Permission.VIEW_QUOTE,
        Permission.CREATE_TRANSFER,
        Permission.VIEW_TRANSFER,
    ]
}


class JWTAuthenticator:
    """JWT-based authentication"""
    
    def __init__(self, secret_key: str, algorithm: str = 'HS256'):
        """Initialize JWT authenticator"""
        self.secret_key = secret_key
        self.algorithm = algorithm
        self.token_expiry = timedelta(hours=24)
    
    def generate_token(
        self,
        user_id: str,
        role: UserRole,
        participant_id: Optional[str] = None,
        additional_claims: Optional[Dict[str, Any]] = None
    ) -> str:
        """Generate JWT token"""
        payload = {
            'user_id': user_id,
            'role': role.value,
            'participant_id': participant_id,
            'iat': datetime.utcnow(),
            'exp': datetime.utcnow() + self.token_expiry,
            'jti': secrets.token_urlsafe(16)  # JWT ID for revocation
        }
        
        if additional_claims:
            payload.update(additional_claims)
        
        token = jwt.encode(payload, self.secret_key, algorithm=self.algorithm)
        
        logger.info(f"JWT token generated for user: {user_id}")
        return token
    
    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Verify and decode JWT token"""
        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=[self.algorithm]
            )
            return payload
        except jwt.ExpiredSignatureError:
            logger.warning("JWT token expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning(f"Invalid JWT token: {e}")
            return None
    
    def refresh_token(self, token: str) -> Optional[str]:
        """Refresh JWT token"""
        payload = self.verify_token(token)
        if not payload:
            return None
        
        # Generate new token with same claims
        return self.generate_token(
            user_id=payload['user_id'],
            role=UserRole(payload['role']),
            participant_id=payload.get('participant_id'),
            additional_claims={k: v for k, v in payload.items() 
                             if k not in ['iat', 'exp', 'jti']}
        )


class Authorizer:
    """Role-based access control"""
    
    def __init__(self):
        """Initialize authorizer"""
        self.role_permissions = ROLE_PERMISSIONS
    
    def check_permission(
        self,
        user_role: UserRole,
        required_permission: Permission
    ) -> bool:
        """Check if role has permission"""
        permissions = self.role_permissions.get(user_role, [])
        return required_permission in permissions
    
    def require_permission(
        self,
        user_role: UserRole,
        required_permission: Permission
    ):
        """Require permission or raise exception"""
        if not self.check_permission(user_role, required_permission):
            raise PermissionDeniedError(
                f"Role {user_role.value} does not have permission {required_permission.value}"
            )
    
    def get_user_permissions(self, user_role: UserRole) -> List[Permission]:
        """Get all permissions for a role"""
        return self.role_permissions.get(user_role, [])


class PermissionDeniedError(Exception):
    """Raised when permission is denied"""
    pass


class DataEncryption:
    """Data encryption and decryption"""
    
    def __init__(self, master_key: Optional[bytes] = None):
        """Initialize encryption"""
        if master_key is None:
            master_key = Fernet.generate_key()
        
        self.cipher = Fernet(master_key)
        self.master_key = master_key
    
    def encrypt(self, data: str) -> str:
        """Encrypt data"""
        encrypted = self.cipher.encrypt(data.encode())
        return base64.b64encode(encrypted).decode()
    
    def decrypt(self, encrypted_data: str) -> str:
        """Decrypt data"""
        encrypted = base64.b64decode(encrypted_data.encode())
        decrypted = self.cipher.decrypt(encrypted)
        return decrypted.decode()
    
    def encrypt_dict(self, data: Dict[str, Any]) -> str:
        """Encrypt dictionary"""
        json_data = json.dumps(data)
        return self.encrypt(json_data)
    
    def decrypt_dict(self, encrypted_data: str) -> Dict[str, Any]:
        """Decrypt to dictionary"""
        json_data = self.decrypt(encrypted_data)
        return json.loads(json_data)


class SignatureVerifier:
    """HMAC signature verification for API requests"""
    
    def __init__(self, secret_key: str):
        """Initialize signature verifier"""
        self.secret_key = secret_key.encode()
    
    def generate_signature(
        self,
        method: str,
        path: str,
        body: str,
        timestamp: str
    ) -> str:
        """Generate HMAC signature"""
        message = f"{method}|{path}|{body}|{timestamp}"
        signature = hmac.new(
            self.secret_key,
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    def verify_signature(
        self,
        method: str,
        path: str,
        body: str,
        timestamp: str,
        provided_signature: str
    ) -> bool:
        """Verify HMAC signature"""
        expected_signature = self.generate_signature(method, path, body, timestamp)
        return hmac.compare_digest(expected_signature, provided_signature)
    
    def verify_request(
        self,
        method: str,
        path: str,
        body: str,
        headers: Dict[str, str],
        max_age_seconds: int = 300
    ) -> bool:
        """Verify API request signature and timestamp"""
        timestamp = headers.get('X-Timestamp')
        signature = headers.get('X-Signature')
        
        if not timestamp or not signature:
            logger.warning("Missing timestamp or signature in request")
            return False
        
        # Check timestamp freshness
        try:
            request_time = datetime.fromisoformat(timestamp)
            age = (datetime.utcnow() - request_time).total_seconds()
            
            if age > max_age_seconds:
                logger.warning(f"Request timestamp too old: {age}s")
                return False
        except ValueError:
            logger.warning("Invalid timestamp format")
            return False
        
        # Verify signature
        return self.verify_signature(method, path, body, timestamp, signature)


class AuditLogger:
    """Audit logging for compliance"""
    
    def __init__(self, db_integration):
        """Initialize audit logger"""
        self.db = db_integration
    
    def log_action(
        self,
        entity_type: str,
        entity_id: str,
        action: str,
        actor: str,
        details: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ):
        """Log audit trail entry"""
        try:
            self.db._log_audit_trail(
                entity_type=entity_type,
                entity_id=entity_id,
                action=action,
                details=details or {}
            )
            
            logger.info(
                f"Audit log: {actor} performed {action} on {entity_type} {entity_id}"
            )
        except Exception as e:
            logger.error(f"Failed to log audit entry: {e}")
    
    def log_quote_created(self, quote_id: str, actor: str, quote_data: Dict[str, Any]):
        """Log quote creation"""
        self.log_action(
            entity_type='quote',
            entity_id=quote_id,
            action='created',
            actor=actor,
            details=quote_data
        )
    
    def log_transfer_state_change(
        self,
        transfer_id: str,
        actor: str,
        old_state: str,
        new_state: str
    ):
        """Log transfer state change"""
        self.log_action(
            entity_type='transfer',
            entity_id=transfer_id,
            action=f'state_changed_{old_state}_to_{new_state}',
            actor=actor,
            details={'old_state': old_state, 'new_state': new_state}
        )


class ComplianceChecker:
    """Compliance checks for transactions"""
    
    def __init__(self):
        """Initialize compliance checker"""
        self.transaction_limits = {
            'INR': {'max': 100000.00, 'daily_max': 1000000.00},
            'NGN': {'max': 500000.00, 'daily_max': 5000000.00},
            'USD': {'max': 10000.00, 'daily_max': 100000.00},
        }
        
        self.sanctioned_countries = ['KP', 'IR', 'SY']  # Example
        self.high_risk_countries = ['AF', 'IQ', 'LY']  # Example
    
    def check_transaction_limit(
        self,
        amount: float,
        currency: str,
        daily_total: float = 0
    ) -> Dict[str, Any]:
        """Check if transaction is within limits"""
        limits = self.transaction_limits.get(currency, {'max': 10000.00, 'daily_max': 100000.00})
        
        if amount > limits['max']:
            return {
                'compliant': False,
                'reason': f'Amount exceeds single transaction limit: {limits["max"]} {currency}'
            }
        
        if daily_total + amount > limits['daily_max']:
            return {
                'compliant': False,
                'reason': f'Amount exceeds daily limit: {limits["daily_max"]} {currency}'
            }
        
        return {'compliant': True}
    
    def check_country_sanctions(self, country_code: str) -> Dict[str, Any]:
        """Check if country is sanctioned"""
        if country_code in self.sanctioned_countries:
            return {
                'compliant': False,
                'reason': f'Country {country_code} is sanctioned',
                'requires_review': True
            }
        
        if country_code in self.high_risk_countries:
            return {
                'compliant': True,
                'reason': f'Country {country_code} is high-risk',
                'requires_review': True
            }
        
        return {'compliant': True, 'requires_review': False}
    
    def check_aml_kyc(self, participant_id: str) -> Dict[str, Any]:
        """Check AML/KYC compliance"""
        # In production, would check against KYC database
        return {
            'compliant': True,
            'kyc_verified': True,
            'aml_risk_score': 'LOW'
        }


class SecurityManager:
    """Central security manager"""
    
    def __init__(
        self,
        jwt_secret: str,
        encryption_key: Optional[bytes] = None,
        signature_secret: str = None,
        db_integration = None
    ):
        """Initialize security manager"""
        self.authenticator = JWTAuthenticator(jwt_secret)
        self.authorizer = Authorizer()
        self.encryption = DataEncryption(encryption_key)
        self.signature_verifier = SignatureVerifier(signature_secret or jwt_secret)
        self.audit_logger = AuditLogger(db_integration) if db_integration else None
        self.compliance_checker = ComplianceChecker()
    
    def authenticate_request(self, token: str) -> Optional[Dict[str, Any]]:
        """Authenticate API request"""
        return self.authenticator.verify_token(token)
    
    def authorize_action(self, user_role: UserRole, permission: Permission):
        """Authorize action"""
        self.authorizer.require_permission(user_role, permission)
    
    def verify_request_signature(
        self,
        method: str,
        path: str,
        body: str,
        headers: Dict[str, str]
    ) -> bool:
        """Verify request signature"""
        return self.signature_verifier.verify_request(method, path, body, headers)
    
    def check_compliance(
        self,
        amount: float,
        currency: str,
        country_code: str,
        participant_id: str
    ) -> Dict[str, Any]:
        """Run all compliance checks"""
        results = {
            'compliant': True,
            'checks': {}
        }
        
        # Transaction limit check
        limit_check = self.compliance_checker.check_transaction_limit(amount, currency)
        results['checks']['transaction_limit'] = limit_check
        if not limit_check['compliant']:
            results['compliant'] = False
        
        # Country sanctions check
        sanctions_check = self.compliance_checker.check_country_sanctions(country_code)
        results['checks']['sanctions'] = sanctions_check
        if not sanctions_check['compliant']:
            results['compliant'] = False
        
        # AML/KYC check
        kyc_check = self.compliance_checker.check_aml_kyc(participant_id)
        results['checks']['kyc'] = kyc_check
        if not kyc_check['compliant']:
            results['compliant'] = False
        
        return results


# Example usage
if __name__ == '__main__':
    # Initialize security manager
    security = SecurityManager(
        jwt_secret='your-secret-key-here',
        signature_secret='your-signature-secret-here'
    )
    
    # Generate token
    token = security.authenticator.generate_token(
        user_id='user123',
        role=UserRole.OPERATOR,
        participant_id='upi-india'
    )
    print(f"Token generated: {token[:50]}...")
    
    # Verify token
    payload = security.authenticate_request(token)
    print(f"Token verified: {payload}")
    
    # Check authorization
    try:
        security.authorize_action(UserRole.OPERATOR, Permission.CREATE_QUOTE)
        print("Authorization: GRANTED")
    except PermissionDeniedError as e:
        print(f"Authorization: DENIED - {e}")
    
    # Check compliance
    compliance = security.check_compliance(
        amount=50000.00,
        currency='INR',
        country_code='NG',
        participant_id='papss-nigeria'
    )
    print(f"Compliance check: {compliance}")

