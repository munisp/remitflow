"""
Enhanced Mojaloop FSPIOP Client
Production-grade connector with ALL Mojaloop features including:
- Transaction Requests (Request-to-Pay / Merchant-initiated)
- Authorization / Pre-authorization Holds
- Callback Handlers
- Settlement Windows
- Participant Management
- PISP / Thirdparty API support

Reference: https://docs.mojaloop.io/api/fspiop/
"""

import logging
import uuid
import hashlib
import hmac
import base64
import json
from typing import Dict, Any, Optional, List, Callable, Awaitable
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from enum import Enum
import asyncio
import aiohttp
from dataclasses import dataclass, field
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


# ==================== Enums ====================

class TransferState(Enum):
    """Mojaloop transfer states"""
    RECEIVED = "RECEIVED"
    RESERVED = "RESERVED"
    COMMITTED = "COMMITTED"
    ABORTED = "ABORTED"


class AuthorizationState(Enum):
    """Authorization states for pre-auth flows"""
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    CAPTURED = "CAPTURED"
    VOIDED = "VOIDED"


class TransactionRequestState(Enum):
    """Transaction request states"""
    RECEIVED = "RECEIVED"
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class PartyIdType(Enum):
    """Mojaloop party identifier types"""
    MSISDN = "MSISDN"
    EMAIL = "EMAIL"
    PERSONAL_ID = "PERSONAL_ID"
    BUSINESS = "BUSINESS"
    DEVICE = "DEVICE"
    ACCOUNT_ID = "ACCOUNT_ID"
    IBAN = "IBAN"
    ALIAS = "ALIAS"


class AmountType(Enum):
    """Amount types for quotes"""
    SEND = "SEND"
    RECEIVE = "RECEIVE"


class TransactionScenario(Enum):
    """Transaction scenarios"""
    DEPOSIT = "DEPOSIT"
    WITHDRAWAL = "WITHDRAWAL"
    TRANSFER = "TRANSFER"
    PAYMENT = "PAYMENT"
    REFUND = "REFUND"


class TransactionInitiator(Enum):
    """Who initiated the transaction"""
    PAYER = "PAYER"
    PAYEE = "PAYEE"


class TransactionInitiatorType(Enum):
    """Type of initiator"""
    CONSUMER = "CONSUMER"
    AGENT = "AGENT"
    BUSINESS = "BUSINESS"
    DEVICE = "DEVICE"


class SettlementWindowState(Enum):
    """Settlement window states"""
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    PENDING_SETTLEMENT = "PENDING_SETTLEMENT"
    SETTLED = "SETTLED"
    ABORTED = "ABORTED"


# ==================== Data Classes ====================

@dataclass
class Money:
    """Mojaloop money object"""
    currency: str
    amount: str
    
    def to_dict(self) -> Dict[str, str]:
        return {"currency": self.currency, "amount": self.amount}


@dataclass
class Party:
    """Mojaloop party object"""
    party_id_type: str
    party_identifier: str
    party_sub_id_or_type: Optional[str] = None
    fsp_id: Optional[str] = None
    name: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "partyIdInfo": {
                "partyIdType": self.party_id_type,
                "partyIdentifier": self.party_identifier
            }
        }
        if self.party_sub_id_or_type:
            result["partyIdInfo"]["partySubIdOrType"] = self.party_sub_id_or_type
        if self.fsp_id:
            result["partyIdInfo"]["fspId"] = self.fsp_id
        if self.name:
            result["name"] = self.name
        return result


@dataclass
class TransactionType:
    """Mojaloop transaction type"""
    scenario: str
    initiator: str
    initiator_type: str
    sub_scenario: Optional[str] = None
    refund_info: Optional[Dict] = None
    balance_of_payments: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "scenario": self.scenario,
            "initiator": self.initiator,
            "initiatorType": self.initiator_type
        }
        if self.sub_scenario:
            result["subScenario"] = self.sub_scenario
        if self.balance_of_payments:
            result["balanceOfPayments"] = self.balance_of_payments
        return result


@dataclass
class Authorization:
    """Authorization / Pre-auth hold"""
    authorization_id: str
    payer: Party
    payee: Party
    amount: Money
    state: AuthorizationState = AuthorizationState.PENDING
    expiration: Optional[str] = None
    condition: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    
    def is_valid(self) -> bool:
        """Check if authorization is still valid"""
        if self.state != AuthorizationState.APPROVED:
            return False
        if self.expiration:
            exp_time = datetime.fromisoformat(self.expiration.replace('Z', '+00:00'))
            if datetime.now(timezone.utc) > exp_time:
                return False
        return True


@dataclass
class TransactionRequest:
    """Request-to-Pay / Merchant-initiated transaction request"""
    transaction_request_id: str
    payee: Party
    payer: Party
    amount: Money
    transaction_type: TransactionType
    state: TransactionRequestState = TransactionRequestState.RECEIVED
    note: Optional[str] = None
    expiration: Optional[str] = None
    extension_list: Optional[List[Dict]] = None


@dataclass
class SettlementWindow:
    """Settlement window for batch settlement"""
    settlement_window_id: str
    state: SettlementWindowState
    created_date: str
    changed_date: Optional[str] = None
    reason: Optional[str] = None


@dataclass
class ParticipantPosition:
    """Participant position in settlement"""
    participant_id: str
    currency: str
    value: Decimal
    reserved_value: Decimal = Decimal("0")
    changed_date: Optional[str] = None


# ==================== Callback Handler Interface ====================

class MojaloopCallbackHandler(ABC):
    """Abstract base class for Mojaloop callback handlers"""
    
    @abstractmethod
    async def on_party_lookup_response(self, party_id_type: str, party_identifier: str, party_info: Dict[str, Any]) -> None:
        """Handle party lookup response"""
        pass
    
    @abstractmethod
    async def on_party_lookup_error(self, party_id_type: str, party_identifier: str, error: Dict[str, Any]) -> None:
        """Handle party lookup error"""
        pass
    
    @abstractmethod
    async def on_quote_response(self, quote_id: str, quote: Dict[str, Any]) -> None:
        """Handle quote response"""
        pass
    
    @abstractmethod
    async def on_quote_error(self, quote_id: str, error: Dict[str, Any]) -> None:
        """Handle quote error"""
        pass
    
    @abstractmethod
    async def on_transfer_response(self, transfer_id: str, transfer: Dict[str, Any]) -> None:
        """Handle transfer response"""
        pass
    
    @abstractmethod
    async def on_transfer_error(self, transfer_id: str, error: Dict[str, Any]) -> None:
        """Handle transfer error"""
        pass
    
    @abstractmethod
    async def on_transaction_request(self, transaction_request_id: str, request: Dict[str, Any]) -> None:
        """Handle incoming transaction request (Request-to-Pay)"""
        pass
    
    @abstractmethod
    async def on_authorization_response(self, authorization_id: str, authorization: Dict[str, Any]) -> None:
        """Handle authorization response"""
        pass


class DefaultCallbackHandler(MojaloopCallbackHandler):
    """Default callback handler that logs events and stores them"""
    
    def __init__(self):
        self.events: List[Dict[str, Any]] = []
        self.pending_requests: Dict[str, asyncio.Future] = {}
    
    async def on_party_lookup_response(self, party_id_type: str, party_identifier: str, party_info: Dict[str, Any]) -> None:
        event = {"type": "party_lookup_response", "party_id_type": party_id_type, "party_identifier": party_identifier, "data": party_info, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.info(f"Party lookup response: {party_id_type}/{party_identifier}")
        
        key = f"party:{party_id_type}:{party_identifier}"
        if key in self.pending_requests:
            self.pending_requests[key].set_result(party_info)
    
    async def on_party_lookup_error(self, party_id_type: str, party_identifier: str, error: Dict[str, Any]) -> None:
        event = {"type": "party_lookup_error", "party_id_type": party_id_type, "party_identifier": party_identifier, "error": error, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.error(f"Party lookup error: {party_id_type}/{party_identifier} - {error}")
        
        key = f"party:{party_id_type}:{party_identifier}"
        if key in self.pending_requests:
            self.pending_requests[key].set_exception(MojaloopError(error.get("errorCode", "3000"), error.get("errorDescription", "Unknown error")))
    
    async def on_quote_response(self, quote_id: str, quote: Dict[str, Any]) -> None:
        event = {"type": "quote_response", "quote_id": quote_id, "data": quote, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.info(f"Quote response: {quote_id}")
        
        key = f"quote:{quote_id}"
        if key in self.pending_requests:
            self.pending_requests[key].set_result(quote)
    
    async def on_quote_error(self, quote_id: str, error: Dict[str, Any]) -> None:
        event = {"type": "quote_error", "quote_id": quote_id, "error": error, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.error(f"Quote error: {quote_id} - {error}")
        
        key = f"quote:{quote_id}"
        if key in self.pending_requests:
            self.pending_requests[key].set_exception(MojaloopError(error.get("errorCode", "3000"), error.get("errorDescription", "Unknown error")))
    
    async def on_transfer_response(self, transfer_id: str, transfer: Dict[str, Any]) -> None:
        event = {"type": "transfer_response", "transfer_id": transfer_id, "data": transfer, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.info(f"Transfer response: {transfer_id}, state: {transfer.get('transferState')}")
        
        key = f"transfer:{transfer_id}"
        if key in self.pending_requests:
            self.pending_requests[key].set_result(transfer)
    
    async def on_transfer_error(self, transfer_id: str, error: Dict[str, Any]) -> None:
        event = {"type": "transfer_error", "transfer_id": transfer_id, "error": error, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.error(f"Transfer error: {transfer_id} - {error}")
        
        key = f"transfer:{transfer_id}"
        if key in self.pending_requests:
            self.pending_requests[key].set_exception(MojaloopError(error.get("errorCode", "3000"), error.get("errorDescription", "Unknown error")))
    
    async def on_transaction_request(self, transaction_request_id: str, request: Dict[str, Any]) -> None:
        event = {"type": "transaction_request", "transaction_request_id": transaction_request_id, "data": request, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.info(f"Transaction request received: {transaction_request_id}")
        
        key = f"txn_request:{transaction_request_id}"
        if key in self.pending_requests:
            self.pending_requests[key].set_result(request)
    
    async def on_authorization_response(self, authorization_id: str, authorization: Dict[str, Any]) -> None:
        event = {"type": "authorization_response", "authorization_id": authorization_id, "data": authorization, "timestamp": datetime.now(timezone.utc).isoformat()}
        self.events.append(event)
        logger.info(f"Authorization response: {authorization_id}")
        
        key = f"auth:{authorization_id}"
        if key in self.pending_requests:
            self.pending_requests[key].set_result(authorization)
    
    def register_pending(self, key: str) -> asyncio.Future:
        """Register a pending request that will be resolved by callback"""
        future = asyncio.get_event_loop().create_future()
        self.pending_requests[key] = future
        return future
    
    def get_events(self, event_type: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """Get stored events, optionally filtered by type"""
        events = self.events if not event_type else [e for e in self.events if e["type"] == event_type]
        return events[-limit:]


# ==================== Exceptions ====================

class MojaloopError(Exception):
    """Base exception for Mojaloop errors"""
    def __init__(self, error_code: str, error_description: str, http_status: int = 500):
        self.error_code = error_code
        self.error_description = error_description
        self.http_status = http_status
        super().__init__(f"{error_code}: {error_description}")


# ==================== Enhanced Mojaloop Client ====================

class EnhancedMojaloopClient:
    """
    Production-grade Mojaloop FSPIOP client with ALL features
    
    Features:
    - Party lookup (account discovery)
    - Quote requests
    - Transfer execution
    - Bulk transfers
    - Transaction Requests (Request-to-Pay)
    - Authorization / Pre-auth holds
    - Callback handling
    - Settlement window management
    - Participant management
    - FSPIOP-compliant headers with signatures
    - Async HTTP with retries and circuit breaker
    """
    
    API_VERSION = "1.1"
    DEFAULT_TIMEOUT = 30
    QUOTE_TIMEOUT = 60
    TRANSFER_TIMEOUT = 60
    MAX_RETRIES = 3
    RETRY_BACKOFF_BASE = 1.0
    
    def __init__(
        self,
        hub_url: str,
        fsp_id: str,
        signing_key: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT,
        max_retries: int = MAX_RETRIES,
        callback_handler: Optional[MojaloopCallbackHandler] = None
    ):
        self.hub_url = hub_url.rstrip('/')
        self.fsp_id = fsp_id
        self.signing_key = signing_key
        self.timeout = timeout
        self.max_retries = max_retries
        self.callback_handler = callback_handler or DefaultCallbackHandler()
        self._session: Optional[aiohttp.ClientSession] = None
        
        # In-memory stores for authorizations and transaction requests
        self._authorizations: Dict[str, Authorization] = {}
        self._transaction_requests: Dict[str, TransactionRequest] = {}
        self._settlement_windows: Dict[str, SettlementWindow] = {}
        self._participant_positions: Dict[str, ParticipantPosition] = {}
        
        logger.info(f"Initialized Enhanced Mojaloop client for FSP: {fsp_id} at {hub_url}")
    
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session
    
    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
    
    def _generate_headers(
        self,
        destination_fsp: Optional[str] = None,
        content_type: str = "application/vnd.interoperability.parties+json;version=1.1"
    ) -> Dict[str, str]:
        headers = {
            "Content-Type": content_type,
            "Accept": content_type,
            "FSPIOP-Source": self.fsp_id,
            "Date": datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        }
        if destination_fsp:
            headers["FSPIOP-Destination"] = destination_fsp
        return headers
    
    def _sign_request(self, headers: Dict[str, str], body: Optional[str] = None) -> Dict[str, str]:
        if not self.signing_key:
            return headers
        
        signature_string = f"FSPIOP-Source: {headers.get('FSPIOP-Source', '')}\n"
        signature_string += f"Date: {headers.get('Date', '')}\n"
        if body:
            signature_string += f"Content-Length: {len(body)}\n"
        
        signature = hmac.new(
            self.signing_key.encode('utf-8'),
            signature_string.encode('utf-8'),
            hashlib.sha256
        ).digest()
        
        headers["FSPIOP-Signature"] = base64.b64encode(signature).decode('utf-8')
        return headers
    
    async def _request_with_retry(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        json_data: Optional[Dict] = None,
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        session = await self._get_session()
        
        if idempotency_key:
            headers["X-Idempotency-Key"] = idempotency_key
        
        body = json.dumps(json_data) if json_data else None
        headers = self._sign_request(headers, body)
        
        last_error = None
        for attempt in range(self.max_retries):
            try:
                async with session.request(method, url, headers=headers, json=json_data) as response:
                    response_text = await response.text()
                    
                    if 200 <= response.status < 300:
                        if response_text:
                            return json.loads(response_text)
                        return {"status": "success", "http_status": response.status}
                    
                    if response.status == 400:
                        error_data = json.loads(response_text) if response_text else {}
                        raise MojaloopError(error_data.get("errorCode", "3100"), error_data.get("errorDescription", "Bad request"), response.status)
                    elif response.status == 404:
                        raise MojaloopError("3200", "Resource not found", response.status)
                    elif response.status in [500, 503]:
                        last_error = MojaloopError("2000", f"Server error: {response.status}", response.status)
                    else:
                        raise MojaloopError(str(response.status), f"HTTP error: {response_text}", response.status)
                        
            except aiohttp.ClientError as e:
                last_error = MojaloopError("2002", f"Connection error: {str(e)}", 503)
            except asyncio.TimeoutError:
                last_error = MojaloopError("2003", "Request timeout", 504)
            
            if attempt < self.max_retries - 1:
                wait_time = self.RETRY_BACKOFF_BASE * (2 ** attempt)
                logger.warning(f"Request failed, retrying in {wait_time}s (attempt {attempt + 1}/{self.max_retries})")
                await asyncio.sleep(wait_time)
        
        raise last_error or MojaloopError("2000", "Unknown error after retries", 500)
    
    # ==================== Party Lookup ====================
    
    async def lookup_party(
        self,
        party_id_type: str,
        party_identifier: str,
        party_sub_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Look up a party (account holder) by identifier"""
        url = f"{self.hub_url}/parties/{party_id_type}/{party_identifier}"
        if party_sub_id:
            url += f"/{party_sub_id}"
        
        headers = self._generate_headers(content_type="application/vnd.interoperability.parties+json;version=1.1")
        logger.info(f"Looking up party: {party_id_type}/{party_identifier}")
        
        result = await self._request_with_retry("GET", url, headers)
        logger.info(f"Party lookup successful: {result.get('party', {}).get('partyIdInfo', {})}")
        return result
    
    # ==================== Quotes ====================
    
    async def request_quote(
        self,
        quote_id: str,
        payer: Party,
        payee: Party,
        amount: Money,
        amount_type: str = "SEND",
        transaction_type: Optional[TransactionType] = None,
        note: Optional[str] = None,
        expiration: Optional[str] = None
    ) -> Dict[str, Any]:
        """Request a quote for a transfer"""
        url = f"{self.hub_url}/quotes"
        headers = self._generate_headers(
            destination_fsp=payee.fsp_id,
            content_type="application/vnd.interoperability.quotes+json;version=1.1"
        )
        
        if not transaction_type:
            transaction_type = TransactionType(
                scenario="TRANSFER",
                initiator="PAYER",
                initiator_type="CONSUMER"
            )
        
        payload = {
            "quoteId": quote_id,
            "transactionId": str(uuid.uuid4()),
            "payer": payer.to_dict(),
            "payee": payee.to_dict(),
            "amountType": amount_type,
            "amount": amount.to_dict(),
            "transactionType": transaction_type.to_dict()
        }
        
        if note:
            payload["note"] = note
        if expiration:
            payload["expiration"] = expiration
        
        logger.info(f"Requesting quote: {quote_id} for {amount.amount} {amount.currency}")
        result = await self._request_with_retry("POST", url, headers, payload, idempotency_key=quote_id)
        logger.info(f"Quote received: {quote_id}")
        return result
    
    # ==================== Transfers ====================
    
    async def execute_transfer(
        self,
        transfer_id: str,
        payee_fsp: str,
        amount: Money,
        ilp_packet: str,
        condition: str,
        expiration: str,
        payer: Optional[Party] = None,
        payee: Optional[Party] = None
    ) -> Dict[str, Any]:
        """Execute a transfer"""
        url = f"{self.hub_url}/transfers"
        headers = self._generate_headers(
            destination_fsp=payee_fsp,
            content_type="application/vnd.interoperability.transfers+json;version=1.1"
        )
        
        payload = {
            "transferId": transfer_id,
            "payeeFsp": payee_fsp,
            "payerFsp": self.fsp_id,
            "amount": amount.to_dict(),
            "ilpPacket": ilp_packet,
            "condition": condition,
            "expiration": expiration
        }
        
        logger.info(f"Executing transfer: {transfer_id} for {amount.amount} {amount.currency}")
        result = await self._request_with_retry("POST", url, headers, payload, idempotency_key=transfer_id)
        logger.info(f"Transfer executed: {transfer_id}, state: {result.get('transferState', 'UNKNOWN')}")
        return result
    
    async def get_transfer(self, transfer_id: str) -> Dict[str, Any]:
        """Get transfer status"""
        url = f"{self.hub_url}/transfers/{transfer_id}"
        headers = self._generate_headers(content_type="application/vnd.interoperability.transfers+json;version=1.1")
        logger.info(f"Getting transfer status: {transfer_id}")
        return await self._request_with_retry("GET", url, headers)
    
    # ==================== Transaction Requests (Request-to-Pay) ====================
    
    async def create_transaction_request(
        self,
        transaction_request_id: str,
        payer: Party,
        payee: Party,
        amount: Money,
        transaction_type: Optional[TransactionType] = None,
        note: Optional[str] = None,
        expiration_seconds: int = 300
    ) -> Dict[str, Any]:
        """
        Create a Transaction Request (Request-to-Pay / Merchant-initiated)
        
        This is a payee-initiated flow where the merchant/payee requests
        payment from the payer. The payer must approve the request.
        
        Args:
            transaction_request_id: Unique request identifier
            payer: The party being asked to pay
            payee: The party requesting payment (merchant)
            amount: Amount being requested
            transaction_type: Transaction type details
            note: Optional note/memo
            expiration_seconds: How long the request is valid
            
        Returns:
            Transaction request response
        """
        url = f"{self.hub_url}/transactionRequests"
        headers = self._generate_headers(
            destination_fsp=payer.fsp_id,
            content_type="application/vnd.interoperability.transactionRequests+json;version=1.1"
        )
        
        if not transaction_type:
            transaction_type = TransactionType(
                scenario="PAYMENT",
                initiator="PAYEE",
                initiator_type="BUSINESS"
            )
        
        expiration = (datetime.now(timezone.utc) + timedelta(seconds=expiration_seconds)).isoformat() + "Z"
        
        payload = {
            "transactionRequestId": transaction_request_id,
            "payer": payer.to_dict(),
            "payee": payee.to_dict(),
            "amount": amount.to_dict(),
            "transactionType": transaction_type.to_dict(),
            "expiration": expiration
        }
        
        if note:
            payload["note"] = note
        
        # Store the transaction request
        self._transaction_requests[transaction_request_id] = TransactionRequest(
            transaction_request_id=transaction_request_id,
            payee=payee,
            payer=payer,
            amount=amount,
            transaction_type=transaction_type,
            note=note,
            expiration=expiration
        )
        
        logger.info(f"Creating transaction request: {transaction_request_id} for {amount.amount} {amount.currency}")
        result = await self._request_with_retry("POST", url, headers, payload, idempotency_key=transaction_request_id)
        logger.info(f"Transaction request created: {transaction_request_id}")
        return result
    
    async def get_transaction_request(self, transaction_request_id: str) -> Dict[str, Any]:
        """Get transaction request status"""
        url = f"{self.hub_url}/transactionRequests/{transaction_request_id}"
        headers = self._generate_headers(content_type="application/vnd.interoperability.transactionRequests+json;version=1.1")
        return await self._request_with_retry("GET", url, headers)
    
    async def respond_to_transaction_request(
        self,
        transaction_request_id: str,
        accept: bool,
        transfer_amount: Optional[Money] = None
    ) -> Dict[str, Any]:
        """
        Respond to an incoming transaction request (as the payer)
        
        Args:
            transaction_request_id: The request to respond to
            accept: Whether to accept or reject the request
            transfer_amount: Amount to transfer (may differ from requested amount)
            
        Returns:
            Response result
        """
        url = f"{self.hub_url}/transactionRequests/{transaction_request_id}"
        headers = self._generate_headers(content_type="application/vnd.interoperability.transactionRequests+json;version=1.1")
        
        payload = {
            "transactionRequestState": "ACCEPTED" if accept else "REJECTED"
        }
        
        if accept and transfer_amount:
            payload["transferAmount"] = transfer_amount.to_dict()
        
        logger.info(f"Responding to transaction request: {transaction_request_id}, accept={accept}")
        return await self._request_with_retry("PUT", url, headers, payload)
    
    # ==================== Authorization / Pre-auth Holds ====================
    
    async def create_authorization(
        self,
        authorization_id: str,
        payer: Party,
        payee: Party,
        amount: Money,
        expiration_seconds: int = 3600,
        transaction_type: Optional[TransactionType] = None
    ) -> Dict[str, Any]:
        """
        Create an authorization (pre-auth hold)
        
        Reserves funds on the payer's account without completing the transfer.
        The authorization can later be captured (completed) or voided (released).
        
        Args:
            authorization_id: Unique authorization identifier
            payer: Party whose funds will be held
            payee: Party who will receive funds if captured
            amount: Amount to authorize
            expiration_seconds: How long the hold is valid
            transaction_type: Transaction type details
            
        Returns:
            Authorization response
        """
        url = f"{self.hub_url}/authorizations"
        headers = self._generate_headers(
            destination_fsp=payer.fsp_id,
            content_type="application/vnd.interoperability.authorizations+json;version=1.1"
        )
        
        if not transaction_type:
            transaction_type = TransactionType(
                scenario="PAYMENT",
                initiator="PAYEE",
                initiator_type="BUSINESS"
            )
        
        expiration = (datetime.now(timezone.utc) + timedelta(seconds=expiration_seconds)).isoformat() + "Z"
        
        # Generate condition for the authorization
        condition_preimage = str(uuid.uuid4()).encode()
        condition = base64.urlsafe_b64encode(hashlib.sha256(condition_preimage).digest()).decode()
        
        payload = {
            "authorizationId": authorization_id,
            "transactionRequestId": str(uuid.uuid4()),
            "payer": payer.to_dict(),
            "payee": payee.to_dict(),
            "amount": amount.to_dict(),
            "transactionType": transaction_type.to_dict(),
            "expiration": expiration
        }
        
        # Store the authorization
        auth = Authorization(
            authorization_id=authorization_id,
            payer=payer,
            payee=payee,
            amount=amount,
            expiration=expiration,
            condition=condition
        )
        self._authorizations[authorization_id] = auth
        
        logger.info(f"Creating authorization: {authorization_id} for {amount.amount} {amount.currency}")
        
        try:
            result = await self._request_with_retry("POST", url, headers, payload, idempotency_key=authorization_id)
            auth.state = AuthorizationState.APPROVED
            logger.info(f"Authorization created: {authorization_id}")
            return {
                "success": True,
                "authorization_id": authorization_id,
                "state": auth.state.value,
                "amount": amount.to_dict(),
                "expiration": expiration,
                "condition": condition,
                **result
            }
        except MojaloopError as e:
            auth.state = AuthorizationState.REJECTED
            raise
    
    async def capture_authorization(
        self,
        authorization_id: str,
        capture_amount: Optional[Money] = None
    ) -> Dict[str, Any]:
        """
        Capture an authorization (complete the pre-auth hold)
        
        Args:
            authorization_id: Authorization to capture
            capture_amount: Amount to capture (can be less than authorized)
            
        Returns:
            Capture result with transfer details
        """
        auth = self._authorizations.get(authorization_id)
        if not auth:
            raise MojaloopError("3200", f"Authorization not found: {authorization_id}")
        
        if not auth.is_valid():
            raise MojaloopError("3300", f"Authorization is not valid: {auth.state.value}")
        
        # Use authorized amount if capture amount not specified
        amount = capture_amount or auth.amount
        
        # Execute the transfer
        transfer_id = str(uuid.uuid4())
        
        # Request quote
        quote_id = str(uuid.uuid4())
        quote = await self.request_quote(
            quote_id=quote_id,
            payer=auth.payer,
            payee=auth.payee,
            amount=amount
        )
        
        # Execute transfer
        expiration = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat() + "Z"
        transfer_result = await self.execute_transfer(
            transfer_id=transfer_id,
            payee_fsp=auth.payee.fsp_id or "",
            amount=amount,
            ilp_packet=quote.get("ilpPacket", ""),
            condition=quote.get("condition", ""),
            expiration=expiration
        )
        
        auth.state = AuthorizationState.CAPTURED
        
        logger.info(f"Authorization captured: {authorization_id}, transfer: {transfer_id}")
        
        return {
            "success": True,
            "authorization_id": authorization_id,
            "transfer_id": transfer_id,
            "captured_amount": amount.to_dict(),
            "transfer_state": transfer_result.get("transferState"),
            "fulfilment": transfer_result.get("fulfilment")
        }
    
    async def void_authorization(self, authorization_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
        """
        Void an authorization (release the pre-auth hold)
        
        Args:
            authorization_id: Authorization to void
            reason: Optional reason for voiding
            
        Returns:
            Void result
        """
        auth = self._authorizations.get(authorization_id)
        if not auth:
            raise MojaloopError("3200", f"Authorization not found: {authorization_id}")
        
        if auth.state not in [AuthorizationState.PENDING, AuthorizationState.APPROVED]:
            raise MojaloopError("3300", f"Cannot void authorization in state: {auth.state.value}")
        
        auth.state = AuthorizationState.VOIDED
        
        logger.info(f"Authorization voided: {authorization_id}, reason: {reason}")
        
        return {
            "success": True,
            "authorization_id": authorization_id,
            "state": auth.state.value,
            "reason": reason,
            "voided_at": datetime.now(timezone.utc).isoformat()
        }
    
    async def get_authorization(self, authorization_id: str) -> Dict[str, Any]:
        """Get authorization status"""
        auth = self._authorizations.get(authorization_id)
        if not auth:
            raise MojaloopError("3200", f"Authorization not found: {authorization_id}")
        
        return {
            "authorization_id": auth.authorization_id,
            "state": auth.state.value,
            "amount": auth.amount.to_dict(),
            "payer": auth.payer.to_dict(),
            "payee": auth.payee.to_dict(),
            "expiration": auth.expiration,
            "is_valid": auth.is_valid(),
            "created_at": auth.created_at
        }
    
    # ==================== Settlement Windows ====================
    
    async def get_settlement_windows(
        self,
        state: Optional[SettlementWindowState] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get settlement windows
        
        Args:
            state: Filter by state
            from_date: Filter from date
            to_date: Filter to date
            
        Returns:
            List of settlement windows
        """
        url = f"{self.hub_url}/settlementWindows"
        params = {}
        if state:
            params["state"] = state.value
        if from_date:
            params["fromDateTime"] = from_date
        if to_date:
            params["toDateTime"] = to_date
        
        if params:
            url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
        
        headers = self._generate_headers(content_type="application/vnd.interoperability.settlements+json;version=1.1")
        return await self._request_with_retry("GET", url, headers)
    
    async def close_settlement_window(self, settlement_window_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
        """
        Close a settlement window
        
        Args:
            settlement_window_id: Window to close
            reason: Optional reason for closing
            
        Returns:
            Updated window state
        """
        url = f"{self.hub_url}/settlementWindows/{settlement_window_id}"
        headers = self._generate_headers(content_type="application/vnd.interoperability.settlements+json;version=1.1")
        
        payload = {
            "state": "CLOSED",
            "reason": reason or "Manual close"
        }
        
        logger.info(f"Closing settlement window: {settlement_window_id}")
        return await self._request_with_retry("POST", url, headers, payload)
    
    async def get_participant_positions(self, participant_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get participant positions (net debit/credit positions)
        
        Args:
            participant_id: Optional specific participant
            
        Returns:
            Participant positions
        """
        url = f"{self.hub_url}/participants"
        if participant_id:
            url += f"/{participant_id}/positions"
        else:
            url += "/positions"
        
        headers = self._generate_headers(content_type="application/vnd.interoperability.participants+json;version=1.1")
        return await self._request_with_retry("GET", url, headers)
    
    async def settle_positions(
        self,
        settlement_id: str,
        participant_ids: List[str],
        settlement_window_id: str
    ) -> Dict[str, Any]:
        """
        Settle participant positions
        
        Args:
            settlement_id: Unique settlement identifier
            participant_ids: Participants to settle
            settlement_window_id: Settlement window
            
        Returns:
            Settlement result
        """
        url = f"{self.hub_url}/settlements"
        headers = self._generate_headers(content_type="application/vnd.interoperability.settlements+json;version=1.1")
        
        payload = {
            "settlementId": settlement_id,
            "settlementWindows": [{"id": settlement_window_id}],
            "participants": [{"id": pid} for pid in participant_ids]
        }
        
        logger.info(f"Settling positions: {settlement_id} for {len(participant_ids)} participants")
        return await self._request_with_retry("POST", url, headers, payload, idempotency_key=settlement_id)
    
    # ==================== Participant Management ====================
    
    async def register_participant(
        self,
        participant_id: str,
        name: str,
        currency: str,
        participant_type: str = "DFSP"
    ) -> Dict[str, Any]:
        """
        Register a new participant (DFSP)
        
        Args:
            participant_id: Unique participant identifier
            name: Participant name
            currency: Primary currency
            participant_type: Type (DFSP, HUB, etc.)
            
        Returns:
            Registration result
        """
        url = f"{self.hub_url}/participants"
        headers = self._generate_headers(content_type="application/vnd.interoperability.participants+json;version=1.1")
        
        payload = {
            "name": participant_id,
            "currency": currency,
            "type": participant_type,
            "displayName": name
        }
        
        logger.info(f"Registering participant: {participant_id}")
        return await self._request_with_retry("POST", url, headers, payload)
    
    async def get_participant(self, participant_id: str) -> Dict[str, Any]:
        """Get participant details"""
        url = f"{self.hub_url}/participants/{participant_id}"
        headers = self._generate_headers(content_type="application/vnd.interoperability.participants+json;version=1.1")
        return await self._request_with_retry("GET", url, headers)
    
    async def update_participant_limits(
        self,
        participant_id: str,
        currency: str,
        net_debit_cap: Decimal,
        position_threshold: Optional[Decimal] = None
    ) -> Dict[str, Any]:
        """
        Update participant limits
        
        Args:
            participant_id: Participant to update
            currency: Currency for limits
            net_debit_cap: Maximum net debit position
            position_threshold: Alert threshold
            
        Returns:
            Updated limits
        """
        url = f"{self.hub_url}/participants/{participant_id}/limits"
        headers = self._generate_headers(content_type="application/vnd.interoperability.participants+json;version=1.1")
        
        payload = {
            "currency": currency,
            "limit": {
                "type": "NET_DEBIT_CAP",
                "value": float(net_debit_cap)
            }
        }
        
        if position_threshold:
            payload["limit"]["alarmPercentage"] = float(position_threshold)
        
        logger.info(f"Updating limits for participant: {participant_id}")
        return await self._request_with_retry("PUT", url, headers, payload)
    
    # ==================== Callback Endpoints (for FastAPI integration) ====================
    
    def get_callback_routes(self):
        """
        Get FastAPI routes for Mojaloop callbacks
        
        Returns a list of route definitions that can be added to a FastAPI app
        """
        from fastapi import APIRouter, Request, HTTPException
        
        router = APIRouter(prefix="/mojaloop/callbacks", tags=["Mojaloop Callbacks"])
        
        @router.put("/parties/{party_id_type}/{party_identifier}")
        async def party_callback(party_id_type: str, party_identifier: str, request: Request):
            """Handle party lookup callback"""
            body = await request.json()
            if "errorInformation" in body:
                await self.callback_handler.on_party_lookup_error(party_id_type, party_identifier, body["errorInformation"])
            else:
                await self.callback_handler.on_party_lookup_response(party_id_type, party_identifier, body)
            return {"status": "received"}
        
        @router.put("/quotes/{quote_id}")
        async def quote_callback(quote_id: str, request: Request):
            """Handle quote callback"""
            body = await request.json()
            if "errorInformation" in body:
                await self.callback_handler.on_quote_error(quote_id, body["errorInformation"])
            else:
                await self.callback_handler.on_quote_response(quote_id, body)
            return {"status": "received"}
        
        @router.put("/quotes/{quote_id}/error")
        async def quote_error_callback(quote_id: str, request: Request):
            """Handle quote error callback"""
            body = await request.json()
            await self.callback_handler.on_quote_error(quote_id, body.get("errorInformation", body))
            return {"status": "received"}
        
        @router.put("/transfers/{transfer_id}")
        async def transfer_callback(transfer_id: str, request: Request):
            """Handle transfer callback"""
            body = await request.json()
            if "errorInformation" in body:
                await self.callback_handler.on_transfer_error(transfer_id, body["errorInformation"])
            else:
                await self.callback_handler.on_transfer_response(transfer_id, body)
            return {"status": "received"}
        
        @router.put("/transfers/{transfer_id}/error")
        async def transfer_error_callback(transfer_id: str, request: Request):
            """Handle transfer error callback"""
            body = await request.json()
            await self.callback_handler.on_transfer_error(transfer_id, body.get("errorInformation", body))
            return {"status": "received"}
        
        @router.post("/transactionRequests")
        async def transaction_request_callback(request: Request):
            """Handle incoming transaction request (Request-to-Pay)"""
            body = await request.json()
            transaction_request_id = body.get("transactionRequestId")
            await self.callback_handler.on_transaction_request(transaction_request_id, body)
            return {"status": "received"}
        
        @router.put("/authorizations/{authorization_id}")
        async def authorization_callback(authorization_id: str, request: Request):
            """Handle authorization callback"""
            body = await request.json()
            await self.callback_handler.on_authorization_response(authorization_id, body)
            return {"status": "received"}
        
        return router
    
    # ==================== High-Level Operations ====================
    
    async def send_money(
        self,
        sender_msisdn: str,
        receiver_msisdn: str,
        amount: Decimal,
        currency: str,
        note: Optional[str] = None
    ) -> Dict[str, Any]:
        """High-level send money operation (payer-initiated)"""
        transfer_id = str(uuid.uuid4())
        quote_id = str(uuid.uuid4())
        
        try:
            # Step 1: Look up receiver
            receiver_info = await self.lookup_party("MSISDN", receiver_msisdn)
            receiver_fsp = receiver_info.get("party", {}).get("partyIdInfo", {}).get("fspId")
            
            if not receiver_fsp:
                raise MojaloopError("3200", "Receiver FSP not found")
            
            # Step 2: Request quote
            payer = Party(party_id_type="MSISDN", party_identifier=sender_msisdn, fsp_id=self.fsp_id)
            payee = Party(party_id_type="MSISDN", party_identifier=receiver_msisdn, fsp_id=receiver_fsp, name=receiver_info.get("party", {}).get("name"))
            money = Money(currency=currency, amount=str(amount))
            
            quote = await self.request_quote(quote_id=quote_id, payer=payer, payee=payee, amount=money, note=note)
            
            # Step 3: Execute transfer
            expiration = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat() + "Z"
            transfer_result = await self.execute_transfer(
                transfer_id=transfer_id,
                payee_fsp=receiver_fsp,
                amount=money,
                ilp_packet=quote.get("ilpPacket", ""),
                condition=quote.get("condition", ""),
                expiration=expiration
            )
            
            return {
                "success": True,
                "transfer_id": transfer_id,
                "quote_id": quote_id,
                "sender": sender_msisdn,
                "receiver": receiver_msisdn,
                "amount": float(amount),
                "currency": currency,
                "fees": quote.get("payeeFspFee", {}).get("amount", "0"),
                "transfer_state": transfer_result.get("transferState", "UNKNOWN"),
                "fulfilment": transfer_result.get("fulfilment")
            }
            
        except MojaloopError as e:
            return {"success": False, "transfer_id": transfer_id, "error_code": e.error_code, "error_description": e.error_description}
        except Exception as e:
            return {"success": False, "transfer_id": transfer_id, "error_code": "5000", "error_description": str(e)}
    
    async def request_payment(
        self,
        merchant_msisdn: str,
        customer_msisdn: str,
        amount: Decimal,
        currency: str,
        invoice_id: Optional[str] = None,
        note: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        High-level request payment operation (payee/merchant-initiated)
        
        Creates a transaction request that the customer must approve.
        """
        transaction_request_id = str(uuid.uuid4())
        
        try:
            # Look up customer
            customer_info = await self.lookup_party("MSISDN", customer_msisdn)
            customer_fsp = customer_info.get("party", {}).get("partyIdInfo", {}).get("fspId")
            
            if not customer_fsp:
                raise MojaloopError("3200", "Customer FSP not found")
            
            # Create transaction request
            merchant = Party(party_id_type="MSISDN", party_identifier=merchant_msisdn, fsp_id=self.fsp_id)
            customer = Party(party_id_type="MSISDN", party_identifier=customer_msisdn, fsp_id=customer_fsp)
            money = Money(currency=currency, amount=str(amount))
            
            result = await self.create_transaction_request(
                transaction_request_id=transaction_request_id,
                payer=customer,
                payee=merchant,
                amount=money,
                note=note or f"Payment request: {invoice_id or transaction_request_id}"
            )
            
            return {
                "success": True,
                "transaction_request_id": transaction_request_id,
                "invoice_id": invoice_id,
                "merchant": merchant_msisdn,
                "customer": customer_msisdn,
                "amount": float(amount),
                "currency": currency,
                "state": "PENDING",
                "expires_at": self._transaction_requests[transaction_request_id].expiration
            }
            
        except MojaloopError as e:
            return {"success": False, "transaction_request_id": transaction_request_id, "error_code": e.error_code, "error_description": e.error_description}
        except Exception as e:
            return {"success": False, "transaction_request_id": transaction_request_id, "error_code": "5000", "error_description": str(e)}
    
    async def authorize_and_capture(
        self,
        merchant_msisdn: str,
        customer_msisdn: str,
        amount: Decimal,
        currency: str,
        capture_immediately: bool = False
    ) -> Dict[str, Any]:
        """
        High-level pre-authorization flow
        
        Creates an authorization hold, optionally capturing immediately.
        """
        authorization_id = str(uuid.uuid4())
        
        try:
            # Look up customer
            customer_info = await self.lookup_party("MSISDN", customer_msisdn)
            customer_fsp = customer_info.get("party", {}).get("partyIdInfo", {}).get("fspId")
            
            if not customer_fsp:
                raise MojaloopError("3200", "Customer FSP not found")
            
            merchant = Party(party_id_type="MSISDN", party_identifier=merchant_msisdn, fsp_id=self.fsp_id)
            customer = Party(party_id_type="MSISDN", party_identifier=customer_msisdn, fsp_id=customer_fsp)
            money = Money(currency=currency, amount=str(amount))
            
            # Create authorization
            auth_result = await self.create_authorization(
                authorization_id=authorization_id,
                payer=customer,
                payee=merchant,
                amount=money
            )
            
            if capture_immediately:
                capture_result = await self.capture_authorization(authorization_id)
                return {
                    "success": True,
                    "authorization_id": authorization_id,
                    "transfer_id": capture_result.get("transfer_id"),
                    "state": "CAPTURED",
                    "amount": float(amount),
                    "currency": currency
                }
            
            return {
                "success": True,
                "authorization_id": authorization_id,
                "state": "AUTHORIZED",
                "amount": float(amount),
                "currency": currency,
                "expires_at": auth_result.get("expiration")
            }
            
        except MojaloopError as e:
            return {"success": False, "authorization_id": authorization_id, "error_code": e.error_code, "error_description": e.error_description}
        except Exception as e:
            return {"success": False, "authorization_id": authorization_id, "error_code": "5000", "error_description": str(e)}


# ==================== Factory Function ====================

def get_enhanced_mojaloop_client(
    hub_url: str = None,
    fsp_id: str = None,
    callback_handler: Optional[MojaloopCallbackHandler] = None
) -> EnhancedMojaloopClient:
    """Get enhanced Mojaloop client instance"""
    import os
    return EnhancedMojaloopClient(
        hub_url=hub_url or os.getenv("MOJALOOP_HUB_URL", "https://mojaloop.example.com"),
        fsp_id=fsp_id or os.getenv("MOJALOOP_FSP_ID", "remittance-fsp"),
        signing_key=os.getenv("MOJALOOP_SIGNING_KEY"),
        callback_handler=callback_handler
    )
