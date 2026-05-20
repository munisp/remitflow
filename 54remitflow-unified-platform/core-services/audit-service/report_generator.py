"""
Audit Report Generator - Compliance reports in multiple formats
"""

import json
import csv
import io
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from enum import Enum
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ReportFormat(str, Enum):
    """Supported report formats"""
    JSON = "json"
    CSV = "csv"
    HTML = "html"
    TEXT = "text"


class ReportType(str, Enum):
    """Types of compliance reports"""
    FULL_AUDIT = "full_audit"
    USER_ACTIVITY = "user_activity"
    SECURITY_EVENTS = "security_events"
    FINANCIAL_TRANSACTIONS = "financial_transactions"
    COMPLIANCE_SUMMARY = "compliance_summary"
    FAILED_OPERATIONS = "failed_operations"
    HIGH_RISK_EVENTS = "high_risk_events"


class ReportRequest(BaseModel):
    """Report generation request"""
    report_type: ReportType
    format: ReportFormat = ReportFormat.JSON
    start_date: datetime
    end_date: datetime
    filters: Optional[Dict[str, Any]] = None
    include_metadata: bool = True


class ReportGenerator:
    """Generates compliance reports from audit logs"""
    
    def __init__(self, audit_storage):
        self.storage = audit_storage
        self.reports_generated = 0
        logger.info("Report generator initialized")
    
    def generate_report(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate report based on request"""
        # Retrieve audit entries
        entries = self._filter_entries(request)
        
        # Generate report in requested format
        if request.format == ReportFormat.JSON:
            content = self._generate_json_report(entries, request)
        elif request.format == ReportFormat.CSV:
            content = self._generate_csv_report(entries, request)
        elif request.format == ReportFormat.HTML:
            content = self._generate_html_report(entries, request)
        elif request.format == ReportFormat.TEXT:
            content = self._generate_text_report(entries, request)
        else:
            raise ValueError(f"Unsupported format: {request.format}")
        
        self.reports_generated += 1
        
        return {
            "report_id": f"RPT-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{self.reports_generated}",
            "report_type": request.report_type,
            "format": request.format,
            "entries_count": len(entries),
            "generated_at": datetime.utcnow().isoformat(),
            "content": content
        }
    
    def _filter_entries(self, request: ReportRequest) -> List[Dict[str, Any]]:
        """Filter audit entries based on request"""
        all_entries = self.storage.retrieve_entries(limit=100000)
        
        # Filter by date range
        filtered = [
            entry for entry in all_entries
            if request.start_date <= datetime.fromisoformat(entry["timestamp"]) <= request.end_date
        ]
        
        # Apply additional filters
        if request.filters:
            for key, value in request.filters.items():
                filtered = [
                    entry for entry in filtered
                    if entry.get(key) == value
                ]
        
        # Apply report type specific filters
        if request.report_type == ReportType.SECURITY_EVENTS:
            security_events = [
                "user_login", "user_logout", "failed_login",
                "password_change", "permission_change"
            ]
            filtered = [
                entry for entry in filtered
                if entry.get("event_type") in security_events
            ]
        
        elif request.report_type == ReportType.FINANCIAL_TRANSACTIONS:
            financial_events = [
                "transaction_create", "payment_initiate",
                "payment_complete", "transfer_funds"
            ]
            filtered = [
                entry for entry in filtered
                if entry.get("event_type") in financial_events
            ]
        
        elif request.report_type == ReportType.HIGH_RISK_EVENTS:
            filtered = [
                entry for entry in filtered
                if entry.get("severity") in ["high", "critical"]
            ]
        
        elif request.report_type == ReportType.FAILED_OPERATIONS:
            filtered = [
                entry for entry in filtered
                if entry.get("action") == "failed" or
                   entry.get("metadata", {}).get("status") == "failed"
            ]
        
        return filtered
    
    def _generate_json_report(
        self,
        entries: List[Dict[str, Any]],
        request: ReportRequest
    ) -> str:
        """Generate JSON format report"""
        report = {
            "report_metadata": {
                "report_type": request.report_type,
                "start_date": request.start_date.isoformat(),
                "end_date": request.end_date.isoformat(),
                "total_entries": len(entries),
                "generated_at": datetime.utcnow().isoformat()
            },
            "entries": entries if request.include_metadata else [
                self._strip_metadata(entry) for entry in entries
            ]
        }
        
        return json.dumps(report, indent=2, default=str)
    
    def _generate_csv_report(
        self,
        entries: List[Dict[str, Any]],
        request: ReportRequest
    ) -> str:
        """Generate CSV format report"""
        if not entries:
            return "No data available"
        
        output = io.StringIO()
        
        # Determine fields
        fields = [
            "event_id", "event_type", "user_id", "resource_type",
            "resource_id", "action", "severity", "timestamp"
        ]
        
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        
        for entry in entries:
            writer.writerow(entry)
        
        return output.getvalue()
    
    def _generate_html_report(
        self,
        entries: List[Dict[str, Any]],
        request: ReportRequest
    ) -> str:
        """Generate HTML format report"""
        html = f"""
<!DOCTYPE html>
<html>
<head>
    <title>Audit Report - {request.report_type}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; }}
        h1 {{ color: #333; }}
        .metadata {{ background: #f5f5f5; padding: 15px; margin-bottom: 20px; }}
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #4CAF50; color: white; }}
        tr:nth-child(even) {{ background-color: #f2f2f2; }}
        .severity-high {{ color: red; font-weight: bold; }}
        .severity-critical {{ color: darkred; font-weight: bold; }}
    </style>
</head>
<body>
    <h1>Audit Report: {request.report_type}</h1>
    <div class="metadata">
        <p><strong>Period:</strong> {request.start_date.strftime('%Y-%m-%d')} to {request.end_date.strftime('%Y-%m-%d')}</p>
        <p><strong>Total Entries:</strong> {len(entries)}</p>
        <p><strong>Generated:</strong> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
    </div>
    <table>
        <thead>
            <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>User ID</th>
                <th>Resource</th>
                <th>Action</th>
                <th>Severity</th>
            </tr>
        </thead>
        <tbody>
"""
        
        for entry in entries:
            severity_class = f"severity-{entry.get('severity', 'medium')}"
            html += f"""
            <tr>
                <td>{entry.get('timestamp', 'N/A')}</td>
                <td>{entry.get('event_type', 'N/A')}</td>
                <td>{entry.get('user_id', 'N/A')}</td>
                <td>{entry.get('resource_type', 'N/A')}:{entry.get('resource_id', 'N/A')}</td>
                <td>{entry.get('action', 'N/A')}</td>
                <td class="{severity_class}">{entry.get('severity', 'N/A')}</td>
            </tr>
"""
        
        html += """
        </tbody>
    </table>
</body>
</html>
"""
        return html
    
    def _generate_text_report(
        self,
        entries: List[Dict[str, Any]],
        request: ReportRequest
    ) -> str:
        """Generate plain text format report"""
        lines = []
        lines.append("=" * 80)
        lines.append(f"AUDIT REPORT: {request.report_type}")
        lines.append("=" * 80)
        lines.append(f"Period: {request.start_date.strftime('%Y-%m-%d')} to {request.end_date.strftime('%Y-%m-%d')}")
        lines.append(f"Total Entries: {len(entries)}")
        lines.append(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
        lines.append("=" * 80)
        lines.append("")
        
        for i, entry in enumerate(entries, 1):
            lines.append(f"Entry #{i}")
            lines.append(f"  Event ID: {entry.get('event_id', 'N/A')}")
            lines.append(f"  Timestamp: {entry.get('timestamp', 'N/A')}")
            lines.append(f"  Event Type: {entry.get('event_type', 'N/A')}")
            lines.append(f"  User ID: {entry.get('user_id', 'N/A')}")
            lines.append(f"  Resource: {entry.get('resource_type', 'N/A')}:{entry.get('resource_id', 'N/A')}")
            lines.append(f"  Action: {entry.get('action', 'N/A')}")
            lines.append(f"  Severity: {entry.get('severity', 'N/A')}")
            lines.append("-" * 80)
        
        return "\n".join(lines)
    
    def _strip_metadata(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Remove metadata fields from entry"""
        essential_fields = [
            "event_id", "event_type", "user_id", "resource_type",
            "resource_id", "action", "severity", "timestamp"
        ]
        
        return {k: v for k, v in entry.items() if k in essential_fields}
    
    def generate_compliance_summary(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """Generate compliance summary report"""
        all_entries = self.storage.retrieve_entries(limit=100000)
        
        # Filter by date
        filtered = [
            entry for entry in all_entries
            if start_date <= datetime.fromisoformat(entry["timestamp"]) <= end_date
        ]
        
        # Calculate statistics
        total_events = len(filtered)
        
        events_by_type = {}
        events_by_severity = {}
        events_by_user = {}
        
        for entry in filtered:
            # By type
            event_type = entry.get("event_type", "unknown")
            events_by_type[event_type] = events_by_type.get(event_type, 0) + 1
            
            # By severity
            severity = entry.get("severity", "unknown")
            events_by_severity[severity] = events_by_severity.get(severity, 0) + 1
            
            # By user
            user_id = entry.get("user_id", "unknown")
            events_by_user[user_id] = events_by_user.get(user_id, 0) + 1
        
        # Top users
        top_users = sorted(events_by_user.items(), key=lambda x: x[1], reverse=True)[:10]
        
        return {
            "period": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat()
            },
            "summary": {
                "total_events": total_events,
                "unique_users": len(events_by_user),
                "unique_event_types": len(events_by_type)
            },
            "events_by_type": events_by_type,
            "events_by_severity": events_by_severity,
            "top_users": [
                {"user_id": user, "event_count": count}
                for user, count in top_users
            ],
            "generated_at": datetime.utcnow().isoformat()
        }
    
    def get_report_statistics(self) -> Dict[str, Any]:
        """Get report generation statistics"""
        return {
            "total_reports_generated": self.reports_generated,
            "supported_formats": [f.value for f in ReportFormat],
            "supported_types": [t.value for t in ReportType]
        }
