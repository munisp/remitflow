"""
USSD Gateway Service - Feature Phone Support for African Markets

This service provides USSD menu-based access to the remittance platform,
enabling feature phone users to:
- Check wallet balance
- Send money to saved beneficiaries
- Buy airtime
- View recent transactions

Architecture:
- Receives USSD callbacks from telco aggregators (Africa's Talking, Infobip, etc.)
- Maintains session state for multi-step menus
- Calls existing backend services (wallet, transaction, airtime)
- Returns USSD-formatted responses
"""

from fastapi import FastAPI, HTTPException, Request, Header
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from enum import Enum
import httpx
import logging
import uuid
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="USSD Gateway Service",
    description="Feature phone access to Nigerian Remittance Platform",
    version="1.0.0"
)

# Configuration
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://user-service:8000")
WALLET_SERVICE_URL = os.getenv("WALLET_SERVICE_URL", "http://wallet-service:8000")
TRANSACTION_SERVICE_URL = os.getenv("TRANSACTION_SERVICE_URL", "http://transaction-service:8000")
AIRTIME_SERVICE_URL = os.getenv("AIRTIME_SERVICE_URL", "http://airtime-service:8000")
SESSION_TTL_MINUTES = int(os.getenv("SESSION_TTL_MINUTES", "5"))

# HTTP client for service calls
http_client = httpx.AsyncClient(timeout=30.0)


class USSDRequest(BaseModel):
    """Standard USSD callback request from telco aggregator"""
    session_id: str
    phone_number: str
    service_code: str
    text: str
    network_code: Optional[str] = None


class USSDResponse(BaseModel):
    """USSD response format"""
    session_id: str
    response: str
    end_session: bool = False


class MenuState(str, Enum):
    """USSD menu states"""
    MAIN_MENU = "main_menu"
    CHECK_BALANCE = "check_balance"
    SEND_MONEY = "send_money"
    SEND_MONEY_SELECT_BENEFICIARY = "send_money_select_beneficiary"
    SEND_MONEY_ENTER_AMOUNT = "send_money_enter_amount"
    SEND_MONEY_CONFIRM = "send_money_confirm"
    BUY_AIRTIME = "buy_airtime"
    BUY_AIRTIME_ENTER_PHONE = "buy_airtime_enter_phone"
    BUY_AIRTIME_ENTER_AMOUNT = "buy_airtime_enter_amount"
    BUY_AIRTIME_CONFIRM = "buy_airtime_confirm"
    RECENT_TRANSACTIONS = "recent_transactions"
    ENTER_PIN = "enter_pin"


# Production mode flag - when True, use Redis; when False, use in-memory (dev only)
USE_REDIS = os.getenv("USE_REDIS", "true").lower() == "true"

# Import Redis session store
try:
    from redis_session import init_session_store, RedisSessionStore, InMemorySessionStore
    SESSION_STORE_AVAILABLE = True
except ImportError:
    SESSION_STORE_AVAILABLE = False
    logger.warning("Redis session store not available, using in-memory fallback")


class USSDSession:
    """
    Session store wrapper that uses Redis in production, in-memory in development.
    In production mode (USE_REDIS=true), Redis is REQUIRED - no fallback to in-memory.
    """
    _store = None
    
    @classmethod
    def _get_store(cls):
        """Get the appropriate session store"""
        if cls._store is None:
            if USE_REDIS and SESSION_STORE_AVAILABLE:
                try:
                    cls._store = init_session_store()
                except Exception as e:
                    logger.error(f"Failed to initialize Redis session store: {e}")
                    # FAIL CLOSED - do not fall back to in-memory in production
                    raise RuntimeError("Redis is required for USSD sessions in production mode")
            else:
                logger.warning("Using in-memory session store (development mode only)")
                cls._store = InMemorySessionStore if SESSION_STORE_AVAILABLE else None
        return cls._store
    
    @classmethod
    def get(cls, session_id: str) -> Optional[Dict[str, Any]]:
        store = cls._get_store()
        if store:
            return store.get(session_id)
        return None
    
    @classmethod
    def set(cls, session_id: str, data: Dict[str, Any]) -> None:
        store = cls._get_store()
        if store:
            store.set(session_id, data)
    
    @classmethod
    def delete(cls, session_id: str) -> None:
        store = cls._get_store()
        if store:
            store.delete(session_id)
    
    @classmethod
    def cleanup_expired(cls) -> int:
        store = cls._get_store()
        if store:
            return store.cleanup_expired()
        return 0


# Production mode flag - when True, fail closed if user-service unavailable
# When False (dev mode), allow mock data fallback for testing
FAIL_CLOSED_ON_SERVICE_UNAVAILABLE = os.getenv("FAIL_CLOSED_ON_SERVICE_UNAVAILABLE", "true").lower() == "true"

# Mock user data ONLY for development/testing (FAIL_CLOSED_ON_SERVICE_UNAVAILABLE=false)
# In production, this is NEVER used - service fails closed if user-service unavailable
DEV_MOCK_USERS = {
    "+2348012345678": {
        "user_id": "user-001",
        "name": "Adebayo Okonkwo",
        "pin": "1234",
        "balance": 150000.00,
        "currency": "NGN",
        "beneficiaries": [
            {"id": "ben-001", "name": "Mama", "phone": "+2348087654321", "bank": "GTBank"},
            {"id": "ben-002", "name": "Chidi", "phone": "+2348098765432", "bank": "Access"},
            {"id": "ben-003", "name": "Ngozi", "phone": "+2348076543210", "bank": "Zenith"},
        ],
        "recent_transactions": [
            {"type": "sent", "amount": 5000, "to": "Mama", "date": "Dec 10"},
            {"type": "received", "amount": 25000, "from": "Emeka", "date": "Dec 8"},
            {"type": "airtime", "amount": 1000, "network": "MTN", "date": "Dec 5"},
        ]
    }
}


def normalize_phone(phone: str) -> str:
    """Normalize phone number to international format"""
    normalized = phone.replace(" ", "").replace("-", "")
    if not normalized.startswith("+"):
        normalized = "+234" + normalized.lstrip("0")
    return normalized


async def get_user_from_service(phone: str) -> Optional[Dict[str, Any]]:
    """Fetch user data from user-service API"""
    try:
        normalized = normalize_phone(phone)
        response = await http_client.get(
            f"{USER_SERVICE_URL}/api/v1/users/phone/{normalized}"
        )
        if response.status_code == 200:
            user_data = response.json()
            logger.info(f"User found in user-service: {user_data.get('user_id')}")
            return user_data
        elif response.status_code == 404:
            logger.info(f"User not found in user-service: {normalized}")
            return None
        else:
            logger.warning(f"User-service error: {response.status_code}")
            return None
    except Exception as e:
        logger.error(f"Failed to fetch user from user-service: {e}")
        return None


async def get_wallet_balance(user_id: str) -> Optional[Dict[str, Any]]:
    """Fetch wallet balance from wallet-service"""
    try:
        response = await http_client.get(
            f"{WALLET_SERVICE_URL}/api/v1/wallets/{user_id}/balance"
        )
        if response.status_code == 200:
            return response.json()
        return None
    except Exception as e:
        logger.error(f"Failed to fetch wallet balance: {e}")
        return None


async def get_beneficiaries(user_id: str) -> List[Dict[str, Any]]:
    """Fetch beneficiaries from user-service"""
    try:
        response = await http_client.get(
            f"{USER_SERVICE_URL}/api/v1/users/{user_id}/beneficiaries"
        )
        if response.status_code == 200:
            return response.json().get("beneficiaries", [])
        return []
    except Exception as e:
        logger.error(f"Failed to fetch beneficiaries: {e}")
        return []


async def get_recent_transactions(user_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Fetch recent transactions from transaction-service"""
    try:
        response = await http_client.get(
            f"{TRANSACTION_SERVICE_URL}/api/v1/transactions/history",
            params={"user_id": user_id, "limit": limit}
        )
        if response.status_code == 200:
            return response.json()
        return []
    except Exception as e:
        logger.error(f"Failed to fetch transactions: {e}")
        return []


async def verify_pin(user_id: str, pin: str) -> bool:
    """Verify user PIN via user-service"""
    try:
        response = await http_client.post(
            f"{USER_SERVICE_URL}/api/v1/users/{user_id}/verify-pin",
            json={"pin": pin}
        )
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Failed to verify PIN: {e}")
        return False


async def create_transfer(user_id: str, beneficiary_id: str, amount: float, idempotency_key: str) -> Dict[str, Any]:
    """Create transfer via transaction-service with idempotency"""
    try:
        response = await http_client.post(
            f"{TRANSACTION_SERVICE_URL}/api/v1/transactions/transfer",
            json={
                "user_id": user_id,
                "beneficiary_id": beneficiary_id,
                "amount": amount,
                "source_currency": "NGN",
                "destination_currency": "NGN"
            },
            headers={"Idempotency-Key": idempotency_key, "X-User-ID": user_id}
        )
        return response.json()
    except Exception as e:
        logger.error(f"Failed to create transfer: {e}")
        return {"error": str(e)}


async def purchase_airtime(user_id: str, phone: str, amount: float, idempotency_key: str) -> Dict[str, Any]:
    """Purchase airtime via airtime-service with idempotency"""
    try:
        response = await http_client.post(
            f"{AIRTIME_SERVICE_URL}/api/v1/airtime/purchase",
            json={
                "user_id": user_id,
                "phone_number": phone,
                "amount": amount
            },
            headers={"Idempotency-Key": idempotency_key}
        )
        return response.json()
    except Exception as e:
        logger.error(f"Failed to purchase airtime: {e}")
        return {"error": str(e)}


async def get_user_by_phone(phone: str) -> Optional[Dict[str, Any]]:
    """
    Get user data by phone number.
    
    In production (FAIL_CLOSED_ON_SERVICE_UNAVAILABLE=true):
        - Returns None if user not found in user-service
        - Does NOT fall back to mock data
    
    In development (FAIL_CLOSED_ON_SERVICE_UNAVAILABLE=false):
        - Falls back to mock data for testing
    """
    normalized = normalize_phone(phone)
    
    # Try user-service first
    user = await get_user_from_service(normalized)
    if user:
        # Enrich with wallet balance and beneficiaries
        wallet = await get_wallet_balance(user.get("user_id", ""))
        if wallet:
            user["balance"] = wallet.get("balance", 0)
            user["currency"] = wallet.get("currency", "NGN")
        
        beneficiaries = await get_beneficiaries(user.get("user_id", ""))
        user["beneficiaries"] = beneficiaries
        
        transactions = await get_recent_transactions(user.get("user_id", ""))
        user["recent_transactions"] = transactions
        
        return user
    
    # In production mode, fail closed - do NOT use mock data
    if FAIL_CLOSED_ON_SERVICE_UNAVAILABLE:
        logger.warning(f"User not found and mock fallback disabled (production mode): {normalized}")
        return None
    
    # Development mode only - fallback to mock data for testing
    logger.info(f"Using DEV mock data for {normalized} (development mode only)")
    return DEV_MOCK_USERS.get(normalized)


def format_currency(amount: float, currency: str = "NGN") -> str:
    """Format amount for USSD display"""
    if currency == "NGN":
        return f"N{amount:,.2f}"
    return f"{currency} {amount:,.2f}"


@app.post("/ussd/callback", response_model=USSDResponse)
async def ussd_callback(request: USSDRequest):
    """
    Main USSD callback endpoint.
    Receives requests from telco aggregator and returns menu responses.
    """
    logger.info(f"USSD request: session={request.session_id}, phone={request.phone_number}, text={request.text}")
    
    # Get or create session
    session = USSDSession.get(request.session_id)
    if session is None:
        session = {
            "phone": request.phone_number,
            "state": MenuState.MAIN_MENU,
            "data": {},
            "authenticated": False
        }
    
    # Get user
    user = await get_user_by_phone(request.phone_number)
    if user is None:
        return USSDResponse(
            session_id=request.session_id,
            response="END Welcome to Remittance.\nYou are not registered.\nDownload our app or visit remittance.ng to register.",
            end_session=True
        )
    
    # Parse user input
    user_input = request.text.split("*")[-1] if request.text else ""
    
    # Process based on current state
    response_text, end_session = await process_menu(session, user, user_input)
    
    # Save session
    USSDSession.set(request.session_id, session)
    
    prefix = "END " if end_session else "CON "
    return USSDResponse(
        session_id=request.session_id,
        response=f"{prefix}{response_text}",
        end_session=end_session
    )


async def process_menu(session: Dict, user: Dict, user_input: str) -> tuple[str, bool]:
    """Process menu navigation and return response"""
    state = session.get("state", MenuState.MAIN_MENU)
    data = session.get("data", {})
    
    # Main Menu
    if state == MenuState.MAIN_MENU:
        if user_input == "":
            return (
                f"Welcome {user['name'].split()[0]}!\n"
                "1. Check Balance\n"
                "2. Send Money\n"
                "3. Buy Airtime\n"
                "4. Recent Transactions\n"
                "0. Exit"
            ), False
        
        if user_input == "1":
            session["state"] = MenuState.ENTER_PIN
            session["data"]["next_action"] = "check_balance"
            return "Enter your 4-digit PIN:", False
        
        if user_input == "2":
            session["state"] = MenuState.SEND_MONEY_SELECT_BENEFICIARY
            beneficiaries = user.get("beneficiaries", [])
            if not beneficiaries:
                return "You have no saved beneficiaries.\nAdd beneficiaries in the app.", True
            
            menu = "Select beneficiary:\n"
            for i, ben in enumerate(beneficiaries[:5], 1):
                menu += f"{i}. {ben['name']} ({ben['phone'][-4:]})\n"
            menu += "0. Back"
            return menu, False
        
        if user_input == "3":
            session["state"] = MenuState.BUY_AIRTIME_ENTER_PHONE
            return "Enter phone number for airtime\n(or 1 for your number):", False
        
        if user_input == "4":
            session["state"] = MenuState.ENTER_PIN
            session["data"]["next_action"] = "recent_transactions"
            return "Enter your 4-digit PIN:", False
        
        if user_input == "0":
            return "Thank you for using Remittance.\nGoodbye!", True
        
        return "Invalid option. Please try again.", False
    
    # PIN Entry
    if state == MenuState.ENTER_PIN:
        if len(user_input) != 4 or not user_input.isdigit():
            return "Invalid PIN. Enter 4 digits:", False
        
        user_id = user.get("user_id", "")
        pin_valid = await verify_pin(user_id, user_input)
        if not pin_valid:
            return "Incorrect PIN.\nPlease try again:", False
        
        session["authenticated"] = True
        next_action = data.get("next_action")
        
        if next_action == "check_balance":
            wallet = await get_wallet_balance(user_id)
            if wallet:
                balance = format_currency(wallet.get("balance", 0), wallet.get("currency", "NGN"))
            else:
                balance = format_currency(user.get("balance", 0), user.get("currency", "NGN"))
            return f"Your balance is:\n{balance}\n\nThank you!", True
        
        if next_action == "recent_transactions":
            txns = await get_recent_transactions(user_id, limit=3)
            if not txns:
                return "No recent transactions.", True
            
            response = "Recent Transactions:\n"
            for txn in txns:
                txn_type = txn.get("type", "unknown")
                if txn_type == "sent":
                    response += f"- Sent N{txn.get('amount', 0):,} to {txn.get('to', 'N/A')} ({txn.get('date', '')})\n"
                elif txn_type == "received":
                    response += f"- Received N{txn.get('amount', 0):,} from {txn.get('from', 'N/A')} ({txn.get('date', '')})\n"
                elif txn_type == "airtime":
                    response += f"- Airtime N{txn.get('amount', 0):,} {txn.get('network', '')} ({txn.get('date', '')})\n"
                else:
                    response += f"- {txn_type.title()} N{txn.get('amount', 0):,} ({txn.get('date', '')})\n"
            return response, True
        
        if next_action == "confirm_send":
            ben = data.get("beneficiary", {})
            amount = data.get("amount", 0)
            idempotency_key = f"ussd-transfer-{session.get('phone', '')}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            
            result = await create_transfer(
                user_id, ben.get("id", ""), amount, idempotency_key
            )
            
            if result.get("error"):
                return f"Transfer failed: {result['error']}\nPlease try again.", True
            
            return (
                f"Transfer Successful!\n"
                f"Sent {format_currency(amount)} to {ben.get('name', 'N/A')}\n"
                f"Ref: {result.get('reference', idempotency_key)}"
            ), True
        
        if next_action == "confirm_airtime":
            phone = data.get("airtime_phone", "")
            amount = data.get("amount", 0)
            idempotency_key = f"ussd-airtime-{session.get('phone', '')}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            
            result = await purchase_airtime(
                user_id, phone, amount, idempotency_key
            )
            
            if result.get("error"):
                return f"Airtime purchase failed: {result['error']}\nPlease try again.", True
            
            return (
                f"Airtime Purchase Successful!\n"
                f"{format_currency(amount)} sent to {phone}\n"
                f"Ref: {result.get('reference', idempotency_key)}"
            ), True
        
        session["state"] = MenuState.MAIN_MENU
        return "PIN verified. Returning to menu...", False
    
    # Send Money - Select Beneficiary
    if state == MenuState.SEND_MONEY_SELECT_BENEFICIARY:
        if user_input == "0":
            session["state"] = MenuState.MAIN_MENU
            return await process_menu(session, user, "")
        
        try:
            idx = int(user_input) - 1
            beneficiaries = user.get("beneficiaries", [])
            if 0 <= idx < len(beneficiaries):
                session["data"]["beneficiary"] = beneficiaries[idx]
                session["state"] = MenuState.SEND_MONEY_ENTER_AMOUNT
                return f"Sending to {beneficiaries[idx]['name']}\nEnter amount (NGN):", False
        except ValueError:
            pass
        
        return "Invalid selection. Try again:", False
    
    # Send Money - Enter Amount
    if state == MenuState.SEND_MONEY_ENTER_AMOUNT:
        try:
            amount = float(user_input.replace(",", ""))
            if amount <= 0:
                return "Amount must be greater than 0:", False
            if amount > user["balance"]:
                return f"Insufficient balance.\nYour balance: {format_currency(user['balance'])}\nEnter amount:", False
            if amount > 100000:
                return "Maximum transfer is N100,000.\nEnter amount:", False
            
            session["data"]["amount"] = amount
            session["state"] = MenuState.SEND_MONEY_CONFIRM
            ben = session["data"]["beneficiary"]
            
            fee = 50 if amount <= 5000 else 100
            total = amount + fee
            
            return (
                f"Confirm Transfer:\n"
                f"To: {ben['name']}\n"
                f"Amount: {format_currency(amount)}\n"
                f"Fee: {format_currency(fee)}\n"
                f"Total: {format_currency(total)}\n"
                f"1. Confirm\n"
                f"0. Cancel"
            ), False
        except ValueError:
            return "Invalid amount. Enter numbers only:", False
    
    # Send Money - Confirm
    if state == MenuState.SEND_MONEY_CONFIRM:
        if user_input == "1":
            session["state"] = MenuState.ENTER_PIN
            session["data"]["next_action"] = "confirm_send"
            return "Enter your 4-digit PIN to confirm:", False
        
        if user_input == "0":
            session["state"] = MenuState.MAIN_MENU
            return "Transfer cancelled.\n" + (await process_menu(session, user, ""))[0], False
        
        return "Invalid option. 1 to confirm, 0 to cancel:", False
    
    # Buy Airtime - Enter Phone
    if state == MenuState.BUY_AIRTIME_ENTER_PHONE:
        if user_input == "1":
            phone = session["phone"]
        else:
            phone = user_input
        
        # Validate phone number
        if len(phone.replace("+", "").replace("234", "")) < 10:
            return "Invalid phone number.\nEnter 11-digit number:", False
        
        session["data"]["airtime_phone"] = phone
        session["state"] = MenuState.BUY_AIRTIME_ENTER_AMOUNT
        return "Enter airtime amount (NGN):\n(Min: 50, Max: 10,000)", False
    
    # Buy Airtime - Enter Amount
    if state == MenuState.BUY_AIRTIME_ENTER_AMOUNT:
        try:
            amount = float(user_input.replace(",", ""))
            if amount < 50:
                return "Minimum airtime is N50.\nEnter amount:", False
            if amount > 10000:
                return "Maximum airtime is N10,000.\nEnter amount:", False
            if amount > user["balance"]:
                return f"Insufficient balance.\nYour balance: {format_currency(user['balance'])}\nEnter amount:", False
            
            session["data"]["amount"] = amount
            session["state"] = MenuState.BUY_AIRTIME_CONFIRM
            phone = session["data"]["airtime_phone"]
            
            return (
                f"Confirm Airtime:\n"
                f"Phone: {phone}\n"
                f"Amount: {format_currency(amount)}\n"
                f"1. Confirm\n"
                f"0. Cancel"
            ), False
        except ValueError:
            return "Invalid amount. Enter numbers only:", False
    
    # Buy Airtime - Confirm
    if state == MenuState.BUY_AIRTIME_CONFIRM:
        if user_input == "1":
            session["state"] = MenuState.ENTER_PIN
            session["data"]["next_action"] = "confirm_airtime"
            return "Enter your 4-digit PIN to confirm:", False
        
        if user_input == "0":
            session["state"] = MenuState.MAIN_MENU
            return "Airtime cancelled.\n" + (await process_menu(session, user, ""))[0], False
        
        return "Invalid option. 1 to confirm, 0 to cancel:", False
    
    # Default: return to main menu
    session["state"] = MenuState.MAIN_MENU
    return await process_menu(session, user, "")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "ussd-gateway", "timestamp": datetime.utcnow().isoformat()}


@app.post("/admin/cleanup-sessions")
async def cleanup_sessions():
    """Admin endpoint to cleanup expired sessions"""
    count = USSDSession.cleanup_expired()
    return {"cleaned_up": count}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
