"""create user and feedback tables

Revision ID: 001
Revises:
Create Date: 2026-07-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

user_role = postgresql.ENUM("superadmin", "admin", "user", "guest", name="user_role")
user_status = postgresql.ENUM("active", "inactive", "invited", "suspended", name="user_status")
kyc_status = postgresql.ENUM(
    "not_verified", "pending", "verified", "failed_verification", name="kyc_verification_status"
)
feedback_category = postgresql.ENUM(
    "general", "bug", "feature_request", "complaint", "compliment", "support", name="feedback_category"
)
feedback_status = postgresql.ENUM("open", "in_progress", "resolved", "closed", name="feedback_status")


def upgrade() -> None:
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    user_status.create(bind, checkfirst=True)
    kyc_status.create(bind, checkfirst=True)
    feedback_category.create(bind, checkfirst=True)
    feedback_status.create(bind, checkfirst=True)

    op.create_table(
        "user",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("first_name", sa.String(), nullable=True),
        sa.Column("last_name", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("uin", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("phone_number", sa.String(), nullable=True, unique=True),
        sa.Column("keycloak_id", sa.String(), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("user_role", user_role, nullable=False, server_default="user"),
        sa.Column("status", user_status, nullable=False, server_default="active"),
        sa.Column("kyc_verification_status", kyc_status, nullable=True, server_default="not_verified"),
        sa.Column("kyc_verification_url", sa.String(), nullable=True),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("tier", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=True),
        sa.Column("postal_code", sa.String(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True),
        sa.CheckConstraint("tier IN (1, 2, 3)", name="ck_user_tier"),
    )
    op.create_index("ix_user_tenant_id", "user", ["tenant_id"])
    op.create_index("ix_user_keycloak_id", "user", ["keycloak_id"])

    op.create_table(
        "feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("category", feedback_category, nullable=False, server_default="general"),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("status", feedback_status, nullable=False, server_default="open"),
        sa.Column("response", sa.Text(), nullable=True),
        sa.Column("responded_by", sa.String(), nullable=True),
        sa.Column("responded_at", sa.String(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True),
    )
    op.create_index("ix_feedback_tenant_id", "feedback", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_tenant_id", table_name="feedback")
    op.drop_table("feedback")
    op.drop_index("ix_user_keycloak_id", table_name="user")
    op.drop_index("ix_user_tenant_id", table_name="user")
    op.drop_table("user")

    bind = op.get_bind()
    feedback_status.drop(bind, checkfirst=True)
    feedback_category.drop(bind, checkfirst=True)
    kyc_status.drop(bind, checkfirst=True)
    user_status.drop(bind, checkfirst=True)
    user_role.drop(bind, checkfirst=True)
