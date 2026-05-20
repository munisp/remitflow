"""
Exchange Client - Integration with cryptocurrency exchanges for liquidity management.

Supports:
- Binance
- Kraken
- OTC desks
- Internal liquidity pools

Features:
- Quote generation
- Trade execution
- Balance management
- Graceful degradation when not configured
"""

import os
import logging
import hmac
import hashlib
import time
from abc import ABC, abstractmethod
from datetime import datetime
from decimal import Decimal
from typing import Optional, Dict, Any, List
from enum import Enum
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

# Environment configuration
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_SECRET = os.getenv("BINANCE_SECRET", "")
BINANCE_API_URL = os.getenv("BINANCE_API_URL", "https://api.binance.com")

KRAKEN_API_KEY = os.getenv("KRAKEN_API_KEY", "")
KRAKEN_SECRET = os.getenv("KRAKEN_SECRET", "")
KRAKEN_API_URL = os.getenv("KRAKEN_API_URL", "https://api.kraken.com")

OTC_API_KEY = os.getenv("OTC_API_KEY", "")
OTC_API_URL = os.getenv("OTC_API_URL", "")

# Liquidity mode
LIQUIDITY_MODE = os.getenv("LIQUIDITY_MODE", "simulated")  # "simulated" or "live"


class TradeSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderStatus(str, Enum):
    PENDING = "pending"
    FILLED = "filled"
    PARTIALLY_FILLED = "partially_filled"
    CANCELLED = "cancelled"
    FAILED = "failed"
    SIMULATED = "simulated"


class Quote:
    """A price quote from an exchange."""
    
    def __init__(
        self,
        quote_id: str,
        pair: str,
        side: TradeSide,
        amount: Decimal,
        price: Decimal,
        total: Decimal,
        fee: Decimal,
        fee_currency: str,
        source: str,
        expires_at: datetime,
        is_simulated: bool = False,
    ):
        self.quote_id = quote_id
        self.pair = pair
        self.side = side
        self.amount = amount
        self.price = price
        self.total = total
        self.fee = fee
        self.fee_currency = fee_currency
        self.source = source
        self.expires_at = expires_at
        self.is_simulated = is_simulated
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "quote_id": self.quote_id,
            "pair": self.pair,
            "side": self.side.value,
            "amount": str(self.amount),
            "price": str(self.price),
            "total": str(self.total),
            "fee": str(self.fee),
            "fee_currency": self.fee_currency,
            "source": self.source,
            "expires_at": self.expires_at.isoformat(),
            "is_simulated": self.is_simulated,
        }


class TradeResult:
    """Result of a trade execution."""
    
    def __init__(
        self,
        trade_id: str,
        order_id: Optional[str] = None,
        pair: str = "",
        side: TradeSide = TradeSide.BUY,
        amount: Decimal = Decimal("0"),
        price: Decimal = Decimal("0"),
        total: Decimal = Decimal("0"),
        fee: Decimal = Decimal("0"),
        fee_currency: str = "",
        status: OrderStatus = OrderStatus.PENDING,
        source: str = "",
        is_simulated: bool = False,
        error: Optional[str] = None,
        fills: Optional[List[Dict[str, Any]]] = None,
    ):
        self.trade_id = trade_id
        self.order_id = order_id
        self.pair = pair
        self.side = side
        self.amount = amount
        self.price = price
        self.total = total
        self.fee = fee
        self.fee_currency = fee_currency
        self.status = status
        self.source = source
        self.is_simulated = is_simulated
        self.error = error
        self.fills = fills or []
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "trade_id": self.trade_id,
            "order_id": self.order_id,
            "pair": self.pair,
            "side": self.side.value,
            "amount": str(self.amount),
            "price": str(self.price),
            "total": str(self.total),
            "fee": str(self.fee),
            "fee_currency": self.fee_currency,
            "status": self.status.value,
            "source": self.source,
            "is_simulated": self.is_simulated,
            "error": self.error,
            "fills": self.fills,
        }


class ExchangeBalance:
    """Balance on an exchange."""
    
    def __init__(
        self,
        asset: str,
        free: Decimal,
        locked: Decimal,
        source: str,
        is_simulated: bool = False,
    ):
        self.asset = asset
        self.free = free
        self.locked = locked
        self.total = free + locked
        self.source = source
        self.is_simulated = is_simulated
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "asset": self.asset,
            "free": str(self.free),
            "locked": str(self.locked),
            "total": str(self.total),
            "source": self.source,
            "is_simulated": self.is_simulated,
        }


class ExchangeProvider(ABC):
    """Abstract base class for exchange providers."""
    
    @abstractmethod
    def is_configured(self) -> bool:
        """Check if the provider is properly configured."""
        pass
    
    @abstractmethod
    async def get_quote(
        self, pair: str, side: TradeSide, amount: Decimal
    ) -> Quote:
        """Get a price quote."""
        pass
    
    @abstractmethod
    async def execute_trade(
        self, pair: str, side: TradeSide, amount: Decimal, price: Optional[Decimal] = None
    ) -> TradeResult:
        """Execute a trade."""
        pass
    
    @abstractmethod
    async def get_balances(self) -> List[ExchangeBalance]:
        """Get account balances."""
        pass
    
    @abstractmethod
    async def get_order_status(self, order_id: str) -> TradeResult:
        """Get status of an order."""
        pass


class SimulatedExchangeProvider(ExchangeProvider):
    """Simulated exchange for development and testing."""
    
    def __init__(self):
        # Simulated prices (would come from real market data in production)
        self._prices = {
            "USDTNGN": Decimal("1650"),
            "USDCNGN": Decimal("1648"),
            "BTCUSDT": Decimal("43500"),
            "ETHUSDT": Decimal("2250"),
            "USDTUSDC": Decimal("0.9998"),
            "USDCUSDT": Decimal("1.0002"),
        }
        
        # Simulated balances
        self._balances = {
            "USDT": Decimal("100000"),
            "USDC": Decimal("100000"),
            "NGN": Decimal("165000000"),
            "BTC": Decimal("2.5"),
            "ETH": Decimal("50"),
        }
        
        self._orders: Dict[str, TradeResult] = {}
    
    def is_configured(self) -> bool:
        return True  # Always available
    
    async def get_quote(
        self, pair: str, side: TradeSide, amount: Decimal
    ) -> Quote:
        import uuid
        
        price = self._prices.get(pair.upper(), Decimal("1"))
        if side == TradeSide.SELL:
            # Slightly worse price for sells
            price = price * Decimal("0.998")
        else:
            price = price * Decimal("1.002")
        
        total = amount * price
        fee = total * Decimal("0.001")  # 0.1% fee
        
        return Quote(
            quote_id=str(uuid.uuid4()),
            pair=pair,
            side=side,
            amount=amount,
            price=price,
            total=total,
            fee=fee,
            fee_currency=pair[-3:] if len(pair) > 3 else "USD",
            source="simulated",
            expires_at=datetime.utcnow(),
            is_simulated=True,
        )
    
    async def execute_trade(
        self, pair: str, side: TradeSide, amount: Decimal, price: Optional[Decimal] = None
    ) -> TradeResult:
        import uuid
        
        if price is None:
            quote = await self.get_quote(pair, side, amount)
            price = quote.price
        
        total = amount * price
        fee = total * Decimal("0.001")
        
        trade_id = str(uuid.uuid4())
        order_id = f"SIM-{trade_id[:8]}"
        
        result = TradeResult(
            trade_id=trade_id,
            order_id=order_id,
            pair=pair,
            side=side,
            amount=amount,
            price=price,
            total=total,
            fee=fee,
            fee_currency=pair[-3:] if len(pair) > 3 else "USD",
            status=OrderStatus.SIMULATED,
            source="simulated",
            is_simulated=True,
            fills=[{
                "price": str(price),
                "qty": str(amount),
                "commission": str(fee),
            }]
        )
        
        self._orders[order_id] = result
        return result
    
    async def get_balances(self) -> List[ExchangeBalance]:
        return [
            ExchangeBalance(
                asset=asset,
                free=balance,
                locked=Decimal("0"),
                source="simulated",
                is_simulated=True,
            )
            for asset, balance in self._balances.items()
        ]
    
    async def get_order_status(self, order_id: str) -> TradeResult:
        if order_id in self._orders:
            return self._orders[order_id]
        
        import uuid
        return TradeResult(
            trade_id=str(uuid.uuid4()),
            order_id=order_id,
            status=OrderStatus.FAILED,
            source="simulated",
            is_simulated=True,
            error="Order not found"
        )


class BinanceProvider(ExchangeProvider):
    """Binance exchange integration."""
    
    def __init__(self, api_key: str, secret: str, api_url: str):
        self.api_key = api_key
        self.secret = secret
        self.api_url = api_url
        self._configured = bool(api_key and secret)
    
    def is_configured(self) -> bool:
        return self._configured
    
    def _sign(self, params: Dict[str, Any]) -> str:
        """Sign request parameters."""
        query_string = urlencode(params)
        signature = hmac.new(
            self.secret.encode(),
            query_string.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "X-MBX-APIKEY": self.api_key,
            "Content-Type": "application/json",
        }
    
    async def get_quote(
        self, pair: str, side: TradeSide, amount: Decimal
    ) -> Quote:
        if not self._configured:
            return Quote(
                quote_id="not_configured",
                pair=pair,
                side=side,
                amount=amount,
                price=Decimal("0"),
                total=Decimal("0"),
                fee=Decimal("0"),
                fee_currency="",
                source="binance",
                expires_at=datetime.utcnow(),
                is_simulated=True,
            )
        
        try:
            async with httpx.AsyncClient() as client:
                # Get current price
                response = await client.get(
                    f"{self.api_url}/api/v3/ticker/price",
                    params={"symbol": pair.upper()},
                    timeout=10.0
                )
                
                if response.status_code != 200:
                    raise Exception(f"API error: {response.status_code}")
                
                data = response.json()
                price = Decimal(data["price"])
                
                # Apply spread
                if side == TradeSide.BUY:
                    price = price * Decimal("1.001")
                else:
                    price = price * Decimal("0.999")
                
                total = amount * price
                fee = total * Decimal("0.001")  # 0.1% fee
                
                import uuid
                return Quote(
                    quote_id=str(uuid.uuid4()),
                    pair=pair,
                    side=side,
                    amount=amount,
                    price=price,
                    total=total,
                    fee=fee,
                    fee_currency=pair[-4:] if pair.endswith("USDT") else pair[-3:],
                    source="binance",
                    expires_at=datetime.utcnow(),
                    is_simulated=False,
                )
        except Exception as e:
            logger.error(f"Binance quote error: {e}")
            import uuid
            return Quote(
                quote_id=str(uuid.uuid4()),
                pair=pair,
                side=side,
                amount=amount,
                price=Decimal("0"),
                total=Decimal("0"),
                fee=Decimal("0"),
                fee_currency="",
                source="binance",
                expires_at=datetime.utcnow(),
                is_simulated=True,
            )
    
    async def execute_trade(
        self, pair: str, side: TradeSide, amount: Decimal, price: Optional[Decimal] = None
    ) -> TradeResult:
        if not self._configured:
            import uuid
            return TradeResult(
                trade_id=str(uuid.uuid4()),
                status=OrderStatus.FAILED,
                source="binance",
                is_simulated=True,
                error="Binance not configured"
            )
        
        try:
            async with httpx.AsyncClient() as client:
                timestamp = int(time.time() * 1000)
                
                params = {
                    "symbol": pair.upper(),
                    "side": side.value.upper(),
                    "type": "MARKET" if price is None else "LIMIT",
                    "quantity": str(amount),
                    "timestamp": timestamp,
                }
                
                if price is not None:
                    params["price"] = str(price)
                    params["timeInForce"] = "GTC"
                
                params["signature"] = self._sign(params)
                
                response = await client.post(
                    f"{self.api_url}/api/v3/order",
                    headers=self._get_headers(),
                    params=params,
                    timeout=30.0
                )
                
                if response.status_code != 200:
                    error_data = response.json()
                    raise Exception(f"API error: {error_data.get('msg', response.status_code)}")
                
                data = response.json()
                
                # Calculate totals from fills
                fills = data.get("fills", [])
                total_qty = sum(Decimal(f["qty"]) for f in fills)
                total_quote = sum(Decimal(f["qty"]) * Decimal(f["price"]) for f in fills)
                total_fee = sum(Decimal(f["commission"]) for f in fills)
                avg_price = total_quote / total_qty if total_qty > 0 else Decimal("0")
                
                import uuid
                return TradeResult(
                    trade_id=str(uuid.uuid4()),
                    order_id=str(data["orderId"]),
                    pair=pair,
                    side=side,
                    amount=total_qty,
                    price=avg_price,
                    total=total_quote,
                    fee=total_fee,
                    fee_currency=fills[0]["commissionAsset"] if fills else "",
                    status=OrderStatus.FILLED if data["status"] == "FILLED" else OrderStatus.PARTIALLY_FILLED,
                    source="binance",
                    is_simulated=False,
                    fills=fills,
                )
        except Exception as e:
            logger.error(f"Binance trade error: {e}")
            import uuid
            return TradeResult(
                trade_id=str(uuid.uuid4()),
                status=OrderStatus.FAILED,
                source="binance",
                is_simulated=False,
                error=str(e)
            )
    
    async def get_balances(self) -> List[ExchangeBalance]:
        if not self._configured:
            return []
        
        try:
            async with httpx.AsyncClient() as client:
                timestamp = int(time.time() * 1000)
                params = {"timestamp": timestamp}
                params["signature"] = self._sign(params)
                
                response = await client.get(
                    f"{self.api_url}/api/v3/account",
                    headers=self._get_headers(),
                    params=params,
                    timeout=10.0
                )
                
                if response.status_code != 200:
                    raise Exception(f"API error: {response.status_code}")
                
                data = response.json()
                balances = []
                
                for balance in data.get("balances", []):
                    free = Decimal(balance["free"])
                    locked = Decimal(balance["locked"])
                    if free > 0 or locked > 0:
                        balances.append(ExchangeBalance(
                            asset=balance["asset"],
                            free=free,
                            locked=locked,
                            source="binance",
                            is_simulated=False,
                        ))
                
                return balances
        except Exception as e:
            logger.error(f"Binance balance error: {e}")
            return []
    
    async def get_order_status(self, order_id: str) -> TradeResult:
        # Implementation would query Binance order status
        import uuid
        return TradeResult(
            trade_id=str(uuid.uuid4()),
            order_id=order_id,
            status=OrderStatus.PENDING,
            source="binance",
            is_simulated=False,
            error="Order status check not implemented"
        )


class KrakenProvider(ExchangeProvider):
    """Kraken exchange integration."""
    
    def __init__(self, api_key: str, secret: str, api_url: str):
        self.api_key = api_key
        self.secret = secret
        self.api_url = api_url
        self._configured = bool(api_key and secret)
    
    def is_configured(self) -> bool:
        return self._configured
    
    async def get_quote(
        self, pair: str, side: TradeSide, amount: Decimal
    ) -> Quote:
        if not self._configured:
            import uuid
            return Quote(
                quote_id=str(uuid.uuid4()),
                pair=pair,
                side=side,
                amount=amount,
                price=Decimal("0"),
                total=Decimal("0"),
                fee=Decimal("0"),
                fee_currency="",
                source="kraken",
                expires_at=datetime.utcnow(),
                is_simulated=True,
            )
        
        try:
            async with httpx.AsyncClient() as client:
                # Map pair to Kraken format
                kraken_pair = self._map_pair(pair)
                
                response = await client.get(
                    f"{self.api_url}/0/public/Ticker",
                    params={"pair": kraken_pair},
                    timeout=10.0
                )
                
                if response.status_code != 200:
                    raise Exception(f"API error: {response.status_code}")
                
                data = response.json()
                if data.get("error"):
                    raise Exception(f"API error: {data['error']}")
                
                result = list(data["result"].values())[0]
                # Use ask for buy, bid for sell
                price = Decimal(result["a"][0]) if side == TradeSide.BUY else Decimal(result["b"][0])
                
                total = amount * price
                fee = total * Decimal("0.0026")  # 0.26% fee
                
                import uuid
                return Quote(
                    quote_id=str(uuid.uuid4()),
                    pair=pair,
                    side=side,
                    amount=amount,
                    price=price,
                    total=total,
                    fee=fee,
                    fee_currency=pair[-3:],
                    source="kraken",
                    expires_at=datetime.utcnow(),
                    is_simulated=False,
                )
        except Exception as e:
            logger.error(f"Kraken quote error: {e}")
            import uuid
            return Quote(
                quote_id=str(uuid.uuid4()),
                pair=pair,
                side=side,
                amount=amount,
                price=Decimal("0"),
                total=Decimal("0"),
                fee=Decimal("0"),
                fee_currency="",
                source="kraken",
                expires_at=datetime.utcnow(),
                is_simulated=True,
            )
    
    def _map_pair(self, pair: str) -> str:
        """Map standard pair to Kraken format."""
        mapping = {
            "BTCUSD": "XXBTZUSD",
            "ETHUSD": "XETHZUSD",
            "BTCUSDT": "XBTUSDT",
            "ETHUSDT": "ETHUSDT",
        }
        return mapping.get(pair.upper(), pair.upper())
    
    async def execute_trade(
        self, pair: str, side: TradeSide, amount: Decimal, price: Optional[Decimal] = None
    ) -> TradeResult:
        # Kraken trade implementation would go here
        import uuid
        return TradeResult(
            trade_id=str(uuid.uuid4()),
            status=OrderStatus.FAILED,
            source="kraken",
            is_simulated=True,
            error="Kraken trading not fully implemented"
        )
    
    async def get_balances(self) -> List[ExchangeBalance]:
        if not self._configured:
            return []
        
        # Kraken balance implementation would go here
        return []
    
    async def get_order_status(self, order_id: str) -> TradeResult:
        import uuid
        return TradeResult(
            trade_id=str(uuid.uuid4()),
            order_id=order_id,
            status=OrderStatus.PENDING,
            source="kraken",
            is_simulated=True,
            error="Order status check not implemented"
        )


class ExchangeClient:
    """
    Main exchange client that manages multiple providers.
    
    Supports routing to best price and graceful degradation.
    """
    
    def __init__(self):
        self.mode = LIQUIDITY_MODE
        self._providers: Dict[str, ExchangeProvider] = {}
        self._init_providers()
        
        configured = [name for name, p in self._providers.items() if p.is_configured()]
        logger.info(f"ExchangeClient initialized in {self.mode} mode with providers: {configured}")
    
    def _init_providers(self):
        """Initialize all available providers."""
        # Always add simulated provider
        self._providers["simulated"] = SimulatedExchangeProvider()
        
        # Add real providers if configured
        if BINANCE_API_KEY:
            self._providers["binance"] = BinanceProvider(
                BINANCE_API_KEY, BINANCE_SECRET, BINANCE_API_URL
            )
        
        if KRAKEN_API_KEY:
            self._providers["kraken"] = KrakenProvider(
                KRAKEN_API_KEY, KRAKEN_SECRET, KRAKEN_API_URL
            )
    
    def get_provider(self, name: str) -> Optional[ExchangeProvider]:
        """Get a specific provider."""
        return self._providers.get(name)
    
    def is_configured(self) -> bool:
        """Check if any real provider is configured."""
        return any(
            p.is_configured() 
            for name, p in self._providers.items() 
            if name != "simulated"
        )
    
    def get_status(self) -> Dict[str, Any]:
        """Get status of all providers."""
        return {
            "mode": self.mode,
            "configured": self.is_configured(),
            "providers": {
                name: p.is_configured()
                for name, p in self._providers.items()
            }
        }
    
    async def get_quote(
        self, pair: str, side: TradeSide, amount: Decimal, source: Optional[str] = None
    ) -> Quote:
        """
        Get a price quote.
        
        If source is specified, uses that provider.
        Otherwise, gets quotes from all providers and returns best price.
        """
        if self.mode == "simulated" or source == "simulated":
            return await self._providers["simulated"].get_quote(pair, side, amount)
        
        if source and source in self._providers:
            provider = self._providers[source]
            if provider.is_configured():
                return await provider.get_quote(pair, side, amount)
        
        # Get quotes from all configured providers
        quotes = []
        for name, provider in self._providers.items():
            if name != "simulated" and provider.is_configured():
                try:
                    quote = await provider.get_quote(pair, side, amount)
                    if quote.price > 0:
                        quotes.append(quote)
                except Exception as e:
                    logger.error(f"Error getting quote from {name}: {e}")
        
        if not quotes:
            # Fall back to simulated
            return await self._providers["simulated"].get_quote(pair, side, amount)
        
        # Return best quote (lowest price for buy, highest for sell)
        if side == TradeSide.BUY:
            return min(quotes, key=lambda q: q.price)
        else:
            return max(quotes, key=lambda q: q.price)
    
    async def execute_trade(
        self,
        pair: str,
        side: TradeSide,
        amount: Decimal,
        price: Optional[Decimal] = None,
        source: Optional[str] = None,
    ) -> TradeResult:
        """
        Execute a trade.
        
        If source is specified, uses that provider.
        Otherwise, uses the provider with the best quote.
        """
        if self.mode == "simulated" or source == "simulated":
            return await self._providers["simulated"].execute_trade(pair, side, amount, price)
        
        if source and source in self._providers:
            provider = self._providers[source]
            if provider.is_configured():
                return await provider.execute_trade(pair, side, amount, price)
        
        # Get best quote and execute with that provider
        quote = await self.get_quote(pair, side, amount)
        if quote.is_simulated:
            return await self._providers["simulated"].execute_trade(pair, side, amount, price)
        
        provider = self._providers.get(quote.source)
        if provider and provider.is_configured():
            return await provider.execute_trade(pair, side, amount, price or quote.price)
        
        # Fall back to simulated
        return await self._providers["simulated"].execute_trade(pair, side, amount, price)
    
    async def get_balances(self, source: Optional[str] = None) -> Dict[str, List[ExchangeBalance]]:
        """
        Get balances from all configured providers.
        
        Returns a dict mapping provider name to list of balances.
        """
        result = {}
        
        if source:
            provider = self._providers.get(source)
            if provider and provider.is_configured():
                result[source] = await provider.get_balances()
            return result
        
        for name, provider in self._providers.items():
            if provider.is_configured():
                try:
                    balances = await provider.get_balances()
                    if balances:
                        result[name] = balances
                except Exception as e:
                    logger.error(f"Error getting balances from {name}: {e}")
        
        return result
    
    async def get_aggregated_balances(self) -> Dict[str, ExchangeBalance]:
        """
        Get aggregated balances across all providers.
        
        Returns a dict mapping asset to total balance.
        """
        all_balances = await self.get_balances()
        aggregated: Dict[str, ExchangeBalance] = {}
        
        for source, balances in all_balances.items():
            for balance in balances:
                if balance.asset in aggregated:
                    existing = aggregated[balance.asset]
                    aggregated[balance.asset] = ExchangeBalance(
                        asset=balance.asset,
                        free=existing.free + balance.free,
                        locked=existing.locked + balance.locked,
                        source="aggregated",
                        is_simulated=existing.is_simulated or balance.is_simulated,
                    )
                else:
                    aggregated[balance.asset] = ExchangeBalance(
                        asset=balance.asset,
                        free=balance.free,
                        locked=balance.locked,
                        source="aggregated",
                        is_simulated=balance.is_simulated,
                    )
        
        return aggregated


# Global instance
exchange_client = ExchangeClient()
