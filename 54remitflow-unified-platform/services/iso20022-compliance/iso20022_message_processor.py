#!/usr/bin/env python3
"""
ISO20022 Message Processor Service
Implements CBN ISO20022 migration requirements for payment messaging compliance
"""

import asyncio
import json
import logging
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import uuid
import re

import aiohttp
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import uvicorn
from lxml import etree

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="ISO20022 Message Processor",
    description="CBN ISO20022 compliance service for payment messaging",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
BUSINESS_RULES_URL = os.getenv("BUSINESS_RULES_URL", "http://localhost:8086")

# ISO20022 Message Types
class MessageType(str, Enum):
    PACS_008 = "pacs.008.001.08"  # Customer Credit Transfer
    PACS_004 = "pacs.004.001.09"  # Payment Return
    PAIN_001 = "pain.001.001.11"  # Customer Credit Transfer Initiation
    PAIN_002 = "pain.002.001.10"  # Customer Payment Status Report
    CAMT_053 = "camt.053.001.08"  # Bank to Customer Statement
    CAMT_054 = "camt.054.001.08"  # Bank to Customer Debit Credit Notification

# Data Models
class PartyIdentification(BaseModel):
    name: str = Field(..., description="Party name")
    identification: Optional[str] = Field(None, description="Party identification")
    address: Optional[Dict[str, str]] = Field(None, description="Party address")
    country_code: str = Field("NG", description="Country code")

class AccountIdentification(BaseModel):
    iban: Optional[str] = Field(None, description="IBAN")
    account_number: str = Field(..., description="Account number")
    bank_code: str = Field(..., description="Bank code")
    account_name: str = Field(..., description="Account name")

class AmountDetails(BaseModel):
    currency: str = Field("NGN", description="Currency code")
    amount: float = Field(..., description="Transaction amount")

class GeolocationData(BaseModel):
    latitude: float = Field(..., description="GPS latitude")
    longitude: float = Field(..., description="GPS longitude")
    accuracy: Optional[float] = Field(None, description="GPS accuracy in meters")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    @validator('latitude')
    def validate_latitude(cls, v):
        if not -90 <= v <= 90:
            raise ValueError('Latitude must be between -90 and 90')
        return v
    
    @validator('longitude')
    def validate_longitude(cls, v):
        if not -180 <= v <= 180:
            raise ValueError('Longitude must be between -180 and 180')
        return v

class PaymentInstruction(BaseModel):
    message_type: MessageType = Field(..., description="ISO20022 message type")
    instruction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    end_to_end_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    debtor: PartyIdentification = Field(..., description="Debtor information")
    debtor_account: AccountIdentification = Field(..., description="Debtor account")
    creditor: PartyIdentification = Field(..., description="Creditor information")
    creditor_account: AccountIdentification = Field(..., description="Creditor account")
    amount: AmountDetails = Field(..., description="Payment amount")
    purpose_code: Optional[str] = Field(None, description="Payment purpose code")
    remittance_info: Optional[str] = Field(None, description="Remittance information")
    geolocation: Optional[GeolocationData] = Field(None, description="Terminal geolocation")
    terminal_id: Optional[str] = Field(None, description="Payment terminal ID")
    merchant_id: Optional[str] = Field(None, description="Merchant identifier")

class ISO20022Message(BaseModel):
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    creation_date_time: datetime = Field(default_factory=datetime.utcnow)
    message_type: MessageType = Field(..., description="Message type")
    payment_instructions: List[PaymentInstruction] = Field(..., description="Payment instructions")
    number_of_transactions: int = Field(..., description="Number of transactions")
    control_sum: float = Field(..., description="Control sum of all amounts")

class ValidationResult(BaseModel):
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    compliance_score: float
    validation_time: float

class ProcessingResult(BaseModel):
    message_id: str
    status: str
    iso20022_xml: str
    validation_result: ValidationResult
    geolocation_compliance: bool
    processing_time: float
    timestamp: datetime

# Global state
redis_client: Optional[redis.Redis] = None
message_count = 0
last_message_time: Optional[datetime] = None

class ISO20022MessageBuilder:
    """Builder for ISO20022 XML messages"""
    
    def __init__(self):
        self.namespaces = {
            'pacs': 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08',
            'pain': 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.11',
            'camt': 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08'
        }
    
    def build_pacs_008(self, message: ISO20022Message) -> str:
        """Build pacs.008 Customer Credit Transfer message"""
        
        # Create root element
        root = etree.Element(
            "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Document",
            nsmap={'pacs': 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08'}
        )
        
        # FIToFICstmrCdtTrf element
        fi_to_fi = etree.SubElement(root, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}FIToFICstmrCdtTrf")
        
        # Group Header
        grp_hdr = etree.SubElement(fi_to_fi, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}GrpHdr")
        
        msg_id = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}MsgId")
        msg_id.text = message.message_id
        
        cre_dt_tm = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}CreDtTm")
        cre_dt_tm.text = message.creation_date_time.isoformat()
        
        nb_of_txs = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}NbOfTxs")
        nb_of_txs.text = str(message.number_of_transactions)
        
        ctrl_sum = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}CtrlSum")
        ctrl_sum.text = f"{message.control_sum:.2f}"
        
        # Credit Transfer Transaction Information
        for instruction in message.payment_instructions:
            cdt_trf_tx_inf = etree.SubElement(fi_to_fi, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}CdtTrfTxInf")
            
            # Payment Identification
            pmt_id = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}PmtId")
            
            instr_id = etree.SubElement(pmt_id, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}InstrId")
            instr_id.text = instruction.instruction_id
            
            end_to_end_id = etree.SubElement(pmt_id, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}EndToEndId")
            end_to_end_id.text = instruction.end_to_end_id
            
            # Interbank Settlement Amount
            intrbnk_sttlm_amt = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}IntrBnkSttlmAmt")
            intrbnk_sttlm_amt.set("Ccy", instruction.amount.currency)
            intrbnk_sttlm_amt.text = f"{instruction.amount.amount:.2f}"
            
            # Debtor
            dbtr = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Dbtr")
            dbtr_nm = etree.SubElement(dbtr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Nm")
            dbtr_nm.text = instruction.debtor.name
            
            # Debtor Account
            dbtr_acct = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}DbtrAcct")
            dbtr_acct_id = etree.SubElement(dbtr_acct, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Id")
            dbtr_acct_othr = etree.SubElement(dbtr_acct_id, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Othr")
            dbtr_acct_othr_id = etree.SubElement(dbtr_acct_othr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Id")
            dbtr_acct_othr_id.text = instruction.debtor_account.account_number
            
            # Creditor
            cdtr = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Cdtr")
            cdtr_nm = etree.SubElement(cdtr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Nm")
            cdtr_nm.text = instruction.creditor.name
            
            # Creditor Account
            cdtr_acct = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}CdtrAcct")
            cdtr_acct_id = etree.SubElement(cdtr_acct, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Id")
            cdtr_acct_othr = etree.SubElement(cdtr_acct_id, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Othr")
            cdtr_acct_othr_id = etree.SubElement(cdtr_acct_othr, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Id")
            cdtr_acct_othr_id.text = instruction.creditor_account.account_number
            
            # Remittance Information
            if instruction.remittance_info:
                rmt_inf = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}RmtInf")
                ustrd = etree.SubElement(rmt_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Ustrd")
                ustrd.text = instruction.remittance_info
            
            # Geolocation Information (CBN Extension)
            if instruction.geolocation:
                # Add geolocation as supplementary data
                splmtry_data = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}SplmtryData")
                envlp = etree.SubElement(splmtry_data, "{urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08}Envlp")
                
                # Geolocation data
                geo_data = etree.SubElement(envlp, "GeolocationData")
                lat = etree.SubElement(geo_data, "Latitude")
                lat.text = str(instruction.geolocation.latitude)
                lng = etree.SubElement(geo_data, "Longitude")
                lng.text = str(instruction.geolocation.longitude)
                
                if instruction.terminal_id:
                    term_id = etree.SubElement(geo_data, "TerminalId")
                    term_id.text = instruction.terminal_id
        
        return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding='UTF-8').decode('utf-8')
    
    def build_pain_001(self, message: ISO20022Message) -> str:
        """Build pain.001 Customer Credit Transfer Initiation message"""
        
        # Create root element
        root = etree.Element(
            "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}Document",
            nsmap={'pain': 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.11'}
        )
        
        # CstmrCdtTrfInitn element
        cstmr_cdt_trf = etree.SubElement(root, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}CstmrCdtTrfInitn")
        
        # Group Header
        grp_hdr = etree.SubElement(cstmr_cdt_trf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}GrpHdr")
        
        msg_id = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}MsgId")
        msg_id.text = message.message_id
        
        cre_dt_tm = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}CreDtTm")
        cre_dt_tm.text = message.creation_date_time.isoformat()
        
        nb_of_txs = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}NbOfTxs")
        nb_of_txs.text = str(message.number_of_transactions)
        
        ctrl_sum = etree.SubElement(grp_hdr, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}CtrlSum")
        ctrl_sum.text = f"{message.control_sum:.2f}"
        
        # Payment Information
        pmt_inf = etree.SubElement(cstmr_cdt_trf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}PmtInf")
        
        pmt_inf_id = etree.SubElement(pmt_inf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}PmtInfId")
        pmt_inf_id.text = f"PMT-{message.message_id}"
        
        pmt_mtd = etree.SubElement(pmt_inf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}PmtMtd")
        pmt_mtd.text = "TRF"  # Transfer
        
        # Credit Transfer Transaction Information
        for instruction in message.payment_instructions:
            cdt_trf_tx_inf = etree.SubElement(pmt_inf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}CdtTrfTxInf")
            
            # Payment Identification
            pmt_id = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}PmtId")
            end_to_end_id = etree.SubElement(pmt_id, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}EndToEndId")
            end_to_end_id.text = instruction.end_to_end_id
            
            # Amount
            amt = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}Amt")
            instd_amt = etree.SubElement(amt, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}InstdAmt")
            instd_amt.set("Ccy", instruction.amount.currency)
            instd_amt.text = f"{instruction.amount.amount:.2f}"
            
            # Creditor
            cdtr = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}Cdtr")
            cdtr_nm = etree.SubElement(cdtr, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}Nm")
            cdtr_nm.text = instruction.creditor.name
            
            # Creditor Account
            cdtr_acct = etree.SubElement(cdt_trf_tx_inf, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}CdtrAcct")
            cdtr_acct_id = etree.SubElement(cdtr_acct, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}Id")
            cdtr_acct_othr = etree.SubElement(cdtr_acct_id, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}Othr")
            cdtr_acct_othr_id = etree.SubElement(cdtr_acct_othr, "{urn:iso:std:iso:20022:tech:xsd:pain.001.001.11}Id")
            cdtr_acct_othr_id.text = instruction.creditor_account.account_number
        
        return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding='UTF-8').decode('utf-8')

class ISO20022Validator:
    """Validator for ISO20022 messages and CBN compliance"""
    
    def __init__(self):
        self.mandatory_fields = {
            MessageType.PACS_008: [
                'message_id', 'creation_date_time', 'number_of_transactions',
                'control_sum', 'payment_instructions'
            ],
            MessageType.PAIN_001: [
                'message_id', 'creation_date_time', 'number_of_transactions',
                'control_sum', 'payment_instructions'
            ]
        }
    
    def validate_message(self, message: ISO20022Message) -> ValidationResult:
        """Validate ISO20022 message for CBN compliance"""
        start_time = time.time()
        errors = []
        warnings = []
        
        # Validate mandatory fields
        mandatory_fields = self.mandatory_fields.get(message.message_type, [])
        for field in mandatory_fields:
            if not hasattr(message, field) or getattr(message, field) is None:
                errors.append(f"Missing mandatory field: {field}")
        
        # Validate payment instructions
        if not message.payment_instructions:
            errors.append("At least one payment instruction is required")
        else:
            for i, instruction in enumerate(message.payment_instructions):
                instruction_errors = self._validate_payment_instruction(instruction, i)
                errors.extend(instruction_errors)
        
        # Validate control sum
        calculated_sum = sum(instr.amount.amount for instr in message.payment_instructions)
        if abs(calculated_sum - message.control_sum) > 0.01:
            errors.append(f"Control sum mismatch: expected {calculated_sum}, got {message.control_sum}")
        
        # Validate number of transactions
        if len(message.payment_instructions) != message.number_of_transactions:
            errors.append(f"Transaction count mismatch: expected {len(message.payment_instructions)}, got {message.number_of_transactions}")
        
        # CBN-specific validations
        cbn_errors, cbn_warnings = self._validate_cbn_requirements(message)
        errors.extend(cbn_errors)
        warnings.extend(cbn_warnings)
        
        # Calculate compliance score
        total_checks = 10  # Total number of validation checks
        failed_checks = len(errors)
        compliance_score = max(0, (total_checks - failed_checks) / total_checks)
        
        validation_time = time.time() - start_time
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            compliance_score=compliance_score,
            validation_time=validation_time
        )
    
    def _validate_payment_instruction(self, instruction: PaymentInstruction, index: int) -> List[str]:
        """Validate individual payment instruction"""
        errors = []
        
        # Validate debtor information
        if not instruction.debtor.name:
            errors.append(f"Instruction {index}: Debtor name is required")
        
        if not instruction.debtor_account.account_number:
            errors.append(f"Instruction {index}: Debtor account number is required")
        
        if not instruction.debtor_account.bank_code:
            errors.append(f"Instruction {index}: Debtor bank code is required")
        
        # Validate creditor information
        if not instruction.creditor.name:
            errors.append(f"Instruction {index}: Creditor name is required")
        
        if not instruction.creditor_account.account_number:
            errors.append(f"Instruction {index}: Creditor account number is required")
        
        if not instruction.creditor_account.bank_code:
            errors.append(f"Instruction {index}: Creditor bank code is required")
        
        # Validate amount
        if instruction.amount.amount <= 0:
            errors.append(f"Instruction {index}: Amount must be positive")
        
        if instruction.amount.currency != "NGN":
            errors.append(f"Instruction {index}: Currency must be NGN for domestic transactions")
        
        return errors
    
    def _validate_cbn_requirements(self, message: ISO20022Message) -> Tuple[List[str], List[str]]:
        """Validate CBN-specific requirements"""
        errors = []
        warnings = []
        
        for i, instruction in enumerate(message.payment_instructions):
            # Geolocation validation for terminal transactions
            if instruction.terminal_id and not instruction.geolocation:
                errors.append(f"Instruction {i}: Geolocation required for terminal transactions")
            
            if instruction.geolocation:
                # Validate GPS coordinates are within Nigeria
                if not (4.0 <= instruction.geolocation.latitude <= 14.0):
                    warnings.append(f"Instruction {i}: Latitude outside Nigeria bounds")
                
                if not (2.5 <= instruction.geolocation.longitude <= 15.0):
                    warnings.append(f"Instruction {i}: Longitude outside Nigeria bounds")
                
                # Validate GPS accuracy
                if instruction.geolocation.accuracy and instruction.geolocation.accuracy > 10:
                    warnings.append(f"Instruction {i}: GPS accuracy exceeds 10 meters")
            
            # Validate merchant/agent identifiers
            if instruction.merchant_id and not re.match(r'^[A-Z0-9]{6,20}$', instruction.merchant_id):
                errors.append(f"Instruction {i}: Invalid merchant ID format")
            
            # Validate bank codes (Nigerian bank codes)
            if not re.match(r'^\d{3}$', instruction.debtor_account.bank_code):
                errors.append(f"Instruction {i}: Invalid debtor bank code format")
            
            if not re.match(r'^\d{3}$', instruction.creditor_account.bank_code):
                errors.append(f"Instruction {i}: Invalid creditor bank code format")
        
        return errors, warnings

class GeolocationValidator:
    """Validator for geolocation compliance"""
    
    def __init__(self):
        self.nigeria_bounds = {
            'min_lat': 4.0,
            'max_lat': 14.0,
            'min_lng': 2.5,
            'max_lng': 15.0
        }
    
    def validate_geolocation_compliance(self, message: ISO20022Message) -> bool:
        """Validate geolocation compliance for all instructions"""
        for instruction in message.payment_instructions:
            if instruction.terminal_id:  # Terminal transaction requires geolocation
                if not instruction.geolocation:
                    return False
                
                if not self._is_within_nigeria(instruction.geolocation):
                    return False
                
                if instruction.geolocation.accuracy and instruction.geolocation.accuracy > 10:
                    return False
        
        return True
    
    def _is_within_nigeria(self, geolocation: GeolocationData) -> bool:
        """Check if coordinates are within Nigeria"""
        return (
            self.nigeria_bounds['min_lat'] <= geolocation.latitude <= self.nigeria_bounds['max_lat'] and
            self.nigeria_bounds['min_lng'] <= geolocation.longitude <= self.nigeria_bounds['max_lng']
        )

# Global instances
message_builder = ISO20022MessageBuilder()
validator = ISO20022Validator()
geo_validator = GeolocationValidator()

class BusinessRulesClient:
    """Client for business rules service integration"""
    
    async def evaluate_rules(self, service: str, facts: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate business rules for ISO20022 processing"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{BUSINESS_RULES_URL}/reason",
                    json={
                        "service": service,
                        "facts": facts,
                        "method": "deduction"
                    },
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        logger.warning(f"Business rules service error: {response.status}")
                        return {"conclusion": {}, "reasoning_trace": []}
        except Exception as e:
            logger.warning(f"Failed to connect to business rules service: {e}")
            return {"conclusion": {}, "reasoning_trace": []}

# Global business rules client
rules_client = BusinessRulesClient()

async def startup_event():
    """Initialize services on startup"""
    global redis_client
    
    try:
        redis_client = redis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Connected to Redis")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}")
        redis_client = None
    
    logger.info("ISO20022 Message Processor started")

async def shutdown_event():
    """Cleanup on shutdown"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
    
    logger.info("ISO20022 Message Processor stopped")

app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow(),
        "services": {
            "redis": "connected" if redis_client else "disconnected",
            "iso20022_processor": "active",
            "business_rules": "available"
        },
        "compliance": {
            "cbn_iso20022": "enabled",
            "geolocation_validation": "enabled",
            "message_validation": "enabled"
        }
    }

@app.post("/process", response_model=ProcessingResult)
async def process_message(message: ISO20022Message):
    """Process ISO20022 message with CBN compliance validation"""
    global message_count, last_message_time
    
    start_time = time.time()
    
    try:
        # Prepare facts for business rules evaluation
        message_facts = {
            "message_type": message.message_type.value,
            "number_of_transactions": message.number_of_transactions,
            "control_sum": message.control_sum,
            "has_geolocation": any(instr.geolocation for instr in message.payment_instructions),
            "terminal_transactions": sum(1 for instr in message.payment_instructions if instr.terminal_id),
            "total_amount": message.control_sum,
            "currency": message.payment_instructions[0].amount.currency if message.payment_instructions else "NGN"
        }
        
        # Evaluate business rules
        rules_result = await rules_client.evaluate_rules("iso20022_compliance", message_facts)
        
        # Validate message
        validation_result = validator.validate_message(message)
        
        # Validate geolocation compliance
        geolocation_compliance = geo_validator.validate_geolocation_compliance(message)
        
        # Build XML message
        if message.message_type == MessageType.PACS_008:
            xml_message = message_builder.build_pacs_008(message)
        elif message.message_type == MessageType.PAIN_001:
            xml_message = message_builder.build_pain_001(message)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported message type: {message.message_type}")
        
        # Determine processing status
        if validation_result.is_valid and geolocation_compliance:
            status = "processed"
        elif validation_result.is_valid:
            status = "processed_with_warnings"
        else:
            status = "failed"
        
        # Calculate processing time
        processing_time = time.time() - start_time
        
        # Update global counters
        message_count += 1
        last_message_time = datetime.utcnow()
        
        # Cache result if Redis is available
        if redis_client:
            cache_key = f"iso20022:{message.message_id}"
            cache_data = {
                "status": status,
                "validation_result": validation_result.dict(),
                "geolocation_compliance": geolocation_compliance,
                "timestamp": last_message_time.isoformat()
            }
            await redis_client.setex(cache_key, 3600, json.dumps(cache_data))  # 1 hour
        
        return ProcessingResult(
            message_id=message.message_id,
            status=status,
            iso20022_xml=xml_message,
            validation_result=validation_result,
            geolocation_compliance=geolocation_compliance,
            processing_time=processing_time,
            timestamp=last_message_time
        )
        
    except Exception as e:
        logger.error(f"Message processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/validate")
async def validate_message(message: ISO20022Message):
    """Validate ISO20022 message without processing"""
    try:
        validation_result = validator.validate_message(message)
        geolocation_compliance = geo_validator.validate_geolocation_compliance(message)
        
        return {
            "message_id": message.message_id,
            "validation_result": validation_result,
            "geolocation_compliance": geolocation_compliance,
            "overall_compliance": validation_result.is_valid and geolocation_compliance
        }
    except Exception as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/message-types")
async def get_supported_message_types():
    """Get supported ISO20022 message types"""
    return {
        "supported_types": [
            {
                "code": msg_type.value,
                "name": msg_type.name,
                "description": _get_message_description(msg_type)
            }
            for msg_type in MessageType
        ]
    }

def _get_message_description(msg_type: MessageType) -> str:
    """Get description for message type"""
    descriptions = {
        MessageType.PACS_008: "Customer Credit Transfer",
        MessageType.PACS_004: "Payment Return",
        MessageType.PAIN_001: "Customer Credit Transfer Initiation",
        MessageType.PAIN_002: "Customer Payment Status Report",
        MessageType.CAMT_053: "Bank to Customer Statement",
        MessageType.CAMT_054: "Bank to Customer Debit Credit Notification"
    }
    return descriptions.get(msg_type, "Unknown message type")

@app.get("/compliance/cbn")
async def get_cbn_compliance_info():
    """Get CBN compliance requirements information"""
    return {
        "compliance_deadline": "2025-10-31",
        "requirements": {
            "iso20022_format": "All payment messages must be in ISO 20022 format",
            "mandatory_data_elements": "Complete population of payer/payee identifiers, merchant/agent identifiers, transaction metadata",
            "geolocation_services": "Native geolocation services with Double-Frequency GPS receivers",
            "terminal_registration": "PTSA registration with accurate coordinates",
            "sdk_integration": "National Central Switch SDK for geolocation monitoring",
            "os_requirement": "Android OS v10 minimum",
            "radius_compliance": "10 meters outside registered business location"
        },
        "supported_message_types": [msg_type.value for msg_type in MessageType]
    }

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return {
        "total_messages_processed": message_count,
        "last_message_time": last_message_time,
        "supported_message_types": len(MessageType),
        "cbn_compliance_enabled": True,
        "geolocation_validation_enabled": True,
        "version": "2.0.0"
    }

@app.post("/test")
async def test_service():
    """Test service with sample ISO20022 message"""
    
    # Create test message
    test_message = ISO20022Message(
        message_type=MessageType.PACS_008,
        payment_instructions=[
            PaymentInstruction(
                debtor=PartyIdentification(
                    name="John Doe",
                    identification="12345678901",
                    country_code="NG"
                ),
                debtor_account=AccountIdentification(
                    account_number="1234567890",
                    bank_code="044",
                    account_name="John Doe"
                ),
                creditor=PartyIdentification(
                    name="Jane Smith",
                    identification="09876543210",
                    country_code="NG"
                ),
                creditor_account=AccountIdentification(
                    account_number="0987654321",
                    bank_code="058",
                    account_name="Jane Smith"
                ),
                amount=AmountDetails(
                    currency="NGN",
                    amount=10000.00
                ),
                purpose_code="SALA",
                remittance_info="Salary payment",
                geolocation=GeolocationData(
                    latitude=6.5244,
                    longitude=3.3792,
                    accuracy=5.0
                ),
                terminal_id="TERM001",
                merchant_id="MERCH001"
            )
        ],
        number_of_transactions=1,
        control_sum=10000.00
    )
    
    # Process test message
    result = await process_message(test_message)
    
    return {
        "test_status": "success",
        "result": result
    }

if __name__ == "__main__":
    uvicorn.run(
        "iso20022_message_processor:app",
        host="0.0.0.0",
        port=8089,
        reload=True,
        log_level="info"
    )

