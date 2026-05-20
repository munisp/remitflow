"""Initial Transfer Service schema with HA-safe idempotency

Revision ID: 20251222_001
Revises: 
Create Date: 2025-12-22

This migration creates the Transfer Service schema with:
- Transfer lifecycle management
- ILP condition/fulfilment tracking
- State transitions
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

SCHEMA = 'transfers'


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    
    # Transfers table with idempotency
    op.create_table(
        'transfers',
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('payer_fsp', sa.String(255), nullable=False),
        sa.Column('payee_fsp', sa.String(255), nullable=False),
        sa.Column('amount', sa.Numeric(18, 4), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='NGN'),
        sa.Column('state', sa.String(20), nullable=False, server_default='RECEIVED'),
        sa.Column('ilp_packet', sa.Text, nullable=True),
        sa.Column('condition', sa.String(100), nullable=True),
        sa.Column('fulfilment', sa.String(100), nullable=True),
        sa.Column('expiration', sa.DateTime(timezone=True), nullable=True),
        sa.Column('tigerbeetle_pending_id', sa.String(100), nullable=True),
        sa.Column('tigerbeetle_transfer_id', sa.String(100), nullable=True),
        sa.Column('error_code', sa.String(10), nullable=True),
        sa.Column('error_description', sa.Text, nullable=True),
        sa.Column('idempotency_key', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA
    )
    op.create_index('idx_transfers_state', 'transfers', ['state'], schema=SCHEMA)
    op.create_index('idx_transfers_payer_fsp', 'transfers', ['payer_fsp'], schema=SCHEMA)
    op.create_index('idx_transfers_payee_fsp', 'transfers', ['payee_fsp'], schema=SCHEMA)
    op.create_index('idx_transfers_created', 'transfers', ['created_at'], schema=SCHEMA)
    op.create_index('idx_transfers_idempotency', 'transfers', ['idempotency_key'], 
                    unique=True, schema=SCHEMA, postgresql_where=sa.text('idempotency_key IS NOT NULL'))
    
    # Transfer state changes for audit
    op.create_table(
        'transfer_state_changes',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('from_state', sa.String(20), nullable=True),
        sa.Column('to_state', sa.String(20), nullable=False),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['transfer_id'], [f'{SCHEMA}.transfers.transfer_id']),
        schema=SCHEMA
    )
    op.create_index('idx_state_changes_transfer', 'transfer_state_changes', ['transfer_id'], schema=SCHEMA)
    
    # Transfer extensions (additional data)
    op.create_table(
        'transfer_extensions',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('key', sa.String(100), nullable=False),
        sa.Column('value', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['transfer_id'], [f'{SCHEMA}.transfers.transfer_id']),
        sa.UniqueConstraint('transfer_id', 'key', name='uq_transfer_extensions'),
        schema=SCHEMA
    )
    
    # Pending transfer reconciliation queue
    op.create_table(
        'pending_reconciliation',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tigerbeetle_pending_id', sa.String(100), nullable=False),
        sa.Column('expected_action', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), server_default='PENDING'),
        sa.Column('retry_count', sa.Integer, server_default='0'),
        sa.Column('last_error', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('transfer_id', name='uq_pending_reconciliation_transfer'),
        schema=SCHEMA
    )
    op.create_index('idx_pending_reconciliation_status', 'pending_reconciliation', ['status'], schema=SCHEMA)
    
    # Callback tracking for async notifications
    op.create_table(
        'transfer_callbacks',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('callback_type', sa.String(50), nullable=False),
        sa.Column('target_fsp', sa.String(255), nullable=False),
        sa.Column('url', sa.String(500), nullable=False),
        sa.Column('status', sa.String(20), server_default='PENDING'),
        sa.Column('retry_count', sa.Integer, server_default='0'),
        sa.Column('last_error', sa.Text, nullable=True),
        sa.Column('idempotency_key', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['transfer_id'], [f'{SCHEMA}.transfers.transfer_id']),
        sa.UniqueConstraint('idempotency_key', name='uq_callbacks_idempotency'),
        schema=SCHEMA
    )
    op.create_index('idx_callbacks_status', 'transfer_callbacks', ['status'], schema=SCHEMA)
    
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
    
    op.execute(f"""
        CREATE TRIGGER update_transfers_updated_at
        BEFORE UPDATE ON {SCHEMA}.transfers
        FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.update_updated_at_column();
    """)
    
    # State transition validation function
    op.execute(f"""
        CREATE OR REPLACE FUNCTION {SCHEMA}.validate_state_transition()
        RETURNS TRIGGER AS $$
        DECLARE
            valid_transitions TEXT[][] := ARRAY[
                ARRAY['RECEIVED', 'RESERVED'],
                ARRAY['RECEIVED', 'ABORTED'],
                ARRAY['RESERVED', 'COMMITTED'],
                ARRAY['RESERVED', 'ABORTED']
            ];
            is_valid BOOLEAN := FALSE;
            i INTEGER;
        BEGIN
            -- Allow same state (idempotent update)
            IF OLD.state = NEW.state THEN
                RETURN NEW;
            END IF;
            
            -- Check if transition is valid
            FOR i IN 1..array_length(valid_transitions, 1) LOOP
                IF valid_transitions[i][1] = OLD.state AND valid_transitions[i][2] = NEW.state THEN
                    is_valid := TRUE;
                    EXIT;
                END IF;
            END LOOP;
            
            IF NOT is_valid THEN
                RAISE EXCEPTION 'Invalid state transition from % to %', OLD.state, NEW.state;
            END IF;
            
            RETURN NEW;
        END;
        $$ language 'plpgsql';
    """)
    
    op.execute(f"""
        CREATE TRIGGER validate_transfer_state_transition
        BEFORE UPDATE ON {SCHEMA}.transfers
        FOR EACH ROW
        WHEN (OLD.state IS DISTINCT FROM NEW.state)
        EXECUTE FUNCTION {SCHEMA}.validate_state_transition();
    """)


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS validate_transfer_state_transition ON {SCHEMA}.transfers")
    op.execute(f"DROP FUNCTION IF EXISTS {SCHEMA}.validate_state_transition()")
    op.execute(f"DROP TRIGGER IF EXISTS update_transfers_updated_at ON {SCHEMA}.transfers")
    op.execute(f"DROP FUNCTION IF EXISTS {SCHEMA}.update_updated_at_column()")
    
    op.drop_table('transfer_callbacks', schema=SCHEMA)
    op.drop_table('pending_reconciliation', schema=SCHEMA)
    op.drop_table('transfer_extensions', schema=SCHEMA)
    op.drop_table('transfer_state_changes', schema=SCHEMA)
    op.drop_table('transfers', schema=SCHEMA)
    
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
