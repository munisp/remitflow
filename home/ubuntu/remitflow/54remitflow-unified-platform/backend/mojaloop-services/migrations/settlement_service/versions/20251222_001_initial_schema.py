"""Initial Settlement Service schema with HA-safe idempotency

Revision ID: 20251222_001
Revises: 
Create Date: 2025-12-22

This migration creates the Settlement Service schema with:
- Settlement window management
- Batch processing
- Net position calculation
- Idempotency constraints for HA safety
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20251222_001'
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = 'settlement'


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    
    # Settlement windows
    op.create_table(
        'settlement_windows',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('window_id', postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('state', sa.String(30), nullable=False, server_default='OPEN'),
        sa.Column('currency', sa.String(3), nullable=False, server_default='NGN'),
        sa.Column('opened_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('settled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('transfer_count', sa.Integer, server_default='0'),
        sa.Column('total_amount', sa.Numeric(18, 4), server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        schema=SCHEMA
    )
    op.create_index('idx_windows_state', 'settlement_windows', ['state'], schema=SCHEMA)
    op.create_index('idx_windows_currency', 'settlement_windows', ['currency'], schema=SCHEMA)
    
    # Window transfers with idempotency
    op.create_table(
        'window_transfers',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('window_id', sa.Integer, nullable=False),
        sa.Column('transfer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('payer_fsp', sa.String(255), nullable=False),
        sa.Column('payee_fsp', sa.String(255), nullable=False),
        sa.Column('amount', sa.Numeric(18, 4), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['window_id'], [f'{SCHEMA}.settlement_windows.id']),
        sa.UniqueConstraint('transfer_id', name='uq_window_transfers_transfer_id'),
        schema=SCHEMA
    )
    op.create_index('idx_window_transfers_window', 'window_transfers', ['window_id'], schema=SCHEMA)
    
    # Settlements
    op.create_table(
        'settlements',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('settlement_id', postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('state', sa.String(30), nullable=False, server_default='PENDING_SETTLEMENT'),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('total_amount', sa.Numeric(18, 4), server_default='0'),
        sa.Column('participant_count', sa.Integer, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA
    )
    op.create_index('idx_settlements_state', 'settlements', ['state'], schema=SCHEMA)
    
    # Settlement window mapping
    op.create_table(
        'settlement_window_mapping',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('settlement_id', sa.Integer, nullable=False),
        sa.Column('window_id', sa.Integer, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['settlement_id'], [f'{SCHEMA}.settlements.id']),
        sa.ForeignKeyConstraint(['window_id'], [f'{SCHEMA}.settlement_windows.id']),
        sa.UniqueConstraint('settlement_id', 'window_id', name='uq_settlement_window_mapping'),
        schema=SCHEMA
    )
    
    # Participant settlement positions
    op.create_table(
        'participant_settlement_positions',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('settlement_id', sa.Integer, nullable=False),
        sa.Column('fsp_id', sa.String(255), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('net_position', sa.Numeric(18, 4), nullable=False),
        sa.Column('total_debits', sa.Numeric(18, 4), server_default='0'),
        sa.Column('total_credits', sa.Numeric(18, 4), server_default='0'),
        sa.Column('state', sa.String(30), server_default='PENDING'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['settlement_id'], [f'{SCHEMA}.settlements.id']),
        sa.UniqueConstraint('settlement_id', 'fsp_id', 'currency', name='uq_participant_positions'),
        schema=SCHEMA
    )
    op.create_index('idx_participant_positions_settlement', 'participant_settlement_positions', 
                    ['settlement_id'], schema=SCHEMA)
    
    # Settlement transfers with idempotency
    op.create_table(
        'settlement_transfers',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('settlement_id', sa.Integer, nullable=False),
        sa.Column('from_fsp', sa.String(255), nullable=False),
        sa.Column('to_fsp', sa.String(255), nullable=False),
        sa.Column('amount', sa.Numeric(18, 4), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('tigerbeetle_transfer_id', sa.String(100), nullable=True),
        sa.Column('state', sa.String(30), server_default='PENDING'),
        sa.Column('idempotency_key', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['settlement_id'], [f'{SCHEMA}.settlements.id']),
        sa.UniqueConstraint('idempotency_key', name='uq_settlement_transfers_idempotency'),
        schema=SCHEMA
    )
    
    # Settlement state history
    op.create_table(
        'settlement_state_history',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('settlement_id', sa.Integer, nullable=False),
        sa.Column('from_state', sa.String(30), nullable=True),
        sa.Column('to_state', sa.String(30), nullable=False),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['settlement_id'], [f'{SCHEMA}.settlements.id']),
        schema=SCHEMA
    )
    
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
    
    for table in ['settlement_windows', 'settlements', 'participant_settlement_positions']:
        op.execute(f"""
            CREATE TRIGGER update_{table}_updated_at
            BEFORE UPDATE ON {SCHEMA}.{table}
            FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.update_updated_at_column();
        """)


def downgrade() -> None:
    for table in ['settlement_windows', 'settlements', 'participant_settlement_positions']:
        op.execute(f"DROP TRIGGER IF EXISTS update_{table}_updated_at ON {SCHEMA}.{table}")
    
    op.execute(f"DROP FUNCTION IF EXISTS {SCHEMA}.update_updated_at_column()")
    
    op.drop_table('settlement_state_history', schema=SCHEMA)
    op.drop_table('settlement_transfers', schema=SCHEMA)
    op.drop_table('participant_settlement_positions', schema=SCHEMA)
    op.drop_table('settlement_window_mapping', schema=SCHEMA)
    op.drop_table('settlements', schema=SCHEMA)
    op.drop_table('window_transfers', schema=SCHEMA)
    op.drop_table('settlement_windows', schema=SCHEMA)
    
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
