import enum


class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"


class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    INVITED = "invited"
    SUSPENDED = "suspended"


class KycVerificationStatus(str, enum.Enum):
    NOT_VERIFIED = "not_verified"
    PENDING = "pending"
    VERIFIED = "verified"
    FAILED_VERIFICATION = "failed_verification"


class FeedbackCategory(str, enum.Enum):
    GENERAL = "general"
    BUG = "bug"
    FEATURE_REQUEST = "feature_request"
    COMPLAINT = "complaint"
    COMPLIMENT = "compliment"
    SUPPORT = "support"


class FeedbackStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"
