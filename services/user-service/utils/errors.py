import logging
from typing import Optional, Any
from pydantic import ValidationError
from fastapi.responses import JSONResponse
from fastapi import HTTPException

SERVICE_NAME = "user-service"

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)


class ApiError(Exception):
    """Base class for an Api Error. `code` follows SERVICE-DOMAIN-TYPE-NNNN."""

    status_code: int
    code: Optional[str]
    message: str
    payload: Optional[Any]

    def __init__(
        self,
        message: str,
        status_code: int,
        code: str,
        payload: Optional[Any] = None,
        service: str = SERVICE_NAME,
    ):
        super().__init__()
        self.message = message
        self.status_code = status_code
        self.code = code
        self.payload = payload
        self.service = service

    def to_dict(self):
        error_data = dict(self.payload or {})
        error_data["message"] = self.message
        error_data["status"] = "error"
        error_data["code"] = self.code
        error_data["service"] = self.service
        return error_data


class BadRequestError(ApiError):
    def __init__(self, message: str, payload: Optional[Any] = None):
        super().__init__(message, status_code=400, code="USER-USER-VAL-3001", payload=payload)


class UserAlreadyExistException(ApiError):
    def __init__(self, message: Optional[str] = None):
        super().__init__(
            message or "User already exists.",
            status_code=409,
            code="USER-USER-CONF-3002",
        )


class InternalApiError(ApiError):
    def __init__(self, message: str, payload: Optional[Any] = None, code: int = 500):
        super().__init__(message, status_code=code, code="USER-USER-INT-5001", payload=payload)


class InvalidInputError(ApiError):
    def __init__(self, messages: list[str] | list | dict):
        message = validation_messages_to_string(messages)
        super().__init__(message, status_code=422, code="USER-USER-VAL-3004")


def handle_input_validation_error(error: ValidationError):
    return handle_api_error(InvalidInputError(error.messages))


def handle_api_error(error: ApiError):
    logger.error("handle_api_error: %s", error.to_dict())
    return JSONResponse(content=error.to_dict(), status_code=error.status_code)


def handle_generic_error(error: Exception):
    logger.error("caught a generic error")
    response = {
        "message": "An unexpected error occurred",
        "status": "error",
        "error": type(error).__name__,
    }
    return JSONResponse(content=response, status_code=500)


def validation_messages_to_string(messages):
    if isinstance(messages, dict):
        return "; ".join(
            f"{field}: {', '.join(msgs)}" for field, msgs in messages.items()
        )
    if isinstance(messages, list):
        return "; ".join(messages)
    return str(messages)


def raise_http_exception_handler(status_code: int, message: str, code: str):
    raise HTTPException(
        status_code=status_code,
        detail={
            "message": message,
            "status": "error",
            "code": code,
            "service": SERVICE_NAME,
        },
    )


def api_error_to_http(error: ApiError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.to_dict())
