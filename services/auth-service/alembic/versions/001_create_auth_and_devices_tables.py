"""create auth and trusted_devices tables

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

auth_user_role = postgresql.ENUM("superadmin", "admin", "user", "guest", name="auth_user_role")


def upgrade() -> None:
    bind = op.get_bind()
    auth_user_role.create(bind, checkfirst=True)

    op.create_table(
        "auth",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("user_role", auth_user_role, nullable=False, server_default="user"),
        sa.Column("keycloak_id", sa.String(), nullable=False, unique=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("api_key", sa.String(), nullable=False, unique=True),
        sa.Column("api_secret", sa.String(), nullable=False, unique=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True),
    )
    op.create_index("ix_auth_tenant_id", "auth", ["tenant_id"])

    op.create_table(
        "trusted_devices",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("device_ip", sa.String(), nullable=False),
        sa.Column("user_agent", sa.String(), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("user_email", sa.String(), nullable=False),
        sa.Column("keycloak_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("device_id", "keycloak_id", "tenant_id", name="uq_trusted_device"),
    )
    op.create_index("ix_trusted_devices_device_id", "trusted_devices", ["device_id"])
    op.create_index("ix_trusted_devices_keycloak_id", "trusted_devices", ["keycloak_id"])


def downgrade() -> None:
    op.drop_index("ix_trusted_devices_keycloak_id", table_name="trusted_devices")
    op.drop_index("ix_trusted_devices_device_id", table_name="trusted_devices")
    op.drop_table("trusted_devices")

    op.drop_index("ix_auth_tenant_id", table_name="auth")
    op.drop_table("auth")

    bind = op.get_bind()
    auth_user_role.drop(bind, checkfirst=True)
