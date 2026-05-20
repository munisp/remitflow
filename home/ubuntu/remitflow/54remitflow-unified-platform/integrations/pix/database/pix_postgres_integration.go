package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

// PIXPostgresDB handles all database operations for PIX
type PIXPostgresDB struct {
	db *sql.DB
}

// PIXTransferRecord represents a PIX transfer in the database
type PIXTransferRecord struct {
	ID                  string
	PIXKey              string
	PIXKeyType          string
	Amount              float64
	Currency            string
	Description         string
	SenderName          string
	SenderDocument      string
	SenderBank          string
	SenderBranch        string
	SenderAccount       string
	ReceiverName        string
	ReceiverDocument    string
	ReceiverBank        string
	ReceiverBranch      string
	ReceiverAccount     string
	BCBTransactionID    string
	BCBEndToEndID       string
	Status              string
	StatusHistory       string // JSON
	SettlementTimeMs    int64
	CreatedAt           time.Time
	UpdatedAt           time.Time
	SettledAt           *time.Time
	Metadata            string // JSON
	ComplianceChecks    string // JSON
	Fees                string // JSON
	ExchangeInfo        string // JSON
	ErrorDetails        string // JSON
	QRCodeData          string
	QRCodeExpiry        *time.Time
}

// NewPIXPostgresDB creates a new PIX database connection
func NewPIXPostgresDB(connStr string) (*PIXPostgresDB, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	pixDB := &PIXPostgresDB{db: db}

	// Initialize schema
	if err := pixDB.InitializeSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	log.Println("PIX PostgreSQL connection established successfully")
	return pixDB, nil
}

// InitializeSchema creates all necessary tables and indexes
func (p *PIXPostgresDB) InitializeSchema() error {
	schema := `
	-- PIX Transfers Table
	CREATE TABLE IF NOT EXISTS pix_transfers (
		id VARCHAR(36) PRIMARY KEY,
		pix_key VARCHAR(255) NOT NULL,
		pix_key_type VARCHAR(20) NOT NULL,
		amount DECIMAL(15, 2) NOT NULL,
		currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
		description TEXT,
		sender_name VARCHAR(255) NOT NULL,
		sender_document VARCHAR(20) NOT NULL,
		sender_bank VARCHAR(10) NOT NULL,
		sender_branch VARCHAR(10),
		sender_account VARCHAR(20),
		receiver_name VARCHAR(255) NOT NULL,
		receiver_document VARCHAR(20) NOT NULL,
		receiver_bank VARCHAR(10) NOT NULL,
		receiver_branch VARCHAR(10),
		receiver_account VARCHAR(20),
		bcb_transaction_id VARCHAR(50) UNIQUE,
		bcb_end_to_end_id VARCHAR(50) UNIQUE,
		status VARCHAR(20) NOT NULL,
		status_history JSONB,
		settlement_time_ms BIGINT,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
		settled_at TIMESTAMP,
		metadata JSONB,
		compliance_checks JSONB,
		fees JSONB,
		exchange_info JSONB,
		error_details JSONB,
		qr_code_data TEXT,
		qr_code_expiry TIMESTAMP
	);

	-- PIX Keys Table
	CREATE TABLE IF NOT EXISTS pix_keys (
		id SERIAL PRIMARY KEY,
		pix_key VARCHAR(255) UNIQUE NOT NULL,
		key_type VARCHAR(20) NOT NULL,
		account_type VARCHAR(10) NOT NULL,
		bank_code VARCHAR(10) NOT NULL,
		branch VARCHAR(10),
		account_number VARCHAR(20) NOT NULL,
		account_holder_name VARCHAR(255) NOT NULL,
		account_holder_document VARCHAR(20) NOT NULL,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
		status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
		bcb_registration_id VARCHAR(50) UNIQUE
	);

	-- PIX QR Codes Table
	CREATE TABLE IF NOT EXISTS pix_qr_codes (
		id SERIAL PRIMARY KEY,
		qr_code_id VARCHAR(36) UNIQUE NOT NULL,
		qr_code_data TEXT NOT NULL,
		qr_code_type VARCHAR(20) NOT NULL,
		pix_key VARCHAR(255),
		amount DECIMAL(15, 2),
		description TEXT,
		merchant_name VARCHAR(255),
		merchant_city VARCHAR(100),
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		expires_at TIMESTAMP,
		status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
		usage_count INT DEFAULT 0,
		max_usage INT
	);

	-- PIX Audit Log Table
	CREATE TABLE IF NOT EXISTS pix_audit_log (
		id SERIAL PRIMARY KEY,
		transfer_id VARCHAR(36),
		event_type VARCHAR(50) NOT NULL,
		event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
		actor VARCHAR(255),
		action VARCHAR(100) NOT NULL,
		details JSONB,
		ip_address INET,
		user_agent TEXT
	);

	-- PIX Compliance Checks Table
	CREATE TABLE IF NOT EXISTS pix_compliance_checks (
		id SERIAL PRIMARY KEY,
		transfer_id VARCHAR(36) NOT NULL,
		check_type VARCHAR(50) NOT NULL,
		check_result VARCHAR(20) NOT NULL,
		risk_score DECIMAL(5, 2),
		details JSONB,
		checked_at TIMESTAMP NOT NULL DEFAULT NOW(),
		FOREIGN KEY (transfer_id) REFERENCES pix_transfers(id)
	);

	-- PIX Settlements Table
	CREATE TABLE IF NOT EXISTS pix_settlements (
		id SERIAL PRIMARY KEY,
		settlement_id VARCHAR(36) UNIQUE NOT NULL,
		settlement_date DATE NOT NULL,
		total_amount DECIMAL(15, 2) NOT NULL,
		transfer_count INT NOT NULL,
		status VARCHAR(20) NOT NULL,
		bcb_settlement_id VARCHAR(50),
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		settled_at TIMESTAMP
	);

	-- PIX Settlement Items Table
	CREATE TABLE IF NOT EXISTS pix_settlement_items (
		id SERIAL PRIMARY KEY,
		settlement_id VARCHAR(36) NOT NULL,
		transfer_id VARCHAR(36) NOT NULL,
		amount DECIMAL(15, 2) NOT NULL,
		FOREIGN KEY (transfer_id) REFERENCES pix_transfers(id)
	);

	-- Indexes for performance
	CREATE INDEX IF NOT EXISTS idx_pix_transfers_status ON pix_transfers(status);
	CREATE INDEX IF NOT EXISTS idx_pix_transfers_created_at ON pix_transfers(created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_pix_transfers_sender_document ON pix_transfers(sender_document);
	CREATE INDEX IF NOT EXISTS idx_pix_transfers_receiver_document ON pix_transfers(receiver_document);
	CREATE INDEX IF NOT EXISTS idx_pix_transfers_bcb_transaction_id ON pix_transfers(bcb_transaction_id);
	CREATE INDEX IF NOT EXISTS idx_pix_transfers_bcb_end_to_end_id ON pix_transfers(bcb_end_to_end_id);
	CREATE INDEX IF NOT EXISTS idx_pix_keys_pix_key ON pix_keys(pix_key);
	CREATE INDEX IF NOT EXISTS idx_pix_keys_account_holder_document ON pix_keys(account_holder_document);
	CREATE INDEX IF NOT EXISTS idx_pix_qr_codes_qr_code_id ON pix_qr_codes(qr_code_id);
	CREATE INDEX IF NOT EXISTS idx_pix_qr_codes_expires_at ON pix_qr_codes(expires_at);
	CREATE INDEX IF NOT EXISTS idx_pix_audit_log_transfer_id ON pix_audit_log(transfer_id);
	CREATE INDEX IF NOT EXISTS idx_pix_audit_log_event_timestamp ON pix_audit_log(event_timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_pix_compliance_checks_transfer_id ON pix_compliance_checks(transfer_id);

	-- Triggers for updated_at
	CREATE OR REPLACE FUNCTION update_updated_at_column()
	RETURNS TRIGGER AS $$
	BEGIN
		NEW.updated_at = NOW();
		RETURN NEW;
	END;
	$$ language 'plpgsql';

	DROP TRIGGER IF EXISTS update_pix_transfers_updated_at ON pix_transfers;
	CREATE TRIGGER update_pix_transfers_updated_at BEFORE UPDATE ON pix_transfers
		FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

	DROP TRIGGER IF EXISTS update_pix_keys_updated_at ON pix_keys;
	CREATE TRIGGER update_pix_keys_updated_at BEFORE UPDATE ON pix_keys
		FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
	`

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err := p.db.ExecContext(ctx, schema)
	if err != nil {
		return fmt.Errorf("failed to execute schema: %w", err)
	}

	log.Println("PIX database schema initialized successfully")
	return nil
}

// SaveTransfer saves a PIX transfer to the database
func (p *PIXPostgresDB) SaveTransfer(ctx context.Context, transfer *PIXTransferRecord) error {
	query := `
		INSERT INTO pix_transfers (
			id, pix_key, pix_key_type, amount, currency, description,
			sender_name, sender_document, sender_bank, sender_branch, sender_account,
			receiver_name, receiver_document, receiver_bank, receiver_branch, receiver_account,
			bcb_transaction_id, bcb_end_to_end_id, status, status_history,
			settlement_time_ms, created_at, updated_at, settled_at,
			metadata, compliance_checks, fees, exchange_info, error_details,
			qr_code_data, qr_code_expiry
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
			$17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
		)
	`

	_, err := p.db.ExecContext(ctx, query,
		transfer.ID, transfer.PIXKey, transfer.PIXKeyType, transfer.Amount, transfer.Currency,
		transfer.Description, transfer.SenderName, transfer.SenderDocument, transfer.SenderBank,
		transfer.SenderBranch, transfer.SenderAccount, transfer.ReceiverName, transfer.ReceiverDocument,
		transfer.ReceiverBank, transfer.ReceiverBranch, transfer.ReceiverAccount,
		transfer.BCBTransactionID, transfer.BCBEndToEndID, transfer.Status, transfer.StatusHistory,
		transfer.SettlementTimeMs, transfer.CreatedAt, transfer.UpdatedAt, transfer.SettledAt,
		transfer.Metadata, transfer.ComplianceChecks, transfer.Fees, transfer.ExchangeInfo,
		transfer.ErrorDetails, transfer.QRCodeData, transfer.QRCodeExpiry,
	)

	if err != nil {
		return fmt.Errorf("failed to save transfer: %w", err)
	}

	return nil
}

// GetTransfer retrieves a PIX transfer by ID
func (p *PIXPostgresDB) GetTransfer(ctx context.Context, id string) (*PIXTransferRecord, error) {
	query := `
		SELECT id, pix_key, pix_key_type, amount, currency, description,
			sender_name, sender_document, sender_bank, sender_branch, sender_account,
			receiver_name, receiver_document, receiver_bank, receiver_branch, receiver_account,
			bcb_transaction_id, bcb_end_to_end_id, status, status_history,
			settlement_time_ms, created_at, updated_at, settled_at,
			metadata, compliance_checks, fees, exchange_info, error_details,
			qr_code_data, qr_code_expiry
		FROM pix_transfers
		WHERE id = $1
	`

	transfer := &PIXTransferRecord{}
	err := p.db.QueryRowContext(ctx, query, id).Scan(
		&transfer.ID, &transfer.PIXKey, &transfer.PIXKeyType, &transfer.Amount, &transfer.Currency,
		&transfer.Description, &transfer.SenderName, &transfer.SenderDocument, &transfer.SenderBank,
		&transfer.SenderBranch, &transfer.SenderAccount, &transfer.ReceiverName, &transfer.ReceiverDocument,
		&transfer.ReceiverBank, &transfer.ReceiverBranch, &transfer.ReceiverAccount,
		&transfer.BCBTransactionID, &transfer.BCBEndToEndID, &transfer.Status, &transfer.StatusHistory,
		&transfer.SettlementTimeMs, &transfer.CreatedAt, &transfer.UpdatedAt, &transfer.SettledAt,
		&transfer.Metadata, &transfer.ComplianceChecks, &transfer.Fees, &transfer.ExchangeInfo,
		&transfer.ErrorDetails, &transfer.QRCodeData, &transfer.QRCodeExpiry,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("transfer not found: %s", id)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get transfer: %w", err)
	}

	return transfer, nil
}

// UpdateTransferStatus updates the status of a PIX transfer
func (p *PIXPostgresDB) UpdateTransferStatus(ctx context.Context, id, status string, settledAt *time.Time) error {
	query := `
		UPDATE pix_transfers
		SET status = $1, settled_at = $2, updated_at = NOW()
		WHERE id = $3
	`

	result, err := p.db.ExecContext(ctx, query, status, settledAt, id)
	if err != nil {
		return fmt.Errorf("failed to update transfer status: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("transfer not found: %s", id)
	}

	return nil
}

// ListTransfers retrieves transfers with pagination
func (p *PIXPostgresDB) ListTransfers(ctx context.Context, limit, offset int, status string) ([]*PIXTransferRecord, error) {
	query := `
		SELECT id, pix_key, pix_key_type, amount, currency, status,
			sender_name, receiver_name, created_at, updated_at
		FROM pix_transfers
		WHERE ($1 = '' OR status = $1)
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := p.db.QueryContext(ctx, query, status, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list transfers: %w", err)
	}
	defer rows.Close()

	var transfers []*PIXTransferRecord
	for rows.Next() {
		transfer := &PIXTransferRecord{}
		err := rows.Scan(
			&transfer.ID, &transfer.PIXKey, &transfer.PIXKeyType, &transfer.Amount,
			&transfer.Currency, &transfer.Status, &transfer.SenderName,
			&transfer.ReceiverName, &transfer.CreatedAt, &transfer.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan transfer: %w", err)
		}
		transfers = append(transfers, transfer)
	}

	return transfers, nil
}

// SaveAuditLog saves an audit log entry
func (p *PIXPostgresDB) SaveAuditLog(ctx context.Context, transferID, eventType, actor, action string, details map[string]interface{}, ipAddress, userAgent string) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("failed to marshal details: %w", err)
	}

	query := `
		INSERT INTO pix_audit_log (transfer_id, event_type, actor, action, details, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`

	_, err = p.db.ExecContext(ctx, query, transferID, eventType, actor, action, detailsJSON, ipAddress, userAgent)
	if err != nil {
		return fmt.Errorf("failed to save audit log: %w", err)
	}

	return nil
}

// GetTransferStats retrieves transfer statistics
func (p *PIXPostgresDB) GetTransferStats(ctx context.Context, startDate, endDate time.Time) (map[string]interface{}, error) {
	query := `
		SELECT
			COUNT(*) as total_transfers,
			SUM(amount) as total_amount,
			AVG(amount) as average_amount,
			COUNT(DISTINCT sender_document) as unique_senders,
			COUNT(DISTINCT receiver_document) as unique_receivers,
			AVG(settlement_time_ms) as average_settlement_time_ms
		FROM pix_transfers
		WHERE created_at BETWEEN $1 AND $2
	`

	var stats struct {
		TotalTransfers          int
		TotalAmount             float64
		AverageAmount           float64
		UniqueSenders           int
		UniqueReceivers         int
		AverageSettlementTimeMs float64
	}

	err := p.db.QueryRowContext(ctx, query, startDate, endDate).Scan(
		&stats.TotalTransfers,
		&stats.TotalAmount,
		&stats.AverageAmount,
		&stats.UniqueSenders,
		&stats.UniqueReceivers,
		&stats.AverageSettlementTimeMs,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get transfer stats: %w", err)
	}

	return map[string]interface{}{
		"total_transfers":            stats.TotalTransfers,
		"total_amount":               stats.TotalAmount,
		"average_amount":             stats.AverageAmount,
		"unique_senders":             stats.UniqueSenders,
		"unique_receivers":           stats.UniqueReceivers,
		"average_settlement_time_ms": stats.AverageSettlementTimeMs,
	}, nil
}

// Close closes the database connection
func (p *PIXPostgresDB) Close() error {
	return p.db.Close()
}

