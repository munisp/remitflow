"""
Paystack Service Layer
High-level service for Paystack integration with business logic
"""

import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

from ..api.paystack_client import PaystackClient, PaystackAPIError
from ..models.transaction import Transaction, TransactionStatus
from ..models.customer import Customer

logger = logging.getLogger(__name__)


class PaystackService:
    """
    High-level Paystack service with business logic
    
    Features:
    - Transaction management with database persistence
    - Customer management
    - Automatic reference generation
    - Webhook event handling
    - Error handling and retry logic
    """
    
    def __init__(self, client: Optional[PaystackClient] = None):
        """
        Initialize Paystack service
        
        Args:
            client: PaystackClient instance (creates new if not provided)
        """
        self.client = client or PaystackClient()
    
    def _generate_reference(self, prefix: str = "TXN") -> str:
        """Generate unique transaction reference"""
        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        unique_id = str(uuid.uuid4())[:8].upper()
        return f"{prefix}-{timestamp}-{unique_id}"
    
    # ==================== PAYMENT PROCESSING ====================
    
    def initiate_payment(
        self,
        email: str,
        amount_ngn: float,
        callback_url: str,
        metadata: Optional[Dict[str, Any]] = None,
        channels: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Initiate a payment transaction
        
        Args:
            email: Customer email
            amount_ngn: Amount in Naira (will be converted to kobo)
            callback_url: URL to redirect after payment
            metadata: Additional transaction metadata
            channels: Payment channels to enable
            
        Returns:
            Dictionary with transaction details and authorization_url
        """
        try:
            # Convert amount to kobo (Paystack uses kobo)
            amount_kobo = int(amount_ngn * 100)
            
            # Generate unique reference
            reference = self._generate_reference()
            
            # Add system metadata
            full_metadata = {
                "initiated_at": datetime.utcnow().isoformat(),
                "source": "remittance_platform",
                **(metadata or {})
            }
            
            logger.info(f"Initiating Paystack payment: {reference} for {email}")
            
            # Initialize transaction with Paystack
            response = self.client.initialize_transaction(
                email=email,
                amount=amount_kobo,
                reference=reference,
                callback_url=callback_url,
                metadata=full_metadata,
                channels=channels
            )
            
            # Create transaction record
            transaction = Transaction(
                reference=reference,
                email=email,
                amount_kobo=amount_kobo,
                amount_ngn=amount_ngn,
                status=TransactionStatus.PENDING,
                authorization_url=response["authorization_url"],
                access_code=response["access_code"],
                metadata=full_metadata,
                created_at=datetime.utcnow()
            )
            
            # Save to database (implement your database logic here)
            # db.session.add(transaction)
            # db.session.commit()
            
            logger.info(f"Payment initiated successfully: {reference}")
            
            return {
                "reference": reference,
                "authorization_url": response["authorization_url"],
                "access_code": response["access_code"],
                "amount_ngn": amount_ngn,
                "amount_kobo": amount_kobo
            }
            
        except PaystackAPIError as e:
            logger.error(f"Paystack API error: {e.message}")
            raise
        except Exception as e:
            logger.error(f"Payment initiation failed: {str(e)}")
            raise
    
    def verify_payment(self, reference: str) -> Dict[str, Any]:
        """
        Verify a payment transaction
        
        Args:
            reference: Transaction reference
            
        Returns:
            Transaction verification details
        """
        try:
            logger.info(f"Verifying payment: {reference}")
            
            # Verify with Paystack
            response = self.client.verify_transaction(reference)
            
            # Update transaction in database
            # transaction = Transaction.query.filter_by(reference=reference).first()
            # if transaction:
            #     transaction.status = TransactionStatus.SUCCESS if response["status"] == "success" else TransactionStatus.FAILED
            #     transaction.verified_at = datetime.utcnow()
            #     transaction.paystack_response = response
            #     db.session.commit()
            
            logger.info(f"Payment verified: {reference} - Status: {response['status']}")
            
            return {
                "reference": reference,
                "status": response["status"],
                "amount": response["amount"] / 100,  # Convert kobo to NGN
                "currency": response["currency"],
                "customer": response["customer"],
                "paid_at": response.get("paid_at"),
                "channel": response.get("channel"),
                "authorization": response.get("authorization")
            }
            
        except PaystackAPIError as e:
            logger.error(f"Payment verification failed: {e.message}")
            raise
    
    def charge_customer(
        self,
        email: str,
        amount_ngn: float,
        authorization_code: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Charge a customer using saved card authorization
        
        Args:
            email: Customer email
            amount_ngn: Amount in Naira
            authorization_code: Authorization code from previous transaction
            metadata: Additional metadata
            
        Returns:
            Charge result
        """
        try:
            amount_kobo = int(amount_ngn * 100)
            reference = self._generate_reference("CHG")
            
            logger.info(f"Charging customer: {email} - {amount_ngn} NGN")
            
            response = self.client.charge_authorization(
                email=email,
                amount=amount_kobo,
                authorization_code=authorization_code,
                reference=reference,
                metadata=metadata
            )
            
            logger.info(f"Customer charged successfully: {reference}")
            
            return {
                "reference": reference,
                "status": response["status"],
                "amount_ngn": amount_ngn,
                "message": response.get("message")
            }
            
        except PaystackAPIError as e:
            logger.error(f"Customer charge failed: {e.message}")
            raise
    
    # ==================== CUSTOMER MANAGEMENT ====================
    
    def create_or_get_customer(
        self,
        email: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        phone: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create a new customer or get existing customer
        
        Args:
            email: Customer email
            first_name: Customer first name
            last_name: Customer last name
            phone: Customer phone number
            metadata: Additional metadata
            
        Returns:
            Customer details
        """
        try:
            # Try to get existing customer
            try:
                customer = self.client.get_customer(email)
                logger.info(f"Customer already exists: {email}")
                return customer
            except PaystackAPIError:
                # Customer doesn't exist, create new
                pass
            
            # Create new customer
            logger.info(f"Creating new customer: {email}")
            customer = self.client.create_customer(
                email=email,
                first_name=first_name,
                last_name=last_name,
                phone=phone,
                metadata=metadata
            )
            
            logger.info(f"Customer created successfully: {email}")
            return customer
            
        except PaystackAPIError as e:
            logger.error(f"Customer operation failed: {e.message}")
            raise
    
    def get_customer_transactions(
        self,
        customer_id: int,
        per_page: int = 50,
        page: int = 1
    ) -> List[Dict[str, Any]]:
        """
        Get customer transaction history
        
        Args:
            customer_id: Paystack customer ID
            per_page: Number of transactions per page
            page: Page number
            
        Returns:
            List of transactions
        """
        try:
            response = self.client.list_transactions(
                customer=customer_id,
                per_page=per_page,
                page=page
            )
            
            return response
            
        except PaystackAPIError as e:
            logger.error(f"Failed to get customer transactions: {e.message}")
            raise
    
    # ==================== REFUNDS ====================
    
    def process_refund(
        self,
        transaction_reference: str,
        amount_ngn: Optional[float] = None,
        customer_note: Optional[str] = None,
        merchant_note: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a refund
        
        Args:
            transaction_reference: Original transaction reference
            amount_ngn: Amount to refund (full refund if not specified)
            customer_note: Note for customer
            merchant_note: Internal note
            
        Returns:
            Refund details
        """
        try:
            amount_kobo = int(amount_ngn * 100) if amount_ngn else None
            
            logger.info(f"Processing refund for transaction: {transaction_reference}")
            
            response = self.client.create_refund(
                transaction=transaction_reference,
                amount=amount_kobo,
                customer_note=customer_note,
                merchant_note=merchant_note
            )
            
            logger.info(f"Refund processed successfully: {transaction_reference}")
            
            return {
                "status": response["status"],
                "message": response.get("message"),
                "refund_id": response.get("id"),
                "amount": response.get("amount", 0) / 100 if response.get("amount") else None
            }
            
        except PaystackAPIError as e:
            logger.error(f"Refund processing failed: {e.message}")
            raise
    
    # ==================== TRANSFERS ====================
    
    def transfer_to_customer(
        self,
        recipient_code: str,
        amount_ngn: float,
        reason: str
    ) -> Dict[str, Any]:
        """
        Transfer funds to a customer
        
        Args:
            recipient_code: Paystack recipient code
            amount_ngn: Amount in Naira
            reason: Transfer reason
            
        Returns:
            Transfer details
        """
        try:
            amount_kobo = int(amount_ngn * 100)
            reference = self._generate_reference("TRF")
            
            logger.info(f"Initiating transfer: {reference} - {amount_ngn} NGN")
            
            response = self.client.initiate_transfer(
                source="balance",
                amount=amount_kobo,
                recipient=recipient_code,
                reason=reason,
                reference=reference
            )
            
            logger.info(f"Transfer initiated successfully: {reference}")
            
            return {
                "reference": reference,
                "status": response["status"],
                "amount_ngn": amount_ngn,
                "transfer_code": response.get("transfer_code")
            }
            
        except PaystackAPIError as e:
            logger.error(f"Transfer failed: {e.message}")
            raise
    
    # ==================== BANK OPERATIONS ====================
    
    def get_banks(self, country: str = "nigeria") -> List[Dict[str, Any]]:
        """
        Get list of supported banks
        
        Args:
            country: Country code
            
        Returns:
            List of banks
        """
        try:
            banks = self.client.list_banks(country=country)
            return banks
        except PaystackAPIError as e:
            logger.error(f"Failed to get banks: {e.message}")
            raise
    
    def verify_bank_account(
        self,
        account_number: str,
        bank_code: str
    ) -> Dict[str, Any]:
        """
        Verify bank account and get account name
        
        Args:
            account_number: Account number
            bank_code: Bank code
            
        Returns:
            Account details
        """
        try:
            logger.info(f"Verifying bank account: {account_number}")
            
            response = self.client.resolve_account_number(
                account_number=account_number,
                bank_code=bank_code
            )
            
            logger.info(f"Bank account verified: {response['account_name']}")
            
            return {
                "account_number": response["account_number"],
                "account_name": response["account_name"],
                "bank_code": bank_code
            }
            
        except PaystackAPIError as e:
            logger.error(f"Bank account verification failed: {e.message}")
            raise
    
    # ==================== WEBHOOK HANDLING ====================
    
    def handle_webhook_event(
        self,
        payload: bytes,
        signature: str
    ) -> Dict[str, Any]:
        """
        Handle Paystack webhook event
        
        Args:
            payload: Raw request body
            signature: X-Paystack-Signature header
            
        Returns:
            Event data
            
        Raises:
            ValueError: If signature is invalid
        """
        # Verify signature
        if not self.client.verify_webhook_signature(payload, signature):
            logger.error("Invalid webhook signature")
            raise ValueError("Invalid webhook signature")
        
        import json
        event_data = json.loads(payload)
        
        event_type = event_data.get("event")
        data = event_data.get("data", {})
        
        logger.info(f"Processing webhook event: {event_type}")
        
        # Handle different event types
        if event_type == "charge.success":
            self._handle_charge_success(data)
        elif event_type == "transfer.success":
            self._handle_transfer_success(data)
        elif event_type == "transfer.failed":
            self._handle_transfer_failed(data)
        elif event_type == "refund.processed":
            self._handle_refund_processed(data)
        
        return event_data
    
    def _handle_charge_success(self, data: Dict[str, Any]):
        """Handle successful charge event"""
        reference = data.get("reference")
        logger.info(f"Charge successful: {reference}")
        
        # Update transaction status in database
        # transaction = Transaction.query.filter_by(reference=reference).first()
        # if transaction:
        #     transaction.status = TransactionStatus.SUCCESS
        #     transaction.paid_at = datetime.utcnow()
        #     db.session.commit()
    
    def _handle_transfer_success(self, data: Dict[str, Any]):
        """Handle successful transfer event"""
        reference = data.get("reference")
        logger.info(f"Transfer successful: {reference}")
        
        # Update transfer status in database
    
    def _handle_transfer_failed(self, data: Dict[str, Any]):
        """Handle failed transfer event"""
        reference = data.get("reference")
        logger.error(f"Transfer failed: {reference}")
        
        # Update transfer status and notify user
    
    def _handle_refund_processed(self, data: Dict[str, Any]):
        """Handle refund processed event"""
        transaction_reference = data.get("transaction", {}).get("reference")
        logger.info(f"Refund processed for: {transaction_reference}")
        
        # Update refund status in database
