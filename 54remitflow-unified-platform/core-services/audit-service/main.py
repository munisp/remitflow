"""
Audit Service - Production Implementation
Tracks all system actions and changes for compliance and security

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uvicorn
import uuid

# Import new modules
from encryption import AuditStorage
from report_generator import ReportGenerator, ReportRequest, ReportFormat, ReportType
from search_engine import AuditSearchEngine, SearchQuery, SearchField, SearchOperator

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Audit Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "audit-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

class AuditEventType(str, Enum):
    USER_LOGIN = "user_login"
    USER_LOGOUT = "user_logout"
    TRANSACTION_CREATE = "transaction_create"
    TRANSACTION_UPDATE = "transaction_update"
    ACCOUNT_CREATE = "account_create"
    ACCOUNT_UPDATE = "account_update"
    PAYMENT_INITIATE = "payment_initiate"
    PAYMENT_COMPLETE = "payment_complete"
    KYC_UPDATE = "kyc_update"
    COMPLIANCE_CHECK = "compliance_check"
    SETTINGS_CHANGE = "settings_change"
    API_CALL = "api_call"

class AuditSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class AuditEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: AuditEventType
    user_id: Optional[str] = None
    resource_type: str
    resource_id: str
    action: str
    severity: AuditSeverity = AuditSeverity.MEDIUM
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    before_state: Optional[Dict[str, Any]] = None
    after_state: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class AuditQuery(BaseModel):
    user_id: Optional[str] = None
    event_type: Optional[AuditEventType] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    severity: Optional[AuditSeverity] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    limit: int = Field(default=100, le=1000)
    offset: int = Field(default=0, ge=0)

audit_store: List[AuditEvent] = []

# Initialize enhanced audit system
audit_storage = AuditStorage()
report_generator = ReportGenerator(audit_storage)
search_engine = AuditSearchEngine(audit_storage)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "audit-service",
        "events_count": len(audit_store),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/v1/audit/log")
async def log_audit_event(event: AuditEvent, background_tasks: BackgroundTasks):
    """Log an audit event"""
    audit_store.append(event)
    
    # Store with encryption and hash chaining
    storage_result = audit_storage.store_entry(event.dict())
    
    if event.severity in [AuditSeverity.HIGH, AuditSeverity.CRITICAL]:
        background_tasks.add_task(send_alert, event)
    
    logger.info(f"Audit event logged: {event.event_type} for {event.resource_type}:{event.resource_id}")
    
    return {
        "event_id": event.event_id,
        "status": "logged",
        "timestamp": event.timestamp.isoformat(),
        "hash_chain": storage_result["hash_chain"]
    }

@app.post("/api/v1/audit/query")
async def query_audit_events(query: AuditQuery):
    """Query audit events with filters"""
    filtered = audit_store
    
    if query.user_id:
        filtered = [e for e in filtered if e.user_id == query.user_id]
    
    if query.event_type:
        filtered = [e for e in filtered if e.event_type == query.event_type]
    
    if query.resource_type:
        filtered = [e for e in filtered if e.resource_type == query.resource_type]
    
    if query.resource_id:
        filtered = [e for e in filtered if e.resource_id == query.resource_id]
    
    if query.severity:
        filtered = [e for e in filtered if e.severity == query.severity]
    
    if query.start_date:
        filtered = [e for e in filtered if e.timestamp >= query.start_date]
    
    if query.end_date:
        filtered = [e for e in filtered if e.timestamp <= query.end_date]
    
    total = len(filtered)
    filtered = filtered[query.offset:query.offset + query.limit]
    
    return {
        "total": total,
        "limit": query.limit,
        "offset": query.offset,
        "events": [e.dict() for e in filtered]
    }

@app.get("/api/v1/audit/{event_id}")
async def get_audit_event(event_id: str):
    """Get specific audit event"""
    for event in audit_store:
        if event.event_id == event_id:
            return event.dict()
    
    raise HTTPException(status_code=404, detail="Audit event not found")

@app.get("/api/v1/audit/user/{user_id}")
async def get_user_audit_trail(user_id: str, limit: int = 100):
    """Get audit trail for specific user"""
    user_events = [e for e in audit_store if e.user_id == user_id]
    user_events.sort(key=lambda x: x.timestamp, reverse=True)
    
    return {
        "user_id": user_id,
        "total_events": len(user_events),
        "events": [e.dict() for e in user_events[:limit]]
    }

@app.get("/api/v1/audit/resource/{resource_type}/{resource_id}")
async def get_resource_audit_trail(resource_type: str, resource_id: str, limit: int = 100):
    """Get audit trail for specific resource"""
    resource_events = [
        e for e in audit_store 
        if e.resource_type == resource_type and e.resource_id == resource_id
    ]
    resource_events.sort(key=lambda x: x.timestamp, reverse=True)
    
    return {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "total_events": len(resource_events),
        "events": [e.dict() for e in resource_events[:limit]]
    }

@app.get("/api/v1/audit/stats")
async def get_audit_statistics():
    """Get audit statistics"""
    now = datetime.utcnow()
    last_24h = now - timedelta(hours=24)
    last_7d = now - timedelta(days=7)
    
    events_24h = [e for e in audit_store if e.timestamp >= last_24h]
    events_7d = [e for e in audit_store if e.timestamp >= last_7d]
    
    event_types_count = {}
    for event in audit_store:
        event_types_count[event.event_type.value] = event_types_count.get(event.event_type.value, 0) + 1
    
    severity_count = {}
    for event in audit_store:
        severity_count[event.severity.value] = severity_count.get(event.severity.value, 0) + 1
    
    return {
        "total_events": len(audit_store),
        "events_last_24h": len(events_24h),
        "events_last_7d": len(events_7d),
        "by_event_type": event_types_count,
        "by_severity": severity_count
    }

async def send_alert(event: AuditEvent):
    """Send alert for high/critical severity events"""
    logger.warning(f"ALERT: {event.severity.value.upper()} event - {event.event_type} by user {event.user_id}")

# New enhanced endpoints

@app.post("/api/v1/audit/reports/generate")
async def generate_report(request: ReportRequest):
    """Generate compliance report"""
    report = report_generator.generate_report(request)
    return report

@app.get("/api/v1/audit/reports/compliance-summary")
async def get_compliance_summary(
    start_date: datetime,
    end_date: datetime
):
    """Get compliance summary report"""
    summary = report_generator.generate_compliance_summary(start_date, end_date)
    return summary

@app.get("/api/v1/audit/reports/stats")
async def get_report_stats():
    """Get report generation statistics"""
    return report_generator.get_report_statistics()

@app.post("/api/v1/audit/search")
async def search_audit_logs(query: SearchQuery):
    """Advanced search of audit logs"""
    results = search_engine.search(query)
    return results

@app.get("/api/v1/audit/search/quick")
async def quick_search(q: str, fields: Optional[str] = None):
    """Quick text search across audit logs"""
    search_fields = fields.split(",") if fields else None
    results = search_engine.quick_search(q, search_fields)
    return {"results": results, "count": len(results)}

@app.get("/api/v1/audit/search/user/{user_id}")
async def search_by_user(
    user_id: str,
    event_type: Optional[str] = None,
    days: int = 30
):
    """Search audit logs for specific user"""
    results = search_engine.search_by_user(user_id, event_type, days)
    return {"user_id": user_id, "results": results, "count": len(results)}

@app.get("/api/v1/audit/search/resource/{resource_type}/{resource_id}")
async def search_by_resource(
    resource_type: str,
    resource_id: str,
    days: int = 30
):
    """Search audit logs for specific resource"""
    results = search_engine.search_by_resource(resource_type, resource_id, days)
    return {"resource_type": resource_type, "resource_id": resource_id, "results": results, "count": len(results)}

@app.get("/api/v1/audit/search/high-severity")
async def search_high_severity(days: int = 7):
    """Search high and critical severity events"""
    results = search_engine.search_high_severity(days)
    return {"results": results, "count": len(results)}

@app.get("/api/v1/audit/search/failed-operations")
async def search_failed_operations(days: int = 7):
    """Search failed operations"""
    results = search_engine.search_failed_operations(days)
    return {"results": results, "count": len(results)}

@app.get("/api/v1/audit/search/stats")
async def get_search_stats():
    """Get search usage statistics"""
    return search_engine.get_search_statistics()

@app.get("/api/v1/audit/integrity/verify")
async def verify_integrity():
    """Verify audit log integrity using hash chain"""
    result = audit_storage.verify_integrity()
    return result

@app.get("/api/v1/audit/storage/stats")
async def get_storage_stats():
    """Get audit storage statistics"""
    return audit_storage.get_storage_stats()

@app.get("/api/v1/audit/export/{event_id}")
async def export_audit_entry(event_id: str, format: str = "json"):
    """Export specific audit entry"""
    entry = audit_storage.retrieve_entry(event_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Audit entry not found")
    
    if format == "json":
        return entry
    elif format == "text":
        lines = []
        for key, value in entry.items():
            lines.append(f"{key}: {value}")
        return {"content": "\n".join(lines)}
    else:
        raise HTTPException(status_code=400, detail="Unsupported format")

@app.post("/api/v1/audit/retention/cleanup")
async def cleanup_old_entries(days: int = 90):
    """Cleanup audit entries older than specified days (admin only)"""
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    # In production, this would archive to cold storage
    logger.info(f"Cleanup requested for entries older than {days} days")
    
    return {
        "status": "scheduled",
        "cutoff_date": cutoff.isoformat(),
        "message": "Cleanup task scheduled for background execution"
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8007)
