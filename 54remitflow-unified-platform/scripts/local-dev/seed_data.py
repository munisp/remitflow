#!/usr/bin/env python3
"""
Seed Data Generator for Local Development
Creates realistic demo data for testing and development
"""

import os
import json
import random
import string
import asyncio
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import asyncpg

# Configuration
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/multibank"
)

# Nigerian banks
BANKS = [
    {"code": "044", "name": "Access Bank"},
    {"code": "058", "name": "GTBank"},
    {"code": "011", "name": "First Bank"},
    {"code": "033", "name": "UBA"},
    {"code": "057", "name": "Zenith Bank"},
    {"code": "035", "name": "Wema Bank"},
    {"code": "221", "name": "Stanbic IBTC"},
    {"code": "032", "name": "Union Bank"},
    {"code": "050", "name": "Ecobank"},
    {"code": "070", "name": "Fidelity Bank"},
]

# Nigerian states
STATES = [
    "Lagos", "Kano", "Rivers", "Kaduna", "Oyo", "Anambra", "Ogun", "Edo",
    "Delta", "Enugu", "Imo", "Abia", "Kwara", "Plateau", "Benue"
]

# First names
FIRST_NAMES = [
    "Chukwuemeka", "Oluwaseun", "Adebayo", "Chidinma", "Ngozi", "Emeka",
    "Olumide", "Funke", "Tunde", "Amara", "Obinna", "Yetunde", "Chidi",
    "Adaeze", "Ikenna", "Folake", "Nnamdi", "Bukola", "Uchenna", "Shade"
]

# Last names
LAST_NAMES = [
    "Okonkwo", "Adeyemi", "Okafor", "Eze", "Nwosu", "Abubakar", "Ibrahim",
    "Ogundimu", "Adeleke", "Chukwu", "Okoro", "Bello", "Aliyu", "Musa",
    "Danjuma", "Obi", "Onyeka", "Ogbonna", "Nwachukwu", "Akpan"
]


def generate_phone():
    """Generate Nigerian phone number"""
    prefixes = ["0803", "0805", "0806", "0807", "0808", "0809", "0810", "0811", "0812", "0813"]
    return f"{random.choice(prefixes)}{random.randint(1000000, 9999999)}"


def generate_bvn():
    """Generate BVN"""
    return f"{random.randint(10000000000, 99999999999)}"


def generate_nin():
    """Generate NIN"""
    return f"{random.randint(10000000000, 99999999999)}"


def generate_account_number():
    """Generate account number"""
    return f"{random.randint(1000000000, 9999999999)}"


def generate_transaction_id():
    """Generate transaction ID"""
    return f"TXN{''.join(random.choices(string.ascii_uppercase + string.digits, k=12))}"


async def create_schema(conn):
    """Create database schema"""
    await conn.execute("""
        -- Banks
        CREATE TABLE IF NOT EXISTS banks (
            bank_code TEXT PRIMARY KEY,
            bank_name TEXT NOT NULL,
            nip_code TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Users
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            phone TEXT UNIQUE NOT NULL,
            email TEXT,
            first_name TEXT,
            last_name TEXT,
            bvn TEXT,
            nin TEXT,
            kyc_status TEXT DEFAULT 'pending',
            tier INTEGER DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Accounts
        CREATE TABLE IF NOT EXISTS accounts (
            account_id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(user_id),
            account_type TEXT NOT NULL,
            bank_code TEXT,
            account_number TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Account balances
        CREATE TABLE IF NOT EXISTS account_balances (
            account_id TEXT PRIMARY KEY REFERENCES accounts(account_id),
            balance DECIMAL(20, 4) DEFAULT 0,
            pending_balance DECIMAL(20, 4) DEFAULT 0,
            available_balance DECIMAL(20, 4) DEFAULT 0,
            currency TEXT DEFAULT 'NGN',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Agents
        CREATE TABLE IF NOT EXISTS agents (
            agent_id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(user_id),
            business_name TEXT,
            tier TEXT DEFAULT 'tier1',
            parent_agent_id TEXT,
            state TEXT,
            lga TEXT,
            address TEXT,
            status TEXT DEFAULT 'active',
            float_balance DECIMAL(20, 4) DEFAULT 0,
            commission_rate DECIMAL(5, 4) DEFAULT 0.01,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Transactions
        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            amount DECIMAL(20, 4) NOT NULL,
            currency TEXT DEFAULT 'NGN',
            sender_account_id TEXT,
            recipient_account_id TEXT,
            agent_id TEXT,
            status TEXT DEFAULT 'pending',
            narration TEXT,
            reference TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        );
        
        -- Commission records
        CREATE TABLE IF NOT EXISTS commissions (
            commission_id TEXT PRIMARY KEY,
            agent_id TEXT REFERENCES agents(agent_id),
            transaction_id TEXT REFERENCES transactions(transaction_id),
            amount DECIMAL(20, 4) NOT NULL,
            rate DECIMAL(5, 4),
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)


async def seed_banks(conn):
    """Seed banks"""
    print("Seeding banks...")
    for bank in BANKS:
        await conn.execute("""
            INSERT INTO banks (bank_code, bank_name, nip_code)
            VALUES ($1, $2, $1)
            ON CONFLICT (bank_code) DO NOTHING
        """, bank["code"], bank["name"])


async def seed_users(conn, count=100):
    """Seed users"""
    print(f"Seeding {count} users...")
    users = []
    
    for i in range(count):
        user_id = f"USR{str(i+1).zfill(6)}"
        phone = generate_phone()
        first_name = random.choice(FIRST_NAMES)
        last_name = random.choice(LAST_NAMES)
        email = f"{first_name.lower()}.{last_name.lower()}@example.com"
        bvn = generate_bvn()
        nin = generate_nin()
        kyc_status = random.choice(["pending", "verified", "verified", "verified"])
        tier = random.choice([1, 1, 2, 2, 3])
        
        await conn.execute("""
            INSERT INTO users (user_id, phone, email, first_name, last_name, bvn, nin, kyc_status, tier)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (user_id) DO NOTHING
        """, user_id, phone, email, first_name, last_name, bvn, nin, kyc_status, tier)
        
        users.append(user_id)
    
    return users


async def seed_accounts(conn, users):
    """Seed accounts"""
    print(f"Seeding accounts for {len(users)} users...")
    accounts = []
    
    for user_id in users:
        account_id = f"ACC{user_id[3:]}"
        bank = random.choice(BANKS)
        account_number = generate_account_number()
        balance = Decimal(str(random.randint(1000, 500000)))
        
        await conn.execute("""
            INSERT INTO accounts (account_id, user_id, account_type, bank_code, account_number)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id) DO NOTHING
        """, account_id, user_id, "wallet", bank["code"], account_number)
        
        await conn.execute("""
            INSERT INTO account_balances (account_id, balance, available_balance, currency)
            VALUES ($1, $2, $2, 'NGN')
            ON CONFLICT (account_id) DO NOTHING
        """, account_id, balance)
        
        accounts.append(account_id)
    
    return accounts


async def seed_agents(conn, users, count=20):
    """Seed agents"""
    print(f"Seeding {count} agents...")
    agents = []
    agent_users = random.sample(users, min(count, len(users)))
    
    # Create super agent first
    super_agent_id = "AGT000001"
    await conn.execute("""
        INSERT INTO agents (agent_id, user_id, business_name, tier, state, lga, address, float_balance, commission_rate)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (agent_id) DO NOTHING
    """, super_agent_id, agent_users[0], "Super Agent HQ", "super_agent", 
        "Lagos", "Ikeja", "123 Main Street", Decimal("10000000"), Decimal("0.015"))
    agents.append(super_agent_id)
    
    # Create regular agents
    for i, user_id in enumerate(agent_users[1:], start=2):
        agent_id = f"AGT{str(i).zfill(6)}"
        business_name = f"{random.choice(FIRST_NAMES)}'s Agency"
        tier = random.choice(["tier1", "tier2", "tier3"])
        state = random.choice(STATES)
        float_balance = Decimal(str(random.randint(50000, 2000000)))
        commission_rate = Decimal(str(random.uniform(0.005, 0.02)))
        
        await conn.execute("""
            INSERT INTO agents (agent_id, user_id, business_name, tier, parent_agent_id, state, lga, address, float_balance, commission_rate)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (agent_id) DO NOTHING
        """, agent_id, user_id, business_name, tier, super_agent_id, state, 
            f"{state} LGA", f"{random.randint(1, 100)} {random.choice(['Main', 'Market', 'Station'])} Street",
            float_balance, commission_rate)
        
        agents.append(agent_id)
    
    return agents


async def seed_transactions(conn, accounts, agents, count=500):
    """Seed transactions"""
    print(f"Seeding {count} transactions...")
    
    transaction_types = ["cash_in", "cash_out", "transfer", "bill_payment"]
    
    for i in range(count):
        txn_id = generate_transaction_id()
        txn_type = random.choice(transaction_types)
        amount = Decimal(str(random.choice([500, 1000, 2000, 5000, 10000, 20000, 50000])))
        sender = random.choice(accounts)
        recipient = random.choice(accounts)
        agent = random.choice(agents) if txn_type in ["cash_in", "cash_out"] else None
        status = random.choice(["completed", "completed", "completed", "pending", "failed"])
        
        # Random date in last 30 days
        days_ago = random.randint(0, 30)
        created_at = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=random.randint(0, 23))
        completed_at = created_at + timedelta(seconds=random.randint(1, 60)) if status == "completed" else None
        
        await conn.execute("""
            INSERT INTO transactions (transaction_id, type, amount, sender_account_id, recipient_account_id, agent_id, status, narration, created_at, completed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (transaction_id) DO NOTHING
        """, txn_id, txn_type, amount, sender, recipient, agent, status, 
            f"{txn_type.replace('_', ' ').title()} transaction", created_at, completed_at)
        
        # Create commission for agent transactions
        if agent and status == "completed":
            commission_id = f"COM{txn_id[3:]}"
            commission_amount = amount * Decimal("0.01")
            
            await conn.execute("""
                INSERT INTO commissions (commission_id, agent_id, transaction_id, amount, rate, status)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (commission_id) DO NOTHING
            """, commission_id, agent, txn_id, commission_amount, Decimal("0.01"), "paid")


async def main():
    """Main seed function"""
    print("Starting seed data generation...")
    print(f"Database: {DATABASE_URL}")
    
    conn = await asyncpg.connect(DATABASE_URL)
    
    try:
        # Create schema
        await create_schema(conn)
        
        # Seed data
        await seed_banks(conn)
        users = await seed_users(conn, count=100)
        accounts = await seed_accounts(conn, users)
        agents = await seed_agents(conn, users, count=20)
        await seed_transactions(conn, accounts, agents, count=500)
        
        print("\nSeed data generation complete!")
        print(f"  - {len(BANKS)} banks")
        print(f"  - {len(users)} users")
        print(f"  - {len(accounts)} accounts")
        print(f"  - {len(agents)} agents")
        print(f"  - 500 transactions")
        
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
