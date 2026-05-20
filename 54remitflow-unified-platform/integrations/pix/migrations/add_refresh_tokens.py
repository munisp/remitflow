"""
Database Migration: Add Refresh Tokens Table
Run this to create the refresh_tokens table
"""

import sys
sys.path.append('..')

from sqlalchemy import create_engine
from database import Base
from models_auth import User
from models_refresh_token import RefreshToken
from config import settings

def run_migration():
    """Create refresh_tokens table"""
    
    print("="*70)
    print("Database Migration: Add Refresh Tokens Table")
    print("="*70)
    print()
    
    # Create engine
    engine = create_engine(settings.DATABASE_URL)
    
    print(f"Database: {settings.DATABASE_URL}")
    print()
    
    # Create tables
    print("Creating refresh_tokens table...")
    
    try:
        # Create only RefreshToken table (User table should already exist)
        RefreshToken.__table__.create(engine, checkfirst=True)
        
        print("✅ Successfully created refresh_tokens table")
        print()
        print("Table schema:")
        print("  - id (Primary Key)")
        print("  - token (Hashed, Unique, Indexed)")
        print("  - user_id (Foreign Key to users.id)")
        print("  - family_id (Token rotation family)")
        print("  - created_at, expires_at, used_at")
        print("  - replaced_by_token (Rotation chain)")
        print("  - is_revoked, revoked_at, revoked_reason")
        print("  - device_info, ip_address, user_agent")
        print()
        print("Indexes:")
        print("  - idx_refresh_token_user_family (user_id, family_id)")
        print("  - idx_refresh_token_expires (expires_at)")
        print("  - idx_refresh_token_revoked (is_revoked)")
        print()
        
    except Exception as e:
        print(f"❌ Error creating table: {str(e)}")
        return False
    
    print("="*70)
    print("Migration completed successfully!")
    print("="*70)
    print()
    print("Next steps:")
    print("1. Restart your application")
    print("2. Test login endpoint - should return refresh_token")
    print("3. Test /auth/refresh endpoint with refresh_token")
    print("4. Test /auth/logout endpoint")
    print()
    
    return True


if __name__ == "__main__":
    run_migration()
