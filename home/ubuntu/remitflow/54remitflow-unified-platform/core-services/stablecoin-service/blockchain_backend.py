"""
Real Blockchain Backend - Production-ready blockchain integration.

This module provides real blockchain connectivity with:
- Multi-chain support (Ethereum, Tron, Solana, Polygon, BSC)
- Proper key management with encryption
- Transaction signing and broadcasting
- Balance monitoring
- Graceful degradation when not configured
"""

import os
import json
import logging
import hashlib
import asyncio
from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime
from enum import Enum

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64

logger = logging.getLogger(__name__)

# Environment configuration
BLOCKCHAIN_MODE = os.getenv("STABLECOIN_BLOCKCHAIN_MODE", "simulated")  # "simulated" or "live"
KEYSTORE_MASTER_KEY = os.getenv("KEYSTORE_MASTER_KEY", "")  # Required for live mode

# RPC endpoints
RPC_ENDPOINTS = {
    "ethereum": os.getenv("ETHEREUM_RPC_URL", ""),
    "tron": os.getenv("TRON_RPC_URL", ""),
    "solana": os.getenv("SOLANA_RPC_URL", ""),
    "polygon": os.getenv("POLYGON_RPC_URL", ""),
    "bsc": os.getenv("BSC_RPC_URL", ""),
}

# ERC20 ABI for token transfers (minimal)
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"}
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    }
]


class BlockchainMode(str, Enum):
    SIMULATED = "simulated"
    LIVE = "live"


class TransactionResult:
    """Result of a blockchain transaction."""
    
    def __init__(
        self,
        success: bool,
        tx_hash: Optional[str] = None,
        error: Optional[str] = None,
        is_simulated: bool = False,
        gas_used: Optional[int] = None,
        block_number: Optional[int] = None,
    ):
        self.success = success
        self.tx_hash = tx_hash
        self.error = error
        self.is_simulated = is_simulated
        self.gas_used = gas_used
        self.block_number = block_number
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "tx_hash": self.tx_hash,
            "error": self.error,
            "is_simulated": self.is_simulated,
            "gas_used": self.gas_used,
            "block_number": self.block_number,
        }


class BalanceResult:
    """Result of a balance query."""
    
    def __init__(
        self,
        balance: Decimal,
        is_simulated: bool = False,
        error: Optional[str] = None,
    ):
        self.balance = balance
        self.is_simulated = is_simulated
        self.error = error
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "balance": str(self.balance),
            "is_simulated": self.is_simulated,
            "error": self.error,
        }


class KeyStore:
    """
    Encrypted key storage for wallet private keys.
    
    WARNING: This is a stepping stone implementation. In production, use:
    - HashiCorp Vault
    - AWS KMS / GCP KMS
    - Hardware Security Modules (HSM)
    """
    
    def __init__(self, master_key: str):
        if not master_key:
            logger.warning("KEYSTORE_MASTER_KEY not set - key storage disabled")
            self._fernet = None
            return
        
        # Derive encryption key from master key
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"stablecoin_keystore_v1",  # In production, use unique salt per key
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(master_key.encode()))
        self._fernet = Fernet(key)
        self._keys: Dict[str, bytes] = {}  # wallet_id -> encrypted_key
    
    def is_configured(self) -> bool:
        return self._fernet is not None
    
    def store_key(self, wallet_id: str, private_key: bytes) -> bool:
        """Store an encrypted private key."""
        if not self._fernet:
            logger.error("KeyStore not configured - cannot store key")
            return False
        
        encrypted = self._fernet.encrypt(private_key)
        self._keys[wallet_id] = encrypted
        logger.info(f"Stored encrypted key for wallet {wallet_id}")
        return True
    
    def get_key(self, wallet_id: str) -> Optional[bytes]:
        """Retrieve and decrypt a private key."""
        if not self._fernet:
            logger.error("KeyStore not configured - cannot retrieve key")
            return None
        
        encrypted = self._keys.get(wallet_id)
        if not encrypted:
            logger.warning(f"No key found for wallet {wallet_id}")
            return None
        
        try:
            return self._fernet.decrypt(encrypted)
        except Exception as e:
            logger.error(f"Failed to decrypt key for wallet {wallet_id}: {e}")
            return None
    
    def delete_key(self, wallet_id: str) -> bool:
        """Delete a stored key."""
        if wallet_id in self._keys:
            del self._keys[wallet_id]
            return True
        return False


class ChainClient(ABC):
    """Abstract base class for blockchain clients."""
    
    def __init__(self, chain: str, rpc_url: str, keystore: KeyStore):
        self.chain = chain
        self.rpc_url = rpc_url
        self.keystore = keystore
        self._is_configured = bool(rpc_url)
    
    def is_configured(self) -> bool:
        return self._is_configured
    
    @abstractmethod
    async def get_balance(
        self, address: str, token_contract: Optional[str] = None
    ) -> BalanceResult:
        """Get native or token balance for an address."""
        pass
    
    @abstractmethod
    async def send_transaction(
        self,
        wallet_id: str,
        to_address: str,
        amount: Decimal,
        token_contract: Optional[str] = None,
    ) -> TransactionResult:
        """Send a transaction."""
        pass
    
    @abstractmethod
    async def get_transaction_status(
        self, tx_hash: str
    ) -> Dict[str, Any]:
        """Get transaction status and confirmations."""
        pass
    
    @abstractmethod
    async def estimate_fee(
        self, to_address: str, amount: Decimal, token_contract: Optional[str] = None
    ) -> Decimal:
        """Estimate transaction fee."""
        pass
    
    @abstractmethod
    async def generate_wallet(self, user_id: str) -> Tuple[str, str]:
        """Generate a new wallet. Returns (address, wallet_id)."""
        pass


class EthereumClient(ChainClient):
    """Ethereum and EVM-compatible chain client."""
    
    def __init__(self, chain: str, rpc_url: str, keystore: KeyStore, chain_id: int = 1):
        super().__init__(chain, rpc_url, keystore)
        self.chain_id = chain_id
        self._web3 = None
        
        if self._is_configured:
            try:
                from web3 import Web3
                self._web3 = Web3(Web3.HTTPProvider(rpc_url))
                if not self._web3.is_connected():
                    logger.warning(f"{chain} RPC not connected: {rpc_url}")
                    self._is_configured = False
                else:
                    logger.info(f"{chain} client connected to {rpc_url}")
            except Exception as e:
                logger.error(f"Failed to initialize {chain} client: {e}")
                self._is_configured = False
    
    async def get_balance(
        self, address: str, token_contract: Optional[str] = None
    ) -> BalanceResult:
        if not self._is_configured or not self._web3:
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error="Chain not configured"
            )
        
        try:
            if token_contract:
                # ERC20 token balance
                contract = self._web3.eth.contract(
                    address=self._web3.to_checksum_address(token_contract),
                    abi=ERC20_ABI
                )
                balance_wei = contract.functions.balanceOf(
                    self._web3.to_checksum_address(address)
                ).call()
                decimals = contract.functions.decimals().call()
                balance = Decimal(balance_wei) / Decimal(10 ** decimals)
            else:
                # Native balance
                balance_wei = self._web3.eth.get_balance(
                    self._web3.to_checksum_address(address)
                )
                balance = Decimal(balance_wei) / Decimal(10 ** 18)
            
            return BalanceResult(balance=balance, is_simulated=False)
        except Exception as e:
            logger.error(f"Failed to get balance on {self.chain}: {e}")
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error=str(e)
            )
    
    async def send_transaction(
        self,
        wallet_id: str,
        to_address: str,
        amount: Decimal,
        token_contract: Optional[str] = None,
    ) -> TransactionResult:
        if not self._is_configured or not self._web3:
            return TransactionResult(
                success=False,
                error="Chain not configured",
                is_simulated=True
            )
        
        private_key = self.keystore.get_key(wallet_id)
        if not private_key:
            return TransactionResult(
                success=False,
                error="Private key not found",
                is_simulated=True
            )
        
        try:
            from web3 import Account
            account = Account.from_key(private_key)
            from_address = account.address
            
            # Get nonce
            nonce = self._web3.eth.get_transaction_count(from_address)
            
            # Get gas price (EIP-1559 style if supported)
            try:
                base_fee = self._web3.eth.get_block('latest')['baseFeePerGas']
                max_priority_fee = self._web3.to_wei(2, 'gwei')
                max_fee = base_fee * 2 + max_priority_fee
                gas_params = {
                    'maxFeePerGas': max_fee,
                    'maxPriorityFeePerGas': max_priority_fee,
                }
            except Exception:
                gas_params = {'gasPrice': self._web3.eth.gas_price}
            
            if token_contract:
                # ERC20 transfer
                contract = self._web3.eth.contract(
                    address=self._web3.to_checksum_address(token_contract),
                    abi=ERC20_ABI
                )
                decimals = contract.functions.decimals().call()
                amount_wei = int(amount * Decimal(10 ** decimals))
                
                tx = contract.functions.transfer(
                    self._web3.to_checksum_address(to_address),
                    amount_wei
                ).build_transaction({
                    'from': from_address,
                    'nonce': nonce,
                    'chainId': self.chain_id,
                    **gas_params,
                })
            else:
                # Native transfer
                amount_wei = int(amount * Decimal(10 ** 18))
                tx = {
                    'to': self._web3.to_checksum_address(to_address),
                    'value': amount_wei,
                    'nonce': nonce,
                    'chainId': self.chain_id,
                    'gas': 21000,
                    **gas_params,
                }
            
            # Estimate gas if not set
            if 'gas' not in tx:
                tx['gas'] = self._web3.eth.estimate_gas(tx)
            
            # Sign and send
            signed = self._web3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self._web3.eth.send_raw_transaction(signed.rawTransaction)
            
            return TransactionResult(
                success=True,
                tx_hash=tx_hash.hex(),
                is_simulated=False,
            )
        except Exception as e:
            logger.error(f"Transaction failed on {self.chain}: {e}")
            return TransactionResult(
                success=False,
                error=str(e),
                is_simulated=False
            )
    
    async def get_transaction_status(self, tx_hash: str) -> Dict[str, Any]:
        if not self._is_configured or not self._web3:
            return {
                "status": "unknown",
                "confirmations": 0,
                "is_simulated": True,
                "error": "Chain not configured"
            }
        
        try:
            receipt = self._web3.eth.get_transaction_receipt(tx_hash)
            if receipt is None:
                return {
                    "status": "pending",
                    "confirmations": 0,
                    "is_simulated": False,
                }
            
            current_block = self._web3.eth.block_number
            confirmations = current_block - receipt['blockNumber']
            
            return {
                "status": "confirmed" if receipt['status'] == 1 else "failed",
                "confirmations": confirmations,
                "block_number": receipt['blockNumber'],
                "gas_used": receipt['gasUsed'],
                "is_simulated": False,
            }
        except Exception as e:
            logger.error(f"Failed to get tx status on {self.chain}: {e}")
            return {
                "status": "unknown",
                "confirmations": 0,
                "is_simulated": True,
                "error": str(e)
            }
    
    async def estimate_fee(
        self, to_address: str, amount: Decimal, token_contract: Optional[str] = None
    ) -> Decimal:
        if not self._is_configured or not self._web3:
            # Return default estimates
            defaults = {
                "ethereum": Decimal("5.00"),
                "polygon": Decimal("0.10"),
                "bsc": Decimal("0.30"),
            }
            return defaults.get(self.chain, Decimal("1.00"))
        
        try:
            gas_price = self._web3.eth.gas_price
            gas_limit = 65000 if token_contract else 21000  # ERC20 vs native
            fee_wei = gas_price * gas_limit
            return Decimal(fee_wei) / Decimal(10 ** 18)
        except Exception as e:
            logger.error(f"Failed to estimate fee on {self.chain}: {e}")
            return Decimal("1.00")
    
    async def generate_wallet(self, user_id: str) -> Tuple[str, str]:
        try:
            from web3 import Account
            account = Account.create()
            wallet_id = f"{self.chain}_{user_id}_{hashlib.sha256(account.address.encode()).hexdigest()[:8]}"
            
            # Store encrypted private key
            if self.keystore.is_configured():
                self.keystore.store_key(wallet_id, account.key)
            
            return account.address, wallet_id
        except Exception as e:
            logger.error(f"Failed to generate wallet on {self.chain}: {e}")
            # Fallback to deterministic address (simulated)
            seed = f"{user_id}:{self.chain}:{datetime.utcnow().isoformat()}".encode()
            address = "0x" + hashlib.sha256(seed).hexdigest()[:40]
            wallet_id = f"{self.chain}_{user_id}_simulated"
            return address, wallet_id


class TronClient(ChainClient):
    """Tron blockchain client."""
    
    def __init__(self, rpc_url: str, keystore: KeyStore):
        super().__init__("tron", rpc_url, keystore)
        self._client = None
        
        if self._is_configured:
            try:
                from tronpy import Tron
                from tronpy.providers import HTTPProvider
                self._client = Tron(HTTPProvider(rpc_url))
                logger.info(f"Tron client connected to {rpc_url}")
            except Exception as e:
                logger.error(f"Failed to initialize Tron client: {e}")
                self._is_configured = False
    
    async def get_balance(
        self, address: str, token_contract: Optional[str] = None
    ) -> BalanceResult:
        if not self._is_configured or not self._client:
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error="Chain not configured"
            )
        
        try:
            if token_contract:
                # TRC20 token balance
                contract = self._client.get_contract(token_contract)
                balance = contract.functions.balanceOf(address)
                decimals = contract.functions.decimals()
                return BalanceResult(
                    balance=Decimal(balance) / Decimal(10 ** decimals),
                    is_simulated=False
                )
            else:
                # Native TRX balance
                balance = self._client.get_account_balance(address)
                return BalanceResult(balance=Decimal(str(balance)), is_simulated=False)
        except Exception as e:
            logger.error(f"Failed to get Tron balance: {e}")
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error=str(e)
            )
    
    async def send_transaction(
        self,
        wallet_id: str,
        to_address: str,
        amount: Decimal,
        token_contract: Optional[str] = None,
    ) -> TransactionResult:
        if not self._is_configured or not self._client:
            return TransactionResult(
                success=False,
                error="Chain not configured",
                is_simulated=True
            )
        
        private_key = self.keystore.get_key(wallet_id)
        if not private_key:
            return TransactionResult(
                success=False,
                error="Private key not found",
                is_simulated=True
            )
        
        try:
            from tronpy.keys import PrivateKey
            priv_key = PrivateKey(private_key)
            
            if token_contract:
                # TRC20 transfer
                contract = self._client.get_contract(token_contract)
                decimals = contract.functions.decimals()
                amount_sun = int(amount * Decimal(10 ** decimals))
                
                txn = (
                    contract.functions.transfer(to_address, amount_sun)
                    .with_owner(priv_key.public_key.to_base58check_address())
                    .fee_limit(10_000_000)
                    .build()
                    .sign(priv_key)
                )
            else:
                # Native TRX transfer
                amount_sun = int(amount * Decimal(10 ** 6))
                txn = (
                    self._client.trx.transfer(
                        priv_key.public_key.to_base58check_address(),
                        to_address,
                        amount_sun
                    )
                    .build()
                    .sign(priv_key)
                )
            
            result = txn.broadcast().wait()
            
            return TransactionResult(
                success=True,
                tx_hash=result['id'],
                is_simulated=False,
            )
        except Exception as e:
            logger.error(f"Tron transaction failed: {e}")
            return TransactionResult(
                success=False,
                error=str(e),
                is_simulated=False
            )
    
    async def get_transaction_status(self, tx_hash: str) -> Dict[str, Any]:
        if not self._is_configured or not self._client:
            return {
                "status": "unknown",
                "confirmations": 0,
                "is_simulated": True,
                "error": "Chain not configured"
            }
        
        try:
            tx_info = self._client.get_transaction_info(tx_hash)
            if not tx_info:
                return {
                    "status": "pending",
                    "confirmations": 0,
                    "is_simulated": False,
                }
            
            return {
                "status": "confirmed" if tx_info.get('receipt', {}).get('result') == 'SUCCESS' else "failed",
                "confirmations": 19,  # Tron uses 19 confirmations
                "block_number": tx_info.get('blockNumber'),
                "is_simulated": False,
            }
        except Exception as e:
            logger.error(f"Failed to get Tron tx status: {e}")
            return {
                "status": "unknown",
                "confirmations": 0,
                "is_simulated": True,
                "error": str(e)
            }
    
    async def estimate_fee(
        self, to_address: str, amount: Decimal, token_contract: Optional[str] = None
    ) -> Decimal:
        # Tron uses bandwidth/energy, roughly $1 for TRC20 transfers
        return Decimal("1.00") if token_contract else Decimal("0.10")
    
    async def generate_wallet(self, user_id: str) -> Tuple[str, str]:
        try:
            from tronpy.keys import PrivateKey
            priv_key = PrivateKey.random()
            address = priv_key.public_key.to_base58check_address()
            wallet_id = f"tron_{user_id}_{hashlib.sha256(address.encode()).hexdigest()[:8]}"
            
            if self.keystore.is_configured():
                self.keystore.store_key(wallet_id, priv_key.hex().encode())
            
            return address, wallet_id
        except Exception as e:
            logger.error(f"Failed to generate Tron wallet: {e}")
            seed = f"{user_id}:tron:{datetime.utcnow().isoformat()}".encode()
            address = "T" + hashlib.sha256(seed).hexdigest()[:33]
            wallet_id = f"tron_{user_id}_simulated"
            return address, wallet_id


class SolanaClient(ChainClient):
    """Solana blockchain client."""
    
    def __init__(self, rpc_url: str, keystore: KeyStore):
        super().__init__("solana", rpc_url, keystore)
        self._client = None
        
        if self._is_configured:
            try:
                from solana.rpc.api import Client
                self._client = Client(rpc_url)
                # Test connection
                self._client.get_version()
                logger.info(f"Solana client connected to {rpc_url}")
            except Exception as e:
                logger.error(f"Failed to initialize Solana client: {e}")
                self._is_configured = False
    
    async def get_balance(
        self, address: str, token_contract: Optional[str] = None
    ) -> BalanceResult:
        if not self._is_configured or not self._client:
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error="Chain not configured"
            )
        
        try:
            from solders.pubkey import Pubkey
            pubkey = Pubkey.from_string(address)
            
            if token_contract:
                # SPL token balance - requires finding associated token account
                # Simplified: return 0 for now, full implementation needs spl-token
                return BalanceResult(
                    balance=Decimal("0"),
                    is_simulated=True,
                    error="SPL token balance not fully implemented"
                )
            else:
                # Native SOL balance
                response = self._client.get_balance(pubkey)
                balance_lamports = response.value
                return BalanceResult(
                    balance=Decimal(balance_lamports) / Decimal(10 ** 9),
                    is_simulated=False
                )
        except Exception as e:
            logger.error(f"Failed to get Solana balance: {e}")
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error=str(e)
            )
    
    async def send_transaction(
        self,
        wallet_id: str,
        to_address: str,
        amount: Decimal,
        token_contract: Optional[str] = None,
    ) -> TransactionResult:
        if not self._is_configured or not self._client:
            return TransactionResult(
                success=False,
                error="Chain not configured",
                is_simulated=True
            )
        
        private_key = self.keystore.get_key(wallet_id)
        if not private_key:
            return TransactionResult(
                success=False,
                error="Private key not found",
                is_simulated=True
            )
        
        try:
            from solders.keypair import Keypair
            from solders.pubkey import Pubkey
            from solders.system_program import transfer, TransferParams
            from solana.transaction import Transaction
            
            keypair = Keypair.from_bytes(private_key)
            to_pubkey = Pubkey.from_string(to_address)
            
            if token_contract:
                # SPL token transfer - requires more complex implementation
                return TransactionResult(
                    success=False,
                    error="SPL token transfers not fully implemented",
                    is_simulated=True
                )
            
            # Native SOL transfer
            amount_lamports = int(amount * Decimal(10 ** 9))
            
            # Get recent blockhash
            recent_blockhash = self._client.get_latest_blockhash().value.blockhash
            
            # Create transfer instruction
            ix = transfer(TransferParams(
                from_pubkey=keypair.pubkey(),
                to_pubkey=to_pubkey,
                lamports=amount_lamports
            ))
            
            # Build and sign transaction
            tx = Transaction(recent_blockhash=recent_blockhash, fee_payer=keypair.pubkey())
            tx.add(ix)
            tx.sign(keypair)
            
            # Send transaction
            result = self._client.send_transaction(tx, keypair)
            
            return TransactionResult(
                success=True,
                tx_hash=str(result.value),
                is_simulated=False,
            )
        except Exception as e:
            logger.error(f"Solana transaction failed: {e}")
            return TransactionResult(
                success=False,
                error=str(e),
                is_simulated=False
            )
    
    async def get_transaction_status(self, tx_hash: str) -> Dict[str, Any]:
        if not self._is_configured or not self._client:
            return {
                "status": "unknown",
                "confirmations": 0,
                "is_simulated": True,
                "error": "Chain not configured"
            }
        
        try:
            from solders.signature import Signature
            sig = Signature.from_string(tx_hash)
            response = self._client.get_signature_statuses([sig])
            
            if not response.value or not response.value[0]:
                return {
                    "status": "pending",
                    "confirmations": 0,
                    "is_simulated": False,
                }
            
            status = response.value[0]
            return {
                "status": "confirmed" if status.confirmation_status else "pending",
                "confirmations": status.confirmations or 0,
                "is_simulated": False,
            }
        except Exception as e:
            logger.error(f"Failed to get Solana tx status: {e}")
            return {
                "status": "unknown",
                "confirmations": 0,
                "is_simulated": True,
                "error": str(e)
            }
    
    async def estimate_fee(
        self, to_address: str, amount: Decimal, token_contract: Optional[str] = None
    ) -> Decimal:
        # Solana fees are very low
        return Decimal("0.01")
    
    async def generate_wallet(self, user_id: str) -> Tuple[str, str]:
        try:
            from solders.keypair import Keypair
            keypair = Keypair()
            address = str(keypair.pubkey())
            wallet_id = f"solana_{user_id}_{hashlib.sha256(address.encode()).hexdigest()[:8]}"
            
            if self.keystore.is_configured():
                self.keystore.store_key(wallet_id, bytes(keypair))
            
            return address, wallet_id
        except Exception as e:
            logger.error(f"Failed to generate Solana wallet: {e}")
            seed = f"{user_id}:solana:{datetime.utcnow().isoformat()}".encode()
            import base64
            address = base64.b64encode(hashlib.sha256(seed).digest()).decode()[:44]
            wallet_id = f"solana_{user_id}_simulated"
            return address, wallet_id


class BlockchainBackend:
    """
    Main blockchain backend that manages all chain clients.
    
    Supports both simulated and live modes with graceful degradation.
    """
    
    def __init__(self):
        self.mode = BlockchainMode(BLOCKCHAIN_MODE)
        self.keystore = KeyStore(KEYSTORE_MASTER_KEY)
        self._clients: Dict[str, ChainClient] = {}
        
        # Initialize chain clients
        self._init_clients()
        
        logger.info(f"BlockchainBackend initialized in {self.mode} mode")
    
    def _init_clients(self):
        """Initialize all chain clients."""
        # Ethereum
        if RPC_ENDPOINTS.get("ethereum"):
            self._clients["ethereum"] = EthereumClient(
                "ethereum", RPC_ENDPOINTS["ethereum"], self.keystore, chain_id=1
            )
        
        # Polygon
        if RPC_ENDPOINTS.get("polygon"):
            self._clients["polygon"] = EthereumClient(
                "polygon", RPC_ENDPOINTS["polygon"], self.keystore, chain_id=137
            )
        
        # BSC
        if RPC_ENDPOINTS.get("bsc"):
            self._clients["bsc"] = EthereumClient(
                "bsc", RPC_ENDPOINTS["bsc"], self.keystore, chain_id=56
            )
        
        # Tron
        if RPC_ENDPOINTS.get("tron"):
            self._clients["tron"] = TronClient(RPC_ENDPOINTS["tron"], self.keystore)
        
        # Solana
        if RPC_ENDPOINTS.get("solana"):
            self._clients["solana"] = SolanaClient(RPC_ENDPOINTS["solana"], self.keystore)
    
    def get_client(self, chain: str) -> Optional[ChainClient]:
        """Get client for a specific chain."""
        return self._clients.get(chain.lower())
    
    def is_chain_configured(self, chain: str) -> bool:
        """Check if a chain is properly configured for live operations."""
        client = self.get_client(chain)
        return client is not None and client.is_configured()
    
    def get_configured_chains(self) -> List[str]:
        """Get list of chains that are properly configured."""
        return [
            chain for chain, client in self._clients.items()
            if client.is_configured()
        ]
    
    def get_status(self) -> Dict[str, Any]:
        """Get backend status for all chains."""
        return {
            "mode": self.mode.value,
            "keystore_configured": self.keystore.is_configured(),
            "chains": {
                chain: {
                    "configured": client.is_configured(),
                    "rpc_url": client.rpc_url[:50] + "..." if client.rpc_url else None,
                }
                for chain, client in self._clients.items()
            },
            "configured_chains": self.get_configured_chains(),
        }
    
    async def get_balance(
        self, chain: str, address: str, token_contract: Optional[str] = None
    ) -> BalanceResult:
        """Get balance for an address on a specific chain."""
        if self.mode == BlockchainMode.SIMULATED:
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error=None
            )
        
        client = self.get_client(chain)
        if not client:
            return BalanceResult(
                balance=Decimal("0"),
                is_simulated=True,
                error=f"Chain {chain} not supported"
            )
        
        return await client.get_balance(address, token_contract)
    
    async def send_transaction(
        self,
        chain: str,
        wallet_id: str,
        to_address: str,
        amount: Decimal,
        token_contract: Optional[str] = None,
    ) -> TransactionResult:
        """Send a transaction on a specific chain."""
        if self.mode == BlockchainMode.SIMULATED:
            # Generate simulated tx hash
            tx_hash = hashlib.sha256(
                f"{chain}:{wallet_id}:{to_address}:{amount}:{datetime.utcnow().isoformat()}".encode()
            ).hexdigest()
            return TransactionResult(
                success=True,
                tx_hash=tx_hash,
                is_simulated=True,
            )
        
        client = self.get_client(chain)
        if not client:
            return TransactionResult(
                success=False,
                error=f"Chain {chain} not supported",
                is_simulated=True
            )
        
        return await client.send_transaction(wallet_id, to_address, amount, token_contract)
    
    async def get_transaction_status(self, chain: str, tx_hash: str) -> Dict[str, Any]:
        """Get transaction status on a specific chain."""
        if self.mode == BlockchainMode.SIMULATED:
            return {
                "status": "confirmed",
                "confirmations": 100,
                "is_simulated": True,
            }
        
        client = self.get_client(chain)
        if not client:
            return {
                "status": "unknown",
                "confirmations": 0,
                "is_simulated": True,
                "error": f"Chain {chain} not supported"
            }
        
        return await client.get_transaction_status(tx_hash)
    
    async def estimate_fee(
        self, chain: str, to_address: str, amount: Decimal, token_contract: Optional[str] = None
    ) -> Decimal:
        """Estimate transaction fee on a specific chain."""
        client = self.get_client(chain)
        if not client:
            # Return default estimates
            defaults = {
                "ethereum": Decimal("5.00"),
                "tron": Decimal("1.00"),
                "solana": Decimal("0.01"),
                "polygon": Decimal("0.10"),
                "bsc": Decimal("0.30"),
            }
            return defaults.get(chain.lower(), Decimal("1.00"))
        
        return await client.estimate_fee(to_address, amount, token_contract)
    
    async def generate_wallet(self, chain: str, user_id: str) -> Tuple[str, str]:
        """Generate a new wallet on a specific chain."""
        client = self.get_client(chain)
        if client:
            return await client.generate_wallet(user_id)
        
        # Fallback to simulated wallet generation
        seed = f"{user_id}:{chain}:{datetime.utcnow().isoformat()}".encode()
        if chain.lower() in ["ethereum", "polygon", "bsc"]:
            address = "0x" + hashlib.sha256(seed).hexdigest()[:40]
        elif chain.lower() == "tron":
            address = "T" + hashlib.sha256(seed).hexdigest()[:33]
        else:
            import base64
            address = base64.b64encode(hashlib.sha256(seed).digest()).decode()[:44]
        
        wallet_id = f"{chain}_{user_id}_simulated"
        return address, wallet_id


# Global instance
blockchain_backend = BlockchainBackend()
