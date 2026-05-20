"""
Flutterwave API Client
Complete implementation of Flutterwave payment gateway API
"""

import os
import hashlib
import hmac
import requests
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class FlutterwaveAPIError(Exception):
    """Custom exception for Flutterwave API errors"""
    
    def __init__(self, message: str, status_code: int = 400, response: Optional[Dict] = None):
        self.message = message
        self.status_code = status_code
        self.response = response or {}
        super().__init__(self.message)


class FlutterwaveClient:
    """
    Flutterwave API Client
    
    Complete implementation of Flutterwave payment gateway API
    Supports: Payments, Transfers, Virtual Accounts, Subscriptions, etc.
    
    Documentation: https://developer.flutterwave.com/docs
    """
    
    BASE_URL_PRODUCTION = "https://api.flutterwave.com/v3"
    BASE_URL_SANDBOX = "https://api.flutterwave.com/v3"
    
    def __init__(
        self,
        secret_key: Optional[str] = None,
        public_key: Optional[str] = None,
        encryption_key: Optional[str] = None,
        environment: str = "sandbox",
        timeout: int = 30
    ):
        """
        Initialize Flutterwave client
        
        Args:
            secret_key: Flutterwave secret key
            public_key: Flutterwave public key
            encryption_key: Flutterwave encryption key
            environment: 'sandbox' or 'production'
            timeout: Request timeout in seconds
        """
        self.secret_key = secret_key or os.getenv("FLUTTERWAVE_SECRET_KEY")
        self.public_key = public_key or os.getenv("FLUTTERWAVE_PUBLIC_KEY")
        self.encryption_key = encryption_key or os.getenv("FLUTTERWAVE_ENCRYPTION_KEY")
        self.environment = environment
        self.timeout = timeout
        
        if not self.secret_key:
            raise ValueError("Flutterwave secret key is required")
        
        self.base_url = self.BASE_URL_PRODUCTION if environment == "production" else self.BASE_URL_SANDBOX
        
        logger.info(f"Flutterwave client initialized ({environment})")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get request headers"""
        return {
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json"
        }
    
    def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Make HTTP request to Flutterwave API
        
        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            endpoint: API endpoint
            data: Request body data
            params: Query parameters
            
        Returns:
            API response data
            
        Raises:
            FlutterwaveAPIError: If request fails
        """
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_headers()
        
        try:
            logger.debug(f"Making {method} request to {endpoint}")
            
            response = requests.request(
                method=method,
                url=url,
                json=data,
                params=params,
                headers=headers,
                timeout=self.timeout
            )
            
            response_data = response.json()
            
            # Check if request was successful
            if response.status_code >= 400:
                error_message = response_data.get("message", "Unknown error")
                logger.error(f"Flutterwave API error: {error_message}")
                raise FlutterwaveAPIError(
                    message=error_message,
                    status_code=response.status_code,
                    response=response_data
                )
            
            # Check Flutterwave status field
            if response_data.get("status") == "error":
                error_message = response_data.get("message", "Unknown error")
                logger.error(f"Flutterwave error: {error_message}")
                raise FlutterwaveAPIError(
                    message=error_message,
                    status_code=response.status_code,
                    response=response_data
                )
            
            logger.debug(f"Request successful: {endpoint}")
            return response_data.get("data", response_data)
            
        except requests.exceptions.Timeout:
            logger.error(f"Request timeout: {endpoint}")
            raise FlutterwaveAPIError("Request timeout", status_code=408)
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed: {str(e)}")
            raise FlutterwaveAPIError(f"Request failed: {str(e)}", status_code=500)
    
    # ==================== PAYMENTS ====================
    
    def initialize_payment(
        self,
        tx_ref: str,
        amount: float,
        currency: str,
        redirect_url: str,
        customer: Dict[str, str],
        payment_options: Optional[str] = None,
        customizations: Optional[Dict[str, str]] = None,
        meta: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Initialize a payment
        
        Args:
            tx_ref: Unique transaction reference
            amount: Amount to charge
            currency: Currency code (NGN, USD, GHS, etc.)
            redirect_url: URL to redirect after payment
            customer: Customer details (email, phone_number, name)
            payment_options: Comma-separated payment methods (card,banktransfer,ussd,etc)
            customizations: UI customizations (title, description, logo)
            meta: Additional metadata
            
        Returns:
            Payment initialization response with link
        """
        data = {
            "tx_ref": tx_ref,
            "amount": amount,
            "currency": currency,
            "redirect_url": redirect_url,
            "customer": customer,
            "payment_options": payment_options or "card,banktransfer,ussd,mobilemoney",
            "customizations": customizations or {},
            "meta": meta or {}
        }
        
        return self._make_request("POST", "payments", data=data)
    
    def verify_transaction(self, transaction_id: int) -> Dict[str, Any]:
        """
        Verify a transaction
        
        Args:
            transaction_id: Flutterwave transaction ID
            
        Returns:
            Transaction details
        """
        return self._make_request("GET", f"transactions/{transaction_id}/verify")
    
    def verify_transaction_by_reference(self, tx_ref: str) -> Dict[str, Any]:
        """
        Verify transaction by reference
        
        Args:
            tx_ref: Transaction reference
            
        Returns:
            Transaction details
        """
        params = {"tx_ref": tx_ref}
        return self._make_request("GET", "transactions/verify_by_reference", params=params)
    
    # ==================== CHARGES ====================
    
    def charge_card(
        self,
        card_number: str,
        cvv: str,
        expiry_month: str,
        expiry_year: str,
        currency: str,
        amount: float,
        email: str,
        tx_ref: str,
        authorization: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Charge a card
        
        Args:
            card_number: Card number
            cvv: Card CVV
            expiry_month: Card expiry month
            expiry_year: Card expiry year
            currency: Currency code
            amount: Amount to charge
            email: Customer email
            tx_ref: Transaction reference
            authorization: Authorization details for saved cards
            
        Returns:
            Charge response
        """
        data = {
            "card_number": card_number,
            "cvv": cvv,
            "expiry_month": expiry_month,
            "expiry_year": expiry_year,
            "currency": currency,
            "amount": amount,
            "email": email,
            "tx_ref": tx_ref,
            "authorization": authorization or {}
        }
        
        return self._make_request("POST", "charges?type=card", data=data)
    
    def charge_bank_account(
        self,
        account_bank: str,
        account_number: str,
        currency: str,
        amount: float,
        email: str,
        tx_ref: str
    ) -> Dict[str, Any]:
        """
        Charge a bank account
        
        Args:
            account_bank: Bank code
            account_number: Account number
            currency: Currency code
            amount: Amount to charge
            email: Customer email
            tx_ref: Transaction reference
            
        Returns:
            Charge response
        """
        data = {
            "account_bank": account_bank,
            "account_number": account_number,
            "currency": currency,
            "amount": amount,
            "email": email,
            "tx_ref": tx_ref
        }
        
        return self._make_request("POST", "charges?type=debit_ng_account", data=data)
    
    # ==================== TRANSFERS ====================
    
    def create_transfer(
        self,
        account_bank: str,
        account_number: str,
        amount: float,
        currency: str,
        narration: str,
        reference: str,
        beneficiary_name: Optional[str] = None,
        meta: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Create a transfer
        
        Args:
            account_bank: Bank code
            account_number: Account number
            amount: Amount to transfer
            currency: Currency code
            narration: Transfer narration
            reference: Unique reference
            beneficiary_name: Beneficiary name
            meta: Additional metadata
            
        Returns:
            Transfer response
        """
        data = {
            "account_bank": account_bank,
            "account_number": account_number,
            "amount": amount,
            "currency": currency,
            "narration": narration,
            "reference": reference,
            "beneficiary_name": beneficiary_name,
            "meta": meta or {}
        }
        
        return self._make_request("POST", "transfers", data=data)
    
    def create_bulk_transfer(self, bulk_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Create bulk transfers
        
        Args:
            bulk_data: List of transfer objects
            
        Returns:
            Bulk transfer response
        """
        data = {"bulk_data": bulk_data}
        return self._make_request("POST", "bulk-transfers", data=data)
    
    def get_transfer(self, transfer_id: int) -> Dict[str, Any]:
        """
        Get transfer details
        
        Args:
            transfer_id: Transfer ID
            
        Returns:
            Transfer details
        """
        return self._make_request("GET", f"transfers/{transfer_id}")
    
    def get_transfer_fee(self, amount: float, currency: str) -> Dict[str, Any]:
        """
        Get transfer fee
        
        Args:
            amount: Transfer amount
            currency: Currency code
            
        Returns:
            Fee details
        """
        params = {"amount": amount, "currency": currency}
        return self._make_request("GET", "transfers/fee", params=params)
    
    # ==================== BANKS ====================
    
    def get_banks(self, country: str = "NG") -> List[Dict[str, Any]]:
        """
        Get list of banks
        
        Args:
            country: Country code (NG, GH, KE, UG, ZA, TZ)
            
        Returns:
            List of banks
        """
        params = {"country": country}
        return self._make_request("GET", "banks/" + country, params=params)
    
    def verify_bank_account(
        self,
        account_number: str,
        account_bank: str
    ) -> Dict[str, Any]:
        """
        Verify bank account
        
        Args:
            account_number: Account number
            account_bank: Bank code
            
        Returns:
            Account details
        """
        data = {
            "account_number": account_number,
            "account_bank": account_bank
        }
        
        return self._make_request("POST", "accounts/resolve", data=data)
    
    # ==================== VIRTUAL ACCOUNTS ====================
    
    def create_virtual_account(
        self,
        email: str,
        is_permanent: bool = True,
        bvn: Optional[str] = None,
        tx_ref: Optional[str] = None,
        firstname: Optional[str] = None,
        lastname: Optional[str] = None,
        narration: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a virtual account
        
        Args:
            email: Customer email
            is_permanent: Whether account is permanent
            bvn: Customer BVN
            tx_ref: Transaction reference
            firstname: Customer first name
            lastname: Customer last name
            narration: Account narration
            
        Returns:
            Virtual account details
        """
        data = {
            "email": email,
            "is_permanent": is_permanent,
            "bvn": bvn,
            "tx_ref": tx_ref,
            "firstname": firstname,
            "lastname": lastname,
            "narration": narration
        }
        
        # Remove None values
        data = {k: v for k, v in data.items() if v is not None}
        
        return self._make_request("POST", "virtual-account-numbers", data=data)
    
    def get_virtual_account(self, order_ref: str) -> Dict[str, Any]:
        """
        Get virtual account details
        
        Args:
            order_ref: Order reference
            
        Returns:
            Virtual account details
        """
        params = {"order_ref": order_ref}
        return self._make_request("GET", "virtual-account-numbers", params=params)
    
    # ==================== REFUNDS ====================
    
    def create_refund(
        self,
        transaction_id: int,
        amount: Optional[float] = None,
        comments: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a refund
        
        Args:
            transaction_id: Transaction ID to refund
            amount: Amount to refund (full refund if not specified)
            comments: Refund comments
            
        Returns:
            Refund response
        """
        data = {
            "id": transaction_id,
            "amount": amount,
            "comments": comments
        }
        
        # Remove None values
        data = {k: v for k, v in data.items() if v is not None}
        
        return self._make_request("POST", "transactions/refund", data=data)
    
    # ==================== BENEFICIARIES ====================
    
    def create_beneficiary(
        self,
        account_number: str,
        account_bank: str,
        beneficiary_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a beneficiary
        
        Args:
            account_number: Account number
            account_bank: Bank code
            beneficiary_name: Beneficiary name
            
        Returns:
            Beneficiary details
        """
        data = {
            "account_number": account_number,
            "account_bank": account_bank,
            "beneficiary_name": beneficiary_name
        }
        
        return self._make_request("POST", "beneficiaries", data=data)
    
    def list_beneficiaries(self) -> List[Dict[str, Any]]:
        """
        List all beneficiaries
        
        Returns:
            List of beneficiaries
        """
        return self._make_request("GET", "beneficiaries")
    
    # ==================== WEBHOOK VERIFICATION ====================
    
    def verify_webhook_signature(self, payload: bytes, signature: str) -> bool:
        """
        Verify Flutterwave webhook signature
        
        Args:
            payload: Raw request body
            signature: verif-hash header value
            
        Returns:
            True if signature is valid
        """
        if not self.secret_key:
            logger.error("Secret key not configured for webhook verification")
            return False
        
        # Flutterwave uses secret key as hash
        expected_signature = self.secret_key
        
        # Constant-time comparison to prevent timing attacks
        return hmac.compare_digest(signature, expected_signature)
