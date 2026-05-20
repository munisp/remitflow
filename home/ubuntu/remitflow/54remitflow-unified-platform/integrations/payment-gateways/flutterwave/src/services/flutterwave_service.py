"""
Flutterwave Service Layer
High-level business logic for Flutterwave payment operations
"""

import os
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

from ..api.flutterwave_client import FlutterwaveClient, FlutterwaveAPIError

logger = logging.getLogger(__name__)


class FlutterwaveService:
    """
    Flutterwave Service Layer
    
    Provides high-level business logic for payment operations
    Handles transaction persistence, reference generation, and error handling
    """
    
    def __init__(
        self,
        secret_key: Optional[str] = None,
        public_key: Optional[str] = None,
        encryption_key: Optional[str] = None,
        environment: str = "sandbox"
    ):
        """
        Initialize Flutterwave service
        
        Args:
            secret_key: Flutterwave secret key
            public_key: Flutterwave public key
            encryption_key: Flutterwave encryption key
            environment: 'sandbox' or 'production'
        """
        self.client = FlutterwaveClient(
            secret_key=secret_key,
            public_key=public_key,
            encryption_key=encryption_key,
            environment=environment
        )
        
        logger.info("Flutterwave service initialized")
    
    def generate_reference(self, prefix: str = "FLW") -> str:
        """
        Generate unique transaction reference
        
        Args:
            prefix: Reference prefix
            
        Returns:
            Unique reference string
        """
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        unique_id = str(uuid.uuid4())[:8].upper()
        return f"{prefix}-{timestamp}-{unique_id}"
    
    # ==================== PAYMENTS ====================
    
    def initialize_payment(
        self,
        amount: float,
        customer_email: str,
        customer_name: str,
        customer_phone: Optional[str] = None,
        currency: str = "NGN",
        redirect_url: Optional[str] = None,
        payment_options: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Initialize a payment
        
        Args:
            amount: Amount to charge
            customer_email: Customer email
            customer_name: Customer name
            customer_phone: Customer phone number
            currency: Currency code (NGN, USD, GHS, etc.)
            redirect_url: URL to redirect after payment
            payment_options: Payment methods (card,banktransfer,ussd,etc)
            metadata: Additional metadata
            
        Returns:
            Payment initialization response
        """
        try:
            # Generate unique reference
            tx_ref = self.generate_reference()
            
            # Prepare customer data
            customer = {
                "email": customer_email,
                "name": customer_name
            }
            if customer_phone:
                customer["phonenumber"] = customer_phone
            
            # Default redirect URL
            if not redirect_url:
                redirect_url = os.getenv("FLUTTERWAVE_REDIRECT_URL", "https://example.com/callback")
            
            # Initialize payment
            response = self.client.initialize_payment(
                tx_ref=tx_ref,
                amount=amount,
                currency=currency,
                redirect_url=redirect_url,
                customer=customer,
                payment_options=payment_options,
                meta=metadata
            )
            
            logger.info(f"Payment initialized: {tx_ref}")
            
            return {
                "reference": tx_ref,
                "payment_url": response.get("link"),
                "amount": amount,
                "currency": currency,
                "status": "pending"
            }
            
        except FlutterwaveAPIError as e:
            logger.error(f"Payment initialization failed: {e.message}")
            raise
    
    def verify_payment(self, transaction_id: int) -> Dict[str, Any]:
        """
        Verify a payment
        
        Args:
            transaction_id: Flutterwave transaction ID
            
        Returns:
            Payment verification response
        """
        try:
            response = self.client.verify_transaction(transaction_id)
            
            logger.info(f"Payment verified: {transaction_id}")
            
            return {
                "transaction_id": response.get("id"),
                "reference": response.get("tx_ref"),
                "amount": response.get("amount"),
                "currency": response.get("currency"),
                "status": response.get("status"),
                "customer_email": response.get("customer", {}).get("email"),
                "payment_type": response.get("payment_type"),
                "charged_amount": response.get("charged_amount"),
                "app_fee": response.get("app_fee"),
                "merchant_fee": response.get("merchant_fee"),
                "processor_response": response.get("processor_response"),
                "created_at": response.get("created_at")
            }
            
        except FlutterwaveAPIError as e:
            logger.error(f"Payment verification failed: {e.message}")
            raise
    
    def verify_payment_by_reference(self, tx_ref: str) -> Dict[str, Any]:
        """
        Verify payment by reference
        
        Args:
            tx_ref: Transaction reference
            
        Returns:
            Payment verification response
        """
        try:
            response = self.client.verify_transaction_by_reference(tx_ref)
            
            logger.info(f"Payment verified by reference: {tx_ref}")
            
            return {
                "transaction_id": response.get("id"),
                "reference": response.get("tx_ref"),
                "amount": response.get("amount"),
                "currency": response.get("currency"),
                "status": response.get("status"),
                "customer_email": response.get("customer", {}).get("email"),
                "payment_type": response.get("payment_type")
            }
            
        except FlutterwaveAPIError as e:
            logger.error(f"Payment verification failed: {e.message}")
            raise
    
    # ==================== TRANSFERS ====================
    
    def create_transfer(
        self,
        account_number: str,
        account_bank: str,
        amount: float,
        narration: str,
        currency: str = "NGN",
        beneficiary_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create a transfer
        
        Args:
            account_number: Beneficiary account number
            account_bank: Bank code
            amount: Amount to transfer
            narration: Transfer narration
            currency: Currency code
            beneficiary_name: Beneficiary name
            metadata: Additional metadata
            
        Returns:
            Transfer response
        """
        try:
            # Generate unique reference
            reference = self.generate_reference("TRF")
            
            response = self.client.create_transfer(
                account_bank=account_bank,
                account_number=account_number,
                amount=amount,
                currency=currency,
                narration=narration,
                reference=reference,
                beneficiary_name=beneficiary_name,
                meta=metadata
            )
            
            logger.info(f"Transfer created: {reference}")
            
            return {
                "reference": reference,
                "transfer_id": response.get("id"),
                "account_number": response.get("account_number"),
                "bank_name": response.get("bank_name"),
                "amount": response.get("amount"),
                "currency": response.get("currency"),
                "status": response.get("status"),
                "fee": response.get("fee"),
                "created_at": response.get("created_at")
            }
            
        except FlutterwaveAPIError as e:
            logger.error(f"Transfer creation failed: {e.message}")
            raise
    
    def get_transfer(self, transfer_id: int) -> Dict[str, Any]:
        """
        Get transfer details
        
        Args:
            transfer_id: Transfer ID
            
        Returns:
            Transfer details
        """
        try:
            response = self.client.get_transfer(transfer_id)
            
            return {
                "transfer_id": response.get("id"),
                "reference": response.get("reference"),
                "account_number": response.get("account_number"),
                "bank_name": response.get("bank_name"),
                "amount": response.get("amount"),
                "currency": response.get("currency"),
                "status": response.get("status"),
                "narration": response.get("narration"),
                "created_at": response.get("created_at"),
                "completed_at": response.get("completed_at")
            }
            
        except FlutterwaveAPIError as e:
            logger.error(f"Get transfer failed: {e.message}")
            raise
    
    # ==================== VIRTUAL ACCOUNTS ====================
    
    def create_virtual_account(
        self,
        email: str,
        bvn: str,
        tx_ref: Optional[str] = None,
        firstname: Optional[str] = None,
        lastname: Optional[str] = None,
        phonenumber: Optional[str] = None,
        narration: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a virtual account
        
        Args:
            email: Customer email
            bvn: Bank Verification Number
            tx_ref: Transaction reference
            firstname: Customer first name
            lastname: Customer last name
            phonenumber: Customer phone number
            narration: Account narration
            
        Returns:
            Virtual account details
        """
        try:
            if not tx_ref:
                tx_ref = self.generate_reference("VA")
            
            response = self.client.create_virtual_account(
                email=email,
                bvn=bvn,
                tx_ref=tx_ref,
                firstname=firstname,
                lastname=lastname,
                phonenumber=phonenumber,
                narration=narration
            )
            
            logger.info(f"Virtual account created: {tx_ref}")
            
            return {
                "reference": tx_ref,
                "account_number": response.get("account_number"),
                "bank_name": response.get("bank_name"),
                "account_reference": response.get("order_ref"),
                "amount": response.get("amount"),
                "status": response.get("response_code"),
                "created_at": response.get("created_at")
            }
            
        except FlutterwaveAPIError as e:
            logger.error(f"Virtual account creation failed: {e.message}")
            raise
    
    # ==================== BANKS ====================
    
    def list_banks(self, country: str = "NG") -> List[Dict[str, Any]]:
        """
        List banks
        
        Args:
            country: Country code (NG, GH, KE, etc.)
            
        Returns:
            List of banks
        """
        try:
            response = self.client.list_banks(country)
            
            return [
                {
                    "id": bank.get("id"),
                    "code": bank.get("code"),
                    "name": bank.get("name")
                }
                for bank in response
            ]
            
        except FlutterwaveAPIError as e:
            logger.error(f"List banks failed: {e.message}")
            raise
    
    def resolve_account(self, account_number: str, account_bank: str) -> Dict[str, Any]:
        """
        Resolve bank account
        
        Args:
            account_number: Account number
            account_bank: Bank code
            
        Returns:
            Account details
        """
        try:
            response = self.client.resolve_account(account_number, account_bank)
            
            return {
                "account_number": response.get("account_number"),
                "account_name": response.get("account_name"),
                "bank_code": account_bank
            }
            
        except FlutterwaveAPIError as e:
            logger.error(f"Account resolution failed: {e.message}")
            raise
    
    # ==================== WEBHOOKS ====================
    
    def handle_webhook_event(self, payload: bytes, signature: str) -> Dict[str, Any]:
        """
        Handle webhook event
        
        Args:
            payload: Raw request body
            signature: verif-hash header value
            
        Returns:
            Processed event data
            
        Raises:
            ValueError: If signature is invalid
        """
        # Verify signature
        if not self.client.verify_webhook_signature(payload, signature):
            logger.error("Invalid webhook signature")
            raise ValueError("Invalid webhook signature")
        
        # Parse payload
        import json
        event_data = json.loads(payload)
        
        event_type = event_data.get("event")
        data = event_data.get("data", {})
        
        logger.info(f"Webhook received: {event_type}")
        
        # Process based on event type
        if event_type == "charge.completed":
            return self._handle_charge_completed(data)
        elif event_type == "transfer.completed":
            return self._handle_transfer_completed(data)
        else:
            logger.warning(f"Unhandled event type: {event_type}")
            return {"event": event_type, "data": data}
    
    def _handle_charge_completed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle charge completed event"""
        logger.info(f"Charge completed: {data.get('tx_ref')}")
        
        return {
            "event": "charge.completed",
            "reference": data.get("tx_ref"),
            "transaction_id": data.get("id"),
            "amount": data.get("amount"),
            "currency": data.get("currency"),
            "status": data.get("status"),
            "customer_email": data.get("customer", {}).get("email")
        }
    
    def _handle_transfer_completed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle transfer completed event"""
        logger.info(f"Transfer completed: {data.get('reference')}")
        
        return {
            "event": "transfer.completed",
            "reference": data.get("reference"),
            "transfer_id": data.get("id"),
            "amount": data.get("amount"),
            "currency": data.get("currency"),
            "status": data.get("status"),
            "account_number": data.get("account_number")
        }
