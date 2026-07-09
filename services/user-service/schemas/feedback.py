from typing import Optional

from pydantic import BaseModel, Field

from utils.enums import FeedbackCategory


class CreateFeedbackSchema(BaseModel):
    category: FeedbackCategory = FeedbackCategory.GENERAL
    subject: str
    message: str
    rating: Optional[int] = Field(None, ge=1, le=5)


class RespondToFeedbackSchema(BaseModel):
    response: str
    responded_by: str
