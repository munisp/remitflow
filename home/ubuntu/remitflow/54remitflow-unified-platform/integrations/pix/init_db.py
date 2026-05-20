"""
Database Initialization Script
Creates tables and seeds initial users for PIX Integration Service
"""

import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import settings
from database import Base
from models import PIXKey, PIXCharge, PIXTransaction
from models_auth import User
from auth import get_password_hash

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init_database():
    """
    Initialize database:
    1. Create all tables
    2. Seed initial users
    """
    logger.info("Initializing database...")
    
    # Create engine
    engine = create_engine(settings.get_database_url())
    
    # Create all tables
    logger.info("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("✅ Database tables created successfully")
    
    # Create session
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        # Check if users already exist
        existing_users = db.query(User).count()
        
        if existing_users > 0:
            logger.info(f"Database already has {existing_users} users. Skipping seed.")
            return
        
        # Seed initial users
        logger.info("Seeding initial users...")
        
        users_to_create = [
            {
                "username": "admin",
                "email": "admin@pixintegration.com",
                "password": "admin123",
                "full_name": "System Administrator",
                "roles": ["admin", "user", "pix_operator"],
                "is_verified": True
            },
            {
                "username": "pix_operator",
                "email": "operator@pixintegration.com",
                "password": "operator123",
                "full_name": "PIX Operator",
                "roles": ["pix_operator", "user"],
                "is_verified": True
            },
            {
                "username": "user1",
                "email": "user1@example.com",
                "password": "user123",
                "full_name": "Test User",
                "roles": ["user"],
                "is_verified": True
            },
            {
                "username": "demo",
                "email": "demo@example.com",
                "password": "demo123",
                "full_name": "Demo User",
                "roles": ["user"],
                "is_verified": True
            }
        ]
        
        for user_data in users_to_create:
            password = user_data.pop("password")
            hashed_password = get_password_hash(password)
            
            user = User(
                **user_data,
                hashed_password=hashed_password,
                is_active=True
            )
            
            db.add(user)
            logger.info(f"✅ Created user: {user.username} ({', '.join(user.roles)})")
        
        db.commit()
        logger.info(f"✅ Successfully seeded {len(users_to_create)} users")
        
        # Print credentials
        print("\n" + "="*70)
        print("DATABASE INITIALIZED SUCCESSFULLY")
        print("="*70)
        print("\nDefault User Credentials:")
        print("-" * 70)
        print(f"{'Username':<20} {'Password':<15} {'Roles':<35}")
        print("-" * 70)
        for user_data in users_to_create:
            print(f"{user_data['username']:<20} {user_data.get('password', 'N/A'):<15} {', '.join(user_data['roles']):<35}")
        print("-" * 70)
        print("\n⚠️  IMPORTANT: Change these passwords in production!\n")
        print("="*70 + "\n")
        
    except Exception as e:
        logger.error(f"Error seeding database: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    init_database()
