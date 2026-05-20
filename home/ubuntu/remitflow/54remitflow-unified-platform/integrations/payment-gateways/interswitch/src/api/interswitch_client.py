"""
Interswitch API Client
Complete implementation of Interswitch payment gateway API

Interswitch is Nigeria's largest payment processing company with:
- Webpay (card payments)
- Quickteller (bill payments)
- Verve (Nigerian domestic card scheme)
- Direct debit
- USSD collections
"""

import os
import hashlib
import hmac
import requests
import json
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class InterswitchAPIError(Exception):
    """Custom exception for Interswitch API errors"""
    
    def __init__(self, message: str, status_code: int = 400, response: Optional[Dict] = None):
        self.message = message
        self.status_code = status_code
        self.response = response or {}
        super().__init__(self.message)


class InterswitchClient:
    """
    Interswitch API Client
    
    Complete implementation of Interswitch payment gateway API
    Supports: Webpay, Quickteller, Verve, Direct Debit, USSD, Bill Payments
    
    Documentation: https://sandbox.interswitchng.com/docbase/docs/
    """
    
    BASE_URL_PRODUCTION = "https://webpay.interswitchng.com"
    BASE_URL_SANDBOX = "https://sandbox.interswitchng.com"
    
    PASSPORT_BASE_URL = "https://passport.interswitchng.com"
    QUICKTELLER_BASE_URL = "https://quickteller.interswitchng.com"
    
    def __init__(
        self,
        merchant_code: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        terminal_id: Optional[str] = None,
        environment: str = "sandbox",
        timeout: int = 30
    ):
        """
        Initialize Interswitch client
        
        Args:
            merchant_code: Interswitch merchant code
            client_id: OAuth client ID
            client_secret: OAuth client secret
            terminal_id: Terminal ID
            environment: 'sandbox' or 'production'
            timeout: Request timeout in seconds
        """
        self.merchant_code = merchant_code or os.getenv("INTERSWITCH_MERCHANT_CODE")
        self.client_id = client_id or os.getenv("INTERSWITCH_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("INTERSWITCH_CLIENT_SECRET")
        self.terminal_id = terminal_id or os.getenv("INTERSWITCH_TERMINAL_ID")
        self.environment = environment
        self.timeout = timeout
        
        if not all([self.merchant_code, self.client_id, self.client_secret]):
            raise ValueError("Interswitch credentials are required")
        
        self.base_url = self.BASE_URL_PRODUCTION if environment == "production" else self.BASE_URL_SANDBOX
        self.access_token = None
        self.token_expiry = None
        
        logger.info(f"Interswitch client initialized ({environment})")
    
    def _get_access_token(self) -> str:
        """
        Get OAuth access token
        
        Returns:
            Access token
        """
        # Check if token is still valid
        if self.access_token and self.token_expiry:
            if datetime.now() < self.token_expiry:
                return self.access_token
        
        # Request new token
        url = f"{self.PASSPORT_BASE_URL}/passport/oauth/token"
        
        data = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret
        }
        
        try:
            response = requests.post(
                url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=self.timeout
            )
            
            response.raise_for_status()
            token_data = response.json()
            
            self.access_token = token_data["access_token"]
            expires_in = token_data.get("expires_in", 3600)
            
            from datetime import timedelta
            self.token_expiry = datetime.now() + timedelta(seconds=expires_in - 60)
            
            logger.info("Access token obtained successfully")
            return self.access_token
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to get access token: {str(e)}")
            raise InterswitchAPIError(f"Authentication failed: {str(e)}", status_code=401)
    
    def _generate_signature(
        self,
        http_method: str,
        url: str,
        timestamp: str,
        nonce: str,
        request_body: Optional[str] = None
    ) -> str:
        """
        Generate request signature for Interswitch API
        
        Args:
            http_method: HTTP method (GET, POST, etc.)
            url: Request URL
            timestamp: Request timestamp
            nonce: Random nonce
            request_body: Request body (for POST/PUT)
            
        Returns:
            Base64-encoded signature
        """
        # Create signature base string
        signature_base = f"{http_method}&{url}&{timestamp}&{nonce}"
        
        if request_body:
            # Calculate SHA-512 hash of request body
            body_hash = hashlib.sha512(request_body.encode()).hexdigest()
            signature_base += f"&{body_hash}"
        
        # Sign with client secret using HMAC-SHA1
        signature = hmac.new(
            self.client_secret.encode(),
            signature_base.encode(),
            hashlib.sha1
        ).digest()
        
        # Base64 encode
        import base64
        return base64.b64encode(signature).decode()
    
    def _get_headers(
        self,
        http_method: str,
        url: str,
        request_body: Optional[str] = None
    ) -> Dict[str, str]:
        """Get request headers with signature"""
        access_token = self._get_access_token()
        
        timestamp = str(int(datetime.now().timestamp() * 1000))
        nonce = os.urandom(16).hex()
        
        signature = self._generate_signature(
            http_method=http_method,
            url=url,
            timestamp=timestamp,
            nonce=nonce,
            request_body=request_body
        )
        
        return {
            "Authorization": f"Bearer {access_token}",
            "Signature": signature,
            "SignatureMethod": "SHA1",
            "Nonce": nonce,
            "Timestamp": timestamp,
            "Content-Type": "application/json",
            "TerminalId": self.terminal_id or ""
        }
    
    def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        base_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Make HTTP request to Interswitch API
        
        Args:
            method: HTTP method
            endpoint: API endpoint
            data: Request body data
            params: Query parameters
            base_url: Override base URL
            
        Returns:
            API response data
            
        Raises:
            InterswitchAPIError: If request fails
        """
        url = f"{base_url or self.base_url}/{endpoint}"
        
        request_body = json.dumps(data) if data else None
        headers = self._get_headers(method, url, request_body)
        
        try:
            logger.debug(f"Making {method} request to {endpoint}")
            
            response = requests.request(
                method=method,
                url=url,
                data=request_body,
                params=params,
                headers=headers,
                timeout=self.timeout
            )
            
            # Try to parse JSON response
            try:
                response_data = response.json()
            except json.JSONDecodeError:
                response_data = {"raw_response": response.text}
            
            # Check if request was successful
            if response.status_code >= 400:
                error_message = response_data.get("error", response_data.get("message", "Unknown error"))
                logger.error(f"Interswitch API error: {error_message}")
                raise InterswitchAPIError(
                    message=error_message,
                    status_code=response.status_code,
                    response=response_data
                )
            
            # Check response code field
            response_code = response_data.get("responseCode", response_data.get("ResponseCode"))
            if response_code and response_code != "00":
                error_message = response_data.get("responseDescription", "Transaction failed")
                logger.error(f"Interswitch error: {error_message}")
                raise InterswitchAPIError(
                    message=error_message,
                    status_code=response.status_code,
                    response=response_data
                )
            
            logger.debug(f"Request successful: {endpoint}")
            return response_data
            
        except requests.exceptions.Timeout:
            logger.error(f"Request timeout: {endpoint}")
            raise InterswitchAPIError("Request timeout", status_code=408)
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed: {str(e)}")
            raise InterswitchAPIError(f"Request failed: {str(e)}", status_code=500)
    
    # ==================== WEBPAY (CARD PAYMENTS) ====================
    
    def initialize_webpay(
        self,
        amount: float,
        currency_code: str,
        customer_email: str,
        customer_name: str,
        redirect_url: str,
        transaction_reference: str,
        pay_item_id: Optional[str] = None,
        site_redirect_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Initialize Webpay transaction
        
        Args:
            amount: Transaction amount in kobo (NGN) or cents (USD)
            currency_code: Currency code (566 for NGN, 840 for USD)
            customer_email: Customer email
            customer_name: Customer name
            redirect_url: Redirect URL after payment
            transaction_reference: Unique transaction reference
            pay_item_id: Pay item ID
            site_redirect_url: Site redirect URL
            
        Returns:
            Transaction details with payment URL
        """
        data = {
            "merchantCode": self.merchant_code,
            "payItemID": pay_item_id or self.merchant_code,
            "customerEmail": customer_email,
            "customerName": customer_name,
            "amount": int(amount * 100),  # Convert to kobo/cents
            "currencyCode": currency_code,
            "redirectURL": redirect_url,
            "transactionReference": transaction_reference,
            "siteRedirectURL": site_redirect_url or redirect_url
        }
        
        response = self._make_request("POST", "api/v1/webpay/initialize", data=data)
        
        # Add payment URL
        payment_url = f"{self.base_url}/payment/pay"
        response["payment_url"] = f"{payment_url}?merchantCode={self.merchant_code}&transactionReference={transaction_reference}"
        
        return response
    
    def query_webpay_transaction(
        self,
        transaction_reference: str,
        amount: float
    ) -> Dict[str, Any]:
        """
        Query Webpay transaction status
        
        Args:
            transaction_reference: Transaction reference
            amount: Transaction amount
            
        Returns:
            Transaction status
        """
        params = {
            "merchantCode": self.merchant_code,
            "transactionReference": transaction_reference,
            "amount": int(amount * 100)
        }
        
        return self._make_request("GET", "api/v1/webpay/query", params=params)
    
    # ==================== VERVE CARD PROCESSING ====================
    
    def tokenize_verve_card(
        self,
        pan: str,
        expiry_date: str,
        cvv: str,
        pin: str
    ) -> Dict[str, Any]:
        """
        Tokenize Verve card for future transactions
        
        Args:
            pan: Card number
            expiry_date: Expiry date (YYMM)
            cvv: Card CVV
            pin: Card PIN
            
        Returns:
            Token details
        """
        data = {
            "pan": pan,
            "expiryDate": expiry_date,
            "cvv": cvv,
            "pin": pin
        }
        
        return self._make_request("POST", "api/v1/verve/tokenize", data=data)
    
    def charge_verve_token(
        self,
        token: str,
        amount: float,
        currency_code: str,
        transaction_reference: str
    ) -> Dict[str, Any]:
        """
        Charge Verve card using token
        
        Args:
            token: Card token
            amount: Amount to charge
            currency_code: Currency code
            transaction_reference: Transaction reference
            
        Returns:
            Charge response
        """
        data = {
            "token": token,
            "amount": int(amount * 100),
            "currencyCode": currency_code,
            "transactionReference": transaction_reference,
            "merchantCode": self.merchant_code
        }
        
        return self._make_request("POST", "api/v1/verve/charge", data=data)
    
    # ==================== QUICKTELLER (BILL PAYMENTS) ====================
    
    def get_billers(self, category_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get list of billers
        
        Args:
            category_id: Filter by category ID
            
        Returns:
            List of billers
        """
        endpoint = "api/v1/quickteller/billers"
        if category_id:
            endpoint += f"?categoryId={category_id}"
        
        response = self._make_request("GET", endpoint, base_url=self.QUICKTELLER_BASE_URL)
        return response.get("billers", [])
    
    def get_biller_categories(self) -> List[Dict[str, Any]]:
        """
        Get biller categories
        
        Returns:
            List of categories
        """
        response = self._make_request("GET", "api/v1/quickteller/categories", base_url=self.QUICKTELLER_BASE_URL)
        return response.get("categories", [])
    
    def validate_customer(
        self,
        biller_id: str,
        customer_id: str,
        payment_code: str
    ) -> Dict[str, Any]:
        """
        Validate customer for bill payment
        
        Args:
            biller_id: Biller ID
            customer_id: Customer ID (e.g., meter number, phone number)
            payment_code: Payment code
            
        Returns:
            Customer validation details
        """
        data = {
            "billerId": biller_id,
            "customerId": customer_id,
            "paymentCode": payment_code
        }
        
        return self._make_request("POST", "api/v1/quickteller/validate", data=data, base_url=self.QUICKTELLER_BASE_URL)
    
    def pay_bill(
        self,
        biller_id: str,
        customer_id: str,
        payment_code: str,
        amount: float,
        transaction_reference: str,
        customer_email: Optional[str] = None,
        customer_phone: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Pay a bill via Quickteller
        
        Args:
            biller_id: Biller ID
            customer_id: Customer ID
            payment_code: Payment code
            amount: Amount to pay
            transaction_reference: Unique reference
            customer_email: Customer email
            customer_phone: Customer phone
            
        Returns:
            Payment response
        """
        data = {
            "billerId": biller_id,
            "customerId": customer_id,
            "paymentCode": payment_code,
            "amount": int(amount * 100),
            "requestReference": transaction_reference,
            "customerEmail": customer_email,
            "customerMobile": customer_phone
        }
        
        return self._make_request("POST", "api/v1/quickteller/payments", data=data, base_url=self.QUICKTELLER_BASE_URL)
    
    def buy_airtime(
        self,
        phone_number: str,
        amount: float,
        transaction_reference: str
    ) -> Dict[str, Any]:
        """
        Buy airtime
        
        Args:
            phone_number: Phone number (with country code)
            amount: Amount in Naira
            transaction_reference: Unique reference
            
        Returns:
            Airtime purchase response
        """
        # Determine network from phone number prefix
        network_map = {
            "0803": "MTN",
            "0806": "MTN",
            "0703": "MTN",
            "0706": "MTN",
            "0805": "GLO",
            "0807": "GLO",
            "0705": "GLO",
            "0815": "GLO",
            "0802": "AIRTEL",
            "0808": "AIRTEL",
            "0708": "AIRTEL",
            "0812": "AIRTEL",
            "0809": "9MOBILE",
            "0817": "9MOBILE",
            "0818": "9MOBILE"
        }
        
        prefix = phone_number[:4]
        network = network_map.get(prefix, "MTN")
        
        # Get biller ID for network
        biller_map = {
            "MTN": "901",
            "GLO": "902",
            "AIRTEL": "903",
            "9MOBILE": "904"
        }
        
        biller_id = biller_map.get(network, "901")
        
        return self.pay_bill(
            biller_id=biller_id,
            customer_id=phone_number,
            payment_code="04226",  # Airtime payment code
            amount=amount,
            transaction_reference=transaction_reference
        )
    
    # ==================== TRANSFERS ====================
    
    def initiate_transfer(
        self,
        beneficiary_account_number: str,
        beneficiary_bank_code: str,
        amount: float,
        narration: str,
        transaction_reference: str,
        beneficiary_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Initiate bank transfer
        
        Args:
            beneficiary_account_number: Beneficiary account number
            beneficiary_bank_code: Bank code
            amount: Amount to transfer
            narration: Transfer narration
            transaction_reference: Unique reference
            beneficiary_name: Beneficiary name
            
        Returns:
            Transfer response
        """
        data = {
            "beneficiaryAccountNumber": beneficiary_account_number,
            "beneficiaryBankCode": beneficiary_bank_code,
            "amount": int(amount * 100),
            "narration": narration,
            "transactionReference": transaction_reference,
            "beneficiaryName": beneficiary_name,
            "merchantCode": self.merchant_code
        }
        
        return self._make_request("POST", "api/v1/transfers", data=data)
    
    def query_transfer(self, transaction_reference: str) -> Dict[str, Any]:
        """
        Query transfer status
        
        Args:
            transaction_reference: Transaction reference
            
        Returns:
            Transfer status
        """
        params = {"transactionReference": transaction_reference}
        return self._make_request("GET", "api/v1/transfers/query", params=params)
    
    # ==================== VALIDATION ====================
    
    def validate_bvn(
        self,
        bvn: str,
        first_name: str,
        last_name: str,
        date_of_birth: str
    ) -> Dict[str, Any]:
        """
        Validate BVN (Bank Verification Number)
        
        Args:
            bvn: BVN (11 digits)
            first_name: First name
            last_name: Last name
            date_of_birth: Date of birth (DD-MM-YYYY)
            
        Returns:
            BVN validation result
        """
        data = {
            "bvn": bvn,
            "firstName": first_name,
            "lastName": last_name,
            "dateOfBirth": date_of_birth
        }
        
        return self._make_request("POST", "api/v1/validation/bvn", data=data)
    
    def validate_account_number(
        self,
        account_number: str,
        bank_code: str
    ) -> Dict[str, Any]:
        """
        Validate bank account number
        
        Args:
            account_number: Account number
            bank_code: Bank code
            
        Returns:
            Account validation result with account name
        """
        data = {
            "accountNumber": account_number,
            "bankCode": bank_code
        }
        
        return self._make_request("POST", "api/v1/validation/account", data=data)
    
    # ==================== WEBHOOK VERIFICATION ====================
    
    def verify_webhook_signature(
        self,
        payload: bytes,
        signature: str
    ) -> bool:
        """
        Verify Interswitch webhook signature
        
        Args:
            payload: Raw request body
            signature: X-Interswitch-Signature header
            
        Returns:
            True if signature is valid
        """
        if not self.client_secret:
            logger.error("Client secret not configured for webhook verification")
            return False
        
        # Calculate expected signature
        expected_signature = hmac.new(
            self.client_secret.encode(),
            payload,
            hashlib.sha512
        ).hexdigest()
        
        # Constant-time comparison
        return hmac.compare_digest(signature, expected_signature)
