from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_session
from models import Feedback, User
from schemas import CreateFeedbackSchema, RespondToFeedbackSchema
from utils.enums import FeedbackCategory, FeedbackStatus
from utils.errors import raise_http_exception_handler
from utils.helpers import create_logger
from utils.kafka_instance import KafkaClientInstance
from utils.kafka_client import UserEventTypes

logger = create_logger(__name__)

feedback_router = APIRouter()


@feedback_router.get("")
def list_feedback(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    status: str | None = Query(None),
    category: str | None = Query(None),
):
    query = db.query(Feedback).filter(Feedback.tenant_id == tenant_id)

    if status is not None:
        if status not in FeedbackStatus._value2member_map_:
            raise_http_exception_handler(400, f"Invalid status: {status}", "USER-FEEDBACK-VAL-4001")
        query = query.filter(Feedback.status == status)

    if category is not None:
        if category not in FeedbackCategory._value2member_map_:
            raise_http_exception_handler(400, f"Invalid category: {category}", "USER-FEEDBACK-VAL-4002")
        query = query.filter(Feedback.category == category)

    items = query.order_by(Feedback.created_at.desc()).all()
    return {"message": "success", "feedback": [f.to_dict() for f in items]}


@feedback_router.post("")
def submit_feedback(
    payload: CreateFeedbackSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    user = (
        db.query(User)
        .filter(User.keycloak_id == keycloak_id, User.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-FEEDBACK-404-4041")

    feedback = Feedback(
        user_id=user.id,
        tenant_id=tenant_id,
        category=payload.category,
        subject=payload.subject,
        message=payload.message,
        rating=payload.rating,
        status=FeedbackStatus.OPEN,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)

    KafkaClientInstance.publish_event(
        "user.feedback",
        {
            "type": UserEventTypes.FEEDBACK_SUBMITTED,
            "user_id": str(user.id),
            "tenant_id": tenant_id,
            "feedback_id": str(feedback.id),
        },
        key=str(user.id),
    )
    return {"message": "success", "feedback": feedback.to_dict()}


@feedback_router.get("/summary")
def feedback_summary(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    base = db.query(Feedback).filter(Feedback.tenant_id == tenant_id)
    total = base.count()

    by_status = dict(
        db.query(Feedback.status, func.count(Feedback.id))
        .filter(Feedback.tenant_id == tenant_id)
        .group_by(Feedback.status)
        .all()
    )
    by_category = dict(
        db.query(Feedback.category, func.count(Feedback.id))
        .filter(Feedback.tenant_id == tenant_id)
        .group_by(Feedback.category)
        .all()
    )
    avg_rating = (
        db.query(func.avg(Feedback.rating))
        .filter(Feedback.tenant_id == tenant_id, Feedback.rating.isnot(None))
        .scalar()
    )

    return {
        "message": "success",
        "total": total,
        "by_status": {k.value if hasattr(k, "value") else k: v for k, v in by_status.items()},
        "by_category": {k.value if hasattr(k, "value") else k: v for k, v in by_category.items()},
        "average_rating": float(avg_rating) if avg_rating is not None else None,
    }


@feedback_router.get("/{feedback_id}")
def get_feedback(
    feedback_id: str,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    feedback = (
        db.query(Feedback)
        .filter(Feedback.id == feedback_id, Feedback.tenant_id == tenant_id)
        .first()
    )
    if not feedback:
        raise_http_exception_handler(404, "Feedback not found.", "USER-FEEDBACK-404-4042")
    return {"message": "success", "feedback": feedback.to_dict()}


@feedback_router.post("/{feedback_id}/respond")
def respond_to_feedback(
    feedback_id: str,
    payload: RespondToFeedbackSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    feedback = (
        db.query(Feedback)
        .filter(Feedback.id == feedback_id, Feedback.tenant_id == tenant_id)
        .first()
    )
    if not feedback:
        raise_http_exception_handler(404, "Feedback not found.", "USER-FEEDBACK-404-4043")

    if feedback.status == FeedbackStatus.CLOSED:
        raise_http_exception_handler(400, "Feedback is already closed.", "USER-FEEDBACK-VAL-4003")

    feedback.response = payload.response
    feedback.responded_by = payload.responded_by
    feedback.responded_at = datetime.now(timezone.utc).isoformat()
    feedback.status = FeedbackStatus.RESOLVED
    db.commit()
    db.refresh(feedback)

    KafkaClientInstance.publish_event(
        "user.feedback",
        {
            "type": UserEventTypes.FEEDBACK_RESPONDED,
            "tenant_id": tenant_id,
            "feedback_id": str(feedback.id),
        },
        key=str(feedback.id),
    )
    return {"message": "success", "feedback": feedback.to_dict()}
