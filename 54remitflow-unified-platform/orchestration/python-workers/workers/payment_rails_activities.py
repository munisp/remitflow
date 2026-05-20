"""
Python activities for CIPS, PIX, UPI, and Mojaloop payment rails
Integrates with existing backend services
"""

import asyncio
import httpx
from temporalio import activity
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)

# Service endpoints (configured via environment variables in production)
CIPS_SERVICE_URL = "http://cips-integration:8000"
UPI_SERVICE_URL = "http://upi-integration:8000"
PIX_SERVICE_URL = "http://payment-gateway-service:8000/pix"
MOJALOOP_SERVICE_URL = "http://mojaloop-service:8000"


# ==================== CIPS Activities ====================

@activity.defn(name="ValidateCIPSSupplier")
async def validate_cips_supplier(
    bank_account: str,
    cnaps_code: str,
    supplier_name: str
) -> Dict[str, Any]:
    """
    Validate Chinese supplier information and CNAPS code
    Calls existing CIPS integration service
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{CIPS_SERVICE_URL}/api/v1/validate-supplier",
                json={
                    "bank_account": bank_account,
                    "cnaps_code": cnaps_code,
                    "supplier_name": supplier_name
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "valid": result.get("valid", False),
                "supplier_name": result.get("supplier_name", ""),
                "bank_name": result.get("bank_name", ""),
                "error_message": result.get("error", "")
            }
    except Exception as e:
        logger.error(f"CIPS supplier validation failed: {e}")
        return {
            "valid": False,
            "error_message": str(e)
        }


@activity.defn(name="ValidateTradeDocuments")
async def validate_trade_documents(
    document_urls: List[str],
    invoice_reference: str,
    amount_ngn: float
) -> Dict[str, Any]:
    """
    Validate trade documentation for large CIPS payments
    Uses AI/ML for document verification
    """
    try:
        # Call DeepSeek OCR service for document validation
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "http://deepseek-ocr-service:8000/api/v1/validate-trade-docs",
                json={
                    "document_urls": document_urls,
                    "invoice_reference": invoice_reference,
                    "expected_amount": amount_ngn
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "valid": result.get("valid", False),
                "documents": document_urls,
                "error_message": result.get("error", "")
            }
    except Exception as e:
        logger.error(f"Trade document validation failed: {e}")
        return {
            "valid": False,
            "error_message": str(e)
        }


@activity.defn(name="CalculateCIPSFee")
async def calculate_cips_fee(amount_ngn: float) -> Dict[str, Any]:
    """
    Calculate CIPS transfer fees
    1% fee, minimum 500 NGN, maximum 5000 NGN
    """
    fee_percentage = 0.01
    calculated_fee = amount_ngn * fee_percentage
    
    # Apply min/max limits
    fee = max(500, min(calculated_fee, 5000))
    
    return {
        "total_fee": fee,
        "breakdown": {
            "transfer_fee": fee * 0.8,
            "fx_fee": fee * 0.15,
            "processing_fee": fee * 0.05
        }
    }


@activity.defn(name="SubmitCIPSPayment")
async def submit_cips_payment(
    bank_account: str,
    cnaps_code: str,
    supplier_name: str,
    amount_rmb: float,
    payment_purpose: str,
    invoice_reference: str,
    settlement_type: str
) -> Dict[str, Any]:
    """
    Submit payment to CIPS network
    Calls existing CIPS integration service
    """
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{CIPS_SERVICE_URL}/api/v1/submit-payment",
                json={
                    "beneficiary_account": bank_account,
                    "cnaps_code": cnaps_code,
                    "beneficiary_name": supplier_name,
                    "amount": amount_rmb,
                    "purpose": payment_purpose,
                    "reference": invoice_reference,
                    "settlement_type": settlement_type
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "cips_reference": result.get("reference_number", ""),
                "settlement_date": result.get("settlement_date", ""),
                "status": result.get("status", "pending")
            }
    except Exception as e:
        logger.error(f"CIPS payment submission failed: {e}")
        raise


@activity.defn(name="PollCIPSSettlementStatus")
async def poll_cips_settlement_status(
    cips_reference: str,
    max_duration_seconds: int
) -> Dict[str, Any]:
    """
    Poll CIPS for settlement status
    """
    start_time = asyncio.get_event_loop().time()
    poll_interval = 60  # Poll every minute
    
    while True:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{CIPS_SERVICE_URL}/api/v1/payment-status/{cips_reference}"
                )
                response.raise_for_status()
                result = response.json()
                
                status = result.get("status", "pending")
                if status == "settled":
                    return {
                        "status": "settled",
                        "settled_at": result.get("settled_at", "")
                    }
                
                # Check if max duration exceeded
                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed >= max_duration_seconds:
                    return {
                        "status": "pending",
                        "settled_at": ""
                    }
                
                # Wait before next poll
                await asyncio.sleep(poll_interval)
                
        except Exception as e:
            logger.error(f"CIPS status poll failed: {e}")
            await asyncio.sleep(poll_interval)


# ==================== PIX Activities ====================

@activity.defn(name="LookupPIXRecipient")
async def lookup_pix_recipient(
    pix_key: str,
    key_type: str
) -> Dict[str, Any]:
    """
    Lookup recipient in PIX DICT (Directory)
    Calls existing PIX gateway service
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{PIX_SERVICE_URL}/lookup",
                json={
                    "pix_key": pix_key,
                    "key_type": key_type
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "found": result.get("found", False),
                "recipient_name": result.get("name", ""),
                "bank_name": result.get("bank_name", ""),
                "bank_ispb": result.get("bank_ispb", ""),
                "account_type": result.get("account_type", "")
            }
    except Exception as e:
        logger.error(f"PIX recipient lookup failed: {e}")
        return {"found": False}


@activity.defn(name="CalculatePIXFee")
async def calculate_pix_fee(amount_ngn: float) -> Dict[str, Any]:
    """
    Calculate PIX transfer fees
    0.3% fee, maximum 150 NGN
    """
    fee_percentage = 0.003
    calculated_fee = amount_ngn * fee_percentage
    
    # Apply max limit
    fee = min(calculated_fee, 150)
    
    return {
        "total_fee": fee,
        "breakdown": {
            "transfer_fee": fee * 0.7,
            "fx_fee": fee * 0.3
        }
    }


@activity.defn(name="InitiatePIXPayment")
async def initiate_pix_payment(
    pix_key: str,
    key_type: str,
    amount_brl: float,
    message: str,
    transaction_id: str
) -> Dict[str, Any]:
    """
    Initiate PIX instant payment
    Calls existing PIX gateway service
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{PIX_SERVICE_URL}/initiate",
                json={
                    "pix_key": pix_key,
                    "key_type": key_type,
                    "amount": amount_brl,
                    "message": message,
                    "idempotency_key": transaction_id
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "end_to_end_id": result.get("e2e_id", ""),
                "status": result.get("status", "completed"),
                "settled_at": result.get("settled_at", "")
            }
    except Exception as e:
        logger.error(f"PIX payment initiation failed: {e}")
        raise


# ==================== UPI Activities ====================

@activity.defn(name="ValidateUPIID")
async def validate_upi_id(upi_id: str) -> Dict[str, Any]:
    """
    Validate UPI ID and lookup recipient
    Calls existing UPI integration service
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{UPI_SERVICE_URL}/api/v1/validate-vpa",
                json={"vpa": upi_id}
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "valid": result.get("valid", False),
                "recipient_name": result.get("name", ""),
                "bank_name": result.get("bank_name", ""),
                "ifsc": result.get("ifsc", ""),
                "account_type": result.get("account_type", "")
            }
    except Exception as e:
        logger.error(f"UPI ID validation failed: {e}")
        return {"valid": False}


@activity.defn(name="CalculateUPIFee")
async def calculate_upi_fee(amount_ngn: float) -> Dict[str, Any]:
    """
    Calculate UPI transfer fees
    0.5% fee, maximum 200 NGN
    """
    fee_percentage = 0.005
    calculated_fee = amount_ngn * fee_percentage
    
    # Apply max limit
    fee = min(calculated_fee, 200)
    
    return {
        "total_fee": fee,
        "breakdown": {
            "transfer_fee": fee * 0.6,
            "fx_fee": fee * 0.4
        }
    }


@activity.defn(name="InitiateUPIIntent")
async def initiate_upi_intent(
    upi_id: str,
    amount_inr: float,
    note: str,
    transaction_id: str
) -> Dict[str, Any]:
    """
    Initiate UPI Intent payment (direct payment)
    Calls existing UPI integration service
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{UPI_SERVICE_URL}/api/v1/initiate-payment",
                json={
                    "payee_vpa": upi_id,
                    "amount": amount_inr,
                    "note": note,
                    "transaction_ref": transaction_id
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "rrn": result.get("rrn", ""),
                "status": result.get("status", "SUCCESS"),
                "settled_at": result.get("settled_at", "")
            }
    except Exception as e:
        logger.error(f"UPI Intent payment failed: {e}")
        raise


@activity.defn(name="InitiateUPICollect")
async def initiate_upi_collect(
    upi_id: str,
    amount_inr: float,
    note: str,
    transaction_id: str
) -> Dict[str, Any]:
    """
    Initiate UPI Collect request (request money from recipient)
    Calls existing UPI integration service
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{UPI_SERVICE_URL}/api/v1/collect-request",
                json={
                    "payer_vpa": upi_id,
                    "amount": amount_inr,
                    "note": note,
                    "transaction_ref": transaction_id
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "rrn": result.get("rrn", ""),
                "status": result.get("status", "PENDING"),
                "settled_at": result.get("settled_at", "")
            }
    except Exception as e:
        logger.error(f"UPI Collect request failed: {e}")
        raise


# ==================== Mojaloop Activities ====================

@activity.defn(name="ValidateMojaloopCountry")
async def validate_mojaloop_country(country_code: str) -> Dict[str, Any]:
    """
    Validate if country is supported by Mojaloop
    """
    # Mojaloop-supported African countries
    supported_countries = {
        "KE": {"name": "Kenya", "fsps": ["Safaricom", "Equity Bank"]},
        "GH": {"name": "Ghana", "fsps": ["MTN Mobile Money", "Vodafone Cash"]},
        "UG": {"name": "Uganda", "fsps": ["MTN Uganda", "Airtel Uganda"]},
        "TZ": {"name": "Tanzania", "fsps": ["Vodacom M-Pesa", "Tigo Pesa"]},
        "RW": {"name": "Rwanda", "fsps": ["MTN Rwanda", "Airtel Rwanda"]},
        "ZA": {"name": "South Africa", "fsps": ["Capitec", "Standard Bank"]},
    }
    
    country_info = supported_countries.get(country_code)
    if country_info:
        return {
            "supported": True,
            "country_code": country_code,
            "country_name": country_info["name"],
            "supported_fsps": country_info["fsps"]
        }
    else:
        return {
            "supported": False,
            "country_code": country_code,
            "country_name": "",
            "supported_fsps": []
        }


@activity.defn(name="PerformMojaloopPartyLookup")
async def perform_mojaloop_party_lookup(
    msisdn: str,
    country_code: str
) -> Dict[str, Any]:
    """
    Perform Mojaloop party lookup to discover recipient's FSP
    Calls existing Mojaloop service
    """
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{MOJALOOP_SERVICE_URL}/api/v1/parties/MSISDN/{msisdn}",
                params={"country": country_code}
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "found": result.get("found", False),
                "party_name": result.get("party_name", ""),
                "fsp_id": result.get("fsp_id", ""),
                "fsp_name": result.get("fsp_name", "")
            }
    except Exception as e:
        logger.error(f"Mojaloop party lookup failed: {e}")
        return {"found": False}


@activity.defn(name="GetMojaloopQuote")
async def get_mojaloop_quote(
    msisdn: str,
    fsp_id: str,
    amount: float,
    currency: str,
    payment_type: str
) -> Dict[str, Any]:
    """
    Get Mojaloop quote including fees
    Calls existing Mojaloop service
    """
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{MOJALOOP_SERVICE_URL}/api/v1/quotes",
                json={
                    "payee_msisdn": msisdn,
                    "payee_fsp_id": fsp_id,
                    "amount": amount,
                    "currency": currency,
                    "transaction_type": payment_type
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "quote_id": result.get("quote_id", ""),
                "transfer_fee": result.get("fees", {}).get("total", 0),
                "total_amount": result.get("total_amount", 0),
                "expiry_time": result.get("expiry", "")
            }
    except Exception as e:
        logger.error(f"Mojaloop quote failed: {e}")
        raise


@activity.defn(name="InitiateMojaloopTransfer")
async def initiate_mojaloop_transfer(
    msisdn: str,
    fsp_id: str,
    amount: float,
    currency: str,
    quote_id: str,
    note: str,
    transaction_id: str
) -> Dict[str, Any]:
    """
    Initiate Mojaloop transfer
    Calls existing Mojaloop service
    """
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{MOJALOOP_SERVICE_URL}/api/v1/transfers",
                json={
                    "payee_msisdn": msisdn,
                    "payee_fsp_id": fsp_id,
                    "amount": amount,
                    "currency": currency,
                    "quote_id": quote_id,
                    "note": note,
                    "transaction_ref": transaction_id
                }
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "transfer_id": result.get("transfer_id", ""),
                "status": result.get("status", "COMMITTED"),
                "settled_at": result.get("settled_at", "")
            }
    except Exception as e:
        logger.error(f"Mojaloop transfer failed: {e}")
        raise
