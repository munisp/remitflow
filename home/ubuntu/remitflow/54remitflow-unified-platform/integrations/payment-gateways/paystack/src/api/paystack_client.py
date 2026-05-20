"""
Paystack API Client
Production-ready client for Paystack payment gateway integration
"""

import os
import hmac
import hashlib
import requests
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class PaystackClient:
    """
    Comprehensive Paystack API client
    
    Supports:
    - Transaction initialization and verification
    - Customer management
    - Refunds and transfers
    - Webhook signature verification
    - Comprehensive error handling
    """
    
    BASE_URL = "https://api.paystack.co"
    
    def __init__(
        self,
        secret_key: Optional[str] = None,
        public_key: Optional[str] = None,
        timeout: int = 30
    ):
        """
        Initialize Paystack client
        
        Args:
            secret_key: Paystack secret key (from environment if not provided)
            public_key: Paystack public key (from environment if not provided)
            timeout: Request timeout in seconds
        """
        self.secret_key = secret_key or os.getenv("PAYSTACK_SECRET_KEY")
        self.public_key = public_key or os.getenv("PAYSTACK_PUBLIC_KEY")
        self.timeout = timeout
        
        if not self.secret_key:
            raise ValueError("Paystack secret key is required")
        
        self.headers = {
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json"
        }
    
    def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Make HTTP request to Paystack API
        
        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            endpoint: API endpoint
            data: Request body data
            params: Query parameters
            
        Returns:
            Response data as dictionary
            
        Raises:
            PaystackAPIError: If API request fails
        """
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            logger.info(f"Paystack API request: {method} {endpoint}")
            
            response = requests.request(
                method=method,
                url=url,
                headers=self.headers,
                json=data,
                params=params,
                timeout=self.timeout
            )
            
            response_data = response.json()
            
            if not response_data.get("status"):
                error_message = response_data.get("message", "Unknown error")
                logger.error(f"Paystack API error: {error_message}")
                raise PaystackAPIError(error_message, response.status_code)
            
            logger.info(f"Paystack API success: {endpoint}")
            return response_data
            
        except requests.exceptions.Timeout:
            logger.error(f"Paystack API timeout: {endpoint}")
            raise PaystackAPIError("Request timeout", 408)
        except requests.exceptions.RequestException as e:
            logger.error(f"Paystack API request failed: {str(e)}")
            raise PaystackAPIError(f"Request failed: {str(e)}", 500)
    
    # ==================== TRANSACTIONS ====================
    
    def initialize_transaction(
        self,
        email: str,
        amount: int,
        reference: Optional[str] = None,
        callback_url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        channels: Optional[List[str]] = None,
        currency: str = "NGN"
    ) -> Dict[str, Any]:
        """
        Initialize a transaction
        
        Args:
            email: Customer email
            amount: Amount in kobo (100 kobo = 1 NGN)
            reference: Unique transaction reference
            callback_url: URL to redirect after payment
            metadata: Additional transaction metadata
            channels: Payment channels (card, bank, ussd, qr, mobile_money, bank_transfer)
            currency: Transaction currency (default: NGN)
            
        Returns:
            Transaction initialization data including authorization_url
        """
        data = {
            "email": email,
            "amount": amount,
            "currency": currency
        }
        
        if reference:
            data["reference"] = reference
        if callback_url:
            data["callback_url"] = callback_url
        if metadata:
            data["metadata"] = metadata
        if channels:
            data["channels"] = channels
        
        response = self._make_request("POST", "/transaction/initialize", data=data)
        return response["data"]
    
    def verify_transaction(self, reference: str) -> Dict[str, Any]:
        """
        Verify a transaction
        
        Args:
            reference: Transaction reference
            
        Returns:
            Transaction verification data
        """
        response = self._make_request("GET", f"/transaction/verify/{reference}")
        return response["data"]
    
    def list_transactions(
        self,
        per_page: int = 50,
        page: int = 1,
        customer: Optional[int] = None,
        status: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        List transactions
        
        Args:
            per_page: Number of transactions per page
            page: Page number
            customer: Customer ID to filter by
            status: Transaction status (success, failed, abandoned)
            from_date: Start date (YYYY-MM-DD)
            to_date: End date (YYYY-MM-DD)
            
        Returns:
            List of transactions
        """
        params = {
            "perPage": per_page,
            "page": page
        }
        
        if customer:
            params["customer"] = customer
        if status:
            params["status"] = status
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date
        
        response = self._make_request("GET", "/transaction", params=params)
        return response["data"]
    
    def charge_authorization(
        self,
        email: str,
        amount: int,
        authorization_code: str,
        reference: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        currency: str = "NGN"
    ) -> Dict[str, Any]:
        """
        Charge a customer using saved authorization
        
        Args:
            email: Customer email
            amount: Amount in kobo
            authorization_code: Authorization code from previous transaction
            reference: Unique transaction reference
            metadata: Additional metadata
            currency: Transaction currency
            
        Returns:
            Charge response data
        """
        data = {
            "email": email,
            "amount": amount,
            "authorization_code": authorization_code,
            "currency": currency
        }
        
        if reference:
            data["reference"] = reference
        if metadata:
            data["metadata"] = metadata
        
        response = self._make_request("POST", "/transaction/charge_authorization", data=data)
        return response["data"]
    
    # ==================== CUSTOMERS ====================
    
    def create_customer(
        self,
        email: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        phone: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create a customer
        
        Args:
            email: Customer email
            first_name: Customer first name
            last_name: Customer last name
            phone: Customer phone number
            metadata: Additional customer metadata
            
        Returns:
            Customer data
        """
        data = {"email": email}
        
        if first_name:
            data["first_name"] = first_name
        if last_name:
            data["last_name"] = last_name
        if phone:
            data["phone"] = phone
        if metadata:
            data["metadata"] = metadata
        
        response = self._make_request("POST", "/customer", data=data)
        return response["data"]
    
    def get_customer(self, email_or_code: str) -> Dict[str, Any]:
        """
        Get customer details
        
        Args:
            email_or_code: Customer email or customer code
            
        Returns:
            Customer data
        """
        response = self._make_request("GET", f"/customer/{email_or_code}")
        return response["data"]
    
    def list_customers(
        self,
        per_page: int = 50,
        page: int = 1
    ) -> Dict[str, Any]:
        """
        List customers
        
        Args:
            per_page: Number of customers per page
            page: Page number
            
        Returns:
            List of customers
        """
        params = {
            "perPage": per_page,
            "page": page
        }
        
        response = self._make_request("GET", "/customer", params=params)
        return response["data"]
    
    # ==================== REFUNDS ====================
    
    def create_refund(
        self,
        transaction: str,
        amount: Optional[int] = None,
        currency: str = "NGN",
        customer_note: Optional[str] = None,
        merchant_note: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a refund
        
        Args:
            transaction: Transaction reference or ID
            amount: Amount to refund in kobo (full refund if not specified)
            currency: Currency
            customer_note: Note for customer
            merchant_note: Internal note
            
        Returns:
            Refund data
        """
        data = {
            "transaction": transaction,
            "currency": currency
        }
        
        if amount:
            data["amount"] = amount
        if customer_note:
            data["customer_note"] = customer_note
        if merchant_note:
            data["merchant_note"] = merchant_note
        
        response = self._make_request("POST", "/refund", data=data)
        return response["data"]
    
    def list_refunds(
        self,
        reference: Optional[str] = None,
        currency: Optional[str] = None,
        per_page: int = 50,
        page: int = 1
    ) -> Dict[str, Any]:
        """
        List refunds
        
        Args:
            reference: Transaction reference
            currency: Currency filter
            per_page: Number of refunds per page
            page: Page number
            
        Returns:
            List of refunds
        """
        params = {
            "perPage": per_page,
            "page": page
        }
        
        if reference:
            params["reference"] = reference
        if currency:
            params["currency"] = currency
        
        response = self._make_request("GET", "/refund", params=params)
        return response["data"]
    
    # ==================== TRANSFERS ====================
    
    def initiate_transfer(
        self,
        source: str,
        amount: int,
        recipient: str,
        reason: Optional[str] = None,
        currency: str = "NGN",
        reference: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Initiate a transfer
        
        Args:
            source: Transfer source (balance)
            amount: Amount in kobo
            recipient: Recipient code
            reason: Transfer reason
            currency: Currency
            reference: Unique reference
            
        Returns:
            Transfer data
        """
        data = {
            "source": source,
            "amount": amount,
            "recipient": recipient,
            "currency": currency
        }
        
        if reason:
            data["reason"] = reason
        if reference:
            data["reference"] = reference
        
        response = self._make_request("POST", "/transfer", data=data)
        return response["data"]
    
    def verify_transfer(self, reference: str) -> Dict[str, Any]:
        """
        Verify a transfer
        
        Args:
            reference: Transfer reference
            
        Returns:
            Transfer verification data
        """
        response = self._make_request("GET", f"/transfer/verify/{reference}")
        return response["data"]
    
    # ==================== BANKS ====================
    
    def list_banks(self, country: str = "nigeria") -> List[Dict[str, Any]]:
        """
        List supported banks
        
        Args:
            country: Country code (nigeria, ghana, south africa)
            
        Returns:
            List of banks
        """
        params = {"country": country}
        response = self._make_request("GET", "/bank", params=params)
        return response["data"]
    
    def resolve_account_number(
        self,
        account_number: str,
        bank_code: str
    ) -> Dict[str, Any]:
        """
        Resolve account number to get account name
        
        Args:
            account_number: Account number
            bank_code: Bank code
            
        Returns:
            Account details
        """
        params = {
            "account_number": account_number,
            "bank_code": bank_code
        }
        
        response = self._make_request("GET", "/bank/resolve", params=params)
        return response["data"]
    
    # ==================== WEBHOOKS ====================
    
    def verify_webhook_signature(
        self,
        payload: bytes,
        signature: str
    ) -> bool:
        """
        Verify Paystack webhook signature
        
        Args:
            payload: Raw request body
            signature: X-Paystack-Signature header value
            
        Returns:
            True if signature is valid, False otherwise
        """
        computed_signature = hmac.new(
            self.secret_key.encode('utf-8'),
            payload,
            hashlib.sha512
        ).hexdigest()
        
        return hmac.compare_digest(computed_signature, signature)


class PaystackAPIError(Exception):
    """Paystack API error exception"""
    
    def __init__(self, message: str, status_code: int):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)
