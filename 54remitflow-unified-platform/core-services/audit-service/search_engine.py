"""
Audit Search Engine - Advanced search and filtering capabilities
"""

import logging
import re
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from enum import Enum
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SearchOperator(str, Enum):
    """Search operators"""
    EQUALS = "eq"
    NOT_EQUALS = "ne"
    CONTAINS = "contains"
    STARTS_WITH = "starts_with"
    ENDS_WITH = "ends_with"
    GREATER_THAN = "gt"
    LESS_THAN = "lt"
    IN = "in"
    NOT_IN = "not_in"


class SearchField(BaseModel):
    """Search field specification"""
    field_name: str
    operator: SearchOperator
    value: Any


class SearchQuery(BaseModel):
    """Advanced search query"""
    fields: List[SearchField]
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    sort_by: str = "timestamp"
    sort_order: str = "desc"  # asc or desc
    limit: int = 100
    offset: int = 0


class AuditSearchEngine:
    """Advanced search engine for audit logs"""
    
    def __init__(self, audit_storage):
        self.storage = audit_storage
        self.search_history = []
        logger.info("Audit search engine initialized")
    
    def search(self, query: SearchQuery) -> Dict[str, Any]:
        """Execute search query"""
        # Get all entries
        all_entries = self.storage.retrieve_entries(limit=100000)
        
        # Apply field filters
        filtered = all_entries
        for field_spec in query.fields:
            filtered = self._apply_field_filter(filtered, field_spec)
        
        # Apply date range filter
        if query.start_date or query.end_date:
            filtered = self._apply_date_filter(
                filtered,
                query.start_date,
                query.end_date
            )
        
        # Sort results
        filtered = self._sort_results(filtered, query.sort_by, query.sort_order)
        
        # Get total before pagination
        total_results = len(filtered)
        
        # Apply pagination
        paginated = filtered[query.offset:query.offset + query.limit]
        
        # Record search
        self.search_history.append({
            "query": query.dict(),
            "results_count": total_results,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        return {
            "results": paginated,
            "total_results": total_results,
            "page": query.offset // query.limit + 1,
            "page_size": query.limit,
            "total_pages": (total_results + query.limit - 1) // query.limit
        }
    
    def _apply_field_filter(
        self,
        entries: List[Dict[str, Any]],
        field_spec: SearchField
    ) -> List[Dict[str, Any]]:
        """Apply single field filter"""
        filtered = []
        
        for entry in entries:
            field_value = entry.get(field_spec.field_name)
            
            if field_value is None:
                continue
            
            match = False
            
            if field_spec.operator == SearchOperator.EQUALS:
                match = field_value == field_spec.value
            
            elif field_spec.operator == SearchOperator.NOT_EQUALS:
                match = field_value != field_spec.value
            
            elif field_spec.operator == SearchOperator.CONTAINS:
                match = str(field_spec.value).lower() in str(field_value).lower()
            
            elif field_spec.operator == SearchOperator.STARTS_WITH:
                match = str(field_value).lower().startswith(str(field_spec.value).lower())
            
            elif field_spec.operator == SearchOperator.ENDS_WITH:
                match = str(field_value).lower().endswith(str(field_spec.value).lower())
            
            elif field_spec.operator == SearchOperator.GREATER_THAN:
                try:
                    match = field_value > field_spec.value
                except Exception:
                    match = False
            
            elif field_spec.operator == SearchOperator.LESS_THAN:
                try:
                    match = field_value < field_spec.value
                except Exception:
                    match = False
            
            elif field_spec.operator == SearchOperator.IN:
                match = field_value in field_spec.value
            
            elif field_spec.operator == SearchOperator.NOT_IN:
                match = field_value not in field_spec.value
            
            if match:
                filtered.append(entry)
        
        return filtered
    
    def _apply_date_filter(
        self,
        entries: List[Dict[str, Any]],
        start_date: Optional[datetime],
        end_date: Optional[datetime]
    ) -> List[Dict[str, Any]]:
        """Apply date range filter"""
        filtered = []
        
        for entry in entries:
            timestamp_str = entry.get("timestamp")
            if not timestamp_str:
                continue
            
            try:
                timestamp = datetime.fromisoformat(timestamp_str)
                
                if start_date and timestamp < start_date:
                    continue
                
                if end_date and timestamp > end_date:
                    continue
                
                filtered.append(entry)
            except Exception:
                continue
        
        return filtered
    
    def _sort_results(
        self,
        entries: List[Dict[str, Any]],
        sort_by: str,
        sort_order: str
    ) -> List[Dict[str, Any]]:
        """Sort results"""
        reverse = (sort_order.lower() == "desc")
        
        try:
            sorted_entries = sorted(
                entries,
                key=lambda x: x.get(sort_by, ""),
                reverse=reverse
            )
            return sorted_entries
        except Exception:
            logger.warning(f"Failed to sort by {sort_by}, returning unsorted")
            return entries
    
    def quick_search(
        self,
        search_term: str,
        search_fields: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Quick text search across multiple fields"""
        if not search_fields:
            search_fields = [
                "event_type", "user_id", "resource_type",
                "resource_id", "action"
            ]
        
        all_entries = self.storage.retrieve_entries(limit=100000)
        results = []
        
        search_term_lower = search_term.lower()
        
        for entry in all_entries:
            for field in search_fields:
                field_value = entry.get(field)
                if field_value and search_term_lower in str(field_value).lower():
                    results.append(entry)
                    break
        
        return results
    
    def search_by_user(
        self,
        user_id: str,
        event_type: Optional[str] = None,
        days: int = 30
    ) -> List[Dict[str, Any]]:
        """Search all events for specific user"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        query = SearchQuery(
            fields=[
                SearchField(
                    field_name="user_id",
                    operator=SearchOperator.EQUALS,
                    value=user_id
                )
            ],
            start_date=cutoff,
            limit=1000
        )
        
        if event_type:
            query.fields.append(
                SearchField(
                    field_name="event_type",
                    operator=SearchOperator.EQUALS,
                    value=event_type
                )
            )
        
        result = self.search(query)
        return result["results"]
    
    def search_by_resource(
        self,
        resource_type: str,
        resource_id: str,
        days: int = 30
    ) -> List[Dict[str, Any]]:
        """Search all events for specific resource"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        query = SearchQuery(
            fields=[
                SearchField(
                    field_name="resource_type",
                    operator=SearchOperator.EQUALS,
                    value=resource_type
                ),
                SearchField(
                    field_name="resource_id",
                    operator=SearchOperator.EQUALS,
                    value=resource_id
                )
            ],
            start_date=cutoff,
            limit=1000
        )
        
        result = self.search(query)
        return result["results"]
    
    def search_high_severity(self, days: int = 7) -> List[Dict[str, Any]]:
        """Search high and critical severity events"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        query = SearchQuery(
            fields=[
                SearchField(
                    field_name="severity",
                    operator=SearchOperator.IN,
                    value=["high", "critical"]
                )
            ],
            start_date=cutoff,
            limit=1000
        )
        
        result = self.search(query)
        return result["results"]
    
    def search_failed_operations(self, days: int = 7) -> List[Dict[str, Any]]:
        """Search failed operations"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        query = SearchQuery(
            fields=[
                SearchField(
                    field_name="action",
                    operator=SearchOperator.CONTAINS,
                    value="fail"
                )
            ],
            start_date=cutoff,
            limit=1000
        )
        
        result = self.search(query)
        return result["results"]
    
    def get_search_statistics(self) -> Dict[str, Any]:
        """Get search usage statistics"""
        if not self.search_history:
            return {
                "total_searches": 0,
                "average_results": 0
            }
        
        total_searches = len(self.search_history)
        total_results = sum(s["results_count"] for s in self.search_history)
        avg_results = total_results / total_searches if total_searches > 0 else 0
        
        return {
            "total_searches": total_searches,
            "average_results": round(avg_results, 2),
            "recent_searches": self.search_history[-10:]
        }
