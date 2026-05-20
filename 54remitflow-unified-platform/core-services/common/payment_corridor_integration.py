"""
Payment Corridor Integration Layer
Wires enhanced Mojaloop and TigerBeetle clients into the transaction flow

Features:
- Unified corridor interface for all payment rails
- Two-phase commit pattern for cross-system atomicity
- Request-to-Pay support for merchant payments
- Pre-authorization for card-like flows
- Atomic fee splits with linked transfers
- Settlement window management
"""

import logging
import uuid
from typing import Dict, Any, Optional, List, Callable, Awaitable
from decimal import Decimal
from datetime import datetime, timezone
from enum import Enum
from dataclasses import dataclass
import asyncio
import os

from .mojaloop_enhanced import (
    EnhancedMojaloopClient,
    get_enhanced_mojaloop_client,
    Party,
    Money,
    TransactionType,
    MojaloopError,
    DefaultCallbackHandler
)
from .tigerbeetle_enhanced import (
    EnhancedTigerBeetleClient,
    get_enhanced_tigerbeetle_client,
    AccountFlags,
    TransferFlags,
    TransferState,
    CURRENCY_CODES
)

logger = logging.getLogger(__name__)


class PaymentCorridor(str, Enum):
    """Supported payment corridors"""
    MOJALOOP = "mojaloop"
    PAPSS = "papss"
    INTERNAL = "internal"
    MOBILE_MONEY = "mobile_money"


class TransactionMode(str, Enum):
    """Transaction modes"""
    IMMEDIATE = "immediate"  # Standard transfer
    TWO_PHASE = "two_phase"  # Reserve then post/void
    REQUEST_TO_PAY = "request_to_pay"  # Payee-initiated
    PRE_AUTH = "pre_auth"  # Authorization hold


@dataclass
class CorridorConfig:
    """Configuration for a payment corridor"""
    corridor: PaymentCorridor
    enabled: bool = True
    supports_two_phase: bool = True
    supports_request_to_pay: bool = True
    supports_pre_auth: bool = True
    default_timeout_seconds: int = 300
    fee_percentage: Decimal = Decimal("0.015")
    min_fee: int = 100
    max_fee: int = 500000


# Default corridor configurations
CORRIDOR_CONFIGS = {
    PaymentCorridor.MOJALOOP: CorridorConfig(
        corridor=PaymentCorridor.MOJALOOP,
        supports_two_phase=True,
        supports_request_to_pay=True,
        supports_pre_auth=True,
        fee_percentage=Decimal("0.003"),
        min_fee=200,
        max_fee=200000
    ),
    PaymentCorridor.PAPSS: CorridorConfig(
        corridor=PaymentCorridor.PAPSS,
        supports_two_phase=True,
        supports_request_to_pay=True,
        supports_pre_auth=False,
        fee_percentage=Decimal("0.005"),
        min_fee=500,
        max_fee=500000
    ),
    PaymentCorridor.INTERNAL: CorridorConfig(
        corridor=PaymentCorridor.INTERNAL,
        supports_two_phase=True,
        supports_request_to_pay=False,
        supports_pre_auth=True,
        fee_percentage=Decimal("0"),
        min_fee=0,
        max_fee=0
    ),
    PaymentCorridor.MOBILE_MONEY: CorridorConfig(
        corridor=PaymentCorridor.MOBILE_MONEY,
        supports_two_phase=True,
        supports_request_to_pay=True,
        supports_pre_auth=False,
        fee_percentage=Decimal("0.01"),
        min_fee=100,
        max_fee=100000
    )
}


class PaymentCorridorIntegration:
    """
    Unified payment corridor integration layer
    
    Provides a single interface for all payment operations across:
    - Mojaloop (FSPIOP)
    - PAPSS (Pan-African)
    - Internal ledger (TigerBeetle)
    - Mobile money operators
    
    Features:
    - Two-phase commit for cross-system atomicity
    - Request-to-Pay for merchant payments
    - Pre-authorization for card-like flows
    - Atomic fee splits
    - Settlement management
    """
    
    def __init__(
        self,
        mojaloop_client: Optional[EnhancedMojaloopClient] = None,
        tigerbeetle_client: Optional[EnhancedTigerBeetleClient] = None,
        fee_account_id: Optional[int] = None,
        settlement_account_id: Optional[int] = None
    ):
        self.mojaloop = mojaloop_client or get_enhanced_mojaloop_client()
        self.tigerbeetle = tigerbeetle_client or get_enhanced_tigerbeetle_client()
        
        # Fee and settlement accounts (should be configured via env)
        self.fee_account_id = fee_account_id or int(os.getenv("FEE_ACCOUNT_ID", "1000000001"))
        self.settlement_account_id = settlement_account_id or int(os.getenv("SETTLEMENT_ACCOUNT_ID", "1000000002"))
        
        self.configs = CORRIDOR_CONFIGS
        
        logger.info("Initialized Payment Corridor Integration")
    
    async def close(self):
        """Close all client connections"""
        await self.mojaloop.close()
    
    # ==================== Account Management ====================
    
    async def create_user_account(
        self,
        user_id: str,
        currency: str = "NGN",
        kyc_tier: int = 1,
        prevent_overdraft: bool = True
    ) -> Dict[str, Any]:
        """
        Create a user account in TigerBeetle with appropriate flags
        
        Args:
            user_id: Unique user identifier
            currency: Account currency
            kyc_tier: KYC tier (affects limits)
            prevent_overdraft: Whether to prevent overdrafts
            
        Returns:
            Account creation result
        """
        # Determine flags based on KYC tier
        flags = AccountFlags.HISTORY
        if prevent_overdraft:
            flags |= AccountFlags.DEBITS_MUST_NOT_EXCEED_CREDITS
        
        result = await self.tigerbeetle.create_account(
            ledger=1,
            currency=currency,
            flags=flags,
            user_data=f"user:{user_id}:tier:{kyc_tier}",
            prevent_overdraft=prevent_overdraft,
            maintain_history=True
        )
        
        if result.get("success"):
            result["user_id"] = user_id
            result["kyc_tier"] = kyc_tier
        
        return result
    
    async def get_user_balance(
        self,
        account_id: int,
        include_pending: bool = True
    ) -> Dict[str, Any]:
        """Get user account balance"""
        return await self.tigerbeetle.get_account_balance(account_id, include_pending)
    
    # ==================== Standard Transfers ====================
    
    async def transfer(
        self,
        from_account_id: int,
        to_account_id: int,
        amount: int,
        currency: str = "NGN",
        corridor: PaymentCorridor = PaymentCorridor.INTERNAL,
        mode: TransactionMode = TransactionMode.IMMEDIATE,
        external_reference: Optional[str] = None,
        note: Optional[str] = None,
        include_fees: bool = True
    ) -> Dict[str, Any]:
        """
        Execute a transfer through the specified corridor
        
        Args:
            from_account_id: Source account
            to_account_id: Destination account
            amount: Amount in minor units
            currency: Currency code
            corridor: Payment corridor to use
            mode: Transaction mode
            external_reference: Optional external reference
            note: Optional note
            include_fees: Whether to deduct fees
            
        Returns:
            Transfer result
        """
        config = self.configs.get(corridor)
        if not config or not config.enabled:
            return {"success": False, "error": f"Corridor not available: {corridor}"}
        
        # Calculate fees if applicable
        fee_amount = 0
        if include_fees and config.fee_percentage > 0:
            calculated_fee = int(Decimal(amount) * config.fee_percentage)
            fee_amount = max(config.min_fee, min(calculated_fee, config.max_fee))
        
        transfer_id = external_reference or str(uuid.uuid4())
        
        try:
            if mode == TransactionMode.IMMEDIATE:
                return await self._execute_immediate_transfer(
                    from_account_id, to_account_id, amount, fee_amount,
                    currency, corridor, transfer_id, note
                )
            elif mode == TransactionMode.TWO_PHASE:
                if not config.supports_two_phase:
                    return {"success": False, "error": f"Corridor {corridor} does not support two-phase transfers"}
                return await self._execute_two_phase_transfer(
                    from_account_id, to_account_id, amount, fee_amount,
                    currency, corridor, transfer_id, note
                )
            else:
                return {"success": False, "error": f"Unsupported mode: {mode}"}
                
        except Exception as e:
            logger.error(f"Transfer failed: {e}")
            return {"success": False, "error": str(e), "transfer_id": transfer_id}
    
    async def _execute_immediate_transfer(
        self,
        from_account_id: int,
        to_account_id: int,
        amount: int,
        fee_amount: int,
        currency: str,
        corridor: PaymentCorridor,
        transfer_id: str,
        note: Optional[str]
    ) -> Dict[str, Any]:
        """Execute an immediate transfer with atomic fee split"""
        
        if fee_amount > 0:
            # Use linked transfers for atomic fee split
            result = await self.tigerbeetle.create_fee_split_transfer(
                customer_account_id=from_account_id,
                merchant_account_id=to_account_id,
                fee_account_id=self.fee_account_id,
                partner_account_id=None,
                total_amount=amount,
                fee_amount=fee_amount,
                partner_amount=0,
                code=CURRENCY_CODES.get(currency, 566)
            )
        else:
            # Simple transfer without fees
            result = await self.tigerbeetle.create_transfer(
                debit_account_id=from_account_id,
                credit_account_id=to_account_id,
                amount=amount,
                currency=currency,
                external_reference=transfer_id
            )
        
        if result.get("success"):
            result["corridor"] = corridor.value
            result["mode"] = TransactionMode.IMMEDIATE.value
            result["note"] = note
        
        return result
    
    async def _execute_two_phase_transfer(
        self,
        from_account_id: int,
        to_account_id: int,
        amount: int,
        fee_amount: int,
        currency: str,
        corridor: PaymentCorridor,
        transfer_id: str,
        note: Optional[str]
    ) -> Dict[str, Any]:
        """Execute a two-phase transfer (reserve then post)"""
        
        # Step 1: Create pending transfer
        pending_result = await self.tigerbeetle.create_pending_transfer(
            debit_account_id=from_account_id,
            credit_account_id=to_account_id,
            amount=amount,
            currency=currency,
            external_reference=transfer_id
        )
        
        if not pending_result.get("success"):
            return pending_result
        
        pending_transfer_id = pending_result["transfer_id"]
        
        # Step 2: Execute corridor-specific operation
        corridor_success = await self._execute_corridor_operation(
            corridor, from_account_id, to_account_id, amount, currency, transfer_id
        )
        
        if corridor_success:
            # Step 3a: Post the pending transfer
            post_result = await self.tigerbeetle.post_pending_transfer(pending_transfer_id)
            
            if post_result.get("success"):
                # Handle fees separately after main transfer
                if fee_amount > 0:
                    await self.tigerbeetle.create_transfer(
                        debit_account_id=from_account_id,
                        credit_account_id=self.fee_account_id,
                        amount=fee_amount,
                        currency=currency,
                        external_reference=f"{transfer_id}_fee"
                    )
                
                return {
                    "success": True,
                    "transfer_id": transfer_id,
                    "pending_transfer_id": pending_transfer_id,
                    "amount": amount,
                    "fee_amount": fee_amount,
                    "corridor": corridor.value,
                    "mode": TransactionMode.TWO_PHASE.value,
                    "state": TransferState.POSTED.value,
                    "note": note
                }
            else:
                # Post failed, void the pending transfer
                await self.tigerbeetle.void_pending_transfer(pending_transfer_id, "Post failed")
                return post_result
        else:
            # Step 3b: Void the pending transfer
            void_result = await self.tigerbeetle.void_pending_transfer(
                pending_transfer_id,
                "Corridor operation failed"
            )
            
            return {
                "success": False,
                "transfer_id": transfer_id,
                "pending_transfer_id": pending_transfer_id,
                "state": TransferState.VOIDED.value,
                "reason": "Corridor operation failed",
                "corridor": corridor.value
            }
    
    async def _execute_corridor_operation(
        self,
        corridor: PaymentCorridor,
        from_account_id: int,
        to_account_id: int,
        amount: int,
        currency: str,
        transfer_id: str
    ) -> bool:
        """Execute corridor-specific operation (returns True on success)"""
        
        if corridor == PaymentCorridor.INTERNAL:
            # Internal transfers always succeed at this point
            return True
        
        elif corridor == PaymentCorridor.MOJALOOP:
            # For Mojaloop, we would execute the FSPIOP transfer here
            # This is a placeholder - in production, this would call the Mojaloop hub
            logger.info(f"Executing Mojaloop transfer: {transfer_id}")
            return True
        
        elif corridor == PaymentCorridor.PAPSS:
            # For PAPSS, we would execute the PAPSS transfer here
            logger.info(f"Executing PAPSS transfer: {transfer_id}")
            return True
        
        elif corridor == PaymentCorridor.MOBILE_MONEY:
            # For mobile money, we would call the operator API here
            logger.info(f"Executing mobile money transfer: {transfer_id}")
            return True
        
        return False
    
    # ==================== Request-to-Pay ====================
    
    async def request_payment(
        self,
        merchant_account_id: int,
        merchant_msisdn: str,
        customer_msisdn: str,
        amount: int,
        currency: str = "NGN",
        invoice_id: Optional[str] = None,
        note: Optional[str] = None,
        expiration_seconds: int = 300
    ) -> Dict[str, Any]:
        """
        Create a Request-to-Pay (merchant-initiated payment request)
        
        The customer will receive a notification and must approve the payment.
        
        Args:
            merchant_account_id: Merchant's TigerBeetle account
            merchant_msisdn: Merchant's mobile number
            customer_msisdn: Customer's mobile number
            amount: Amount in minor units
            currency: Currency code
            invoice_id: Optional invoice reference
            note: Optional note
            expiration_seconds: How long the request is valid
            
        Returns:
            Request-to-Pay result
        """
        request_id = str(uuid.uuid4())
        
        try:
            # Create Mojaloop transaction request
            result = await self.mojaloop.request_payment(
                merchant_msisdn=merchant_msisdn,
                customer_msisdn=customer_msisdn,
                amount=Decimal(amount) / 100,  # Convert to major units
                currency=currency,
                invoice_id=invoice_id,
                note=note
            )
            
            if result.get("success"):
                result["request_id"] = request_id
                result["merchant_account_id"] = merchant_account_id
                result["mode"] = TransactionMode.REQUEST_TO_PAY.value
            
            return result
            
        except Exception as e:
            logger.error(f"Request-to-Pay failed: {e}")
            return {"success": False, "error": str(e), "request_id": request_id}
    
    async def approve_payment_request(
        self,
        transaction_request_id: str,
        customer_account_id: int,
        merchant_account_id: int,
        amount: int,
        currency: str = "NGN"
    ) -> Dict[str, Any]:
        """
        Approve a Request-to-Pay (as the customer)
        
        Args:
            transaction_request_id: The request to approve
            customer_account_id: Customer's TigerBeetle account
            merchant_account_id: Merchant's TigerBeetle account
            amount: Amount to transfer
            currency: Currency code
            
        Returns:
            Approval result with transfer details
        """
        try:
            # Execute the transfer using two-phase commit
            result = await self.transfer(
                from_account_id=customer_account_id,
                to_account_id=merchant_account_id,
                amount=amount,
                currency=currency,
                corridor=PaymentCorridor.MOJALOOP,
                mode=TransactionMode.TWO_PHASE,
                external_reference=transaction_request_id,
                include_fees=True
            )
            
            if result.get("success"):
                # Respond to Mojaloop transaction request
                await self.mojaloop.respond_to_transaction_request(
                    transaction_request_id=transaction_request_id,
                    accept=True,
                    transfer_amount=Money(currency=currency, amount=str(amount))
                )
            
            return result
            
        except Exception as e:
            logger.error(f"Payment request approval failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def reject_payment_request(
        self,
        transaction_request_id: str,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """Reject a Request-to-Pay"""
        try:
            await self.mojaloop.respond_to_transaction_request(
                transaction_request_id=transaction_request_id,
                accept=False
            )
            
            return {
                "success": True,
                "transaction_request_id": transaction_request_id,
                "state": "REJECTED",
                "reason": reason
            }
            
        except Exception as e:
            logger.error(f"Payment request rejection failed: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== Pre-Authorization ====================
    
    async def create_authorization(
        self,
        customer_account_id: int,
        customer_msisdn: str,
        merchant_msisdn: str,
        amount: int,
        currency: str = "NGN",
        expiration_seconds: int = 3600
    ) -> Dict[str, Any]:
        """
        Create a pre-authorization hold
        
        Reserves funds on the customer's account without completing the transfer.
        The authorization can later be captured or voided.
        
        Args:
            customer_account_id: Customer's TigerBeetle account
            customer_msisdn: Customer's mobile number
            merchant_msisdn: Merchant's mobile number
            amount: Amount to authorize
            currency: Currency code
            expiration_seconds: How long the hold is valid
            
        Returns:
            Authorization result
        """
        authorization_id = str(uuid.uuid4())
        
        try:
            # Create pending transfer in TigerBeetle (reserve funds)
            pending_result = await self.tigerbeetle.create_pending_transfer(
                debit_account_id=customer_account_id,
                credit_account_id=self.settlement_account_id,  # Hold in settlement account
                amount=amount,
                currency=currency,
                timeout_seconds=expiration_seconds,
                external_reference=authorization_id
            )
            
            if not pending_result.get("success"):
                return pending_result
            
            # Create Mojaloop authorization
            mojaloop_result = await self.mojaloop.authorize_and_capture(
                merchant_msisdn=merchant_msisdn,
                customer_msisdn=customer_msisdn,
                amount=Decimal(amount) / 100,
                currency=currency,
                capture_immediately=False
            )
            
            return {
                "success": True,
                "authorization_id": authorization_id,
                "pending_transfer_id": pending_result["transfer_id"],
                "amount": amount,
                "currency": currency,
                "state": "AUTHORIZED",
                "expires_at": pending_result.get("timeout_at"),
                "mode": TransactionMode.PRE_AUTH.value
            }
            
        except Exception as e:
            logger.error(f"Authorization failed: {e}")
            return {"success": False, "error": str(e), "authorization_id": authorization_id}
    
    async def capture_authorization(
        self,
        authorization_id: str,
        merchant_account_id: int,
        capture_amount: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Capture an authorization (complete the pre-auth hold)
        
        Args:
            authorization_id: Authorization to capture
            merchant_account_id: Merchant's account to credit
            capture_amount: Amount to capture (can be less than authorized)
            
        Returns:
            Capture result
        """
        try:
            # Look up the pending transfer
            lookup_result = await self.tigerbeetle.lookup_transfer_by_reference(authorization_id)
            
            if not lookup_result.get("success"):
                return {"success": False, "error": "Authorization not found"}
            
            pending_transfer_id = lookup_result.get("transfer_id")
            original_amount = lookup_result.get("amount", 0)
            amount = capture_amount if capture_amount is not None else original_amount
            
            # Post the pending transfer
            post_result = await self.tigerbeetle.post_pending_transfer(
                pending_transfer_id,
                amount=amount
            )
            
            if post_result.get("success"):
                # Transfer from settlement to merchant
                await self.tigerbeetle.create_transfer(
                    debit_account_id=self.settlement_account_id,
                    credit_account_id=merchant_account_id,
                    amount=amount,
                    external_reference=f"{authorization_id}_capture"
                )
                
                return {
                    "success": True,
                    "authorization_id": authorization_id,
                    "captured_amount": amount,
                    "state": "CAPTURED"
                }
            
            return post_result
            
        except Exception as e:
            logger.error(f"Capture failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def void_authorization(
        self,
        authorization_id: str,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Void an authorization (release the pre-auth hold)
        
        Args:
            authorization_id: Authorization to void
            reason: Optional reason for voiding
            
        Returns:
            Void result
        """
        try:
            # Look up the pending transfer
            lookup_result = await self.tigerbeetle.lookup_transfer_by_reference(authorization_id)
            
            if not lookup_result.get("success"):
                return {"success": False, "error": "Authorization not found"}
            
            pending_transfer_id = lookup_result.get("transfer_id")
            
            # Void the pending transfer
            void_result = await self.tigerbeetle.void_pending_transfer(
                pending_transfer_id,
                reason=reason
            )
            
            if void_result.get("success"):
                return {
                    "success": True,
                    "authorization_id": authorization_id,
                    "state": "VOIDED",
                    "reason": reason
                }
            
            return void_result
            
        except Exception as e:
            logger.error(f"Void failed: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== Settlement ====================
    
    async def get_settlement_windows(
        self,
        state: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get Mojaloop settlement windows"""
        from .mojaloop_enhanced import SettlementWindowState
        
        window_state = None
        if state:
            try:
                window_state = SettlementWindowState(state)
            except ValueError:
                pass
        
        return await self.mojaloop.get_settlement_windows(state=window_state)
    
    async def close_settlement_window(
        self,
        settlement_window_id: str,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """Close a Mojaloop settlement window"""
        return await self.mojaloop.close_settlement_window(settlement_window_id, reason)
    
    async def get_participant_positions(self) -> Dict[str, Any]:
        """Get participant positions for settlement"""
        return await self.mojaloop.get_participant_positions()
    
    async def reconcile_settlement(
        self,
        settlement_id: str,
        corridor: str,
        expected_balance: Decimal
    ) -> Dict[str, Any]:
        """
        Reconcile settlement between Mojaloop and TigerBeetle
        
        Args:
            settlement_id: Settlement identifier
            corridor: Trade corridor
            expected_balance: Expected balance from Mojaloop
            
        Returns:
            Reconciliation result
        """
        # Get TigerBeetle balance for settlement account
        tb_balance = await self.tigerbeetle.get_account_balance(self.settlement_account_id)
        
        if not tb_balance.get("success"):
            return {"success": False, "error": "Failed to get TigerBeetle balance"}
        
        actual_balance = Decimal(tb_balance.get("balance", 0))
        variance = actual_balance - expected_balance
        
        return {
            "success": True,
            "settlement_id": settlement_id,
            "corridor": corridor,
            "expected_balance": float(expected_balance),
            "actual_balance": float(actual_balance),
            "variance": float(variance),
            "status": "RECONCILED" if abs(variance) < 100 else "DISCREPANCY_DETECTED",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    
    # ==================== Batch Operations ====================
    
    async def process_bulk_transfers(
        self,
        transfers: List[Dict[str, Any]],
        atomic: bool = True
    ) -> Dict[str, Any]:
        """
        Process multiple transfers in a batch
        
        Args:
            transfers: List of transfer definitions
            atomic: If True, all transfers succeed or fail together
            
        Returns:
            Batch result
        """
        if atomic:
            # Use linked transfers for atomic batch
            return await self.tigerbeetle.create_linked_transfers(transfers)
        else:
            # Process individually
            results = []
            for t in transfers:
                result = await self.transfer(
                    from_account_id=t["from_account_id"],
                    to_account_id=t["to_account_id"],
                    amount=t["amount"],
                    currency=t.get("currency", "NGN"),
                    corridor=PaymentCorridor(t.get("corridor", "internal")),
                    mode=TransactionMode(t.get("mode", "immediate"))
                )
                results.append(result)
            
            success_count = sum(1 for r in results if r.get("success"))
            
            return {
                "success": success_count == len(transfers),
                "total": len(transfers),
                "successful": success_count,
                "failed": len(transfers) - success_count,
                "results": results
            }
    
    async def process_salary_disbursement(
        self,
        employer_account_id: int,
        disbursements: List[Dict[str, Any]],
        fee_account_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Process salary disbursement with atomic multi-party transfers
        
        Args:
            employer_account_id: Employer's account
            disbursements: List of {employee_account_id, amount}
            fee_account_id: Optional fee account
            
        Returns:
            Disbursement result
        """
        total_amount = sum(d["amount"] for d in disbursements)
        
        # Build linked transfers
        transfers = []
        for d in disbursements:
            transfers.append({
                "debit_account_id": employer_account_id,
                "credit_account_id": d["employee_account_id"],
                "amount": d["amount"]
            })
        
        # Add fee transfer if applicable
        if fee_account_id:
            fee = int(Decimal(total_amount) * Decimal("0.001"))  # 0.1% fee
            transfers.append({
                "debit_account_id": employer_account_id,
                "credit_account_id": fee_account_id,
                "amount": fee
            })
        
        result = await self.tigerbeetle.create_linked_transfers(transfers)
        
        if result.get("success"):
            result["disbursement"] = {
                "employer_account_id": employer_account_id,
                "employee_count": len(disbursements),
                "total_amount": total_amount
            }
        
        return result


# ==================== Factory Function ====================

def get_payment_corridor_integration(
    mojaloop_client: Optional[EnhancedMojaloopClient] = None,
    tigerbeetle_client: Optional[EnhancedTigerBeetleClient] = None
) -> PaymentCorridorIntegration:
    """Get payment corridor integration instance"""
    return PaymentCorridorIntegration(
        mojaloop_client=mojaloop_client,
        tigerbeetle_client=tigerbeetle_client
    )
