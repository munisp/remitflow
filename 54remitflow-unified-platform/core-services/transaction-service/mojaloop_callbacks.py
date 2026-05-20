"""
Mojaloop FSPIOP Callback Handlers
FastAPI routes for receiving Mojaloop callbacks

These endpoints handle asynchronous responses from the Mojaloop hub:
- Party lookup responses
- Quote responses
- Transfer state changes
- Transaction request notifications
- Authorization responses
- Error callbacks
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel, Field
import asyncio
import os

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mojaloop/callbacks", tags=["Mojaloop Callbacks"])


# ==================== Pydantic Models ====================

class PartyIdInfo(BaseModel):
    partyIdType: str
    partyIdentifier: str
    partySubIdOrType: Optional[str] = None
    fspId: Optional[str] = None


class Party(BaseModel):
    partyIdInfo: PartyIdInfo
    name: Optional[str] = None
    personalInfo: Optional[Dict[str, Any]] = None


class Money(BaseModel):
    currency: str
    amount: str


class ErrorInformation(BaseModel):
    errorCode: str
    errorDescription: str
    extensionList: Optional[Dict[str, Any]] = None


class PartyLookupResponse(BaseModel):
    party: Party


class QuoteResponse(BaseModel):
    transferAmount: Money
    payeeReceiveAmount: Optional[Money] = None
    payeeFspFee: Optional[Money] = None
    payeeFspCommission: Optional[Money] = None
    expiration: str
    ilpPacket: str
    condition: str
    extensionList: Optional[Dict[str, Any]] = None


class TransferResponse(BaseModel):
    fulfilment: Optional[str] = None
    completedTimestamp: Optional[str] = None
    transferState: str
    extensionList: Optional[Dict[str, Any]] = None


class TransactionRequest(BaseModel):
    transactionRequestId: str
    payer: Party
    payee: Party
    amount: Money
    transactionType: Dict[str, Any]
    note: Optional[str] = None
    expiration: Optional[str] = None


class AuthorizationResponse(BaseModel):
    authorizationId: str
    authorizationState: str
    amount: Optional[Money] = None


class ErrorCallback(BaseModel):
    errorInformation: ErrorInformation


# ==================== Callback Storage ====================

class CallbackStore:
    """In-memory store for callbacks (use Redis/PostgreSQL in production)"""
    
    def __init__(self):
        self.party_lookups: Dict[str, Dict[str, Any]] = {}
        self.quotes: Dict[str, Dict[str, Any]] = {}
        self.transfers: Dict[str, Dict[str, Any]] = {}
        self.transaction_requests: Dict[str, Dict[str, Any]] = {}
        self.authorizations: Dict[str, Dict[str, Any]] = {}
        self.errors: Dict[str, Dict[str, Any]] = {}
        self.pending_futures: Dict[str, asyncio.Future] = {}
    
    def store_party_lookup(self, party_id_type: str, party_identifier: str, data: Dict[str, Any]):
        key = f"{party_id_type}:{party_identifier}"
        self.party_lookups[key] = {
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self._resolve_future(f"party:{key}", data)
    
    def store_quote(self, quote_id: str, data: Dict[str, Any]):
        self.quotes[quote_id] = {
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self._resolve_future(f"quote:{quote_id}", data)
    
    def store_transfer(self, transfer_id: str, data: Dict[str, Any]):
        self.transfers[transfer_id] = {
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self._resolve_future(f"transfer:{transfer_id}", data)
    
    def store_transaction_request(self, transaction_request_id: str, data: Dict[str, Any]):
        self.transaction_requests[transaction_request_id] = {
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self._resolve_future(f"txn_request:{transaction_request_id}", data)
    
    def store_authorization(self, authorization_id: str, data: Dict[str, Any]):
        self.authorizations[authorization_id] = {
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self._resolve_future(f"auth:{authorization_id}", data)
    
    def store_error(self, resource_type: str, resource_id: str, error: Dict[str, Any]):
        key = f"{resource_type}:{resource_id}"
        self.errors[key] = {
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self._reject_future(f"{resource_type}:{resource_id}", error)
    
    def register_pending(self, key: str, timeout: float = 60.0) -> asyncio.Future:
        """Register a pending request that will be resolved by callback"""
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self.pending_futures[key] = future
        
        # Set timeout
        async def timeout_handler():
            await asyncio.sleep(timeout)
            if key in self.pending_futures and not self.pending_futures[key].done():
                self.pending_futures[key].set_exception(
                    TimeoutError(f"Callback timeout for {key}")
                )
                del self.pending_futures[key]
        
        asyncio.create_task(timeout_handler())
        return future
    
    def _resolve_future(self, key: str, data: Dict[str, Any]):
        if key in self.pending_futures and not self.pending_futures[key].done():
            self.pending_futures[key].set_result(data)
            del self.pending_futures[key]
    
    def _reject_future(self, key: str, error: Dict[str, Any]):
        if key in self.pending_futures and not self.pending_futures[key].done():
            self.pending_futures[key].set_exception(
                Exception(f"Mojaloop error: {error.get('errorCode', 'unknown')} - {error.get('errorDescription', 'unknown')}")
            )
            del self.pending_futures[key]
    
    def get_party_lookup(self, party_id_type: str, party_identifier: str) -> Optional[Dict[str, Any]]:
        key = f"{party_id_type}:{party_identifier}"
        return self.party_lookups.get(key)
    
    def get_quote(self, quote_id: str) -> Optional[Dict[str, Any]]:
        return self.quotes.get(quote_id)
    
    def get_transfer(self, transfer_id: str) -> Optional[Dict[str, Any]]:
        return self.transfers.get(transfer_id)
    
    def get_transaction_request(self, transaction_request_id: str) -> Optional[Dict[str, Any]]:
        return self.transaction_requests.get(transaction_request_id)
    
    def get_authorization(self, authorization_id: str) -> Optional[Dict[str, Any]]:
        return self.authorizations.get(authorization_id)


# Global callback store
callback_store = CallbackStore()


# ==================== Callback Handlers ====================

def validate_fspiop_headers(
    fspiop_source: Optional[str],
    fspiop_destination: Optional[str],
    date: Optional[str]
) -> bool:
    """Validate FSPIOP headers"""
    if not fspiop_source:
        logger.warning("Missing FSPIOP-Source header")
        return False
    return True


@router.put("/parties/{party_id_type}/{party_identifier}")
async def party_lookup_callback(
    party_id_type: str,
    party_identifier: str,
    request: Request,
    background_tasks: BackgroundTasks,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source"),
    fspiop_destination: Optional[str] = Header(None, alias="FSPIOP-Destination"),
    date: Optional[str] = Header(None)
):
    """
    Handle party lookup callback from Mojaloop hub
    
    This is called when a party lookup request completes.
    """
    body = await request.json()
    
    logger.info(f"Party lookup callback: {party_id_type}/{party_identifier} from {fspiop_source}")
    
    if "errorInformation" in body:
        callback_store.store_error("party", f"{party_id_type}:{party_identifier}", body["errorInformation"])
        logger.error(f"Party lookup error: {body['errorInformation']}")
    else:
        callback_store.store_party_lookup(party_id_type, party_identifier, body)
        logger.info(f"Party lookup success: {party_id_type}/{party_identifier}")
    
    return {"status": "received"}


@router.put("/parties/{party_id_type}/{party_identifier}/{party_sub_id}")
async def party_lookup_callback_with_sub_id(
    party_id_type: str,
    party_identifier: str,
    party_sub_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """Handle party lookup callback with sub-ID"""
    body = await request.json()
    
    key = f"{party_id_type}:{party_identifier}:{party_sub_id}"
    logger.info(f"Party lookup callback with sub-ID: {key}")
    
    if "errorInformation" in body:
        callback_store.store_error("party", key, body["errorInformation"])
    else:
        callback_store.store_party_lookup(party_id_type, f"{party_identifier}:{party_sub_id}", body)
    
    return {"status": "received"}


@router.put("/parties/{party_id_type}/{party_identifier}/error")
async def party_lookup_error_callback(
    party_id_type: str,
    party_identifier: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """Handle party lookup error callback"""
    body = await request.json()
    
    error_info = body.get("errorInformation", body)
    callback_store.store_error("party", f"{party_id_type}:{party_identifier}", error_info)
    
    logger.error(f"Party lookup error: {party_id_type}/{party_identifier} - {error_info}")
    
    return {"status": "received"}


@router.put("/quotes/{quote_id}")
async def quote_callback(
    quote_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """
    Handle quote callback from Mojaloop hub
    
    This is called when a quote request completes.
    """
    body = await request.json()
    
    logger.info(f"Quote callback: {quote_id} from {fspiop_source}")
    
    if "errorInformation" in body:
        callback_store.store_error("quote", quote_id, body["errorInformation"])
        logger.error(f"Quote error: {quote_id} - {body['errorInformation']}")
    else:
        callback_store.store_quote(quote_id, body)
        logger.info(f"Quote success: {quote_id}, amount: {body.get('transferAmount', {}).get('amount')}")
    
    return {"status": "received"}


@router.put("/quotes/{quote_id}/error")
async def quote_error_callback(
    quote_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """Handle quote error callback"""
    body = await request.json()
    
    error_info = body.get("errorInformation", body)
    callback_store.store_error("quote", quote_id, error_info)
    
    logger.error(f"Quote error: {quote_id} - {error_info}")
    
    return {"status": "received"}


@router.put("/transfers/{transfer_id}")
async def transfer_callback(
    transfer_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """
    Handle transfer callback from Mojaloop hub
    
    This is called when a transfer state changes.
    """
    body = await request.json()
    
    logger.info(f"Transfer callback: {transfer_id} from {fspiop_source}")
    
    if "errorInformation" in body:
        callback_store.store_error("transfer", transfer_id, body["errorInformation"])
        logger.error(f"Transfer error: {transfer_id} - {body['errorInformation']}")
    else:
        callback_store.store_transfer(transfer_id, body)
        logger.info(f"Transfer success: {transfer_id}, state: {body.get('transferState')}")
    
    return {"status": "received"}


@router.put("/transfers/{transfer_id}/error")
async def transfer_error_callback(
    transfer_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """Handle transfer error callback"""
    body = await request.json()
    
    error_info = body.get("errorInformation", body)
    callback_store.store_error("transfer", transfer_id, error_info)
    
    logger.error(f"Transfer error: {transfer_id} - {error_info}")
    
    return {"status": "received"}


@router.post("/transactionRequests")
async def transaction_request_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """
    Handle incoming transaction request (Request-to-Pay)
    
    This is called when a payee initiates a payment request.
    The payer must approve or reject the request.
    """
    body = await request.json()
    
    transaction_request_id = body.get("transactionRequestId")
    logger.info(f"Transaction request received: {transaction_request_id} from {fspiop_source}")
    
    callback_store.store_transaction_request(transaction_request_id, body)
    
    # In production, this would trigger a notification to the payer
    # background_tasks.add_task(notify_payer, transaction_request_id, body)
    
    return {"status": "received"}


@router.put("/transactionRequests/{transaction_request_id}")
async def transaction_request_response_callback(
    transaction_request_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """Handle transaction request response callback"""
    body = await request.json()
    
    logger.info(f"Transaction request response: {transaction_request_id}, state: {body.get('transactionRequestState')}")
    
    callback_store.store_transaction_request(transaction_request_id, body)
    
    return {"status": "received"}


@router.put("/transactionRequests/{transaction_request_id}/error")
async def transaction_request_error_callback(
    transaction_request_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """Handle transaction request error callback"""
    body = await request.json()
    
    error_info = body.get("errorInformation", body)
    callback_store.store_error("txn_request", transaction_request_id, error_info)
    
    logger.error(f"Transaction request error: {transaction_request_id} - {error_info}")
    
    return {"status": "received"}


@router.put("/authorizations/{authorization_id}")
async def authorization_callback(
    authorization_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """
    Handle authorization callback
    
    This is called when an authorization state changes.
    """
    body = await request.json()
    
    logger.info(f"Authorization callback: {authorization_id}, state: {body.get('authorizationState')}")
    
    if "errorInformation" in body:
        callback_store.store_error("auth", authorization_id, body["errorInformation"])
    else:
        callback_store.store_authorization(authorization_id, body)
    
    return {"status": "received"}


@router.put("/authorizations/{authorization_id}/error")
async def authorization_error_callback(
    authorization_id: str,
    request: Request,
    fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")
):
    """Handle authorization error callback"""
    body = await request.json()
    
    error_info = body.get("errorInformation", body)
    callback_store.store_error("auth", authorization_id, error_info)
    
    logger.error(f"Authorization error: {authorization_id} - {error_info}")
    
    return {"status": "received"}


# ==================== Query Endpoints ====================

@router.get("/status/party/{party_id_type}/{party_identifier}")
async def get_party_lookup_status(party_id_type: str, party_identifier: str):
    """Get party lookup result"""
    result = callback_store.get_party_lookup(party_id_type, party_identifier)
    if result:
        return {"found": True, **result}
    return {"found": False}


@router.get("/status/quote/{quote_id}")
async def get_quote_status(quote_id: str):
    """Get quote result"""
    result = callback_store.get_quote(quote_id)
    if result:
        return {"found": True, **result}
    return {"found": False}


@router.get("/status/transfer/{transfer_id}")
async def get_transfer_status(transfer_id: str):
    """Get transfer result"""
    result = callback_store.get_transfer(transfer_id)
    if result:
        return {"found": True, **result}
    return {"found": False}


@router.get("/status/transaction-request/{transaction_request_id}")
async def get_transaction_request_status(transaction_request_id: str):
    """Get transaction request result"""
    result = callback_store.get_transaction_request(transaction_request_id)
    if result:
        return {"found": True, **result}
    return {"found": False}


@router.get("/status/authorization/{authorization_id}")
async def get_authorization_status(authorization_id: str):
    """Get authorization result"""
    result = callback_store.get_authorization(authorization_id)
    if result:
        return {"found": True, **result}
    return {"found": False}


# ==================== Health Check ====================

@router.get("/health")
async def health_check():
    """Health check for callback handlers"""
    return {
        "status": "healthy",
        "service": "mojaloop-callbacks",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "party_lookups": len(callback_store.party_lookups),
            "quotes": len(callback_store.quotes),
            "transfers": len(callback_store.transfers),
            "transaction_requests": len(callback_store.transaction_requests),
            "authorizations": len(callback_store.authorizations),
            "errors": len(callback_store.errors),
            "pending_futures": len(callback_store.pending_futures)
        }
    }


# ==================== Export for Integration ====================

def get_callback_store() -> CallbackStore:
    """Get the callback store instance"""
    return callback_store


def register_pending_callback(key: str, timeout: float = 60.0) -> asyncio.Future:
    """Register a pending callback that will be resolved when received"""
    return callback_store.register_pending(key, timeout)
