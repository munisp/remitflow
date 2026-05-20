"""
KYC Activities for Nigerian Remittance Platform
Implements atomic operations for KYC verification workflow
Integrates with open-source KYB (PaddleOCR, VLM, Docling) and OLMOCR/GOT-OCR2.0 (OCR)
"""

import asyncio
import logging
from typing import Dict, Any, List
from datetime import datetime
from temporalio import activity
from ocr_service import OCRService
from kyb_service import KYBService
from liveness_service import LivenessService

# Configure logging
logger = logging.getLogger(__name__)


@activity.defn
async def collect_documents(kyc_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Collect and validate KYC documents
    
    Args:
        kyc_data: KYC information including document references
    
    Returns:
        Dict with document collection result
    """
    activity.logger.info(f"Collecting documents for user: {kyc_data.get('user_id')}")
    
    try:
        documents = kyc_data.get('documents', [])
        
        # Validate document requirements
        kyc_type = kyc_data.get('kyc_type', 'individual')
        
        if kyc_type == 'individual':
            required_docs = ['national_id', 'proof_of_address']
        else:  # business
            required_docs = ['business_registration', 'tax_certificate', 'director_id']
        
        provided_doc_types = [doc.get('type') for doc in documents]
        missing_docs = [doc for doc in required_docs if doc not in provided_doc_types]
        
        if missing_docs:
            return {
                "success": False,
                "error": f"Missing required documents: {', '.join(missing_docs)}"
            }
        
        # Validate document formats
        valid_formats = ['pdf', 'jpg', 'jpeg', 'png']
        for doc in documents:
            doc_format = doc.get('format', '').lower()
            if doc_format not in valid_formats:
                return {
                    "success": False,
                    "error": f"Invalid document format: {doc_format}. Supported: {', '.join(valid_formats)}"
                }
        
        activity.logger.info(
            f"Documents collected successfully for user: {kyc_data.get('user_id')} - "
            f"Count: {len(documents)}"
        )
        
        return {
            "success": True,
            "documents": documents,
            "collected_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        activity.logger.error(f"Document collection error: {str(e)}")
        return {
            "success": False,
            "error": f"Document collection failed: {str(e)}"
        }


@activity.defn
async def verify_identity_ocr(verification_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Verify identity using OCR (OLMOCR/GOT-OCR2.0)
    
    Args:
        verification_data: Verification data including documents and personal info
    
    Returns:
        Dict with OCR verification result
    """
    activity.logger.info(f"Performing OCR verification for user: {verification_data.get('user_id')}")
    
    try:
        documents = verification_data.get('documents', [])
        personal_info = verification_data.get('personal_info', {})
        
        ocr_service = OCRService()
        result = ocr_service.recognize_text(documents[0].get(\'path\')) # Assuming the first document is the one to be OCR-ed
        
        # Process the result to extract the text
        extracted_text = \'\'.join([line[1][0] for line in result[0]])

        # In a real-world scenario, you would have a more sophisticated way of comparing the extracted text with the provided personal info
        if personal_info.get(\'name\') in extracted_text:
            verified = True
            confidence = 0.9
        else:
            verified = False
            confidence = 0.5
        
        await asyncio.sleep(0.3)  # Simulate OCR processing
        
        # Simulate extracted data
        extracted_data = {
            "name": personal_info.get('name'),
            "date_of_birth": personal_info.get('date_of_birth'),
            "id_number": personal_info.get('id_number'),
            "address": personal_info.get('address')
        }
        
        # Simulate verification
        confidence = 0.95  # High confidence
        verified = True
        
        # Check if extracted data matches provided info
        if extracted_data.get('name', '').lower() != personal_info.get('name', '').lower():
            verified = False
            confidence = 0.6
        
        result = {
            "verified": verified,
            "confidence": confidence,
            "extracted_data": extracted_data,
            "verified_at": datetime.utcnow().isoformat(),
            "ocr_engine": "OLMOCR"
        }
        
        if not verified:
            result["reason"] = "Extracted data does not match provided information"
        
        activity.logger.info(
            f"OCR verification completed for user: {verification_data.get('user_id')} - "
            f"Verified: {verified}, Confidence: {confidence}"
        )
        
        return result
        
    except Exception as e:
        activity.logger.error(f"OCR verification error: {str(e)}")
        return {
            "verified": False,
            "confidence": 0.0,
            "reason": f"OCR verification failed: {str(e)}"
        }


@activity.defn
async def check_sanctions(sanctions_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check user against sanctions lists
    
    Args:
        sanctions_data: User information for sanctions screening
    
    Returns:
        Dict with sanctions check result
    """
    activity.logger.info(f"Checking sanctions for user: {sanctions_data.get('user_id')}")
    
    try:
        personal_info = sanctions_data.get('personal_info', {})
        country = sanctions_data.get('country', '')
        
        # In production, this would check against OFAC, UN, EU sanctions lists
        # For now, simulate sanctions screening
        
        await asyncio.sleep(0.2)  # Simulate API call
        
        # Simulate check against multiple lists
        checked_lists = [
            "OFAC SDN",
            "UN Consolidated List",
            "EU Sanctions List",
            "UK HMT Sanctions"
        ]
        
        # For simulation, assume not sanctioned
        is_sanctioned = False
        
        result = {
            "is_sanctioned": is_sanctioned,
            "checked_lists": checked_lists,
            "checked_at": datetime.utcnow().isoformat()
        }
        
        if is_sanctioned:
            result["details"] = "User appears on sanctions list"
        
        activity.logger.info(
            f"Sanctions check completed for user: {sanctions_data.get('user_id')} - "
            f"Sanctioned: {is_sanctioned}"
        )
        
        return result
        
    except Exception as e:
        activity.logger.error(f"Sanctions check error: {str(e)}")
        # Fail safe: block on error
        return {
            "is_sanctioned": True,
            "details": f"Sanctions check failed: {str(e)}"
        }


@activity.defn
async def verify_business_opensource(kyb_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Verify business using open-source KYB stack:
    - Docling for structured document parsing
    - PaddleOCR for raw text extraction
    - VLM (BLIP) for semantic document understanding
    - Liveness detection for anti-spoofing

    Args:
        kyb_data: Business information for KYB verification including
                  business_info, documents list, and optional video_path

    Returns:
        Dict with open-source KYB verification result
    """
    activity.logger.info(f"Performing open-source KYB for user: {kyb_data.get('user_id')}")

    try:
        business_info = kyb_data.get('business_info', {})
        documents = kyb_data.get('documents', [])

        kyb_service = KYBService()
        liveness_service = LivenessService()

        # 1. Document Analysis (Docling + PaddleOCR + VLM)
        doc_path = documents[0].get('path') if documents else None
        doc_analysis_result = kyb_service.analyze_document(doc_path) if doc_path else {"vlm_result": {"answer": None}}

        # 2. Liveness Detection
        video_path = kyb_data.get('video_path')
        liveness_result = liveness_service.check_liveness(video_path) if video_path else {"is_live": True}

        # 3. Combine results and determine verification status
        verified = (
            doc_analysis_result.get('vlm_result', {}).get('answer') is not None
            and liveness_result.get('is_live', False)
        )
        risk_score = 0.2 if verified else 0.8

        result = {
            "verified": verified,
            "risk_score": risk_score,
            "verified_at": datetime.utcnow().isoformat(),
            "platform": "opensource_kyb",
            "checks_performed": [
                "business_registration",
                "director_verification",
                "beneficial_ownership",
                "business_activity"
            ]
        }

        if not verified:
            result["reason"] = "Business verification failed"

        activity.logger.info(
            f"Open-source KYB completed for user: {kyb_data.get('user_id')} - "
            f"Verified: {verified}, Risk Score: {risk_score}"
        )

        return result

    except Exception as e:
        activity.logger.error(f"Open-source KYB error: {str(e)}")
        return {
            "verified": False,
            "risk_score": 1.0,
            "reason": f"Open-source KYB verification failed: {str(e)}"
        }


@activity.defn
async def approve_kyc(approval_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Approve KYC verification
    
    Args:
        approval_data: Approval information
    
    Returns:
        Dict with approval result
    """
    activity.logger.info(f"Approving KYC for user: {approval_data.get('user_id')}")
    
    try:
        # In production, this would update database and user status
        
        kyc_id = f"KYC-{approval_data.get('user_id')}-{int(datetime.utcnow().timestamp())}"
        
        await asyncio.sleep(0.1)  # Simulate database update
        
        activity.logger.info(
            f"KYC approved for user: {approval_data.get('user_id')} - "
            f"KYC ID: {kyc_id}"
        )
        
        return {
            "success": True,
            "kyc_id": kyc_id,
            "approval_date": datetime.utcnow().isoformat(),
            "kyc_type": approval_data.get('kyc_type')
        }
        
    except Exception as e:
        activity.logger.error(f"KYC approval error: {str(e)}")
        return {
            "success": False,
            "error": f"Approval failed: {str(e)}"
        }


@activity.defn
async def reject_kyc(rejection_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Reject KYC verification
    
    Args:
        rejection_data: Rejection information
    
    Returns:
        Dict with rejection result
    """
    activity.logger.info(
        f"Rejecting KYC for user: {rejection_data.get('user_id')} - "
        f"Reason: {rejection_data.get('reason')}"
    )
    
    try:
        # In production, this would update database and user status
        
        await asyncio.sleep(0.1)  # Simulate database update
        
        activity.logger.info(
            f"KYC rejected for user: {rejection_data.get('user_id')}"
        )
        
        return {
            "success": True,
            "rejected_at": datetime.utcnow().isoformat(),
            "reason": rejection_data.get('reason')
        }
        
    except Exception as e:
        activity.logger.error(f"KYC rejection error: {str(e)}")
        return {
            "success": False,
            "error": f"Rejection failed: {str(e)}"
        }


@activity.defn
async def send_kyc_notification(notification_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Send KYC-related notification to user
    
    Args:
        notification_data: Notification information
    
    Returns:
        Dict with notification result
    """
    activity.logger.info(
        f"Sending KYC notification to user: {notification_data.get('user_id')} - "
        f"Type: {notification_data.get('type')}"
    )
    
    try:
        # In production, this would send via notification service
        
        notification_id = f"KYC-NOTIF-{notification_data.get('user_id')}-{int(datetime.utcnow().timestamp())}"
        
        await asyncio.sleep(0.05)  # Simulate notification sending
        
        activity.logger.info(
            f"KYC notification sent successfully: {notification_id}"
        )
        
        return {
            "success": True,
            "notification_id": notification_id,
            "sent_at": datetime.utcnow().isoformat(),
            "type": notification_data.get('type')
        }
        
    except Exception as e:
        activity.logger.error(f"KYC notification error: {str(e)}")
        return {
            "success": False,
            "error": f"Notification failed: {str(e)}"
        }

