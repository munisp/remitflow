"""Initial Participant Registry schema with HA-safe idempotency

Revision ID: 20251222_001
Revises: 
Create Date: 2025-12-22

This migration creates the Participant Registry schema with:
- FSP registration and management
- Endpoint configuration
- Credential management
- Audit logging
- Idempotency constraints for HA safety
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20251222_001'
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = 'participant_registry'


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    
    # Registry participants
    op.create_table(
        'registry_participants',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fsp_id', sa.String(255), nullable=False, unique=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('participant_type', sa.String(20), nullable=False, server_default='DFSP'),
        sa.Column('status', sa.String(20), nullable=False, server_default='CREATED'),
        sa.Column('currency', sa.String(3), nullable=False, server_default='NGN'),
        sa.Column('net_debit_cap', sa.Numeric(18, 4), nullable=True),
        sa.Column('daily_limit', sa.Numeric(18, 4), nullable=True),
        sa.Column('transaction_limit', sa.Numeric(18, 4), nullable=True),
        sa.Column('contact_name', sa.String(255), nullable=True),
        sa.Column('contact_email', sa.String(255), nullable=True),
        sa.Column('contact_phone', sa.String(50), nullable=True),
        sa.Column('central_ledger_participant_id', sa.String(255), nullable=True),
        sa.Column('tigerbeetle_account_id', sa.String(100), nullable=True),
        sa.Column('metadata', postgresql.JSONB, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approved_by', sa.String(255), nullable=True),
        schema=SCHEMA
    )
    op.create_index('idx_participants_status', 'registry_participants', ['status'], schema=SCHEMA)
    op.create_index('idx_participants_type', 'registry_participants', ['participant_type'], schema=SCHEMA)
    
    # Participant endpoints
    op.create_table(
        'participant_endpoints',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('endpoint_type', sa.String(100), nullable=False),
        sa.Column('url', sa.String(500), nullable=False),
        sa.Column('is_active', sa.Boolean, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['fsp_id'], [f'{SCHEMA}.registry_participants.fsp_id']),
        sa.UniqueConstraint('fsp_id', 'endpoint_type', name='uq_endpoints_fsp_type'),
        schema=SCHEMA
    )
    op.create_index('idx_endpoints_fsp', 'participant_endpoints', ['fsp_id'], schema=SCHEMA)
    
    # Participant credentials with idempotency
    op.create_table(
        'participant_credentials',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('credential_id', sa.String(100), nullable=False, unique=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('credential_type', sa.String(30), nullable=False),
        sa.Column('credential_value', sa.Text, nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_by', sa.String(255), nullable=True),
        sa.ForeignKeyConstraint(['fsp_id'], [f'{SCHEMA}.registry_participants.fsp_id']),
        schema=SCHEMA
    )
    op.create_index('idx_credentials_fsp', 'participant_credentials', ['fsp_id'], schema=SCHEMA)
    op.create_index('idx_credentials_id', 'participant_credentials', ['credential_id'], schema=SCHEMA)
    
    # Participant audit log
    op.create_table(
        'participant_audit_log',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('actor', sa.String(255), nullable=True),
        sa.Column('details', postgresql.JSONB, server_default='{}'),
        sa.Column('ip_address', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        schema=SCHEMA
    )
    op.create_index('idx_audit_fsp', 'participant_audit_log', ['fsp_id'], schema=SCHEMA)
    op.create_index('idx_audit_action', 'participant_audit_log', ['action'], schema=SCHEMA)
    op.create_index('idx_audit_created', 'participant_audit_log', ['created_at'], schema=SCHEMA)
    
    # Onboarding requests with idempotency
    op.create_table(
        'onboarding_requests',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('request_id', postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('status', sa.String(30), nullable=False, server_default='PENDING'),
        sa.Column('request_data', postgresql.JSONB, nullable=False),
        sa.Column('idempotency_key', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.UniqueConstraint('idempotency_key', name='uq_onboarding_idempotency'),
        schema=SCHEMA
    )
    op.create_index('idx_onboarding_status', 'onboarding_requests', ['status'], schema=SCHEMA)
    
    # Create updated_at trigger
    op.execute(f"""
        CREATE OR REPLACE FUNCTION {SCHEMA}.update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';
    """)
    
    for table in ['registry_participants', 'participant_endpoints']:
        op.execute(f"""
            CREATE TRIGGER update_{table}_updated_at
            BEFORE UPDATE ON {SCHEMA}.{table}
            FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.update_updated_at_column();
        """)


def downgrade() -> None:
    for table in ['registry_participants', 'participant_endpoints']:
        op.execute(f"DROP TRIGGER IF EXISTS update_{table}_updated_at ON {SCHEMA}.{table}")
    
    op.execute(f"DROP FUNCTION IF EXISTS {SCHEMA}.update_updated_at_column()")
    
    op.drop_table('onboarding_requests', schema=SCHEMA)
    op.drop_table('participant_audit_log', schema=SCHEMA)
    op.drop_table('participant_credentials', schema=SCHEMA)
    op.drop_table('participant_endpoints', schema=SCHEMA)
    op.drop_table('registry_participants', schema=SCHEMA)
    
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
