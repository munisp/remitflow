"""
Stablecoin Service - Multi-chain wallet management for USDT, USDC, and other stablecoins.

Features:
- Multi-chain support (Ethereum, Tron, Solana, Polygon, BSC)
- Hot/cold wallet architecture
- Deposit detection via blockchain listeners
- On/off ramp integration
- ML-powered rate optimization
- Offline transaction queuing
"""

import os
import uuid
import logging
import hashlib
import hmac
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/stablecoin_db")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://localhost:8025")
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://localhost:8020")
PAYMENT_SERVICE_URL = os.getenv("PAYMENT_SERVICE_URL", "http://localhost:8003")

# Blockchain RPC endpoints (use environment variables in production)
ETHEREUM_RPC = os.getenv("ETHEREUM_RPC", "https://mainnet.infura.io/v3/YOUR_KEY")
TRON_RPC = os.getenv("TRON_RPC", "https://api.trongrid.io")
SOLANA_RPC = os.getenv("SOLANA_RPC", "https://api.mainnet-beta.solana.com")
POLYGON_RPC = os.getenv("POLYGON_RPC", "https://polygon-rpc.com")
BSC_RPC = os.getenv("BSC_RPC", "https://bsc-dataseed.binance.org")

# On/Off ramp provider keys
MOONPAY_API_KEY = os.getenv("MOONPAY_API_KEY", "")
TRANSAK_API_KEY = os.getenv("TRANSAK_API_KEY", "")


# Enums
class Chain(str, Enum):
    ETHEREUM = "ethereum"
    TRON = "tron"
    SOLANA = "solana"
    POLYGON = "polygon"
    BSC = "bsc"


class Stablecoin(str, Enum):
    USDT = "usdt"
    USDC = "usdc"
    PYUSD = "pyusd"
    EURC = "eurc"
    DAI = "dai"


class TransactionType(str, Enum):
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    TRANSFER = "transfer"
    CONVERSION = "conversion"
    ON_RAMP = "on_ramp"
    OFF_RAMP = "off_ramp"


class TransactionStatus(str, Enum):
    PENDING = "pending"
    CONFIRMING = "confirming"
    COMPLETED = "completed"
    FAILED = "failed"
    QUEUED_OFFLINE = "queued_offline"


class WalletType(str, Enum):
    HOT = "hot"
    COLD = "cold"
    USER = "user"


# Contract addresses for stablecoins on different chains
STABLECOIN_CONTRACTS: Dict[Chain, Dict[Stablecoin, str]] = {
    Chain.ETHEREUM: {
        Stablecoin.USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        Stablecoin.USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        Stablecoin.PYUSD: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
        Stablecoin.DAI: "0x6B175474E89094C44Da98b954EescdeCB5BE3830",
    },
    Chain.TRON: {
        Stablecoin.USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        Stablecoin.USDC: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    },
    Chain.SOLANA: {
        Stablecoin.USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        Stablecoin.USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
    Chain.POLYGON: {
        Stablecoin.USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        Stablecoin.USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    },
    Chain.BSC: {
        Stablecoin.USDT: "0x55d398326f99059fF775485246999027B3197955",
        Stablecoin.USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    },
}

# Chain configurations
CHAIN_CONFIG: Dict[Chain, Dict[str, Any]] = {
    Chain.ETHEREUM: {
        "name": "Ethereum",
        "symbol": "ETH",
        "decimals": 18,
        "confirmations": 12,
        "avg_block_time": 12,
        "explorer": "https://etherscan.io",
    },
    Chain.TRON: {
        "name": "Tron",
        "symbol": "TRX",
        "decimals": 6,
        "confirmations": 19,
        "avg_block_time": 3,
        "explorer": "https://tronscan.org",
    },
    Chain.SOLANA: {
        "name": "Solana",
        "symbol": "SOL",
        "decimals": 9,
        "confirmations": 32,
        "avg_block_time": 0.4,
        "explorer": "https://solscan.io",
    },
    Chain.POLYGON: {
        "name": "Polygon",
        "symbol": "MATIC",
        "decimals": 18,
        "confirmations": 128,
        "avg_block_time": 2,
        "explorer": "https://polygonscan.com",
    },
    Chain.BSC: {
        "name": "BNB Smart Chain",
        "symbol": "BNB",
        "decimals": 18,
        "confirmations": 15,
        "avg_block_time": 3,
        "explorer": "https://bscscan.com",
    },
}


# Pydantic Models
class WalletAddress(BaseModel):
    address_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    chain: Chain
    address: str
    stablecoin: Optional[Stablecoin] = None
    wallet_type: WalletType = WalletType.USER
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True


class WalletBalance(BaseModel):
    user_id: str
    chain: Chain
    stablecoin: Stablecoin
    balance: Decimal = Decimal("0")
    pending_balance: Decimal = Decimal("0")
    locked_balance: Decimal = Decimal("0")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class StablecoinTransaction(BaseModel):
    transaction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    transaction_type: TransactionType
    chain: Chain
    stablecoin: Stablecoin
    amount: Decimal
    fee: Decimal = Decimal("0")
    from_address: Optional[str] = None
    to_address: Optional[str] = None
    tx_hash: Optional[str] = None
    status: TransactionStatus = TransactionStatus.PENDING
    confirmations: int = 0
    required_confirmations: int = 12
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ConversionQuote(BaseModel):
    quote_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    from_currency: str
    to_currency: str
    from_amount: Decimal
    to_amount: Decimal
    rate: Decimal
    fee: Decimal
    expires_at: datetime
    is_ml_optimized: bool = False
    ml_confidence: Optional[float] = None


class OnRampRequest(BaseModel):
    user_id: str
    fiat_currency: str  # NGN, USD, EUR, GBP
    fiat_amount: Decimal
    target_stablecoin: Stablecoin
    target_chain: Chain
    payment_method: str  # bank_transfer, card, mobile_money


class OffRampRequest(BaseModel):
    user_id: str
    stablecoin: Stablecoin
    chain: Chain
    amount: Decimal
    target_fiat: str  # NGN, USD, EUR, GBP
    payout_method: str  # bank_transfer, mobile_money
    payout_details: Dict[str, str]  # account_number, bank_code, etc.


class OfflineQueuedTransaction(BaseModel):
    queue_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    transaction_type: TransactionType
    chain: Chain
    stablecoin: Stablecoin
    amount: Decimal
    to_address: Optional[str] = None
    queued_at: datetime = Field(default_factory=datetime.utcnow)
    retry_count: int = 0
    max_retries: int = 5
    status: str = "queued"


# Request/Response Models
class CreateWalletRequest(BaseModel):
    user_id: str
    chains: List[Chain] = [Chain.TRON, Chain.ETHEREUM]  # Default to most common


class SendStablecoinRequest(BaseModel):
    user_id: str
    chain: Chain
    stablecoin: Stablecoin
    amount: Decimal
    to_address: str
    is_offline_queued: bool = False


class ConvertRequest(BaseModel):
    user_id: str
    from_stablecoin: Stablecoin
    from_chain: Chain
    to_stablecoin: Stablecoin
    to_chain: Chain
    amount: Decimal
    use_ml_optimization: bool = True


class GetQuoteRequest(BaseModel):
    from_currency: str
    to_currency: str
    amount: Decimal
    use_ml_optimization: bool = True


# In-memory storage (use PostgreSQL in production)
wallets_db: Dict[str, List[WalletAddress]] = {}
balances_db: Dict[str, Dict[str, WalletBalance]] = {}
transactions_db: Dict[str, StablecoinTransaction] = {}
offline_queue_db: Dict[str, OfflineQueuedTransaction] = {}
quotes_db: Dict[str, ConversionQuote] = {}


# Wallet Generation (simplified - use proper HD wallet derivation in production)
class WalletGenerator:
    """Generate wallet addresses for different chains."""
    
    @staticmethod
    def generate_ethereum_address(user_id: str, index: int = 0) -> str:
        """Generate Ethereum-compatible address (also works for Polygon, BSC)."""
        # In production, use HD wallet derivation with proper key management
        seed = f"{user_id}:{index}:eth".encode()
        hash_bytes = hashlib.sha256(seed).digest()
        return "0x" + hash_bytes[:20].hex()
    
    @staticmethod
    def generate_tron_address(user_id: str, index: int = 0) -> str:
        """Generate Tron address."""
        seed = f"{user_id}:{index}:tron".encode()
        hash_bytes = hashlib.sha256(seed).digest()
        # Tron addresses start with 'T'
        return "T" + hashlib.sha256(hash_bytes).hexdigest()[:33]
    
    @staticmethod
    def generate_solana_address(user_id: str, index: int = 0) -> str:
        """Generate Solana address."""
        seed = f"{user_id}:{index}:sol".encode()
        hash_bytes = hashlib.sha256(seed).digest()
        # Solana addresses are base58 encoded
        import base64
        return base64.b64encode(hash_bytes).decode()[:44]
    
    @classmethod
    def generate_address(cls, user_id: str, chain: Chain, index: int = 0) -> str:
        """Generate address for specified chain."""
        if chain in [Chain.ETHEREUM, Chain.POLYGON, Chain.BSC]:
            return cls.generate_ethereum_address(user_id, index)
        elif chain == Chain.TRON:
            return cls.generate_tron_address(user_id, index)
        elif chain == Chain.SOLANA:
            return cls.generate_solana_address(user_id, index)
        else:
            raise ValueError(f"Unsupported chain: {chain}")


# Blockchain Service
class BlockchainService:
    """Service for interacting with different blockchains."""
    
    def __init__(self):
        self.rpc_endpoints = {
            Chain.ETHEREUM: ETHEREUM_RPC,
            Chain.TRON: TRON_RPC,
            Chain.SOLANA: SOLANA_RPC,
            Chain.POLYGON: POLYGON_RPC,
            Chain.BSC: BSC_RPC,
        }
    
    async def get_balance(self, chain: Chain, address: str, stablecoin: Stablecoin) -> Decimal:
        """Get stablecoin balance for an address."""
        # In production, call actual blockchain RPC
        # For now, return from in-memory storage
        key = f"{address}:{chain}:{stablecoin}"
        if key in balances_db:
            return balances_db[key].get("balance", Decimal("0"))
        return Decimal("0")
    
    async def send_transaction(
        self,
        chain: Chain,
        from_address: str,
        to_address: str,
        stablecoin: Stablecoin,
        amount: Decimal,
    ) -> str:
        """Send stablecoin transaction."""
        # In production, sign and broadcast transaction
        # For now, simulate with a mock tx hash
        tx_hash = hashlib.sha256(
            f"{chain}:{from_address}:{to_address}:{amount}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()
        
        logger.info(f"Simulated transaction: {tx_hash} on {chain}")
        return tx_hash
    
    async def get_transaction_status(self, chain: Chain, tx_hash: str) -> Dict[str, Any]:
        """Get transaction status and confirmations."""
        # In production, query blockchain for tx status
        config = CHAIN_CONFIG[chain]
        return {
            "status": "confirmed",
            "confirmations": config["confirmations"],
            "block_number": 12345678,
        }
    
    async def estimate_gas(self, chain: Chain, stablecoin: Stablecoin) -> Decimal:
        """Estimate gas/fee for transaction."""
        # Simplified fee estimation
        gas_prices = {
            Chain.ETHEREUM: Decimal("5.00"),  # ~$5 for ETH
            Chain.TRON: Decimal("1.00"),      # ~$1 for Tron
            Chain.SOLANA: Decimal("0.01"),    # ~$0.01 for Solana
            Chain.POLYGON: Decimal("0.10"),   # ~$0.10 for Polygon
            Chain.BSC: Decimal("0.30"),       # ~$0.30 for BSC
        }
        return gas_prices.get(chain, Decimal("1.00"))


# Rate Service with ML Integration
class RateService:
    """Service for getting conversion rates with ML optimization."""
    
    def __init__(self):
        self.base_rates = {
            # Stablecoin to fiat rates (simplified)
            ("usdt", "ngn"): Decimal("1650"),
            ("usdc", "ngn"): Decimal("1648"),
            ("usdt", "usd"): Decimal("1.00"),
            ("usdc", "usd"): Decimal("1.00"),
            ("usdt", "eur"): Decimal("0.92"),
            ("usdc", "eur"): Decimal("0.92"),
            ("usdt", "gbp"): Decimal("0.79"),
            ("usdc", "gbp"): Decimal("0.79"),
            # Stablecoin to stablecoin
            ("usdt", "usdc"): Decimal("0.9998"),
            ("usdc", "usdt"): Decimal("1.0002"),
        }
    
    async def get_rate(
        self,
        from_currency: str,
        to_currency: str,
        use_ml: bool = True
    ) -> Decimal:
        """Get conversion rate, optionally using ML optimization."""
        from_curr = from_currency.lower()
        to_curr = to_currency.lower()
        
        # Get base rate
        rate = self.base_rates.get((from_curr, to_curr))
        if not rate:
            # Try reverse
            reverse_rate = self.base_rates.get((to_curr, from_curr))
            if reverse_rate:
                rate = Decimal("1") / reverse_rate
            else:
                rate = Decimal("1")  # Default 1:1
        
        # Apply ML optimization if enabled
        if use_ml:
            ml_adjustment = await self._get_ml_rate_adjustment(from_curr, to_curr)
            rate = rate * (Decimal("1") + ml_adjustment)
        
        return rate
    
    async def _get_ml_rate_adjustment(self, from_curr: str, to_curr: str) -> Decimal:
        """Get ML-based rate adjustment."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{ML_SERVICE_URL}/predict",
                    json={
                        "model_name": "rate_optimizer",
                        "features": {
                            "from_currency": from_curr,
                            "to_currency": to_curr,
                            "hour_of_day": datetime.utcnow().hour,
                            "day_of_week": datetime.utcnow().weekday(),
                        }
                    },
                    timeout=5.0
                )
                if response.status_code == 200:
                    result = response.json()
                    # ML suggests optimal timing adjustment (-2% to +2%)
                    return Decimal(str(result.get("adjustment", 0)))
        except Exception as e:
            logger.warning(f"ML rate optimization unavailable: {e}")
        
        return Decimal("0")
    
    async def get_quote(
        self,
        from_currency: str,
        to_currency: str,
        amount: Decimal,
        use_ml: bool = True
    ) -> ConversionQuote:
        """Get conversion quote with fees."""
        rate = await self.get_rate(from_currency, to_currency, use_ml)
        
        # Calculate fee (0.5% for stablecoin conversions, 1% for fiat)
        is_stablecoin_to_stablecoin = (
            from_currency.lower() in ["usdt", "usdc", "pyusd", "dai", "eurc"] and
            to_currency.lower() in ["usdt", "usdc", "pyusd", "dai", "eurc"]
        )
        fee_rate = Decimal("0.005") if is_stablecoin_to_stablecoin else Decimal("0.01")
        fee = amount * fee_rate
        
        to_amount = (amount - fee) * rate
        
        quote = ConversionQuote(
            from_currency=from_currency,
            to_currency=to_currency,
            from_amount=amount,
            to_amount=to_amount.quantize(Decimal("0.01")),
            rate=rate,
            fee=fee.quantize(Decimal("0.01")),
            expires_at=datetime.utcnow() + timedelta(minutes=5),
            is_ml_optimized=use_ml,
        )
        
        quotes_db[quote.quote_id] = quote
        return quote


# On/Off Ramp Service
class RampService:
    """Service for fiat on/off ramps."""
    
    def __init__(self):
        self.rate_service = RateService()
    
    async def create_on_ramp(self, request: OnRampRequest) -> Dict[str, Any]:
        """Create fiat to stablecoin on-ramp order."""
        # Get quote
        quote = await self.rate_service.get_quote(
            request.fiat_currency,
            request.target_stablecoin.value,
            request.fiat_amount,
            use_ml=True
        )
        
        # Create on-ramp order
        order_id = str(uuid.uuid4())
        
        # In production, integrate with MoonPay/Transak/Ramp
        # For now, create internal order
        order = {
            "order_id": order_id,
            "user_id": request.user_id,
            "type": "on_ramp",
            "fiat_currency": request.fiat_currency,
            "fiat_amount": str(request.fiat_amount),
            "stablecoin": request.target_stablecoin.value,
            "chain": request.target_chain.value,
            "stablecoin_amount": str(quote.to_amount),
            "rate": str(quote.rate),
            "fee": str(quote.fee),
            "payment_method": request.payment_method,
            "status": "pending_payment",
            "created_at": datetime.utcnow().isoformat(),
            "payment_instructions": await self._get_payment_instructions(
                request.fiat_currency,
                request.payment_method,
                request.fiat_amount
            ),
        }
        
        return order
    
    async def create_off_ramp(self, request: OffRampRequest) -> Dict[str, Any]:
        """Create stablecoin to fiat off-ramp order."""
        # Get quote
        quote = await self.rate_service.get_quote(
            request.stablecoin.value,
            request.target_fiat,
            request.amount,
            use_ml=True
        )
        
        order_id = str(uuid.uuid4())
        
        # Create off-ramp order
        order = {
            "order_id": order_id,
            "user_id": request.user_id,
            "type": "off_ramp",
            "stablecoin": request.stablecoin.value,
            "chain": request.chain.value,
            "stablecoin_amount": str(request.amount),
            "fiat_currency": request.target_fiat,
            "fiat_amount": str(quote.to_amount),
            "rate": str(quote.rate),
            "fee": str(quote.fee),
            "payout_method": request.payout_method,
            "payout_details": request.payout_details,
            "status": "pending_stablecoin",
            "created_at": datetime.utcnow().isoformat(),
            "deposit_address": await self._get_platform_deposit_address(
                request.chain,
                request.stablecoin
            ),
        }
        
        return order
    
    async def _get_payment_instructions(
        self,
        currency: str,
        method: str,
        amount: Decimal
    ) -> Dict[str, Any]:
        """Get payment instructions for on-ramp."""
        if currency == "NGN" and method == "bank_transfer":
            return {
                "bank_name": "Platform Bank",
                "account_number": "1234567890",
                "account_name": "Platform Stablecoin Ltd",
                "amount": str(amount),
                "reference": f"ONRAMP-{uuid.uuid4().hex[:8].upper()}",
            }
        elif method == "card":
            return {
                "payment_url": f"https://pay.platform.com/onramp/{uuid.uuid4()}",
                "expires_in": 1800,  # 30 minutes
            }
        else:
            return {"instructions": "Contact support for payment instructions"}
    
    async def _get_platform_deposit_address(
        self,
        chain: Chain,
        stablecoin: Stablecoin
    ) -> str:
        """Get platform's deposit address for off-ramp."""
        # In production, use actual hot wallet addresses
        addresses = {
            Chain.ETHEREUM: "0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21",
            Chain.TRON: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
            Chain.SOLANA: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
            Chain.POLYGON: "0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21",
            Chain.BSC: "0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21",
        }
        return addresses.get(chain, "")


# Offline Queue Service
class OfflineQueueService:
    """Service for handling offline-queued transactions."""
    
    def __init__(self, blockchain_service: BlockchainService):
        self.blockchain_service = blockchain_service
    
    async def queue_transaction(
        self,
        user_id: str,
        transaction_type: TransactionType,
        chain: Chain,
        stablecoin: Stablecoin,
        amount: Decimal,
        to_address: Optional[str] = None,
    ) -> OfflineQueuedTransaction:
        """Queue a transaction for later execution."""
        queued_tx = OfflineQueuedTransaction(
            user_id=user_id,
            transaction_type=transaction_type,
            chain=chain,
            stablecoin=stablecoin,
            amount=amount,
            to_address=to_address,
        )
        
        offline_queue_db[queued_tx.queue_id] = queued_tx
        logger.info(f"Queued offline transaction: {queued_tx.queue_id}")
        
        return queued_tx
    
    async def process_queue(self, user_id: str) -> List[Dict[str, Any]]:
        """Process all queued transactions for a user."""
        results = []
        
        user_queue = [
            tx for tx in offline_queue_db.values()
            if tx.user_id == user_id and tx.status == "queued"
        ]
        
        for queued_tx in user_queue:
            try:
                # Execute the transaction
                if queued_tx.transaction_type == TransactionType.TRANSFER:
                    tx_hash = await self.blockchain_service.send_transaction(
                        queued_tx.chain,
                        "",  # From address would come from user's wallet
                        queued_tx.to_address or "",
                        queued_tx.stablecoin,
                        queued_tx.amount,
                    )
                    queued_tx.status = "executed"
                    results.append({
                        "queue_id": queued_tx.queue_id,
                        "status": "executed",
                        "tx_hash": tx_hash,
                    })
                else:
                    queued_tx.status = "executed"
                    results.append({
                        "queue_id": queued_tx.queue_id,
                        "status": "executed",
                    })
            except Exception as e:
                queued_tx.retry_count += 1
                if queued_tx.retry_count >= queued_tx.max_retries:
                    queued_tx.status = "failed"
                results.append({
                    "queue_id": queued_tx.queue_id,
                    "status": "failed",
                    "error": str(e),
                })
        
        return results
    
    async def get_queue(self, user_id: str) -> List[OfflineQueuedTransaction]:
        """Get all queued transactions for a user."""
        return [
            tx for tx in offline_queue_db.values()
            if tx.user_id == user_id
        ]


# Initialize services
blockchain_service = BlockchainService()
rate_service = RateService()
ramp_service = RampService()
offline_queue_service = OfflineQueueService(blockchain_service)


# FastAPI App
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Stablecoin Service...")
    yield
    logger.info("Shutting down Stablecoin Service...")


app = FastAPI(
    title="Stablecoin Service",
    description="Multi-chain stablecoin wallet and payment service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health Check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "stablecoin-service",
        "timestamp": datetime.utcnow().isoformat(),
        "supported_chains": [c.value for c in Chain],
        "supported_stablecoins": [s.value for s in Stablecoin],
    }


# Wallet Endpoints
@app.post("/wallet/create")
async def create_wallet(request: CreateWalletRequest):
    """Create stablecoin wallets for a user on specified chains."""
    user_wallets = []
    
    for chain in request.chains:
        address = WalletGenerator.generate_address(request.user_id, chain)
        
        wallet = WalletAddress(
            user_id=request.user_id,
            chain=chain,
            address=address,
        )
        
        if request.user_id not in wallets_db:
            wallets_db[request.user_id] = []
        wallets_db[request.user_id].append(wallet)
        
        # Initialize balances for all stablecoins on this chain
        for stablecoin in Stablecoin:
            if stablecoin in STABLECOIN_CONTRACTS.get(chain, {}):
                balance_key = f"{request.user_id}:{chain}:{stablecoin}"
                balances_db[balance_key] = WalletBalance(
                    user_id=request.user_id,
                    chain=chain,
                    stablecoin=stablecoin,
                )
        
        user_wallets.append(wallet)
    
    return {
        "user_id": request.user_id,
        "wallets": [w.model_dump() for w in user_wallets],
    }


@app.get("/wallet/{user_id}")
async def get_wallets(user_id: str):
    """Get all wallets for a user."""
    wallets = wallets_db.get(user_id, [])
    return {
        "user_id": user_id,
        "wallets": [w.model_dump() for w in wallets],
    }


@app.get("/wallet/{user_id}/balances")
async def get_balances(user_id: str):
    """Get all stablecoin balances for a user."""
    balances = []
    
    for key, balance in balances_db.items():
        if key.startswith(f"{user_id}:"):
            balances.append(balance.model_dump())
    
    # Calculate total in USD
    total_usd = sum(
        Decimal(str(b.get("balance", 0))) for b in balances
    )
    
    return {
        "user_id": user_id,
        "balances": balances,
        "total_usd": str(total_usd),
    }


@app.get("/wallet/{user_id}/address/{chain}")
async def get_deposit_address(user_id: str, chain: Chain):
    """Get deposit address for a specific chain."""
    wallets = wallets_db.get(user_id, [])
    
    for wallet in wallets:
        if wallet.chain == chain:
            return {
                "user_id": user_id,
                "chain": chain.value,
                "address": wallet.address,
                "supported_stablecoins": list(STABLECOIN_CONTRACTS.get(chain, {}).keys()),
            }
    
    raise HTTPException(status_code=404, detail=f"No wallet found for chain {chain}")


# Transaction Endpoints
@app.post("/send")
async def send_stablecoin(request: SendStablecoinRequest, background_tasks: BackgroundTasks):
    """Send stablecoin to an address."""
    # Check balance
    balance_key = f"{request.user_id}:{request.chain}:{request.stablecoin}"
    balance = balances_db.get(balance_key)
    
    if not balance or balance.balance < request.amount:
        if request.is_offline_queued:
            # Queue for later
            queued = await offline_queue_service.queue_transaction(
                request.user_id,
                TransactionType.TRANSFER,
                request.chain,
                request.stablecoin,
                request.amount,
                request.to_address,
            )
            return {
                "status": "queued_offline",
                "queue_id": queued.queue_id,
                "message": "Transaction queued for when you're back online",
            }
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Estimate fee
    fee = await blockchain_service.estimate_gas(request.chain, request.stablecoin)
    
    # Get user's wallet address
    wallets = wallets_db.get(request.user_id, [])
    from_address = None
    for w in wallets:
        if w.chain == request.chain:
            from_address = w.address
            break
    
    if not from_address:
        raise HTTPException(status_code=400, detail="No wallet found for this chain")
    
    # Create transaction
    tx = StablecoinTransaction(
        user_id=request.user_id,
        transaction_type=TransactionType.TRANSFER,
        chain=request.chain,
        stablecoin=request.stablecoin,
        amount=request.amount,
        fee=fee,
        from_address=from_address,
        to_address=request.to_address,
        required_confirmations=CHAIN_CONFIG[request.chain]["confirmations"],
    )
    
    # Send transaction
    tx_hash = await blockchain_service.send_transaction(
        request.chain,
        from_address,
        request.to_address,
        request.stablecoin,
        request.amount,
    )
    
    tx.tx_hash = tx_hash
    tx.status = TransactionStatus.CONFIRMING
    transactions_db[tx.transaction_id] = tx
    
    # Update balance
    balance.balance -= request.amount
    balance.pending_balance += request.amount
    
    # Schedule confirmation check
    background_tasks.add_task(check_transaction_confirmation, tx.transaction_id)
    
    return {
        "transaction_id": tx.transaction_id,
        "tx_hash": tx_hash,
        "status": tx.status.value,
        "amount": str(request.amount),
        "fee": str(fee),
        "explorer_url": f"{CHAIN_CONFIG[request.chain]['explorer']}/tx/{tx_hash}",
    }


async def check_transaction_confirmation(transaction_id: str):
    """Background task to check transaction confirmation."""
    tx = transactions_db.get(transaction_id)
    if not tx:
        return
    
    # Wait for confirmations
    await asyncio.sleep(30)  # Wait 30 seconds before checking
    
    status = await blockchain_service.get_transaction_status(tx.chain, tx.tx_hash or "")
    tx.confirmations = status.get("confirmations", 0)
    
    if tx.confirmations >= tx.required_confirmations:
        tx.status = TransactionStatus.COMPLETED
        tx.completed_at = datetime.utcnow()
        
        # Update balance
        balance_key = f"{tx.user_id}:{tx.chain}:{tx.stablecoin}"
        if balance_key in balances_db:
            balances_db[balance_key].pending_balance -= tx.amount


@app.get("/transaction/{transaction_id}")
async def get_transaction(transaction_id: str):
    """Get transaction details."""
    tx = transactions_db.get(transaction_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    return tx.model_dump()


@app.get("/transactions/{user_id}")
async def get_user_transactions(user_id: str, limit: int = 50):
    """Get all transactions for a user."""
    user_txs = [
        tx.model_dump() for tx in transactions_db.values()
        if tx.user_id == user_id
    ]
    
    # Sort by created_at descending
    user_txs.sort(key=lambda x: x["created_at"], reverse=True)
    
    return {
        "user_id": user_id,
        "transactions": user_txs[:limit],
        "total": len(user_txs),
    }


# Conversion Endpoints
@app.post("/quote")
async def get_quote(request: GetQuoteRequest):
    """Get conversion quote."""
    quote = await rate_service.get_quote(
        request.from_currency,
        request.to_currency,
        request.amount,
        request.use_ml_optimization,
    )
    
    return quote.model_dump()


@app.post("/convert")
async def convert_stablecoin(request: ConvertRequest):
    """Convert between stablecoins or chains."""
    # Get quote
    quote = await rate_service.get_quote(
        request.from_stablecoin.value,
        request.to_stablecoin.value,
        request.amount,
        request.use_ml_optimization,
    )
    
    # Check balance
    from_balance_key = f"{request.user_id}:{request.from_chain}:{request.from_stablecoin}"
    from_balance = balances_db.get(from_balance_key)
    
    if not from_balance or from_balance.balance < request.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Create conversion transaction
    tx = StablecoinTransaction(
        user_id=request.user_id,
        transaction_type=TransactionType.CONVERSION,
        chain=request.from_chain,
        stablecoin=request.from_stablecoin,
        amount=request.amount,
        fee=quote.fee,
        metadata={
            "to_chain": request.to_chain.value,
            "to_stablecoin": request.to_stablecoin.value,
            "to_amount": str(quote.to_amount),
            "rate": str(quote.rate),
        },
    )
    
    # Deduct from source
    from_balance.balance -= request.amount
    
    # Add to destination
    to_balance_key = f"{request.user_id}:{request.to_chain}:{request.to_stablecoin}"
    if to_balance_key not in balances_db:
        balances_db[to_balance_key] = WalletBalance(
            user_id=request.user_id,
            chain=request.to_chain,
            stablecoin=request.to_stablecoin,
        )
    balances_db[to_balance_key].balance += quote.to_amount
    
    tx.status = TransactionStatus.COMPLETED
    tx.completed_at = datetime.utcnow()
    transactions_db[tx.transaction_id] = tx
    
    return {
        "transaction_id": tx.transaction_id,
        "from_amount": str(request.amount),
        "to_amount": str(quote.to_amount),
        "rate": str(quote.rate),
        "fee": str(quote.fee),
        "status": "completed",
    }


# On/Off Ramp Endpoints
@app.post("/ramp/on")
async def create_on_ramp(request: OnRampRequest):
    """Create fiat to stablecoin on-ramp order."""
    order = await ramp_service.create_on_ramp(request)
    return order


@app.post("/ramp/off")
async def create_off_ramp(request: OffRampRequest):
    """Create stablecoin to fiat off-ramp order."""
    order = await ramp_service.create_off_ramp(request)
    return order


@app.get("/ramp/rates")
async def get_ramp_rates():
    """Get current on/off ramp rates."""
    rates = {}
    
    for stablecoin in [Stablecoin.USDT, Stablecoin.USDC]:
        for fiat in ["NGN", "USD", "EUR", "GBP"]:
            rate = await rate_service.get_rate(stablecoin.value, fiat.lower())
            rates[f"{stablecoin.value}_{fiat}"] = str(rate)
    
    return {
        "rates": rates,
        "updated_at": datetime.utcnow().isoformat(),
    }


# Offline Queue Endpoints
@app.get("/offline/queue/{user_id}")
async def get_offline_queue(user_id: str):
    """Get queued offline transactions."""
    queue = await offline_queue_service.get_queue(user_id)
    return {
        "user_id": user_id,
        "queued_transactions": [q.model_dump() for q in queue],
    }


@app.post("/offline/process/{user_id}")
async def process_offline_queue(user_id: str):
    """Process all queued offline transactions."""
    results = await offline_queue_service.process_queue(user_id)
    return {
        "user_id": user_id,
        "processed": results,
    }


# Chain Info Endpoints
@app.get("/chains")
async def get_supported_chains():
    """Get all supported chains and their configurations."""
    return {
        "chains": {
            chain.value: {
                **CHAIN_CONFIG[chain],
                "stablecoins": list(STABLECOIN_CONTRACTS.get(chain, {}).keys()),
            }
            for chain in Chain
        }
    }


@app.get("/stablecoins")
async def get_supported_stablecoins():
    """Get all supported stablecoins."""
    stablecoins = {}
    
    for stablecoin in Stablecoin:
        chains = []
        for chain, contracts in STABLECOIN_CONTRACTS.items():
            if stablecoin in contracts:
                chains.append({
                    "chain": chain.value,
                    "contract": contracts[stablecoin],
                })
        
        stablecoins[stablecoin.value] = {
            "name": stablecoin.value.upper(),
            "chains": chains,
        }
    
    return {"stablecoins": stablecoins}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8026)
