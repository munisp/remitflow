"""
Virtual Card Manager - Create and manage virtual cards
"""

import logging
from typing import Dict, List
from decimal import Decimal
from datetime import datetime, timedelta
import uuid
import random

logger = logging.getLogger(__name__)


class VirtualCardManager:
    """Manages virtual card creation and lifecycle"""
    
    def __init__(self):
        self.cards: Dict[str, Dict] = {}
        logger.info("Virtual card manager initialized")
    
    def generate_card_number(self) -> str:
        """Generate virtual card number"""
        # Generate 16-digit card number (simplified)
        return "".join([str(random.randint(0, 9)) for _ in range(16)])
    
    def generate_cvv(self) -> str:
        """Generate CVV"""
        return "".join([str(random.randint(0, 9)) for _ in range(3)])
    
    def create_virtual_card(
        self,
        user_id: str,
        card_type: str,
        currency: str,
        spending_limit: Decimal,
        expiry_months: int = 12
    ) -> Dict:
        """Create virtual card"""
        
        card_id = str(uuid.uuid4())
        card_number = self.generate_card_number()
        cvv = self.generate_cvv()
        expiry_date = datetime.utcnow() + timedelta(days=30 * expiry_months)
        
        card = {
            "card_id": card_id,
            "user_id": user_id,
            "card_number": card_number,
            "masked_number": f"****-****-****-{card_number[-4:]}",
            "cvv": cvv,
            "card_type": card_type,
            "currency": currency,
            "spending_limit": float(spending_limit),
            "current_balance": float(spending_limit),
            "expiry_date": expiry_date.strftime("%m/%y"),
            "status": "active",
            "created_at": datetime.utcnow().isoformat(),
            "transactions": []
        }
        
        self.cards[card_id] = card
        logger.info(f"Virtual card created: {card_id}")
        
        return card
    
    def get_card(self, card_id: str) -> Dict:
        """Get card details"""
        return self.cards.get(card_id)
    
    def list_cards(self, user_id: str) -> List[Dict]:
        """List user's cards"""
        return [
            card for card in self.cards.values()
            if card["user_id"] == user_id
        ]
    
    def freeze_card(self, card_id: str) -> Dict:
        """Freeze card"""
        if card_id in self.cards:
            self.cards[card_id]["status"] = "frozen"
            logger.info(f"Card frozen: {card_id}")
            return self.cards[card_id]
        return None
    
    def unfreeze_card(self, card_id: str) -> Dict:
        """Unfreeze card"""
        if card_id in self.cards:
            self.cards[card_id]["status"] = "active"
            logger.info(f"Card unfrozen: {card_id}")
            return self.cards[card_id]
        return None
    
    def terminate_card(self, card_id: str) -> Dict:
        """Terminate card"""
        if card_id in self.cards:
            self.cards[card_id]["status"] = "terminated"
            logger.info(f"Card terminated: {card_id}")
            return self.cards[card_id]
        return None
    
    def update_spending_limit(self, card_id: str, new_limit: Decimal) -> Dict:
        """Update spending limit"""
        if card_id in self.cards:
            self.cards[card_id]["spending_limit"] = float(new_limit)
            logger.info(f"Spending limit updated for card: {card_id}")
            return self.cards[card_id]
        return None
    
    def record_transaction(self, card_id: str, amount: Decimal, merchant: str) -> bool:
        """Record card transaction"""
        if card_id in self.cards:
            card = self.cards[card_id]
            
            if card["status"] != "active":
                return False
            
            if card["current_balance"] < float(amount):
                return False
            
            card["current_balance"] -= float(amount)
            card["transactions"].append({
                "amount": float(amount),
                "merchant": merchant,
                "timestamp": datetime.utcnow().isoformat()
            })
            
            return True
        return False
    
    def get_statistics(self) -> Dict:
        """Get card statistics"""
        total_cards = len(self.cards)
        active_cards = sum(1 for c in self.cards.values() if c["status"] == "active")
        frozen_cards = sum(1 for c in self.cards.values() if c["status"] == "frozen")
        
        return {
            "total_cards": total_cards,
            "active_cards": active_cards,
            "frozen_cards": frozen_cards,
            "terminated_cards": total_cards - active_cards - frozen_cards
        }
