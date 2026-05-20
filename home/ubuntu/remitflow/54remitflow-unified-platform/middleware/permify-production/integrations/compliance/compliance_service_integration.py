"""
Compliance Service Integration with Permify Authorization
Integrates authorization checks into compliance operations
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

from service.authorization_service import AuthorizationService, get_authorization_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AMLCaseStatus(Enum):
    """AML case status"""
    OPEN = "open"
    INVESTIGATING = "investigating"
    ESCALATED = "escalated"
    SAR_FILED = "sar_filed"
    CLOSED = "closed"


class ComplianceServiceIntegration:
    """
    Compliance service with integrated authorization
    """
    
    def __init__(self, auth_service: Optional[AuthorizationService] = None):
        """
        Initialize compliance service integration
        
        Args:
            auth_service: Authorization service instance
        """
        self.auth_service = auth_service or get_authorization_service()
        logger.info("Compliance service integration initialized")
    
    async def create_aml_case(
        self,
        user_id: str,
        subject_user_id: str,
        reason: str,
        risk_indicators: List[str],
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create AML case
        
        Args:
            user_id: User creating the case (compliance officer)
            subject_user_id: Subject user ID
            reason: Reason for creating case
            risk_indicators: List of risk indicators
            metadata: Additional metadata
        
        Returns:
            AML case record
        """
        # Create AML case
        case_id = f"aml_{datetime.utcnow().timestamp()}"
        
        # Setup permissions
        await self.auth_service.assign_compliance_officer(user_id, case_id, "aml_case")
        
        await self.auth_service.client.create_relationship(
            entity_type="aml_case",
            entity_id=case_id,
            relation="subject",
            subject_type="user",
            subject_id=subject_user_id
        )
        
        logger.info(f"AML case created: case={case_id}, subject={subject_user_id}, officer={user_id}")
        
        return {
            "case_id": case_id,
            "subject_user_id": subject_user_id,
            "status": AMLCaseStatus.OPEN.value,
            "reason": reason,
            "risk_indicators": risk_indicators,
            "created_by": user_id,
            "created_at": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
    
    async def view_aml_case(
        self,
        user_id: str,
        case_id: str
    ) -> Dict[str, Any]:
        """
        View AML case with authorization check
        
        Args:
            user_id: User viewing the case
            case_id: AML case ID
        
        Returns:
            AML case data
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_view = await self.auth_service.can_view_aml_case(user_id, case_id)
        
        if not can_view:
            logger.warning(f"AML case view denied: user={user_id}, case={case_id}")
            raise PermissionError(f"User {user_id} cannot view AML case {case_id}")
        
        # Log authorized view
        logger.info(f"AML case viewed: user={user_id}, case={case_id}")
        
        # Fetch real AML case data from PostgreSQL database
        import psycopg2
        import os
        from psycopg2.extras import RealDictCursor
        
        try:
            # Connect to PostgreSQL
            conn = psycopg2.connect(
                host=os.getenv('POSTGRES_HOST', 'localhost'),
                port=os.getenv('POSTGRES_PORT', '5432'),
                database=os.getenv('POSTGRES_DB', 'remittance'),
                user=os.getenv('POSTGRES_USER', 'postgres'),
                password=os.getenv('POSTGRES_PASSWORD', ''),
                cursor_factory=RealDictCursor
            )
            
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT 
                        case_id,
                        status,
                        risk_score,
                        customer_id,
                        assigned_to,
                        created_at,
                        updated_at,
                        notes,
                        transaction_ids
                    FROM aml_cases
                    WHERE case_id = %s
                    """,
                    (case_id,)
                )
                
                result = cursor.fetchone()
                
                if result:
                    return {
                        "case_id": result['case_id'],
                        "status": result['status'],
                        "risk_score": result.get('risk_score'),
                        "customer_id": result.get('customer_id'),
                        "assigned_to": result.get('assigned_to'),
                        "created_at": result['created_at'].isoformat() if result.get('created_at') else None,
                        "last_updated": result['updated_at'].isoformat() if result.get('updated_at') else None,
                        "notes": result.get('notes'),
                        "transaction_ids": result.get('transaction_ids', [])
                    }
                else:
                    logger.warning(f"AML case {case_id} not found in database")
                    
            conn.close()
            
        except Exception as e:
            logger.error(f"Failed to fetch AML case from database: {e}")
        
        # Fallback response if database unavailable or case not found
        return {
            "case_id": case_id,
            "status": AMLCaseStatus.UNKNOWN.value,
            "created_at": datetime.utcnow().isoformat(),
            "last_updated": datetime.utcnow().isoformat(),
            "note": "Case data unavailable - database connection failed or case not found"
        }
    
    async def file_sar(
        self,
        user_id: str,
        case_id: str,
        sar_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        File Suspicious Activity Report with authorization check
        
        Args:
            user_id: User filing the SAR (chief compliance officer)
            case_id: AML case ID
            sar_data: SAR data
        
        Returns:
            SAR filing result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_file_sar = await self.auth_service.can_file_sar(user_id, case_id)
        
        if not can_file_sar:
            logger.warning(f"SAR filing denied: user={user_id}, case={case_id}")
            raise PermissionError(f"User {user_id} cannot file SAR for case {case_id}")
        
        # Create SAR record
        sar_id = f"sar_{datetime.utcnow().timestamp()}"
        
        # Setup permissions
        await self.auth_service.client.create_relationship(
            entity_type="sar",
            entity_id=sar_id,
            relation="creator",
            subject_type="user",
            subject_id=user_id
        )
        
        logger.info(f"SAR filed: sar={sar_id}, case={case_id}, officer={user_id}")
        
        return {
            "sar_id": sar_id,
            "case_id": case_id,
            "status": "submitted",
            "filed_by": user_id,
            "filed_at": datetime.utcnow().isoformat(),
            "sar_data": sar_data
        }
    
    async def assign_compliance_officer_to_case(
        self,
        admin_user_id: str,
        case_id: str,
        officer_user_id: str,
        case_type: str = "aml_case"
    ) -> bool:
        """
        Assign compliance officer to case
        
        Args:
            admin_user_id: Admin assigning the officer
            case_id: Case ID
            officer_user_id: Compliance officer user ID
            case_type: Case type (aml_case, sanctions_screening, etc.)
        
        Returns:
            True if successful
        """
        # Assign compliance officer relationship
        await self.auth_service.assign_compliance_officer(officer_user_id, case_id, case_type)
        
        logger.info(f"Compliance officer assigned: case={case_id}, officer={officer_user_id}, type={case_type}")
        return True

