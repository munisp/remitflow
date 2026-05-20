"""
Cleanup Script for Expired Refresh Tokens
Run periodically via cron to remove old tokens
"""

import sys
sys.path.append('..')

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from refresh_token_service import RefreshTokenService
from config import settings
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def cleanup_expired_tokens(days_old: int = 30):
    """
    Remove expired and old refresh tokens
    
    Args:
        days_old: Remove tokens older than this many days
    """
    print("="*70)
    print("Refresh Token Cleanup")
    print("="*70)
    print()
    
    # Create database session
    engine = create_engine(settings.DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        # Run cleanup
        refresh_service = RefreshTokenService(db)
        deleted_count = refresh_service.cleanup_expired_tokens(days_old=days_old)
        
        print(f"✅ Cleanup completed")
        print(f"   Removed {deleted_count} expired/old tokens")
        print(f"   Cutoff: Tokens older than {days_old} days")
        print()
        
        return deleted_count
        
    except Exception as e:
        logger.error(f"Error during cleanup: {str(e)}")
        print(f"❌ Error: {str(e)}")
        return 0
        
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Cleanup expired refresh tokens")
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Remove tokens older than this many days (default: 30)"
    )
    
    args = parser.parse_args()
    
    cleanup_expired_tokens(days_old=args.days)
