#!/usr/bin/env python3
"""
Data Reconciliation Service for Remittance Platform
Automated reconciliation between TigerBeetle and PostgreSQL
No mocks, no placeholders - production ready
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from contextlib import asynccontextmanager
import uuid
import hashlib

import asyncpg
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import uvicorn
import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import pandas as pd
import numpy as np
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# =====================================================
# CONFIGURATION
# =====================================================

@dataclass
class Config:
    """Application configuration"""
    # Database
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: int = int(os.getenv("DB_PORT", "5432"))
    db_name: str = os.getenv("DB_NAME", "remittance_network")
    db_user: str = os.getenv("DB_USER", "postgres")
    db_password: str = os.getenv("DB_PASSWORD", "password")
    
    # Redis
    redis_host: str = os.getenv("REDIS_HOST", "localhost")
    redis_port: int = int(os.getenv("REDIS_PORT", "6379"))
    redis_db: int = int(os.getenv("REDIS_DB", "0"))
    
    # TigerBeetle API
    tigerbeetle_url: str = os.getenv("TIGERBEETLE_URL", "http://localhost:8095")
    
    # Reconciliation settings
    reconciliation_interval: int = int(os.getenv("RECONCILIATION_INTERVAL", "300"))  # 5 minutes
    batch_size: int = int(os.getenv("BATCH_SIZE", "1000"))
    tolerance_amount: float = float(os.getenv("TOLERANCE_AMOUNT", "0.01"))  # 1 cent
    
    # Alerting
    smtp_host: str = os.getenv("SMTP_HOST", "localhost")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    alert_emails: List[str] = os.getenv("ALERT_EMAILS", "").split(",")

config = Config()

# =====================================================
# METRICS
# =====================================================

reconciliation_runs = Counter('reconciliation_runs_total', 'Total reconciliation runs')
reconciliation_duration = Histogram('reconciliation_duration_seconds', 'Reconciliation duration')
discrepancies_found = Counter('discrepancies_found_total', 'Total discrepancies found')
accounts_reconciled = Gauge('accounts_reconciled_total', 'Total accounts reconciled')
last_reconciliation_time = Gauge('last_reconciliation_timestamp', 'Last reconciliation timestamp')

# =====================================================
# DATA MODELS
# =====================================================

class ReconciliationStatus(str):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class DiscrepancyType(str):
    BALANCE_MISMATCH = "balance_mismatch"
    MISSING_ACCOUNT = "missing_account"
    EXTRA_ACCOUNT = "extra_account"
    TRANSACTION_MISMATCH = "transaction_mismatch"
    METADATA_INCONSISTENCY = "metadata_inconsistency"

@dataclass
class AccountBalance:
    """Account balance information"""
    account_id: str
    tigerbeetle_balance: float
    postgres_balance: float
    last_transaction_time: Optional[datetime]
    transaction_count: int

@dataclass
class Discrepancy:
    """Reconciliation discrepancy"""
    id: str
    type: DiscrepancyType
    account_id: str
    description: str
    tigerbeetle_value: Optional[Any]
    postgres_value: Optional[Any]
    difference: Optional[float]
    severity: str  # low, medium, high, critical
    detected_at: datetime
    resolved_at: Optional[datetime]
    resolution_notes: Optional[str]

@dataclass
class ReconciliationRun:
    """Reconciliation run information"""
    id: str
    status: ReconciliationStatus
    started_at: datetime
    completed_at: Optional[datetime]
    accounts_processed: int
    discrepancies_found: int
    total_balance_difference: float
    error_message: Optional[str]

# =====================================================
# DATABASE CONNECTIONS
# =====================================================

class DatabaseManager:
    """Manages database connections"""
    
    def __init__(self):
        self.postgres_pool = None
        self.redis_client = None
        self.http_client = httpx.AsyncClient(timeout=30.0)
    
    async def initialize(self):
        """Initialize database connections"""
        # PostgreSQL connection
        dsn = f"postgresql://{config.db_user}:{config.db_password}@{config.db_host}:{config.db_port}/{config.db_name}"
        self.postgres_pool = await asyncpg.create_pool(dsn, min_size=5, max_size=20)
        
        # Redis connection
        self.redis_client = redis.Redis(
            host=config.redis_host,
            port=config.redis_port,
            db=config.redis_db,
            decode_responses=True
        )
        
        # Test connections
        async with self.postgres_pool.acquire() as conn:
            await conn.execute("SELECT 1")
        
        await self.redis_client.ping()
        
        logging.info("Database connections initialized")
    
    async def close(self):
        """Close database connections"""
        if self.postgres_pool:
            await self.postgres_pool.close()
        if self.redis_client:
            await self.redis_client.close()
        await self.http_client.aclose()

db_manager = DatabaseManager()

# =====================================================
# RECONCILIATION ENGINE
# =====================================================

class ReconciliationEngine:
    """Core reconciliation engine"""
    
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager
        self.logger = logging.getLogger(__name__)
    
    async def run_reconciliation(self) -> ReconciliationRun:
        """Run complete reconciliation process"""
        run_id = str(uuid.uuid4())
        run = ReconciliationRun(
            id=run_id,
            status=ReconciliationStatus.PENDING,
            started_at=datetime.now(timezone.utc),
            completed_at=None,
            accounts_processed=0,
            discrepancies_found=0,
            total_balance_difference=0.0,
            error_message=None
        )
        
        try:
            reconciliation_runs.inc()
            with reconciliation_duration.time():
                run.status = ReconciliationStatus.IN_PROGRESS
                await self._save_reconciliation_run(run)
                
                # Get account data from both systems
                tigerbeetle_accounts = await self._get_tigerbeetle_accounts()
                postgres_accounts = await self._get_postgres_accounts()
                
                # Reconcile accounts
                discrepancies = await self._reconcile_accounts(
                    tigerbeetle_accounts, postgres_accounts
                )
                
                # Process discrepancies
                for discrepancy in discrepancies:
                    await self._save_discrepancy(discrepancy)
                    discrepancies_found.inc()
                    
                    if discrepancy.severity in ['high', 'critical']:
                        await self._send_alert(discrepancy)
                
                # Update run status
                run.status = ReconciliationStatus.COMPLETED
                run.completed_at = datetime.now(timezone.utc)
                run.accounts_processed = len(set(tigerbeetle_accounts.keys()) | set(postgres_accounts.keys()))
                run.discrepancies_found = len(discrepancies)
                run.total_balance_difference = sum(
                    d.difference for d in discrepancies 
                    if d.difference is not None
                )
                
                accounts_reconciled.set(run.accounts_processed)
                last_reconciliation_time.set(time.time())
                
                await self._save_reconciliation_run(run)
                
                self.logger.info(
                    f"Reconciliation completed: {run.accounts_processed} accounts, "
                    f"{run.discrepancies_found} discrepancies"
                )
                
        except Exception as e:
            run.status = ReconciliationStatus.FAILED
            run.error_message = str(e)
            run.completed_at = datetime.now(timezone.utc)
            await self._save_reconciliation_run(run)
            
            self.logger.error(f"Reconciliation failed: {e}")
            await self._send_critical_alert(f"Reconciliation failed: {e}")
            raise
        
        return run
    
    async def _get_tigerbeetle_accounts(self) -> Dict[str, AccountBalance]:
        """Get account balances from TigerBeetle"""
        accounts = {}
        
        try:
            # Get all accounts from TigerBeetle API
            response = await self.db_manager.http_client.get(
                f"{config.tigerbeetle_url}/api/v1/accounts"
            )
            response.raise_for_status()
            
            tigerbeetle_data = response.json()
            
            for account_data in tigerbeetle_data.get('accounts', []):
                account_id = str(account_data['id'])
                balance = (account_data.get('credits_posted', 0) - 
                          account_data.get('debits_posted', 0)) / 100.0  # Convert from cents
                
                accounts[account_id] = AccountBalance(
                    account_id=account_id,
                    tigerbeetle_balance=balance,
                    postgres_balance=0.0,  # Will be filled later
                    last_transaction_time=None,
                    transaction_count=0
                )
                
        except Exception as e:
            self.logger.error(f"Failed to get TigerBeetle accounts: {e}")
            raise
        
        return accounts
    
    async def _get_postgres_accounts(self) -> Dict[str, AccountBalance]:
        """Get account balances from PostgreSQL"""
        accounts = {}
        
        try:
            async with self.db_manager.postgres_pool.acquire() as conn:
                # Query account balances from various tables
                query = """
                SELECT 
                    a.id as account_id,
                    COALESCE(SUM(t.amount), 0) as balance,
                    MAX(t.created_at) as last_transaction_time,
                    COUNT(t.id) as transaction_count
                FROM accounts a
                LEFT JOIN transactions t ON a.id = t.account_id
                WHERE a.status = 'active'
                GROUP BY a.id
                """
                
                rows = await conn.fetch(query)
                
                for row in rows:
                    account_id = str(row['account_id'])
                    accounts[account_id] = AccountBalance(
                        account_id=account_id,
                        tigerbeetle_balance=0.0,  # Will be filled later
                        postgres_balance=float(row['balance']),
                        last_transaction_time=row['last_transaction_time'],
                        transaction_count=row['transaction_count']
                    )
                    
        except Exception as e:
            self.logger.error(f"Failed to get PostgreSQL accounts: {e}")
            raise
        
        return accounts
    
    async def _reconcile_accounts(
        self, 
        tigerbeetle_accounts: Dict[str, AccountBalance],
        postgres_accounts: Dict[str, AccountBalance]
    ) -> List[Discrepancy]:
        """Reconcile accounts between systems"""
        discrepancies = []
        
        # Get all unique account IDs
        all_account_ids = set(tigerbeetle_accounts.keys()) | set(postgres_accounts.keys())
        
        for account_id in all_account_ids:
            tb_account = tigerbeetle_accounts.get(account_id)
            pg_account = postgres_accounts.get(account_id)
            
            # Check for missing accounts
            if tb_account is None:
                discrepancies.append(Discrepancy(
                    id=str(uuid.uuid4()),
                    type=DiscrepancyType.MISSING_ACCOUNT,
                    account_id=account_id,
                    description=f"Account {account_id} exists in PostgreSQL but not in TigerBeetle",
                    tigerbeetle_value=None,
                    postgres_value=pg_account.postgres_balance if pg_account else None,
                    difference=None,
                    severity="high",
                    detected_at=datetime.now(timezone.utc),
                    resolved_at=None,
                    resolution_notes=None
                ))
                continue
            
            if pg_account is None:
                discrepancies.append(Discrepancy(
                    id=str(uuid.uuid4()),
                    type=DiscrepancyType.EXTRA_ACCOUNT,
                    account_id=account_id,
                    description=f"Account {account_id} exists in TigerBeetle but not in PostgreSQL",
                    tigerbeetle_value=tb_account.tigerbeetle_balance,
                    postgres_value=None,
                    difference=None,
                    severity="high",
                    detected_at=datetime.now(timezone.utc),
                    resolved_at=None,
                    resolution_notes=None
                ))
                continue
            
            # Check balance differences
            balance_diff = abs(tb_account.tigerbeetle_balance - pg_account.postgres_balance)
            if balance_diff > config.tolerance_amount:
                severity = "critical" if balance_diff > 1000 else "high" if balance_diff > 100 else "medium"
                
                discrepancies.append(Discrepancy(
                    id=str(uuid.uuid4()),
                    type=DiscrepancyType.BALANCE_MISMATCH,
                    account_id=account_id,
                    description=f"Balance mismatch for account {account_id}",
                    tigerbeetle_value=tb_account.tigerbeetle_balance,
                    postgres_value=pg_account.postgres_balance,
                    difference=balance_diff,
                    severity=severity,
                    detected_at=datetime.now(timezone.utc),
                    resolved_at=None,
                    resolution_notes=None
                ))
        
        return discrepancies
    
    async def _save_reconciliation_run(self, run: ReconciliationRun):
        """Save reconciliation run to database"""
        async with self.db_manager.postgres_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO reconciliation_runs 
                (id, status, started_at, completed_at, accounts_processed, 
                 discrepancies_found, total_balance_difference, error_message)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    completed_at = EXCLUDED.completed_at,
                    accounts_processed = EXCLUDED.accounts_processed,
                    discrepancies_found = EXCLUDED.discrepancies_found,
                    total_balance_difference = EXCLUDED.total_balance_difference,
                    error_message = EXCLUDED.error_message
            """, run.id, run.status, run.started_at, run.completed_at,
                run.accounts_processed, run.discrepancies_found,
                run.total_balance_difference, run.error_message)
    
    async def _save_discrepancy(self, discrepancy: Discrepancy):
        """Save discrepancy to database"""
        async with self.db_manager.postgres_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO reconciliation_discrepancies
                (id, type, account_id, description, tigerbeetle_value, 
                 postgres_value, difference, severity, detected_at, 
                 resolved_at, resolution_notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """, discrepancy.id, discrepancy.type, discrepancy.account_id,
                discrepancy.description, json.dumps(discrepancy.tigerbeetle_value),
                json.dumps(discrepancy.postgres_value), discrepancy.difference,
                discrepancy.severity, discrepancy.detected_at,
                discrepancy.resolved_at, discrepancy.resolution_notes)
    
    async def _send_alert(self, discrepancy: Discrepancy):
        """Send alert for discrepancy"""
        if not config.alert_emails or not config.smtp_host:
            return
        
        try:
            subject = f"Data Reconciliation Alert: {discrepancy.type}"
            body = f"""
            Discrepancy Detected:
            
            Type: {discrepancy.type}
            Account ID: {discrepancy.account_id}
            Description: {discrepancy.description}
            Severity: {discrepancy.severity}
            
            TigerBeetle Value: {discrepancy.tigerbeetle_value}
            PostgreSQL Value: {discrepancy.postgres_value}
            Difference: {discrepancy.difference}
            
            Detected At: {discrepancy.detected_at}
            """
            
            await self._send_email(subject, body)
            
        except Exception as e:
            self.logger.error(f"Failed to send alert: {e}")
    
    async def _send_critical_alert(self, message: str):
        """Send critical alert"""
        if not config.alert_emails or not config.smtp_host:
            return
        
        try:
            subject = "CRITICAL: Data Reconciliation Service Alert"
            body = f"""
            Critical Alert from Data Reconciliation Service:
            
            {message}
            
            Time: {datetime.now(timezone.utc)}
            
            Please investigate immediately.
            """
            
            await self._send_email(subject, body)
            
        except Exception as e:
            self.logger.error(f"Failed to send critical alert: {e}")
    
    async def _send_email(self, subject: str, body: str):
        """Send email notification"""
        try:
            msg = MIMEMultipart()
            msg['From'] = config.smtp_user
            msg['To'] = ", ".join(config.alert_emails)
            msg['Subject'] = subject
            
            msg.attach(MIMEText(body, 'plain'))
            
            server = smtplib.SMTP(config.smtp_host, config.smtp_port)
            server.starttls()
            if config.smtp_user and config.smtp_password:
                server.login(config.smtp_user, config.smtp_password)
            
            server.send_message(msg)
            server.quit()
            
        except Exception as e:
            self.logger.error(f"Failed to send email: {e}")

# =====================================================
# BACKGROUND TASKS
# =====================================================

class ReconciliationScheduler:
    """Schedules and manages reconciliation tasks"""
    
    def __init__(self, engine: ReconciliationEngine):
        self.engine = engine
        self.running = False
        self.task = None
    
    async

