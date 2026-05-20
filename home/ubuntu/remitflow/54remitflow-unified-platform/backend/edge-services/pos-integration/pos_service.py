"""
Point of Sale (POS) Integration Service
Handles payment processing, card transactions, and POS device management
"""

import asyncio
import json
import logging
import os
import uuid
import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
import base64

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from sqlalchemy import create_engine, Column, String, Float, DateTime, Text, Integer, Boolean, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.dialects.postgresql import UUID
import aioredis
from cryptography.fernet import Fernet
import qrcode
import io
import serial
import socket

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database setup
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/pos_integration")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class PaymentMethod(str, Enum):
    CARD_CHIP = "card_chip"
    CARD_SWIPE = "card_swipe"
    CARD_CONTACTLESS = "card_contactless"
    MOBILE_NFC = "mobile_nfc"
    QR_CODE = "qr_code"
    CASH = "cash"
    BANK_TRANSFER = "bank_transfer"
    DIGITAL_WALLET = "digital_wallet"

class TransactionStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    APPROVED = "approved"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"
    FAILED = "failed"

class DeviceType(str, Enum):
    CARD_READER = "card_reader"
    PIN_PAD = "pin_pad"
    RECEIPT_PRINTER = "receipt_printer"
    CASH_DRAWER = "cash_drawer"
    BARCODE_SCANNER = "barcode_scanner"
    DISPLAY = "display"
    INTEGRATED_POS = "integrated_pos"

class DeviceStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    ERROR = "error"
    MAINTENANCE = "maintenance"
    UPDATING = "updating"

@dataclass
class PaymentRequest:
    amount: float
    currency: str
    payment_method: PaymentMethod
    merchant_id: str
    terminal_id: str
    transaction_reference: str
    customer_data: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None

@dataclass
class PaymentResponse:
    transaction_id: str
    status: TransactionStatus
    amount: float
    currency: str
    authorization_code: Optional[str] = None
    receipt_data: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    processing_time: float = 0.0

class POSTransaction(Base):
    __tablename__ = "pos_transactions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id = Column(String, nullable=False, unique=True, index=True)
    merchant_id = Column(String, nullable=False, index=True)
    terminal_id = Column(String, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False)
    payment_method = Column(String, nullable=False, index=True)
    status = Column(String, default=TransactionStatus.PENDING.value, index=True)
    authorization_code = Column(String)
    card_last_four = Column(String)
    card_type = Column(String)
    customer_data = Column(JSON)
    receipt_data = Column(JSON)
    metadata = Column(JSON)
    error_message = Column(Text)
    processing_time = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    processed_at = Column(DateTime)
    settled_at = Column(DateTime)
    refunded_at = Column(DateTime)
    refund_amount = Column(Float)

class POSDevice(Base):
    __tablename__ = "pos_devices"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(String, nullable=False, unique=True, index=True)
    device_type = Column(String, nullable=False, index=True)
    device_name = Column(String, nullable=False)
    merchant_id = Column(String, nullable=False, index=True)
    terminal_id = Column(String, nullable=False, index=True)
    status = Column(String, default=DeviceStatus.OFFLINE.value, index=True)
    ip_address = Column(String)
    serial_port = Column(String)
    configuration = Column(JSON)
    capabilities = Column(JSON)
    firmware_version = Column(String)
    last_heartbeat = Column(DateTime)
    error_count = Column(Integer, default=0)
    total_transactions = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class MerchantTerminal(Base):
    __tablename__ = "merchant_terminals"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    terminal_id = Column(String, nullable=False, unique=True, index=True)
    merchant_id = Column(String, nullable=False, index=True)
    terminal_name = Column(String, nullable=False)
    location = Column(String)
    configuration = Column(JSON)
    supported_payment_methods = Column(JSON)
    daily_limit = Column(Float)
    transaction_limit = Column(Float)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# Create tables
Base.metadata.create_all(bind=engine)

class POSIntegrationService:
    def __init__(self):
        self.redis_client = None
        self.connected_devices = {}
        self.active_websockets = {}
        self.encryption_key = os.getenv("POS_ENCRYPTION_KEY", Fernet.generate_key())
        self.cipher_suite = Fernet(self.encryption_key)
        
        # Payment processor configurations
        self.payment_processors = {
            "stripe": {
                "api_key": os.getenv("STRIPE_SECRET_KEY", ""),
                "endpoint": "https://api.stripe.com/v1"
            },
            "square": {
                "api_key": os.getenv("SQUARE_ACCESS_TOKEN", ""),
                "endpoint": "https://connect.squareup.com/v2"
            },
            "adyen": {
                "api_key": os.getenv("ADYEN_API_KEY", ""),
                "endpoint": "https://checkout-test.adyen.com/v70"
            }
        }
        
        # Device communication protocols
        self.device_protocols = {
            "serial": self._handle_serial_device,
            "tcp": self._handle_tcp_device,
            "usb": self._handle_usb_device,
            "bluetooth": self._handle_bluetooth_device
        }
    
    async def initialize(self):
        """Initialize the POS integration service"""
        try:
            # Initialize Redis for caching and real-time communication
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self.redis_client = await aioredis.from_url(redis_url)
            
            # Start device discovery and monitoring
            asyncio.create_task(self._device_discovery_loop())
            asyncio.create_task(self._device_monitoring_loop())
            
            logger.info("POS Integration Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize POS Integration Service: {e}")
            self.redis_client = None
    
    async def process_payment(self, payment_request: PaymentRequest) -> PaymentResponse:
        """Process a payment transaction"""
        db = SessionLocal()
        try:
            start_time = datetime.utcnow()
            transaction_id = str(uuid.uuid4())
            
            # Validate merchant and terminal
            terminal = db.query(MerchantTerminal).filter(
                MerchantTerminal.terminal_id == payment_request.terminal_id,
                MerchantTerminal.merchant_id == payment_request.merchant_id,
                MerchantTerminal.is_active == True
            ).first()
            
            if not terminal:
                raise HTTPException(status_code=404, detail="Terminal not found or inactive")
            
            # Validate payment limits
            if payment_request.amount > terminal.transaction_limit:
                raise HTTPException(status_code=400, detail="Amount exceeds transaction limit")
            
            # Check daily limit
            daily_total = await self._get_daily_transaction_total(
                payment_request.merchant_id, payment_request.terminal_id
            )
            if daily_total + payment_request.amount > terminal.daily_limit:
                raise HTTPException(status_code=400, detail="Amount exceeds daily limit")
            
            # Create transaction record
            transaction = POSTransaction(
                transaction_id=transaction_id,
                merchant_id=payment_request.merchant_id,
                terminal_id=payment_request.terminal_id,
                amount=payment_request.amount,
                currency=payment_request.currency,
                payment_method=payment_request.payment_method.value,
                customer_data=payment_request.customer_data,
                metadata=payment_request.metadata
            )
            
            db.add(transaction)
            db.commit()
            db.refresh(transaction)
            
            # Process payment based on method
            if payment_request.payment_method in [PaymentMethod.CARD_CHIP, PaymentMethod.CARD_SWIPE, PaymentMethod.CARD_CONTACTLESS]:
                response = await self._process_card_payment(payment_request, transaction)
            elif payment_request.payment_method == PaymentMethod.MOBILE_NFC:
                response = await self._process_nfc_payment(payment_request, transaction)
            elif payment_request.payment_method == PaymentMethod.QR_CODE:
                response = await self._process_qr_payment(payment_request, transaction)
            elif payment_request.payment_method == PaymentMethod.CASH:
                response = await self._process_cash_payment(payment_request, transaction)
            elif payment_request.payment_method == PaymentMethod.DIGITAL_WALLET:
                response = await self._process_wallet_payment(payment_request, transaction)
            else:
                raise HTTPException(status_code=400, detail="Unsupported payment method")
            
            # Update transaction with response
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            transaction.status = response.status.value
            transaction.authorization_code = response.authorization_code
            transaction.receipt_data = response.receipt_data
            transaction.error_message = response.error_message
            transaction.processing_time = processing_time
            transaction.processed_at = datetime.utcnow()
            
            db.commit()
            
            # Send real-time update
            await self._send_transaction_update(transaction_id, response)
            
            return response
            
        except Exception as e:
            db.rollback()
            logger.error(f"Payment processing failed: {e}")
            
            # Update transaction with error
            if 'transaction' in locals():
                transaction.status = TransactionStatus.FAILED.value
                transaction.error_message = str(e)
                db.commit()
            
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            db.close()
    
    async def _process_card_payment(self, payment_request: PaymentRequest, 
                                   transaction: POSTransaction) -> PaymentResponse:
        """Process card payment through payment processor"""
        try:
            # Use Stripe as default processor
            processor = "stripe"
            config = self.payment_processors[processor]
            
            if not config["api_key"]:
                # Simulate payment for demo
                return await self._simulate_card_payment(payment_request)
            
            async with httpx.AsyncClient() as client:
                headers = {
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/x-www-form-urlencoded"
                }
                
                data = {
                    "amount": int(payment_request.amount * 100),  # Amount in cents
                    "currency": payment_request.currency.lower(),
                    "payment_method_types[]": "card",
                    "metadata[transaction_id]": transaction.transaction_id,
                    "metadata[terminal_id]": payment_request.terminal_id
                }
                
                response = await client.post(
                    f"{config['endpoint']}/payment_intents",
                    headers=headers,
                    data=data,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    
                    return PaymentResponse(
                        transaction_id=transaction.transaction_id,
                        status=TransactionStatus.APPROVED,
                        amount=payment_request.amount,
                        currency=payment_request.currency,
                        authorization_code=result.get("id", ""),
                        receipt_data=self._generate_receipt_data(payment_request, result)
                    )
                else:
                    error_data = response.json()
                    return PaymentResponse(
                        transaction_id=transaction.transaction_id,
                        status=TransactionStatus.DECLINED,
                        amount=payment_request.amount,
                        currency=payment_request.currency,
                        error_message=error_data.get("error", {}).get("message", "Payment failed")
                    )
                    
        except Exception as e:
            logger.error(f"Card payment processing failed: {e}")
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.FAILED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                error_message=str(e)
            )
    
    async def _simulate_card_payment(self, payment_request: PaymentRequest) -> PaymentResponse:
        """Simulate card payment for demo purposes"""
        # Simulate processing delay
        await asyncio.sleep(2)
        
        # Simulate approval/decline based on amount
        if payment_request.amount > 10000:  # Decline large amounts
            return PaymentResponse(
                transaction_id=str(uuid.uuid4()),
                status=TransactionStatus.DECLINED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                error_message="Amount exceeds limit"
            )
        
        # Generate mock authorization code
        auth_code = f"AUTH{uuid.uuid4().hex[:8].upper()}"
        
        return PaymentResponse(
            transaction_id=str(uuid.uuid4()),
            status=TransactionStatus.APPROVED,
            amount=payment_request.amount,
            currency=payment_request.currency,
            authorization_code=auth_code,
            receipt_data=self._generate_mock_receipt(payment_request, auth_code)
        )
    
    async def _process_nfc_payment(self, payment_request: PaymentRequest,
                                 transaction: POSTransaction) -> PaymentResponse:
        """Process NFC mobile payment"""
        try:
            # Simulate NFC payment processing
            await asyncio.sleep(1)
            
            # Generate NFC transaction data
            nfc_data = {
                "device_type": "mobile",
                "payment_app": payment_request.metadata.get("payment_app", "apple_pay"),
                "device_id": payment_request.metadata.get("device_id", ""),
                "transaction_token": str(uuid.uuid4())
            }
            
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.APPROVED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                authorization_code=f"NFC{uuid.uuid4().hex[:8].upper()}",
                receipt_data=self._generate_receipt_data(payment_request, nfc_data)
            )
            
        except Exception as e:
            logger.error(f"NFC payment processing failed: {e}")
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.FAILED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                error_message=str(e)
            )
    
    async def _process_qr_payment(self, payment_request: PaymentRequest,
                                transaction: POSTransaction) -> PaymentResponse:
        """Process QR code payment"""
        try:
            # Generate QR code for payment
            qr_data = {
                "transaction_id": transaction.transaction_id,
                "amount": payment_request.amount,
                "currency": payment_request.currency,
                "merchant_id": payment_request.merchant_id,
                "terminal_id": payment_request.terminal_id,
                "expires_at": (datetime.utcnow() + timedelta(minutes=5)).isoformat()
            }
            
            qr_code_data = await self._generate_qr_code(qr_data)
            
            # For demo, auto-approve QR payments
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.APPROVED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                authorization_code=f"QR{uuid.uuid4().hex[:8].upper()}",
                receipt_data={
                    "qr_code": qr_code_data,
                    "payment_method": "QR Code",
                    **self._generate_receipt_data(payment_request, qr_data)
                }
            )
            
        except Exception as e:
            logger.error(f"QR payment processing failed: {e}")
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.FAILED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                error_message=str(e)
            )
    
    async def _process_cash_payment(self, payment_request: PaymentRequest,
                                  transaction: POSTransaction) -> PaymentResponse:
        """Process cash payment"""
        try:
            # Cash payments are immediately approved
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.APPROVED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                authorization_code=f"CASH{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                receipt_data=self._generate_receipt_data(payment_request, {"payment_method": "Cash"})
            )
            
        except Exception as e:
            logger.error(f"Cash payment processing failed: {e}")
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.FAILED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                error_message=str(e)
            )
    
    async def _process_wallet_payment(self, payment_request: PaymentRequest,
                                    transaction: POSTransaction) -> PaymentResponse:
        """Process digital wallet payment"""
        try:
            wallet_type = payment_request.metadata.get("wallet_type", "unknown")
            
            # Simulate wallet payment processing
            await asyncio.sleep(1.5)
            
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.APPROVED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                authorization_code=f"WALLET{uuid.uuid4().hex[:8].upper()}",
                receipt_data=self._generate_receipt_data(payment_request, {
                    "wallet_type": wallet_type,
                    "payment_method": "Digital Wallet"
                })
            )
            
        except Exception as e:
            logger.error(f"Wallet payment processing failed: {e}")
            return PaymentResponse(
                transaction_id=transaction.transaction_id,
                status=TransactionStatus.FAILED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                error_message=str(e)
            )
    
    def _generate_receipt_data(self, payment_request: PaymentRequest, 
                              processor_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate receipt data for transaction"""
        return {
            "merchant_id": payment_request.merchant_id,
            "terminal_id": payment_request.terminal_id,
            "transaction_reference": payment_request.transaction_reference,
            "amount": payment_request.amount,
            "currency": payment_request.currency,
            "payment_method": payment_request.payment_method.value,
            "timestamp": datetime.utcnow().isoformat(),
            "processor_data": processor_data,
            "receipt_number": f"RCP{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:4].upper()}"
        }
    
    def _generate_mock_receipt(self, payment_request: PaymentRequest, auth_code: str) -> Dict[str, Any]:
        """Generate mock receipt for demo"""
        return {
            "merchant_name": "Demo Merchant",
            "merchant_id": payment_request.merchant_id,
            "terminal_id": payment_request.terminal_id,
            "amount": payment_request.amount,
            "currency": payment_request.currency,
            "payment_method": "Card",
            "card_last_four": "1234",
            "card_type": "Visa",
            "authorization_code": auth_code,
            "timestamp": datetime.utcnow().isoformat(),
            "receipt_number": f"RCP{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        }
    
    async def _generate_qr_code(self, data: Dict[str, Any]) -> str:
        """Generate QR code for payment"""
        try:
            qr_string = json.dumps(data)
            
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=4,
            )
            qr.add_data(qr_string)
            qr.make(fit=True)
            
            img = qr.make_image(fill_color="black", back_color="white")
            
            # Convert to base64
            buffer = io.BytesIO()
            img.save(buffer, format='PNG')
            img_str = base64.b64encode(buffer.getvalue()).decode()
            
            return f"data:image/png;base64,{img_str}"
            
        except Exception as e:
            logger.error(f"QR code generation failed: {e}")
            return ""
    
    async def _get_daily_transaction_total(self, merchant_id: str, terminal_id: str) -> float:
        """Get daily transaction total for limits checking"""
        db = SessionLocal()
        try:
            today = datetime.utcnow().date()
            
            result = db.query(POSTransaction).filter(
                POSTransaction.merchant_id == merchant_id,
                POSTransaction.terminal_id == terminal_id,
                POSTransaction.status == TransactionStatus.APPROVED.value,
                POSTransaction.created_at >= today
            ).all()
            
            return sum(t.amount for t in result)
            
        except Exception as e:
            logger.error(f"Failed to get daily total: {e}")
            return 0.0
        finally:
            db.close()
    
    async def register_device(self, device_data: Dict[str, Any]) -> str:
        """Register a new POS device"""
        db = SessionLocal()
        try:
            device_id = device_data.get("device_id") or str(uuid.uuid4())
            
            # Check if device already exists
            existing_device = db.query(POSDevice).filter(
                POSDevice.device_id == device_id
            ).first()
            
            if existing_device:
                # Update existing device
                for key, value in device_data.items():
                    if hasattr(existing_device, key):
                        setattr(existing_device, key, value)
                existing_device.updated_at = datetime.utcnow()
                existing_device.status = DeviceStatus.ONLINE.value
                db.commit()
                return device_id
            
            # Create new device
            device = POSDevice(
                device_id=device_id,
                device_type=device_data.get("device_type", DeviceType.INTEGRATED_POS.value),
                device_name=device_data.get("device_name", f"Device {device_id[:8]}"),
                merchant_id=device_data.get("merchant_id", ""),
                terminal_id=device_data.get("terminal_id", ""),
                ip_address=device_data.get("ip_address"),
                serial_port=device_data.get("serial_port"),
                configuration=device_data.get("configuration", {}),
                capabilities=device_data.get("capabilities", []),
                firmware_version=device_data.get("firmware_version", "1.0.0"),
                status=DeviceStatus.ONLINE.value,
                last_heartbeat=datetime.utcnow()
            )
            
            db.add(device)
            db.commit()
            db.refresh(device)
            
            # Store device connection info
            self.connected_devices[device_id] = {
                "device": device,
                "last_seen": datetime.utcnow(),
                "connection_type": device_data.get("connection_type", "tcp")
            }
            
            return device_id
            
        except Exception as e:
            db.rollback()
            logger.error(f"Device registration failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            db.close()
    
    async def _device_discovery_loop(self):
        """Discover POS devices on the network"""
        while True:
            try:
                # Scan for devices on common POS ports
                await self._scan_network_devices()
                await self._scan_serial_devices()
                
                await asyncio.sleep(30)  # Scan every 30 seconds
                
            except Exception as e:
                logger.error(f"Device discovery error: {e}")
                await asyncio.sleep(60)
    
    async def _scan_network_devices(self):
        """Scan network for POS devices"""
        try:
            # Common POS device ports
            pos_ports = [9100, 8080, 80, 443, 23, 9001, 9002]
            
            # Scan local network (simplified)
            base_ip = "192.168.1."
            
            for i in range(1, 255):
                ip = f"{base_ip}{i}"
                
                for port in pos_ports:
                    try:
                        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        sock.settimeout(1)
                        result = sock.connect_ex((ip, port))
                        
                        if result == 0:
                            # Device found, try to identify
                            await self._identify_network_device(ip, port)
                        
                        sock.close()
                        
                    except Exception:
                        continue
                        
        except Exception as e:
            logger.error(f"Network device scan failed: {e}")
    
    async def _scan_serial_devices(self):
        """Scan for serial POS devices"""
        try:
            import serial.tools.list_ports
            
            ports = serial.tools.list_ports.comports()
            
            for port in ports:
                try:
                    # Try to connect to serial device
                    ser = serial.Serial(port.device, 9600, timeout=1)
                    
                    # Send identification command
                    ser.write(b'\x1B\x1D\x49\x01')  # ESC GS I command
                    response = ser.read(100)
                    
                    if response:
                        await self._identify_serial_device(port.device, response)
                    
                    ser.close()
                    
                except Exception:
                    continue
                    
        except Exception as e:
            logger.error(f"Serial device scan failed: {e}")
    
    async def _identify_network_device(self, ip: str, port: int):
        """Identify network POS device"""
        try:
            # Try to get device information via HTTP
            async with httpx.AsyncClient() as client:
                response = await client.get(f"http://{ip}:{port}/device/info", timeout=5.0)
                
                if response.status_code == 200:
                    device_info = response.json()
                    device_info["ip_address"] = ip
                    device_info["connection_type"] = "tcp"
                    
                    await self.register_device(device_info)
                    
        except Exception as e:
            logger.debug(f"Failed to identify device at {ip}:{port}: {e}")
    
    async def _identify_serial_device(self, port: str, response: bytes):
        """Identify serial POS device"""
        try:
            device_info = {
                "device_id": f"serial_{port.replace('/', '_')}",
                "device_type": DeviceType.INTEGRATED_POS.value,
                "device_name": f"Serial Device {port}",
                "serial_port": port,
                "connection_type": "serial",
                "capabilities": ["print", "payment"],
                "firmware_version": "unknown"
            }
            
            await self.register_device(device_info)
            
        except Exception as e:
            logger.error(f"Failed to identify serial device: {e}")
    
    async def _device_monitoring_loop(self):
        """Monitor connected devices"""
        while True:
            try:
                current_time = datetime.utcnow()
                
                # Check device heartbeats
                for device_id, device_info in list(self.connected_devices.items()):
                    last_seen = device_info["last_seen"]
                    
                    if (current_time - last_seen).total_seconds() > 300:  # 5 minutes timeout
                        # Mark device as offline
                        await self._mark_device_offline(device_id)
                        del self.connected_devices[device_id]
                
                await asyncio.sleep(60)  # Check every minute
                
            except Exception as e:
                logger.error(f"Device monitoring error: {e}")
                await asyncio.sleep(60)
    
    async def _mark_device_offline(self, device_id: str):
        """Mark device as offline"""
        db = SessionLocal()
        try:
            device = db.query(POSDevice).filter(POSDevice.device_id == device_id).first()
            if device:
                device.status = DeviceStatus.OFFLINE.value
                device.updated_at = datetime.utcnow()
                db.commit()
                
        except Exception as e:
            logger.error(f"Failed to mark device offline: {e}")
        finally:
            db.close()
    
    async def _handle_serial_device(self, device_id: str, command: str, data: Any):
        """Handle serial device communication"""
        try:
            device_info = self.connected_devices.get(device_id)
            if not device_info:
                return {"error": "Device not found"}
            
            serial_port = device_info["device"].serial_port
            
            ser = serial.Serial(serial_port, 9600, timeout=5)
            
            if command == "print_receipt":
                # Send receipt data to printer
                receipt_data = data.get("receipt_data", "")
                ser.write(receipt_data.encode())
                
            elif command == "open_cash_drawer":
                # Send cash drawer open command
                ser.write(b'\x1B\x70\x00\x19\xFA')  # ESC p command
                
            elif command == "read_card":
                # Request card read
                ser.write(b'\x02READ_CARD\x03')
                response = ser.read(100)
                return {"card_data": response.decode()}
            
            ser.close()
            return {"status": "success"}
            
        except Exception as e:
            logger.error(f"Serial device communication failed: {e}")
            return {"error": str(e)}
    
    async def _handle_tcp_device(self, device_id: str, command: str, data: Any):
        """Handle TCP device communication"""
        try:
            device_info = self.connected_devices.get(device_id)
            if not device_info:
                return {"error": "Device not found"}
            
            ip_address = device_info["device"].ip_address
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"http://{ip_address}/command",
                    json={"command": command, "data": data},
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    return {"error": f"Device returned {response.status_code}"}
                    
        except Exception as e:
            logger.error(f"TCP device communication failed: {e}")
            return {"error": str(e)}
    
    async def _handle_usb_device(self, device_id: str, command: str, data: Any):
        """Handle USB device communication"""
        # USB device handling would require specific drivers
        return {"error": "USB devices not implemented"}
    
    async def _handle_bluetooth_device(self, device_id: str, command: str, data: Any):
        """Handle Bluetooth device communication"""
        # Bluetooth device handling would require bluetooth libraries
        return {"error": "Bluetooth devices not implemented"}
    
    async def send_device_command(self, device_id: str, command: str, data: Any = None) -> Dict[str, Any]:
        """Send command to POS device"""
        try:
            device_info = self.connected_devices.get(device_id)
            if not device_info:
                raise HTTPException(status_code=404, detail="Device not found")
            
            connection_type = device_info.get("connection_type", "tcp")
            handler = self.device_protocols.get(connection_type)
            
            if not handler:
                raise HTTPException(status_code=400, detail="Unsupported connection type")
            
            result = await handler(device_id, command, data)
            
            # Update device last seen
            device_info["last_seen"] = datetime.utcnow()
            
            return result
            
        except Exception as e:
            logger.error(f"Device command failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    async def _send_transaction_update(self, transaction_id: str, response: PaymentResponse):
        """Send real-time transaction update via WebSocket"""
        try:
            if self.redis_client:
                update_data = {
                    "transaction_id": transaction_id,
                    "status": response.status.value,
                    "amount": response.amount,
                    "authorization_code": response.authorization_code,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                await self.redis_client.publish(
                    f"transaction_updates:{transaction_id}",
                    json.dumps(update_data)
                )
                
        except Exception as e:
            logger.error(f"Failed to send transaction update: {e}")
    
    async def get_transaction_status(self, transaction_id: str) -> Dict[str, Any]:
        """Get transaction status"""
        db = SessionLocal()
        try:
            transaction = db.query(POSTransaction).filter(
                POSTransaction.transaction_id == transaction_id
            ).first()
            
            if not transaction:
                raise HTTPException(status_code=404, detail="Transaction not found")
            
            return {
                "transaction_id": transaction.transaction_id,
                "status": transaction.status,
                "amount": transaction.amount,
                "currency": transaction.currency,
                "payment_method": transaction.payment_method,
                "authorization_code": transaction.authorization_code,
                "receipt_data": transaction.receipt_data,
                "error_message": transaction.error_message,
                "processing_time": transaction.processing_time,
                "created_at": transaction.created_at.isoformat(),
                "processed_at": transaction.processed_at.isoformat() if transaction.processed_at else None
            }
            
        except Exception as e:
            logger.error(f"Failed to get transaction status: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            db.close()
    
    async def refund_transaction(self, transaction_id: str, refund_amount: Optional[float] = None,
                               reason: str = "") -> Dict[str, Any]:
        """Refund a transaction"""
        db = SessionLocal()
        try:
            transaction = db.query(POSTransaction).filter(
                POSTransaction.transaction_id == transaction_id,
                POSTransaction.status == TransactionStatus.APPROVED.value
            ).first()
            
            if not transaction:
                raise HTTPException(status_code=404, detail="Transaction not found or not approved")
            
            # Determine refund amount
            if refund_amount is None:
                refund_amount = transaction.amount
            elif refund_amount > transaction.amount:
                raise HTTPException(status_code=400, detail="Refund amount exceeds transaction amount")
            
            # Process refund
            refund_id = str(uuid.uuid4())
            
            # Update transaction
            if refund_amount == transaction.amount:
                transaction.status = TransactionStatus.REFUNDED.value
            else:
                transaction.status = TransactionStatus.PARTIALLY_REFUNDED.value
            
            transaction.refunded_at = datetime.utcnow()
            transaction.refund_amount = (transaction.refund_amount or 0) + refund_amount
            
            db.commit()
            
            return {
                "refund_id": refund_id,
                "transaction_id": transaction_id,
                "refund_amount": refund_amount,
                "status": "processed",
                "reason": reason,
                "processed_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            db.rollback()
            logger.error(f"Refund processing failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            db.close()
    
    async def get_device_list(self, merchant_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get list of registered devices"""
        db = SessionLocal()
        try:
            query = db.query(POSDevice)
            
            if merchant_id:
                query = query.filter(POSDevice.merchant_id == merchant_id)
            
            devices = query.all()
            
            return [
                {
                    "device_id": device.device_id,
                    "device_type": device.device_type,
                    "device_name": device.device_name,
                    "merchant_id": device.merchant_id,
                    "terminal_id": device.terminal_id,
                    "status": device.status,
                    "ip_address": device.ip_address,
                    "capabilities": device.capabilities,
                    "firmware_version": device.firmware_version,
                    "last_heartbeat": device.last_heartbeat.isoformat() if device.last_heartbeat else None,
                    "total_transactions": device.total_transactions
                }
                for device in devices
            ]
            
        except Exception as e:
            logger.error(f"Failed to get device list: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            db.close()
    
    async def health_check(self) -> Dict[str, Any]:
        """Health check endpoint"""
        db = SessionLocal()
        try:
            # Check database connection
            db.execute("SELECT 1")
            db_healthy = True
        except Exception:
            db_healthy = False
        finally:
            db.close()
        
        # Check Redis connection
        redis_healthy = False
        if self.redis_client:
            try:
                await self.redis_client.ping()
                redis_healthy = True
            except Exception:
                redis_healthy = False
        
        # Check connected devices
        connected_devices_count = len(self.connected_devices)
        
        return {
            "status": "healthy" if db_healthy else "unhealthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "pos-integration-service",
            "version": "1.0.0",
            "components": {
                "database": db_healthy,
                "redis": redis_healthy,
                "connected_devices": connected_devices_count
            }
        }

# FastAPI application
app = FastAPI(title="POS Integration Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global service instance
pos_service = POSIntegrationService()

# Pydantic models for API
class PaymentRequestModel(BaseModel):
    amount: float = Field(..., gt=0)
    currency: str = Field(..., min_length=3, max_length=3)
    payment_method: PaymentMethod
    merchant_id: str
    terminal_id: str
    transaction_reference: str
    customer_data: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None

class DeviceRegistrationModel(BaseModel):
    device_id: Optional[str] = None
    device_type: DeviceType
    device_name: str
    merchant_id: str
    terminal_id: str
    ip_address: Optional[str] = None
    serial_port: Optional[str] = None
    configuration: Optional[Dict[str, Any]] = None
    capabilities: Optional[List[str]] = None
    firmware_version: Optional[str] = None

class DeviceCommandModel(BaseModel):
    command: str
    data: Optional[Dict[str, Any]] = None

@app.on_event("startup")
async def startup_event():
    """Initialize service on startup"""
    await pos_service.initialize()

@app.post("/process-payment")
async def process_payment(request: PaymentRequestModel):
    """Process a payment transaction"""
    payment_request = PaymentRequest(**request.dict())
    response = await pos_service.process_payment(payment_request)
    return asdict(response)

@app.get("/transaction/{transaction_id}/status")
async def get_transaction_status(transaction_id: str):
    """Get transaction status"""
    return await pos_service.get_transaction_status(transaction_id)

@app.post("/transaction/{transaction_id}/refund")
async def refund_transaction(
    transaction_id: str,
    refund_amount: Optional[float] = None,
    reason: str = ""
):
    """Refund a transaction"""
    return await pos_service.refund_transaction(transaction_id, refund_amount, reason)

@app.post("/device/register")
async def register_device(device: DeviceRegistrationModel):
    """Register a POS device"""
    device_id = await pos_service.register_device(device.dict())
    return {"device_id": device_id, "status": "registered"}

@app.get("/devices")
async def get_devices(merchant_id: Optional[str] = None):
    """Get list of registered devices"""
    return await pos_service.get_device_list(merchant_id)

@app.post("/device/{device_id}/command")
async def send_device_command(device_id: str, command: DeviceCommandModel):
    """Send command to POS device"""
    return await pos_service.send_device_command(device_id, command.command, command.data)

@app.websocket("/ws/transactions/{terminal_id}")
async def websocket_endpoint(websocket: WebSocket, terminal_id: str):
    """WebSocket endpoint for real-time transaction updates"""
    await websocket.accept()
    pos_service.active_websockets[terminal_id] = websocket
    
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming WebSocket messages if needed
            
    except WebSocketDisconnect:
        if terminal_id in pos_service.active_websockets:
            del pos_service.active_websockets[terminal_id]

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return await pos_service.health_check()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8016)
