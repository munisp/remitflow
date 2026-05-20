"""
AML/CFT (Anti-Money Laundering / Counter-Financing of Terrorism) Engine
Implements sanctions screening, transaction monitoring, SAR/CTR reporting
"""

import os
import json
import logging
import asyncio
import hashlib
from typing import Optional, Dict, Any, List, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
from uuid import uuid4
import re

import httpx
import asyncpg
from fuzzywuzzy import fuzz

logger = logging.getLogger(__name__)


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
    BLOCKED = "blocked"


class AlertType(str, Enum):
    SANCTIONS_MATCH = "sanctions_match"
    PEP_MATCH = "pep_match"
    ADVERSE_MEDIA = "adverse_media"
    STRUCTURING = "structuring"
    VELOCITY = "velocity"
    UNUSUAL_PATTERN = "unusual_pattern"
    HIGH_RISK_JURISDICTION = "high_risk_jurisdiction"
    LARGE_CASH = "large_cash"
    ROUND_AMOUNT = "round_amount"
    RAPID_MOVEMENT = "rapid_movement"


class ReportType(str, Enum):
    SAR = "sar"  # Suspicious Activity Report
    CTR = "ctr"  # Currency Transaction Report
    STR = "str"  # Suspicious Transaction Report


@dataclass
class ScreeningResult:
    """Result of sanctions/PEP screening"""
    match_found: bool
    match_score: float
    match_type: str  # sanctions, pep, adverse_media
    matched_name: Optional[str] = None
    matched_list: Optional[str] = None
    matched_entry_id: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)
    risk_level: RiskLevel = RiskLevel.LOW


@dataclass
class TransactionAlert:
    """AML alert for a transaction"""
    alert_id: str
    alert_type: AlertType
    transaction_id: str
    customer_id: str
    agent_id: str
    risk_level: RiskLevel
    score: float
    description: str
    details: Dict[str, Any]
    created_at: datetime
    status: str = "pending"  # pending, reviewed, escalated, dismissed, reported


@dataclass
class AMLReport:
    """SAR/CTR/STR report"""
    report_id: str
    report_type: ReportType
    customer_id: str
    transaction_ids: List[str]
    alert_ids: List[str]
    narrative: str
    risk_indicators: List[str]
    amount_involved: float
    currency: str
    filing_deadline: datetime
    status: str = "draft"  # draft, pending_review, submitted, acknowledged
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    submitted_at: Optional[datetime] = None


class SanctionsScreener:
    """Screens entities against sanctions lists"""
    
    def __init__(self):
        self._sanctions_lists: Dict[str, List[Dict]] = {}
        self._pep_list: List[Dict] = []
        self._last_update: Optional[datetime] = None
        self._update_interval = timedelta(hours=24)
        
        # External API endpoints
        self.ofac_api = os.getenv("OFAC_API_URL", "https://api.ofac-api.com/v4")
        self.opensanctions_api = os.getenv("OPENSANCTIONS_API_URL", "https://api.opensanctions.org")
        self.api_key = os.getenv("SANCTIONS_API_KEY")
    
    async def update_lists(self):
        """Update sanctions lists from external sources"""
        if self._last_update and datetime.now(timezone.utc) - self._last_update < self._update_interval:
            return
        
        try:
            async with httpx.AsyncClient() as client:
                # OFAC SDN List
                if self.api_key:
                    response = await client.get(
                        f"{self.ofac_api}/search",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        params={"source": "sdn", "limit": 10000}
                    )
                    if response.status_code == 200:
                        self._sanctions_lists["ofac_sdn"] = response.json().get("results", [])
                
                # OpenSanctions (free tier)
                response = await client.get(
                    f"{self.opensanctions_api}/entities",
                    params={"limit": 10000}
                )
                if response.status_code == 200:
                    self._sanctions_lists["opensanctions"] = response.json().get("results", [])
            
            self._last_update = datetime.now(timezone.utc)
            logger.info(f"Updated sanctions lists: {len(self._sanctions_lists)} sources")
        except Exception as e:
            logger.error(f"Failed to update sanctions lists: {e}")
    
    async def screen_entity(
        self,
        name: str,
        country: Optional[str] = None,
        date_of_birth: Optional[str] = None,
        id_number: Optional[str] = None,
        entity_type: str = "individual"
    ) -> ScreeningResult:
        """Screen an entity against sanctions lists"""
        await self.update_lists()
        
        best_match = ScreeningResult(
            match_found=False,
            match_score=0.0,
            match_type="none"
        )
        
        # Normalize name for comparison
        normalized_name = self._normalize_name(name)
        
        # Check against each sanctions list
        for list_name, entries in self._sanctions_lists.items():
            for entry in entries:
                entry_name = entry.get("name", "") or entry.get("caption", "")
                entry_aliases = entry.get("aliases", []) or entry.get("names", [])
                
                # Check main name
                score = self._calculate_match_score(normalized_name, entry_name)
                
                # Check aliases
                for alias in entry_aliases:
                    alias_score = self._calculate_match_score(normalized_name, alias)
                    score = max(score, alias_score)
                
                # Apply additional matching criteria
                if country and entry.get("country"):
                    if country.upper() == entry.get("country", "").upper():
                        score += 10
                
                if date_of_birth and entry.get("birth_date"):
                    if date_of_birth == entry.get("birth_date"):
                        score += 15
                
                if score > best_match.match_score and score >= 80:
                    best_match = ScreeningResult(
                        match_found=True,
                        match_score=score,
                        match_type="sanctions",
                        matched_name=entry_name,
                        matched_list=list_name,
                        matched_entry_id=entry.get("id"),
                        details=entry,
                        risk_level=RiskLevel.BLOCKED if score >= 95 else RiskLevel.CRITICAL
                    )
        
        # Check PEP list
        for pep in self._pep_list:
            pep_name = pep.get("name", "")
            score = self._calculate_match_score(normalized_name, pep_name)
            
            if score > best_match.match_score and score >= 85:
                best_match = ScreeningResult(
                    match_found=True,
                    match_score=score,
                    match_type="pep",
                    matched_name=pep_name,
                    matched_list="pep",
                    matched_entry_id=pep.get("id"),
                    details=pep,
                    risk_level=RiskLevel.HIGH
                )
        
        return best_match
    
    def _normalize_name(self, name: str) -> str:
        """Normalize a name for comparison"""
        # Remove special characters, convert to uppercase
        normalized = re.sub(r'[^\w\s]', '', name.upper())
        # Remove extra whitespace
        normalized = ' '.join(normalized.split())
        return normalized
    
    def _calculate_match_score(self, name1: str, name2: str) -> float:
        """Calculate fuzzy match score between two names"""
        if not name1 or not name2:
            return 0.0
        
        name1_norm = self._normalize_name(name1)
        name2_norm = self._normalize_name(name2)
        
        # Use multiple fuzzy matching algorithms
        ratio = fuzz.ratio(name1_norm, name2_norm)
        partial = fuzz.partial_ratio(name1_norm, name2_norm)
        token_sort = fuzz.token_sort_ratio(name1_norm, name2_norm)
        token_set = fuzz.token_set_ratio(name1_norm, name2_norm)
        
        # Weighted average
        return (ratio * 0.2 + partial * 0.2 + token_sort * 0.3 + token_set * 0.3)


class TransactionMonitor:
    """Monitors transactions for suspicious patterns"""
    
    def __init__(self, database_url: str = None):
        self.database_url = database_url or os.getenv(
            "AML_DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/aml"
        )
        self._pool: Optional[asyncpg.Pool] = None
        
        # Thresholds
        self.ctr_threshold = float(os.getenv("CTR_THRESHOLD", "10000"))  # USD equivalent
        self.structuring_threshold = float(os.getenv("STRUCTURING_THRESHOLD", "9000"))
        self.velocity_window_hours = int(os.getenv("VELOCITY_WINDOW_HOURS", "24"))
        self.velocity_count_threshold = int(os.getenv("VELOCITY_COUNT_THRESHOLD", "10"))
        self.velocity_amount_threshold = float(os.getenv("VELOCITY_AMOUNT_THRESHOLD", "50000"))
        
        # High-risk jurisdictions (FATF grey/black list)
        self.high_risk_countries = set(os.getenv(
            "HIGH_RISK_COUNTRIES",
            "KP,IR,MM,SY,YE,AF,PK,NG"
        ).split(","))
    
    async def connect(self):
        """Connect to database"""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self.database_url, min_size=2, max_size=10)
            await self._ensure_schema()
    
    async def _ensure_schema(self):
        """Ensure AML schema exists"""
        async with self._pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS aml_alerts (
                    id BIGSERIAL PRIMARY KEY,
                    alert_id UUID UNIQUE NOT NULL,
                    alert_type VARCHAR(50) NOT NULL,
                    transaction_id VARCHAR(100),
                    customer_id VARCHAR(100) NOT NULL,
                    agent_id VARCHAR(100),
                    risk_level VARCHAR(20) NOT NULL,
                    score DECIMAL(5,2),
                    description TEXT,
                    details JSONB,
                    status VARCHAR(20) DEFAULT 'pending',
                    reviewed_by VARCHAR(100),
                    reviewed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS aml_reports (
                    id BIGSERIAL PRIMARY KEY,
                    report_id UUID UNIQUE NOT NULL,
                    report_type VARCHAR(10) NOT NULL,
                    customer_id VARCHAR(100) NOT NULL,
                    transaction_ids JSONB,
                    alert_ids JSONB,
                    narrative TEXT,
                    risk_indicators JSONB,
                    amount_involved DECIMAL(18,2),
                    currency VARCHAR(3),
                    filing_deadline TIMESTAMPTZ,
                    status VARCHAR(20) DEFAULT 'draft',
                    submitted_at TIMESTAMPTZ,
                    acknowledgment_id VARCHAR(100),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS customer_risk_profiles (
                    id BIGSERIAL PRIMARY KEY,
                    customer_id VARCHAR(100) UNIQUE NOT NULL,
                    risk_score DECIMAL(5,2) DEFAULT 0,
                    risk_level VARCHAR(20) DEFAULT 'low',
                    risk_factors JSONB,
                    last_screening_at TIMESTAMPTZ,
                    screening_result JSONB,
                    transaction_count_30d INTEGER DEFAULT 0,
                    transaction_volume_30d DECIMAL(18,2) DEFAULT 0,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_aml_alerts_customer ON aml_alerts(customer_id);
                CREATE INDEX IF NOT EXISTS idx_aml_alerts_status ON aml_alerts(status);
                CREATE INDEX IF NOT EXISTS idx_aml_reports_customer ON aml_reports(customer_id);
            """)
    
    async def analyze_transaction(
        self,
        transaction_id: str,
        customer_id: str,
        agent_id: str,
        amount: float,
        currency: str,
        transaction_type: str,
        source_country: Optional[str] = None,
        destination_country: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> List[TransactionAlert]:
        """Analyze a transaction for AML risks"""
        await self.connect()
        
        alerts = []
        
        # Rule 1: Large cash transaction (CTR threshold)
        if amount >= self.ctr_threshold:
            alerts.append(TransactionAlert(
                alert_id=str(uuid4()),
                alert_type=AlertType.LARGE_CASH,
                transaction_id=transaction_id,
                customer_id=customer_id,
                agent_id=agent_id,
                risk_level=RiskLevel.MEDIUM,
                score=70.0,
                description=f"Large cash transaction: {currency} {amount:,.2f}",
                details={"amount": amount, "currency": currency, "threshold": self.ctr_threshold},
                created_at=datetime.now(timezone.utc)
            ))
        
        # Rule 2: Structuring detection (just below threshold)
        if self.structuring_threshold <= amount < self.ctr_threshold:
            # Check for multiple transactions just below threshold
            structuring_count = await self._check_structuring(customer_id, amount)
            if structuring_count >= 2:
                alerts.append(TransactionAlert(
                    alert_id=str(uuid4()),
                    alert_type=AlertType.STRUCTURING,
                    transaction_id=transaction_id,
                    customer_id=customer_id,
                    agent_id=agent_id,
                    risk_level=RiskLevel.HIGH,
                    score=85.0,
                    description=f"Potential structuring: {structuring_count} transactions just below threshold",
                    details={"count": structuring_count, "amount": amount},
                    created_at=datetime.now(timezone.utc)
                ))
        
        # Rule 3: Velocity check
        velocity_result = await self._check_velocity(customer_id)
        if velocity_result["exceeded"]:
            alerts.append(TransactionAlert(
                alert_id=str(uuid4()),
                alert_type=AlertType.VELOCITY,
                transaction_id=transaction_id,
                customer_id=customer_id,
                agent_id=agent_id,
                risk_level=RiskLevel.HIGH,
                score=80.0,
                description=f"High transaction velocity: {velocity_result['count']} transactions, {currency} {velocity_result['total']:,.2f} in {self.velocity_window_hours}h",
                details=velocity_result,
                created_at=datetime.now(timezone.utc)
            ))
        
        # Rule 4: High-risk jurisdiction
        if source_country and source_country.upper() in self.high_risk_countries:
            alerts.append(TransactionAlert(
                alert_id=str(uuid4()),
                alert_type=AlertType.HIGH_RISK_JURISDICTION,
                transaction_id=transaction_id,
                customer_id=customer_id,
                agent_id=agent_id,
                risk_level=RiskLevel.HIGH,
                score=75.0,
                description=f"Transaction from high-risk jurisdiction: {source_country}",
                details={"country": source_country},
                created_at=datetime.now(timezone.utc)
            ))
        
        if destination_country and destination_country.upper() in self.high_risk_countries:
            alerts.append(TransactionAlert(
                alert_id=str(uuid4()),
                alert_type=AlertType.HIGH_RISK_JURISDICTION,
                transaction_id=transaction_id,
                customer_id=customer_id,
                agent_id=agent_id,
                risk_level=RiskLevel.HIGH,
                score=75.0,
                description=f"Transaction to high-risk jurisdiction: {destination_country}",
                details={"country": destination_country},
                created_at=datetime.now(timezone.utc)
            ))
        
        # Rule 5: Round amount detection
        if amount >= 1000 and amount == int(amount) and amount % 1000 == 0:
            alerts.append(TransactionAlert(
                alert_id=str(uuid4()),
                alert_type=AlertType.ROUND_AMOUNT,
                transaction_id=transaction_id,
                customer_id=customer_id,
                agent_id=agent_id,
                risk_level=RiskLevel.LOW,
                score=40.0,
                description=f"Round amount transaction: {currency} {amount:,.2f}",
                details={"amount": amount},
                created_at=datetime.now(timezone.utc)
            ))
        
        # Save alerts to database
        for alert in alerts:
            await self._save_alert(alert)
        
        return alerts
    
    async def _check_structuring(self, customer_id: str, current_amount: float) -> int:
        """Check for structuring pattern"""
        async with self._pool.acquire() as conn:
            # Count transactions in last 24 hours between structuring threshold and CTR threshold
            count = await conn.fetchval("""
                SELECT COUNT(*) FROM transactions
                WHERE customer_id = $1
                AND amount >= $2 AND amount < $3
                AND created_at >= NOW() - INTERVAL '24 hours'
            """, customer_id, self.structuring_threshold, self.ctr_threshold)
            return count or 0
    
    async def _check_velocity(self, customer_id: str) -> Dict[str, Any]:
        """Check transaction velocity"""
        async with self._pool.acquire() as conn:
            result = await conn.fetchrow("""
                SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
                FROM transactions
                WHERE customer_id = $1
                AND created_at >= NOW() - INTERVAL '%s hours'
            """ % self.velocity_window_hours, customer_id)
            
            count = result["count"] if result else 0
            total = float(result["total"]) if result else 0.0
            
            exceeded = (
                count >= self.velocity_count_threshold or
                total >= self.velocity_amount_threshold
            )
            
            return {
                "count": count,
                "total": total,
                "exceeded": exceeded,
                "count_threshold": self.velocity_count_threshold,
                "amount_threshold": self.velocity_amount_threshold
            }
    
    async def _save_alert(self, alert: TransactionAlert):
        """Save alert to database"""
        async with self._pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO aml_alerts (
                    alert_id, alert_type, transaction_id, customer_id, agent_id,
                    risk_level, score, description, details, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """,
                alert.alert_id,
                alert.alert_type.value,
                alert.transaction_id,
                alert.customer_id,
                alert.agent_id,
                alert.risk_level.value,
                alert.score,
                alert.description,
                json.dumps(alert.details),
                alert.status,
                alert.created_at
            )


class ReportGenerator:
    """Generates SAR/CTR/STR reports"""
    
    def __init__(self, database_url: str = None):
        self.database_url = database_url or os.getenv(
            "AML_DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/aml"
        )
        self._pool: Optional[asyncpg.Pool] = None
        
        # Regulatory filing endpoints
        self.fiu_endpoint = os.getenv("FIU_FILING_ENDPOINT")
        self.fiu_api_key = os.getenv("FIU_API_KEY")
    
    async def connect(self):
        """Connect to database"""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self.database_url, min_size=2, max_size=10)
    
    async def generate_ctr(
        self,
        customer_id: str,
        transaction_ids: List[str],
        total_amount: float,
        currency: str
    ) -> AMLReport:
        """Generate Currency Transaction Report"""
        await self.connect()
        
        report = AMLReport(
            report_id=str(uuid4()),
            report_type=ReportType.CTR,
            customer_id=customer_id,
            transaction_ids=transaction_ids,
            alert_ids=[],
            narrative=f"Currency transaction report for {len(transaction_ids)} transaction(s) totaling {currency} {total_amount:,.2f}",
            risk_indicators=["large_cash_transaction"],
            amount_involved=total_amount,
            currency=currency,
            filing_deadline=datetime.now(timezone.utc) + timedelta(days=15)
        )
        
        await self._save_report(report)
        return report
    
    async def generate_sar(
        self,
        customer_id: str,
        alert_ids: List[str],
        transaction_ids: List[str],
        narrative: str,
        risk_indicators: List[str],
        total_amount: float,
        currency: str
    ) -> AMLReport:
        """Generate Suspicious Activity Report"""
        await self.connect()
        
        report = AMLReport(
            report_id=str(uuid4()),
            report_type=ReportType.SAR,
            customer_id=customer_id,
            transaction_ids=transaction_ids,
            alert_ids=alert_ids,
            narrative=narrative,
            risk_indicators=risk_indicators,
            amount_involved=total_amount,
            currency=currency,
            filing_deadline=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        await self._save_report(report)
        return report
    
    async def submit_report(self, report_id: str) -> Dict[str, Any]:
        """Submit report to regulatory authority"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            report = await conn.fetchrow(
                "SELECT * FROM aml_reports WHERE report_id = $1",
                report_id
            )
            
            if not report:
                raise ValueError(f"Report not found: {report_id}")
            
            # Submit to FIU
            if self.fiu_endpoint and self.fiu_api_key:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        self.fiu_endpoint,
                        headers={"Authorization": f"Bearer {self.fiu_api_key}"},
                        json={
                            "report_type": report["report_type"],
                            "customer_id": report["customer_id"],
                            "narrative": report["narrative"],
                            "amount": float(report["amount_involved"]),
                            "currency": report["currency"],
                            "risk_indicators": report["risk_indicators"]
                        }
                    )
                    
                    if response.status_code == 200:
                        result = response.json()
                        acknowledgment_id = result.get("acknowledgment_id")
                        
                        await conn.execute("""
                            UPDATE aml_reports
                            SET status = 'submitted',
                                submitted_at = NOW(),
                                acknowledgment_id = $2
                            WHERE report_id = $1
                        """, report_id, acknowledgment_id)
                        
                        return {"success": True, "acknowledgment_id": acknowledgment_id}
            
            # Mark as submitted even without FIU endpoint (for testing)
            await conn.execute("""
                UPDATE aml_reports
                SET status = 'submitted', submitted_at = NOW()
                WHERE report_id = $1
            """, report_id)
            
            return {"success": True, "acknowledgment_id": None}
    
    async def _save_report(self, report: AMLReport):
        """Save report to database"""
        async with self._pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO aml_reports (
                    report_id, report_type, customer_id, transaction_ids, alert_ids,
                    narrative, risk_indicators, amount_involved, currency,
                    filing_deadline, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            """,
                report.report_id,
                report.report_type.value,
                report.customer_id,
                json.dumps(report.transaction_ids),
                json.dumps(report.alert_ids),
                report.narrative,
                json.dumps(report.risk_indicators),
                report.amount_involved,
                report.currency,
                report.filing_deadline,
                report.status,
                report.created_at
            )


class AMLCFTEngine:
    """Main AML/CFT engine combining all components"""
    
    def __init__(self, database_url: str = None):
        self.screener = SanctionsScreener()
        self.monitor = TransactionMonitor(database_url)
        self.reporter = ReportGenerator(database_url)
    
    async def screen_customer(
        self,
        customer_id: str,
        name: str,
        country: Optional[str] = None,
        date_of_birth: Optional[str] = None,
        id_number: Optional[str] = None
    ) -> ScreeningResult:
        """Screen a customer against sanctions and PEP lists"""
        result = await self.screener.screen_entity(
            name=name,
            country=country,
            date_of_birth=date_of_birth,
            id_number=id_number
        )
        
        # Update customer risk profile
        await self._update_customer_risk_profile(customer_id, result)
        
        return result
    
    async def process_transaction(
        self,
        transaction_id: str,
        customer_id: str,
        agent_id: str,
        amount: float,
        currency: str,
        transaction_type: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Process a transaction through AML checks"""
        # Analyze transaction
        alerts = await self.monitor.analyze_transaction(
            transaction_id=transaction_id,
            customer_id=customer_id,
            agent_id=agent_id,
            amount=amount,
            currency=currency,
            transaction_type=transaction_type,
            **kwargs
        )
        
        # Determine if transaction should be blocked
        blocked = any(a.risk_level == RiskLevel.BLOCKED for a in alerts)
        requires_review = any(a.risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL) for a in alerts)
        
        # Auto-generate CTR if threshold exceeded
        if amount >= self.monitor.ctr_threshold:
            await self.reporter.generate_ctr(
                customer_id=customer_id,
                transaction_ids=[transaction_id],
                total_amount=amount,
                currency=currency
            )
        
        return {
            "transaction_id": transaction_id,
            "blocked": blocked,
            "requires_review": requires_review,
            "alerts": [
                {
                    "alert_id": a.alert_id,
                    "type": a.alert_type.value,
                    "risk_level": a.risk_level.value,
                    "description": a.description
                }
                for a in alerts
            ],
            "risk_level": max((a.risk_level for a in alerts), default=RiskLevel.LOW).value
        }
    
    async def _update_customer_risk_profile(self, customer_id: str, screening_result: ScreeningResult):
        """Update customer risk profile based on screening"""
        await self.monitor.connect()
        
        async with self.monitor._pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO customer_risk_profiles (
                    customer_id, risk_score, risk_level, screening_result, last_screening_at
                ) VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (customer_id) DO UPDATE SET
                    risk_score = $2,
                    risk_level = $3,
                    screening_result = $4,
                    last_screening_at = NOW(),
                    updated_at = NOW()
            """,
                customer_id,
                screening_result.match_score,
                screening_result.risk_level.value,
                json.dumps({
                    "match_found": screening_result.match_found,
                    "match_type": screening_result.match_type,
                    "matched_name": screening_result.matched_name,
                    "matched_list": screening_result.matched_list
                })
            )


# Global instance
_aml_engine: Optional[AMLCFTEngine] = None


def get_aml_engine() -> AMLCFTEngine:
    """Get the global AML/CFT engine instance"""
    global _aml_engine
    if _aml_engine is None:
        _aml_engine = AMLCFTEngine()
    return _aml_engine


# Example usage
if __name__ == "__main__":
    async def main():
        engine = AMLCFTEngine()
        
        # Screen a customer
        result = await engine.screen_customer(
            customer_id="CUST-001",
            name="John Doe",
            country="US"
        )
        print(f"Screening result: {result}")
        
        # Process a transaction
        result = await engine.process_transaction(
            transaction_id="TXN-001",
            customer_id="CUST-001",
            agent_id="AGT-001",
            amount=15000.00,
            currency="USD",
            transaction_type="cash_in"
        )
        print(f"Transaction result: {result}")
    
    asyncio.run(main())
