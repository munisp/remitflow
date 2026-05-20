import logging
from typing import List, Optional

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from . import models, schemas

# --- Configuration and Logging ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Custom Exceptions ---
class PolicyException(Exception):
    """Base exception for policy-related errors."""
    pass

class PolicyNotFound(PolicyException):
    """Raised when a policy with the given ID or name is not found."""
    def __init__(self, identifier: str):
        self.identifier = identifier
        super().__init__(f"WAF Policy with identifier '{identifier}' not found.")

class PolicyAlreadyExists(PolicyException):
    """Raised when trying to create a policy with a name that already exists."""
    def __init__(self, name: str):
        self.name = name
        super().__init__(f"WAF Policy with name '{name}' already exists.")

# --- CRUD Operations ---

def get_policy_by_id(db: Session, policy_id: int) -> models.WAFPolicy:
    """Retrieve a WAF policy by its ID."""
    logger.info(f"Attempting to retrieve policy with ID: {policy_id}")
    policy = db.query(models.WAFPolicy).filter(models.WAFPolicy.id == policy_id).first()
    if not policy:
        logger.warning(f"Policy with ID {policy_id} not found.")
        raise PolicyNotFound(str(policy_id))
    return policy

def get_policy_by_name(db: Session, name: str) -> Optional[models.WAFPolicy]:
    """Retrieve a WAF policy by its unique name."""
    logger.info(f"Attempting to retrieve policy with name: {name}")
    return db.query(models.WAFPolicy).filter(models.WAFPolicy.name == name).first()

def get_all_policies(db: Session, skip: int = 0, limit: int = 100) -> List[models.WAFPolicy]:
    """Retrieve a list of all WAF policies with pagination."""
    logger.info(f"Retrieving policies with skip={skip}, limit={limit}")
    return db.query(models.WAFPolicy).offset(skip).limit(limit).all()

def create_policy(db: Session, policy_data: schemas.WAFPolicyCreate) -> models.WAFPolicy:
    """Create a new WAF policy."""
    if get_policy_by_name(db, policy_data.name):
        raise PolicyAlreadyExists(policy_data.name)

    logger.info(f"Creating new policy: {policy_data.name}")
    
    # Convert Pydantic schema to a dictionary for model creation
    policy_dict = policy_data.model_dump()
    
    db_policy = models.WAFPolicy(**policy_dict)
    
    try:
        db.add(db_policy)
        db.commit()
        db.refresh(db_policy)
        logger.info(f"Policy created successfully with ID: {db_policy.id}")
        return db_policy
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Database integrity error during policy creation: {e}")
        # This is a fallback, as PolicyAlreadyExists should catch most name conflicts
        raise PolicyAlreadyExists(policy_data.name)
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error during policy creation: {e}")
        raise

def update_policy(db: Session, policy_id: int, policy_data: schemas.WAFPolicyUpdate) -> models.WAFPolicy:
    """Update an existing WAF policy."""
    db_policy = get_policy_by_id(db, policy_id)
    
    update_data = policy_data.model_dump(exclude_unset=True)
    
    # Check for name conflict if name is being updated
    if "name" in update_data and update_data["name"] != db_policy.name:
        if get_policy_by_name(db, update_data["name"]):
            raise PolicyAlreadyExists(update_data["name"])

    logger.info(f"Updating policy ID {policy_id} with data: {update_data.keys()}")
    
    for key, value in update_data.items():
        setattr(db_policy, key, value)
    
    try:
        db.add(db_policy)
        db.commit()
        db.refresh(db_policy)
        logger.info(f"Policy ID {policy_id} updated successfully.")
        return db_policy
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Database integrity error during policy update: {e}")
        raise PolicyException("Failed to update policy due to data integrity violation.")
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error during policy update: {e}")
        raise

def delete_policy(db: Session, policy_id: int) -> None:
    """Delete a WAF policy by its ID."""
    db_policy = get_policy_by_id(db, policy_id)
    
    logger.info(f"Deleting policy ID: {policy_id}")
    
    try:
        db.delete(db_policy)
        db.commit()
        logger.info(f"Policy ID {policy_id} deleted successfully.")
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error during policy deletion: {e}")
        raise PolicyException("Failed to delete policy.")