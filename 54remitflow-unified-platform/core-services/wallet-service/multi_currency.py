"""
Multi-Currency Support - Currency conversion and management
"""

import logging
from typing import Dict
from decimal import Decimal
from datetime import datetime

logger = logging.getLogger(__name__)


class CurrencyConverter:
    """Handles currency conversions"""
    
    def __init__(self):
        self.exchange_rates = {
            "NGN": {"USD": Decimal("0.0013"), "GBP": Decimal("0.0010"), "EUR": Decimal("0.0012")},
            "USD": {"NGN": Decimal("770"), "GBP": Decimal("0.79"), "EUR": Decimal("0.92")},
            "GBP": {"NGN": Decimal("975"), "USD": Decimal("1.27"), "EUR": Decimal("1.17")},
            "EUR": {"NGN": Decimal("835"), "USD": Decimal("1.09"), "GBP": Decimal("0.85")}
        }
        logger.info("Currency converter initialized")
    
    def convert(self, amount: Decimal, from_currency: str, to_currency: str) -> Decimal:
        """Convert amount between currencies"""
        if from_currency == to_currency:
            return amount
        
        rate = self.exchange_rates.get(from_currency, {}).get(to_currency, Decimal("1"))
        return (amount * rate).quantize(Decimal("0.01"))
    
    def get_rate(self, from_currency: str, to_currency: str) -> Decimal:
        """Get exchange rate"""
        return self.exchange_rates.get(from_currency, {}).get(to_currency, Decimal("1"))
