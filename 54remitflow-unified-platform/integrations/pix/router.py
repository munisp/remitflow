from typing import List
from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy.orm import Session

from . import schemas, service
from .database import get_db
from .service import PixService, PixIntegrationError
from .auth import get_current_active_user, require_pix_operator, User

# Create the router
pix_router = APIRouter()

# Dependency to get the service instance
def get_pix_service(db: Session = Depends(get_db)) -> PixService:
    return PixService(db)

# --- PIX Key Endpoints (CRUD) ---

@pix_router.post(
    "/keys",
    response_model=schemas.PixKeyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new PIX Key",
    description="Registers a new PIX key (e.g., CPF, Email, Phone) for a user. Requires authentication."
)
def create_key(
    key_data: schemas.PixKeyCreate,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(get_current_active_user)
):
    """
    Creates a new PIX key with the provided details.
    
    **Authentication Required**: Yes
    **Required Roles**: Any authenticated user
    
    Raises a 409 Conflict error if a PIX key with the same value already exists.
    """
    try:
        # Optionally validate that user can only create keys for themselves
        # if key_data.user_id != current_user.id and "admin" not in current_user.roles:
        #     raise HTTPException(status_code=403, detail="Cannot create keys for other users")
        
        return pix_service.create_pix_key(key_data)
    except service.PixIntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@pix_router.get(
    "/keys/{key_value}",
    response_model=schemas.PixKeyResponse,
    summary="Get PIX Key details by value",
    description="Retrieves the details of a specific PIX key. Requires authentication."
)
def get_key(
    key_value: str,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(get_current_active_user)
):
    """
    Returns the PIX key matching the given value.
    
    **Authentication Required**: Yes
    **Required Roles**: Any authenticated user
    
    Raises a 404 Not Found error if the PIX key does not exist.
    """
    try:
        pix_key = pix_service.get_pix_key_by_value(key_value)
        
        # Optionally validate that user can only view their own keys
        # if pix_key.user_id != current_user.id and "admin" not in current_user.roles:
        #     raise HTTPException(status_code=403, detail="Cannot view other users' keys")
        
        return pix_key
    except service.PixIntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@pix_router.get(
    "/keys/user/{user_id}",
    response_model=List[schemas.PixKeyResponse],
    summary="List PIX Keys for a User",
    description="Retrieves all registered PIX keys for a given user ID. Requires authentication."
)
def list_keys(
    user_id: int,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(get_current_active_user)
):
    """
    Returns a list of PIX keys for the specified user.
    
    **Authentication Required**: Yes
    **Required Roles**: Any authenticated user (can only list own keys unless admin)
    
    Users can only list their own keys unless they have admin role.
    """
    # Validate that user can only list their own keys unless admin
    if user_id != current_user.id and "admin" not in current_user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot list keys for other users"
        )
    
    return pix_service.list_pix_keys_by_user(user_id)

@pix_router.delete(
    "/keys/{key_value}",
    response_model=schemas.MessageResponse,
    summary="Delete a PIX Key",
    description="Deletes a registered PIX key. Requires authentication."
)
def delete_key(
    key_value: str,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(get_current_active_user)
):
    """
    Deletes the PIX key matching the given value.
    
    **Authentication Required**: Yes
    **Required Roles**: Any authenticated user (can only delete own keys unless admin)
    
    Raises a 404 Not Found error if the PIX key does not exist.
    """
    try:
        # Get the key first to validate ownership
        pix_key = pix_service.get_pix_key_by_value(key_value)
        
        # Validate that user can only delete their own keys unless admin
        if pix_key.user_id != current_user.id and "admin" not in current_user.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot delete other users' keys"
            )
        
        return pix_service.delete_pix_key(key_value)
    except service.PixIntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

# --- PIX Charge Endpoints (QR Code Generation) ---

@pix_router.post(
    "/charges",
    response_model=schemas.PixChargeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a PIX Charge (Payment Request)",
    description="Creates a new PIX charge, generating a QR code payload (BR Code) for payment. Requires authentication."
)
def create_charge(
    charge_data: schemas.PixChargeCreate,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(get_current_active_user)
):
    """
    Creates a new PIX charge with QR code payload.
    
    **Authentication Required**: Yes
    **Required Roles**: Any authenticated user
    
    The recipient_key_value must belong to an existing PIX key.
    Returns the charge with a generated QR code payload (BR Code).
    """
    try:
        # Optionally validate that user owns the recipient key
        recipient_key = pix_service.get_pix_key_by_value(charge_data.recipient_key_value)
        if recipient_key.user_id != current_user.id and "admin" not in current_user.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot create charges for other users' keys"
            )
        
        return pix_service.create_pix_charge(charge_data)
    except service.PixIntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@pix_router.get(
    "/charges/{charge_id}",
    response_model=schemas.PixChargeResponse,
    summary="Get PIX Charge details",
    description="Retrieves the details of a specific PIX charge. Requires authentication."
)
def get_charge(
    charge_id: int,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(get_current_active_user)
):
    """
    Returns the PIX charge matching the given ID.
    
    **Authentication Required**: Yes
    **Required Roles**: Any authenticated user
    
    Raises a 404 Not Found error if the charge does not exist.
    """
    try:
        charge = pix_service.get_pix_charge(charge_id)
        
        # Optionally validate ownership
        # recipient_key = pix_service.get_pix_key_by_id(charge.recipient_key_id)
        # if recipient_key.user_id != current_user.id and "admin" not in current_user.roles:
        #     raise HTTPException(status_code=403, detail="Cannot view other users' charges")
        
        return charge
    except service.PixIntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

# --- PIX Transaction Endpoints (Webhook/Callback Simulation) ---

@pix_router.post(
    "/transactions/incoming",
    response_model=schemas.PixTransactionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Process Incoming PIX Transaction (Webhook)",
    description="Simulates a webhook/callback from the PIX system confirming a payment. Requires PIX operator role.",
    dependencies=[Depends(require_pix_operator)]
)
def process_transaction(
    transaction_data: schemas.PixTransactionReceive,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(require_pix_operator)
):
    """
    Processes an incoming PIX transaction (webhook simulation).
    
    **Authentication Required**: Yes
    **Required Roles**: pix_operator or admin
    
    This endpoint simulates a webhook/callback from the PIX system.
    It processes the transaction and updates the associated charge status.
    
    The endpoint is idempotent - duplicate transaction IDs will return the existing transaction.
    """
    try:
        return pix_service.process_incoming_transaction(transaction_data)
    except service.PixIntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@pix_router.get(
    "/transactions/{transaction_id}",
    response_model=schemas.PixTransactionResponse,
    summary="Get PIX Transaction details",
    description="Retrieves the details of a specific PIX transaction by its internal ID. Requires authentication."
)
def get_transaction(
    transaction_id: int,
    pix_service: PixService = Depends(get_pix_service),
    current_user: User = Depends(get_current_active_user)
):
    """
    Returns the PIX transaction matching the given internal ID.
    
    **Authentication Required**: Yes
    **Required Roles**: Any authenticated user
    
    Raises a 404 Not Found error if the transaction does not exist.
    """
    try:
        transaction = pix_service.get_transaction_by_id(transaction_id)
        
        # Optionally validate ownership
        # recipient_key = pix_service.get_pix_key_by_id(transaction.recipient_key_id)
        # if recipient_key.user_id != current_user.id and "admin" not in current_user.roles:
        #     raise HTTPException(status_code=403, detail="Cannot view other users' transactions")
        
        return transaction
    except service.PixIntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
