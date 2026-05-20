"""
WeChat Pay Gateway Integration
Supports QR code payments, mini-program payments, and H5 payments
"""

import hashlib
import hmac
import time
import uuid
import xml.etree.ElementTree as ET
from typing import Dict, Optional
import httpx
from datetime import datetime


class WeChatPayGateway:
    """WeChat Pay payment gateway implementation"""
    
    def __init__(self, app_id: str, mch_id: str, api_key: str, cert_path: str, key_path: str):
        self.app_id = app_id
        self.mch_id = mch_id
        self.api_key = api_key
        self.cert_path = cert_path
        self.key_path = key_path
        self.base_url = "https://api.mch.weixin.qq.com"
        
    def _generate_nonce_str(self) -> str:
        """Generate random string for nonce"""
        return str(uuid.uuid4()).replace('-', '')
    
    def _generate_sign(self, params: Dict) -> str:
        """Generate signature for WeChat Pay API"""
        # Sort parameters
        sorted_params = sorted(params.items())
        # Create string to sign
        string_to_sign = "&".join([f"{k}={v}" for k, v in sorted_params if v])
        string_to_sign += f"&key={self.api_key}"
        # Generate MD5 hash
        return hashlib.md5(string_to_sign.encode('utf-8')).hexdigest().upper()
    
    def _dict_to_xml(self, data: Dict) -> str:
        """Convert dictionary to XML"""
        xml = "<xml>"
        for key, value in data.items():
            xml += f"<{key}>{value}</{key}>"
        xml += "</xml>"
        return xml
    
    def _xml_to_dict(self, xml_str: str) -> Dict:
        """Convert XML to dictionary"""
        root = ET.fromstring(xml_str)
        return {child.tag: child.text for child in root}
    
    async def create_native_payment(
        self,
        out_trade_no: str,
        total_fee: int,
        body: str,
        notify_url: str,
        trade_type: str = "NATIVE"
    ) -> Dict:
        """
        Create native payment (QR code)
        
        Args:
            out_trade_no: Merchant order number
            total_fee: Amount in cents (CNY)
            body: Product description
            notify_url: Callback URL
            trade_type: Payment type (NATIVE, JSAPI, MWEB, APP)
        """
        params = {
            "appid": self.app_id,
            "mch_id": self.mch_id,
            "nonce_str": self._generate_nonce_str(),
            "body": body,
            "out_trade_no": out_trade_no,
            "total_fee": str(total_fee),
            "spbill_create_ip": "127.0.0.1",
            "notify_url": notify_url,
            "trade_type": trade_type
        }
        
        # Generate signature
        params["sign"] = self._generate_sign(params)
        
        # Convert to XML
        xml_data = self._dict_to_xml(params)
        
        # Make API request
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/pay/unifiedorder",
                content=xml_data,
                headers={"Content-Type": "application/xml"}
            )
            
        # Parse response
        result = self._xml_to_dict(response.text)
        
        if result.get("return_code") == "SUCCESS" and result.get("result_code") == "SUCCESS":
            return {
                "status": "success",
                "code_url": result.get("code_url"),
                "prepay_id": result.get("prepay_id"),
                "out_trade_no": out_trade_no
            }
        else:
            return {
                "status": "failed",
                "error": result.get("return_msg") or result.get("err_code_des"),
                "error_code": result.get("err_code")
            }
    
    async def query_order(self, out_trade_no: Optional[str] = None, transaction_id: Optional[str] = None) -> Dict:
        """
        Query order status
        
        Args:
            out_trade_no: Merchant order number
            transaction_id: WeChat transaction ID
        """
        params = {
            "appid": self.app_id,
            "mch_id": self.mch_id,
            "nonce_str": self._generate_nonce_str()
        }
        
        if out_trade_no:
            params["out_trade_no"] = out_trade_no
        elif transaction_id:
            params["transaction_id"] = transaction_id
        else:
            raise ValueError("Either out_trade_no or transaction_id must be provided")
        
        # Generate signature
        params["sign"] = self._generate_sign(params)
        
        # Convert to XML
        xml_data = self._dict_to_xml(params)
        
        # Make API request
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/pay/orderquery",
                content=xml_data,
                headers={"Content-Type": "application/xml"}
            )
        
        # Parse response
        result = self._xml_to_dict(response.text)
        
        if result.get("return_code") == "SUCCESS" and result.get("result_code") == "SUCCESS":
            return {
                "status": "success",
                "trade_state": result.get("trade_state"),
                "transaction_id": result.get("transaction_id"),
                "out_trade_no": result.get("out_trade_no"),
                "total_fee": int(result.get("total_fee", 0)),
                "time_end": result.get("time_end")
            }
        else:
            return {
                "status": "failed",
                "error": result.get("return_msg") or result.get("err_code_des")
            }
    
    async def refund(
        self,
        out_trade_no: str,
        out_refund_no: str,
        total_fee: int,
        refund_fee: int,
        refund_desc: Optional[str] = None
    ) -> Dict:
        """
        Process refund
        
        Args:
            out_trade_no: Original merchant order number
            out_refund_no: Merchant refund number
            total_fee: Original amount in cents
            refund_fee: Refund amount in cents
            refund_desc: Refund description
        """
        params = {
            "appid": self.app_id,
            "mch_id": self.mch_id,
            "nonce_str": self._generate_nonce_str(),
            "out_trade_no": out_trade_no,
            "out_refund_no": out_refund_no,
            "total_fee": str(total_fee),
            "refund_fee": str(refund_fee)
        }
        
        if refund_desc:
            params["refund_desc"] = refund_desc
        
        # Generate signature
        params["sign"] = self._generate_sign(params)
        
        # Convert to XML
        xml_data = self._dict_to_xml(params)
        
        # Make API request with client certificate
        async with httpx.AsyncClient(cert=(self.cert_path, self.key_path)) as client:
            response = await client.post(
                f"{self.base_url}/secapi/pay/refund",
                content=xml_data,
                headers={"Content-Type": "application/xml"}
            )
        
        # Parse response
        result = self._xml_to_dict(response.text)
        
        if result.get("return_code") == "SUCCESS" and result.get("result_code") == "SUCCESS":
            return {
                "status": "success",
                "refund_id": result.get("refund_id"),
                "out_refund_no": out_refund_no,
                "refund_fee": refund_fee
            }
        else:
            return {
                "status": "failed",
                "error": result.get("return_msg") or result.get("err_code_des")
            }
    
    async def close_order(self, out_trade_no: str) -> Dict:
        """Close unpaid order"""
        params = {
            "appid": self.app_id,
            "mch_id": self.mch_id,
            "out_trade_no": out_trade_no,
            "nonce_str": self._generate_nonce_str()
        }
        
        # Generate signature
        params["sign"] = self._generate_sign(params)
        
        # Convert to XML
        xml_data = self._dict_to_xml(params)
        
        # Make API request
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/pay/closeorder",
                content=xml_data,
                headers={"Content-Type": "application/xml"}
            )
        
        # Parse response
        result = self._xml_to_dict(response.text)
        
        if result.get("return_code") == "SUCCESS" and result.get("result_code") == "SUCCESS":
            return {"status": "success", "message": "Order closed successfully"}
        else:
            return {
                "status": "failed",
                "error": result.get("return_msg") or result.get("err_code_des")
            }
    
    def verify_notify(self, data: Dict) -> bool:
        """Verify payment notification signature"""
        sign = data.pop("sign", None)
        if not sign:
            return False
        
        calculated_sign = self._generate_sign(data)
        return sign == calculated_sign
