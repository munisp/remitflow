from .auth import auth_router
from .health import health_router
from .permissions import permissions_router
from .system import system_router
from .token import token_router

__all__ = ["auth_router", "health_router", "permissions_router", "system_router", "token_router"]
