"""
Database Migration: Add audit_logs table
Creates the audit_logs table for tracking authentication and security events
"""

from sqlalchemy import create_engine, Column, Integer, String, DateTime, JSON, Boolean, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings
from database import Base
from models_audit_log import AuditLog

def run_migration():
    """Run the migration to create audit_logs table"""
    
    # Create engine
    engine = create_engine(settings.DATABASE_URL)
    
    print("Creating audit_logs table...")
    
    try:
        # Create table
        AuditLog.__table__.create(engine, checkfirst=True)
        
        # Create indexes
        print("Creating indexes...")
        from sqlalchemy import Index
        
        Index('idx_audit_event_type', AuditLog.event_type).create(engine, checkfirst=True)
        Index('idx_audit_severity', AuditLog.severity).create(engine, checkfirst=True)
        Index('idx_audit_user_id', AuditLog.user_id).create(engine, checkfirst=True)
        Index('idx_audit_username', AuditLog.username).create(engine, checkfirst=True)
        Index('idx_audit_ip_address', AuditLog.ip_address).create(engine, checkfirst=True)
        Index('idx_audit_success', AuditLog.success).create(engine, checkfirst=True)
        Index('idx_audit_token_family', AuditLog.token_family_id).create(engine, checkfirst=True)
        Index('idx_audit_created_at', AuditLog.created_at).create(engine, checkfirst=True)
        
        print("✅ Migration completed successfully!")
        print("✅ audit_logs table created with indexes")
        
    except Exception as e:
        print(f"❌ Migration failed: {str(e)}")
        raise

if __name__ == "__main__":
    run_migration()
