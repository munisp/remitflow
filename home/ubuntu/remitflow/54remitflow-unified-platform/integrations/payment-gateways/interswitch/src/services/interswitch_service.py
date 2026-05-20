"""
Interswitch Service Layer
High-level service for Interswitch integration with business logic
"""

import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

from ..api.interswitch_client import InterswitchClient, InterswitchAPIError
from ..models.transaction import Transaction, TransactionStatus, TransactionType
from ..models.bill_payment import BillPayment, BillPaymentStatus

logger = logging.getLogger(__name__)


class InterswitchService:
    """
    High-level Interswitch service with business logic
    
    Features:
    - Webpay payment processing
    - Bill payments via Quickteller
    - Bank transfers
    - BVN and account validation
    - Verve card tokenization
    - Transaction management
    """
    
    def __init__(self, client: Optional[InterswitchClient] = None):
        """
        Initialize Interswitch service
        
        Args:
            client: InterswitchClient instance
        """
        self.client = client or InterswitchClient()
    
    def _generate_reference(self, prefix: str = "ISW") -> str:
        """Generate unique transaction reference"""
        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        unique_id = str(uuid.uuid4())[:8].upper()
        return f"{prefix}-{timestamp}-{unique_id}"
    
    # ==================== WEBPAY PAYMENTS ====================
    
    def initiate_payment(
        self,
        amount_ngn: float,
        customer_email: str,
        customer_name: str,
        redirect_url: str,
        currency: str = "NGN",
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Initiate a Webpay payment
        
        Args:
            amount_ngn: Amount in Naira
            customer_email: Customer email
            customer_name: Customer name
            redirect_url: Redirect URL after payment
            currency: Currency code (NGN or USD)
            metadata: Additional metadata
            
        Returns:
            Payment initialization details with payment URL
        """
        try:
            reference = self._generate_reference("PAY")
            
            # Currency codes: 566 = NGN, 840 = USD
            currency_code = "566" if currency == "NGN" else "840"
            
            logger.info(f"Initiating Webpay payment: {reference}")
            
            response = self.client.initialize_webpay(
                amount=amount_ngn,
                currency_code=currency_code,
                customer_email=customer_email,
                customer_name=customer_name,
                redirect_url=redirect_url,
                transaction_reference=reference
            )
            
            # Create transaction record
            transaction = Transaction(
                reference=reference,
                type=TransactionType.PAYMENT,
                amount=amount_ngn,
                currency=currency,
                customer_email=customer_email,
                customer_name=customer_name,
                status=TransactionStatus.PENDING,
                metadata=metadata or {},
                created_at=datetime.utcnow()
            )
            
            # Save to database (implement your database logic)
            # db.session.add(transaction)
            # db.session.commit()
            
            logger.info(f"Payment initiated: {reference}")
            
            return {
                "reference": reference,
                "payment_url": response["payment_url"],
                "amount": amount_ngn,
                "currency": currency,
                "status": "pending"
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Payment initiation failed: {e.message}")
            raise
    
    def verify_payment(self, reference: str, amount: float) -> Dict[str, Any]:
        """
        Verify a payment transaction
        
        Args:
            reference: Transaction reference
            amount: Transaction amount
            
        Returns:
            Payment verification details
        """
        try:
            logger.info(f"Verifying payment: {reference}")
            
            response = self.client.query_webpay_transaction(
                transaction_reference=reference,
                amount=amount
            )
            
            # Update transaction status
            # transaction = Transaction.query.filter_by(reference=reference).first()
            # if transaction:
            #     response_code = response.get("responseCode")
            #     transaction.status = TransactionStatus.SUCCESS if response_code == "00" else TransactionStatus.FAILED
            #     transaction.verified_at = datetime.utcnow()
            #     db.session.commit()
            
            logger.info(f"Payment verified: {reference}")
            
            return {
                "reference": reference,
                "status": "success" if response.get("responseCode") == "00" else "failed",
                "amount": amount,
                "response_code": response.get("responseCode"),
                "response_description": response.get("responseDescription")
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Payment verification failed: {e.message}")
            raise
    
    # ==================== BILL PAYMENTS ====================
    
    def get_bill_categories(self) -> List[Dict[str, Any]]:
        """
        Get bill payment categories
        
        Returns:
            List of categories
        """
        try:
            categories = self.client.get_biller_categories()
            return categories
        except InterswitchAPIError as e:
            logger.error(f"Failed to get categories: {e.message}")
            raise
    
    def get_billers(self, category_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get billers
        
        Args:
            category_id: Filter by category
            
        Returns:
            List of billers
        """
        try:
            billers = self.client.get_billers(category_id=category_id)
            return billers
        except InterswitchAPIError as e:
            logger.error(f"Failed to get billers: {e.message}")
            raise
    
    def validate_bill_customer(
        self,
        biller_id: str,
        customer_id: str,
        payment_code: str
    ) -> Dict[str, Any]:
        """
        Validate customer for bill payment
        
        Args:
            biller_id: Biller ID
            customer_id: Customer ID (meter number, phone, etc.)
            payment_code: Payment code
            
        Returns:
            Customer validation details
        """
        try:
            logger.info(f"Validating customer: {customer_id} for biller {biller_id}")
            
            response = self.client.validate_customer(
                biller_id=biller_id,
                customer_id=customer_id,
                payment_code=payment_code
            )
            
            logger.info(f"Customer validated: {customer_id}")
            return response
            
        except InterswitchAPIError as e:
            logger.error(f"Customer validation failed: {e.message}")
            raise
    
    def pay_bill(
        self,
        biller_id: str,
        customer_id: str,
        payment_code: str,
        amount: float,
        customer_email: Optional[str] = None,
        customer_phone: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Pay a bill
        
        Args:
            biller_id: Biller ID
            customer_id: Customer ID
            payment_code: Payment code
            amount: Amount to pay
            customer_email: Customer email
            customer_phone: Customer phone
            
        Returns:
            Payment response
        """
        try:
            reference = self._generate_reference("BILL")
            
            logger.info(f"Paying bill: {reference} - {amount} NGN")
            
            response = self.client.pay_bill(
                biller_id=biller_id,
                customer_id=customer_id,
                payment_code=payment_code,
                amount=amount,
                transaction_reference=reference,
                customer_email=customer_email,
                customer_phone=customer_phone
            )
            
            # Create bill payment record
            bill_payment = BillPayment(
                reference=reference,
                biller_id=biller_id,
                customer_id=customer_id,
                amount=amount,
                status=BillPaymentStatus.SUCCESS if response.get("responseCode") == "00" else BillPaymentStatus.FAILED,
                created_at=datetime.utcnow()
            )
            
            # Save to database
            # db.session.add(bill_payment)
            # db.session.commit()
            
            logger.info(f"Bill paid: {reference}")
            
            return {
                "reference": reference,
                "status": "success" if response.get("responseCode") == "00" else "failed",
                "amount": amount,
                "response_code": response.get("responseCode"),
                "response_description": response.get("responseDescription")
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Bill payment failed: {e.message}")
            raise
    
    def buy_airtime(
        self,
        phone_number: str,
        amount: float
    ) -> Dict[str, Any]:
        """
        Buy airtime
        
        Args:
            phone_number: Phone number
            amount: Amount in Naira
            
        Returns:
            Airtime purchase response
        """
        try:
            reference = self._generate_reference("AIR")
            
            logger.info(f"Buying airtime: {phone_number} - {amount} NGN")
            
            response = self.client.buy_airtime(
                phone_number=phone_number,
                amount=amount,
                transaction_reference=reference
            )
            
            logger.info(f"Airtime purchased: {reference}")
            
            return {
                "reference": reference,
                "phone_number": phone_number,
                "amount": amount,
                "status": "success" if response.get("responseCode") == "00" else "failed"
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Airtime purchase failed: {e.message}")
            raise
    
    # ==================== TRANSFERS ====================
    
    def transfer_funds(
        self,
        account_number: str,
        bank_code: str,
        amount: float,
        narration: str,
        beneficiary_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Transfer funds to bank account
        
        Args:
            account_number: Beneficiary account number
            bank_code: Bank code
            amount: Amount to transfer
            narration: Transfer narration
            beneficiary_name: Beneficiary name
            
        Returns:
            Transfer response
        """
        try:
            reference = self._generate_reference("TRF")
            
            logger.info(f"Initiating transfer: {reference} - {amount} NGN")
            
            response = self.client.initiate_transfer(
                beneficiary_account_number=account_number,
                beneficiary_bank_code=bank_code,
                amount=amount,
                narration=narration,
                transaction_reference=reference,
                beneficiary_name=beneficiary_name
            )
            
            logger.info(f"Transfer initiated: {reference}")
            
            return {
                "reference": reference,
                "account_number": account_number,
                "amount": amount,
                "status": "success" if response.get("responseCode") == "00" else "failed",
                "response_code": response.get("responseCode")
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Transfer failed: {e.message}")
            raise
    
    def query_transfer(self, reference: str) -> Dict[str, Any]:
        """
        Query transfer status
        
        Args:
            reference: Transaction reference
            
        Returns:
            Transfer status
        """
        try:
            logger.info(f"Querying transfer: {reference}")
            
            response = self.client.query_transfer(reference)
            
            return {
                "reference": reference,
                "status": "success" if response.get("responseCode") == "00" else "failed",
                "response_code": response.get("responseCode"),
                "response_description": response.get("responseDescription")
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Transfer query failed: {e.message}")
            raise
    
    # ==================== VALIDATION ====================
    
    def validate_bvn(
        self,
        bvn: str,
        first_name: str,
        last_name: str,
        date_of_birth: str
    ) -> Dict[str, Any]:
        """
        Validate BVN
        
        Args:
            bvn: BVN (11 digits)
            first_name: First name
            last_name: Last name
            date_of_birth: Date of birth (DD-MM-YYYY)
            
        Returns:
            BVN validation result
        """
        try:
            logger.info(f"Validating BVN: {bvn}")
            
            response = self.client.validate_bvn(
                bvn=bvn,
                first_name=first_name,
                last_name=last_name,
                date_of_birth=date_of_birth
            )
            
            is_valid = response.get("responseCode") == "00"
            logger.info(f"BVN validation: {'valid' if is_valid else 'invalid'}")
            
            return {
                "bvn": bvn,
                "is_valid": is_valid,
                "response_code": response.get("responseCode"),
                "response_description": response.get("responseDescription")
            }
            
        except InterswitchAPIError as e:
            logger.error(f"BVN validation failed: {e.message}")
            raise
    
    def validate_account(
        self,
        account_number: str,
        bank_code: str
    ) -> Dict[str, Any]:
        """
        Validate bank account
        
        Args:
            account_number: Account number
            bank_code: Bank code
            
        Returns:
            Account validation result with account name
        """
        try:
            logger.info(f"Validating account: {account_number}")
            
            response = self.client.validate_account_number(
                account_number=account_number,
                bank_code=bank_code
            )
            
            logger.info(f"Account validated: {response.get('accountName')}")
            
            return {
                "account_number": account_number,
                "account_name": response.get("accountName"),
                "bank_code": bank_code,
                "is_valid": response.get("responseCode") == "00"
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Account validation failed: {e.message}")
            raise
    
    # ==================== VERVE CARD ====================
    
    def tokenize_verve_card(
        self,
        pan: str,
        expiry_date: str,
        cvv: str,
        pin: str
    ) -> Dict[str, Any]:
        """
        Tokenize Verve card
        
        Args:
            pan: Card number
            expiry_date: Expiry date (YYMM)
            cvv: CVV
            pin: PIN
            
        Returns:
            Token details
        """
        try:
            logger.info("Tokenizing Verve card")
            
            response = self.client.tokenize_verve_card(
                pan=pan,
                expiry_date=expiry_date,
                cvv=cvv,
                pin=pin
            )
            
            logger.info("Verve card tokenized successfully")
            
            return {
                "token": response.get("token"),
                "masked_pan": f"{pan[:6]}******{pan[-4:]}",
                "expiry_date": expiry_date
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Card tokenization failed: {e.message}")
            raise
    
    def charge_verve_token(
        self,
        token: str,
        amount: float,
        currency: str = "NGN"
    ) -> Dict[str, Any]:
        """
        Charge Verve card using token
        
        Args:
            token: Card token
            amount: Amount to charge
            currency: Currency code
            
        Returns:
            Charge response
        """
        try:
            reference = self._generate_reference("VRV")
            currency_code = "566" if currency == "NGN" else "840"
            
            logger.info(f"Charging Verve token: {reference}")
            
            response = self.client.charge_verve_token(
                token=token,
                amount=amount,
                currency_code=currency_code,
                transaction_reference=reference
            )
            
            logger.info(f"Verve token charged: {reference}")
            
            return {
                "reference": reference,
                "amount": amount,
                "status": "success" if response.get("responseCode") == "00" else "failed",
                "response_code": response.get("responseCode")
            }
            
        except InterswitchAPIError as e:
            logger.error(f"Verve charge failed: {e.message}")
            raise
    
    # ==================== WEBHOOK HANDLING ====================
    
    def handle_webhook_event(
        self,
        payload: bytes,
        signature: str
    ) -> Dict[str, Any]:
        """
        Handle Interswitch webhook event
        
        Args:
            payload: Raw request body
            signature: X-Interswitch-Signature header
            
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
        
        event_type = event_data.get("eventType")
        logger.info(f"Processing webhook event: {event_type}")
        
        # Handle different event types
        if event_type == "payment.success":
            self._handle_payment_success(event_data)
        elif event_type == "payment.failed":
            self._handle_payment_failed(event_data)
        elif event_type == "transfer.success":
            self._handle_transfer_success(event_data)
        elif event_type == "transfer.failed":
            self._handle_transfer_failed(event_data)
        
        return event_data
    
    def _handle_payment_success(self, data: Dict[str, Any]):
        """Handle successful payment event"""
        reference = data.get("transactionReference")
        logger.info(f"Payment successful: {reference}")
        
        # Update transaction status
        # transaction = Transaction.query.filter_by(reference=reference).first()
        # if transaction:
        #     transaction.status = TransactionStatus.SUCCESS
        #     transaction.paid_at = datetime.utcnow()
        #     db.session.commit()
    
    def _handle_payment_failed(self, data: Dict[str, Any]):
        """Handle failed payment event"""
        reference = data.get("transactionReference")
        logger.error(f"Payment failed: {reference}")
        
        # Update transaction status
        # transaction = Transaction.query.filter_by(reference=reference).first()
        # if transaction:
        #     transaction.status = TransactionStatus.FAILED
        #     db.session.commit()
    
    def _handle_transfer_success(self, data: Dict[str, Any]):
        """Handle successful transfer event"""
        reference = data.get("transactionReference")
        logger.info(f"Transfer successful: {reference}")
    
    def _handle_transfer_failed(self, data: Dict[str, Any]):
        """Handle failed transfer event"""
        reference = data.get("transactionReference")
        logger.error(f"Transfer failed: {reference}")
