"""create admin table

Revision ID: 001
Revises:
Create Date: 2026-07-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("first_name", sa.String(), nullable=True),
        sa.Column("last_name", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("uin", sa.String(), nullable=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("keycloak_id", sa.String(), nullable=False),
        sa.Column("kyc_url", sa.String(), nullable=True),
        sa.Column("branch_id", sa.String(), nullable=True),
        sa.Column("access_level", sa.String(length=100), nullable=False, server_default="support_agent"),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_suspended", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True),
    )
    op.create_index("ix_admin_tenant_id", "admin", ["tenant_id"])
    op.create_index("ix_admin_keycloak_id", "admin", ["keycloak_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_keycloak_id", table_name="admin")
    op.drop_index("ix_admin_tenant_id", table_name="admin")
    op.drop_table("admin")
