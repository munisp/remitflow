"""Initial Central Ledger schema with HA-safe idempotency

Revision ID: 20251222_001
Revises: 
Create Date: 2025-12-22

This migration creates the Central Ledger schema with:
- Participant management
- Position tracking
- Transfer orchestration state
- Idempotency constraints for HA safety
- TigerBeetle integration references
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20251222_001'
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = 'central_ledger'


def upgrade() -> None:
    # Create schema
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    
    # Participants table
    op.create_table(
        'participants',
        sa.Column('fsp_id', sa.String(255), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='NGN'),
        sa.Column('status', sa.String(20), nullable=False, server_default='CREATED'),
        sa.Column('net_debit_cap', sa.Numeric(18, 4), nullable=False),
        sa.Column('daily_limit', sa.Numeric(18, 4), nullable=True),
        sa.Column('transaction_limit', sa.Numeric(18, 4), nullable=True),
        sa.Column('tigerbeetle_account_id', sa.String(100), nullable=True),
        sa.Column('metadata', postgresql.JSONB, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        schema=SCHEMA
    )
    
    # Participant positions
    op.create_table(
        'participant_positions',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('position_type', sa.String(20), nullable=False),
        sa.Column('value', sa.Numeric(18, 4), nullable=False, server_default='0'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['fsp_id'], [f'{SCHEMA}.participants.fsp_id']),
        sa.UniqueConstraint('fsp_id', 'currency', 'position_type', name='uq_positions_fsp_currency_type'),
        schema=SCHEMA
    )
    op.create_index('idx_positions_fsp', 'participant_positions', ['fsp_id'], schema=SCHEMA)
    
    # Position history for audit
    op.create_table(
        'position_history',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('position_type', sa.String(20), nullable=False),
        sa.Column('previous_value', sa.Numeric(18, 4), nullable=True),
        sa.Column('new_value', sa.Numeric(18, 4), nullable=True),
        sa.Column('change_amount', sa.Numeric(18, 4), nullable=True),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        schema=SCHEMA
    )
    op.create_index('idx_position_history_fsp', 'position_history', ['fsp_id', 'created_at'], schema=SCHEMA)
    
    # Transfer orchestration state with idempotency
    op.create_table(
        'transfer_state',
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('payer_fsp', sa.String(255), nullable=False),
        sa.Column('payee_fsp', sa.String(255), nullable=False),
        sa.Column('amount', sa.Numeric(18, 4), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('state', sa.String(20), nullable=False, server_default='RECEIVED'),
        sa.Column('payer_position_reserved', sa.Numeric(18, 4), nullable=True),
        sa.Column('tigerbeetle_pending_id', sa.String(100), nullable=True),
        sa.Column('error_code', sa.String(10), nullable=True),
        sa.Column('error_description', sa.Text, nullable=True),
        sa.Column('idempotency_key', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA
    )
    op.create_index('idx_transfer_state_payer', 'transfer_state', ['payer_fsp'], schema=SCHEMA)
    op.create_index('idx_transfer_state_payee', 'transfer_state', ['payee_fsp'], schema=SCHEMA)
    op.create_index('idx_transfer_state_state', 'transfer_state', ['state'], schema=SCHEMA)
    op.create_index('idx_transfer_state_idempotency', 'transfer_state', ['idempotency_key'], 
                    unique=True, schema=SCHEMA, postgresql_where=sa.text('idempotency_key IS NOT NULL'))
    
    # Daily usage tracking
    op.create_table(
        'daily_usage',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('usage_date', sa.Date, nullable=False),
        sa.Column('total_debits', sa.Numeric(18, 4), nullable=False, server_default='0'),
        sa.Column('total_credits', sa.Numeric(18, 4), nullable=False, server_default='0'),
        sa.Column('transaction_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.UniqueConstraint('fsp_id', 'currency', 'usage_date', name='uq_daily_usage_fsp_currency_date'),
        schema=SCHEMA
    )
    op.create_index('idx_daily_usage_date', 'daily_usage', ['usage_date'], schema=SCHEMA)
    
    # Liquidity adjustments with idempotency
    op.create_table(
        'liquidity_adjustments',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('amount', sa.Numeric(18, 4), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('adjustment_type', sa.String(20), nullable=False),
        sa.Column('reference', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('tigerbeetle_transfer_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['fsp_id'], [f'{SCHEMA}.participants.fsp_id']),
        sa.UniqueConstraint('reference', name='uq_liquidity_adjustments_reference'),
        schema=SCHEMA
    )
    
    # State transition log for HA reconciliation
    op.create_table(
        'state_transitions',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('from_state', sa.String(20), nullable=True),
        sa.Column('to_state', sa.String(20), nullable=False),
        sa.Column('transition_reason', sa.Text, nullable=True),
        sa.Column('tigerbeetle_sync_status', sa.String(20), server_default='PENDING'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['transfer_id'], [f'{SCHEMA}.transfer_state.transfer_id']),
        schema=SCHEMA
    )
    op.create_index('idx_state_transitions_transfer', 'state_transitions', ['transfer_id'], schema=SCHEMA)
    op.create_index('idx_state_transitions_sync', 'state_transitions', ['tigerbeetle_sync_status'], schema=SCHEMA)
    
    # Reconciliation table for HA recovery
    op.create_table(
        'reconciliation_queue',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tigerbeetle_pending_id', sa.String(100), nullable=True),
        sa.Column('expected_state', sa.String(20), nullable=False),
        sa.Column('reconciliation_status', sa.String(20), server_default='PENDING'),
        sa.Column('retry_count', sa.Integer, server_default='0'),
        sa.Column('last_error', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('transfer_id', name='uq_reconciliation_transfer'),
        schema=SCHEMA
    )
    op.create_index('idx_reconciliation_status', 'reconciliation_queue', ['reconciliation_status'], schema=SCHEMA)
    
    # Create updated_at trigger function
    op.execute(f"""
        CREATE OR REPLACE FUNCTION {SCHEMA}.update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';
    """)
    
    # Apply trigger to tables with updated_at
    for table in ['participants', 'participant_positions', 'transfer_state', 'daily_usage']:
        op.execute(f"""
            CREATE TRIGGER update_{table}_updated_at
            BEFORE UPDATE ON {SCHEMA}.{table}
            FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.update_updated_at_column();
        """)


def downgrade() -> None:
    # Drop triggers
    for table in ['participants', 'participant_positions', 'transfer_state', 'daily_usage']:
        op.execute(f"DROP TRIGGER IF EXISTS update_{table}_updated_at ON {SCHEMA}.{table}")
    
    op.execute(f"DROP FUNCTION IF EXISTS {SCHEMA}.update_updated_at_column()")
    
    # Drop tables in reverse order
    op.drop_table('reconciliation_queue', schema=SCHEMA)
    op.drop_table('state_transitions', schema=SCHEMA)
    op.drop_table('liquidity_adjustments', schema=SCHEMA)
    op.drop_table('daily_usage', schema=SCHEMA)
    op.drop_table('transfer_state', schema=SCHEMA)
    op.drop_table('position_history', schema=SCHEMA)
    op.drop_table('participant_positions', schema=SCHEMA)
    op.drop_table('participants', schema=SCHEMA)
    
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
