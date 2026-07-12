package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/remitflow/travel-rule-service/models"
)

type TravelRuleRepository struct {
	db *sqlx.DB
}

func New(db *sqlx.DB) *TravelRuleRepository {
	return &TravelRuleRepository{db: db}
}

func (r *TravelRuleRepository) Create(ctx context.Context, rec *models.TravelRuleRecord) error {
	originatorJSON, _ := json.Marshal(rec.Originator)
	beneficiaryJSON, _ := json.Marshal(rec.Beneficiary)
	originatorVASPJSON, _ := json.Marshal(rec.OriginatorVASP)
	beneficiaryVASPJSON, _ := json.Marshal(rec.BeneficiaryVASP)

	query := `
		INSERT INTO travel_rule_records (
			id, transfer_id, direction, status, threshold_usd, amount_usd,
			originator_vasp, beneficiary_vasp, originator, beneficiary,
			ivms101_payload, protocol, sanctions_screened, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		)`

	rec.ID = uuid.New()
	rec.CreatedAt = time.Now().UTC()
	rec.UpdatedAt = time.Now().UTC()

	_, err := r.db.ExecContext(ctx, query,
		rec.ID, rec.TransferID, rec.Direction, rec.Status,
		rec.ThresholdUSD, rec.AmountUSD,
		originatorVASPJSON, beneficiaryVASPJSON,
		originatorJSON, beneficiaryJSON,
		rec.IVMS101Payload, rec.Protocol,
		rec.SanctionsScreened,
		rec.CreatedAt, rec.UpdatedAt,
	)
	return err
}

func (r *TravelRuleRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.TravelRuleRecord, error) {
	var rec models.TravelRuleRecord
	var originatorJSON, beneficiaryJSON, originatorVASPJSON, beneficiaryVASPJSON []byte

	query := `
		SELECT id, transfer_id, direction, status, threshold_usd, amount_usd,
			originator_vasp, beneficiary_vasp, originator, beneficiary,
			ivms101_payload, encrypted_payload, verification_result,
			sanctions_screened, sanctions_result, protocol,
			sent_at, received_at, verified_at, created_at, updated_at
		FROM travel_rule_records WHERE id = $1`

	row := r.db.QueryRowContext(ctx, query, id)
	err := row.Scan(
		&rec.ID, &rec.TransferID, &rec.Direction, &rec.Status,
		&rec.ThresholdUSD, &rec.AmountUSD,
		&originatorVASPJSON, &beneficiaryVASPJSON,
		&originatorJSON, &beneficiaryJSON,
		&rec.IVMS101Payload, &rec.EncryptedPayload, &rec.VerificationResult,
		&rec.SanctionsScreened, &rec.SanctionsResult, &rec.Protocol,
		&rec.SentAt, &rec.ReceivedAt, &rec.VerifiedAt,
		&rec.CreatedAt, &rec.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("record not found: %s", id)
	}
	if err != nil {
		return nil, err
	}

	json.Unmarshal(originatorJSON, &rec.Originator)
	json.Unmarshal(beneficiaryJSON, &rec.Beneficiary)
	json.Unmarshal(originatorVASPJSON, &rec.OriginatorVASP)
	json.Unmarshal(beneficiaryVASPJSON, &rec.BeneficiaryVASP)

	return &rec, nil
}

func (r *TravelRuleRepository) GetByTransferID(ctx context.Context, transferID string) (*models.TravelRuleRecord, error) {
	var rec models.TravelRuleRecord
	var originatorJSON, beneficiaryJSON, originatorVASPJSON, beneficiaryVASPJSON []byte

	query := `
		SELECT id, transfer_id, direction, status, threshold_usd, amount_usd,
			originator_vasp, beneficiary_vasp, originator, beneficiary,
			ivms101_payload, encrypted_payload, verification_result,
			sanctions_screened, sanctions_result, protocol,
			sent_at, received_at, verified_at, created_at, updated_at
		FROM travel_rule_records WHERE transfer_id = $1 ORDER BY created_at DESC LIMIT 1`

	row := r.db.QueryRowContext(ctx, query, transferID)
	err := row.Scan(
		&rec.ID, &rec.TransferID, &rec.Direction, &rec.Status,
		&rec.ThresholdUSD, &rec.AmountUSD,
		&originatorVASPJSON, &beneficiaryVASPJSON,
		&originatorJSON, &beneficiaryJSON,
		&rec.IVMS101Payload, &rec.EncryptedPayload, &rec.VerificationResult,
		&rec.SanctionsScreened, &rec.SanctionsResult, &rec.Protocol,
		&rec.SentAt, &rec.ReceivedAt, &rec.VerifiedAt,
		&rec.CreatedAt, &rec.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("record not found for transfer: %s", transferID)
	}
	if err != nil {
		return nil, err
	}

	json.Unmarshal(originatorJSON, &rec.Originator)
	json.Unmarshal(beneficiaryJSON, &rec.Beneficiary)
	json.Unmarshal(originatorVASPJSON, &rec.OriginatorVASP)
	json.Unmarshal(beneficiaryVASPJSON, &rec.BeneficiaryVASP)

	return &rec, nil
}

func (r *TravelRuleRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status string, extra map[string]interface{}) error {
	now := time.Now().UTC()
	query := `UPDATE travel_rule_records SET status = $1, updated_at = $2 WHERE id = $3`
	_, err := r.db.ExecContext(ctx, query, status, now, id)
	if err != nil {
		return err
	}

	// Handle specific status transitions
	switch status {
	case models.StatusSent:
		_, err = r.db.ExecContext(ctx, `UPDATE travel_rule_records SET sent_at = $1 WHERE id = $2`, now, id)
	case models.StatusReceived:
		_, err = r.db.ExecContext(ctx, `UPDATE travel_rule_records SET received_at = $1 WHERE id = $2`, now, id)
	case models.StatusVerified:
		result, _ := extra["verification_result"].(string)
		_, err = r.db.ExecContext(ctx,
			`UPDATE travel_rule_records SET verified_at = $1, verification_result = $2 WHERE id = $3`,
			now, result, id)
	case models.StatusRejected:
		result, _ := extra["verification_result"].(string)
		_, err = r.db.ExecContext(ctx,
			`UPDATE travel_rule_records SET verification_result = $1 WHERE id = $2`,
			result, id)
	}
	return err
}

func (r *TravelRuleRepository) UpdateSanctionsResult(ctx context.Context, id uuid.UUID, result *models.SanctionsScreeningResult) error {
	matchesJSON, _ := json.Marshal(result.Matches)
	_, err := r.db.ExecContext(ctx,
		`UPDATE travel_rule_records SET sanctions_screened = true, sanctions_result = $1, updated_at = $2 WHERE id = $3`,
		string(matchesJSON), time.Now().UTC(), id,
	)
	return err
}

func (r *TravelRuleRepository) List(ctx context.Context, customerID string, limit, offset int) ([]*models.TravelRuleRecord, int, error) {
	countQuery := `SELECT COUNT(*) FROM travel_rule_records WHERE originator->>'customer_id' = $1 OR beneficiary->>'customer_id' = $1`
	var total int
	r.db.QueryRowContext(ctx, countQuery, customerID).Scan(&total)

	query := `
		SELECT id, transfer_id, direction, status, threshold_usd, amount_usd,
			originator_vasp, beneficiary_vasp, originator, beneficiary,
			protocol, sanctions_screened, created_at, updated_at
		FROM travel_rule_records
		WHERE originator->>'customer_id' = $1 OR beneficiary->>'customer_id' = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`

	rows, err := r.db.QueryContext(ctx, query, customerID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var records []*models.TravelRuleRecord
	for rows.Next() {
		var rec models.TravelRuleRecord
		var originatorJSON, beneficiaryJSON, originatorVASPJSON, beneficiaryVASPJSON []byte
		if err := rows.Scan(
			&rec.ID, &rec.TransferID, &rec.Direction, &rec.Status,
			&rec.ThresholdUSD, &rec.AmountUSD,
			&originatorVASPJSON, &beneficiaryVASPJSON,
			&originatorJSON, &beneficiaryJSON,
			&rec.Protocol, &rec.SanctionsScreened,
			&rec.CreatedAt, &rec.UpdatedAt,
		); err != nil {
			continue
		}
		json.Unmarshal(originatorJSON, &rec.Originator)
		json.Unmarshal(beneficiaryJSON, &rec.Beneficiary)
		json.Unmarshal(originatorVASPJSON, &rec.OriginatorVASP)
		json.Unmarshal(beneficiaryVASPJSON, &rec.BeneficiaryVASP)
		records = append(records, &rec)
	}
	return records, total, nil
}

func (r *TravelRuleRepository) LookupVASP(ctx context.Context, countryCode string) ([]*models.VASPDirectoryEntry, error) {
	query := `SELECT vasp_id, name, country_code, endpoint, public_key, protocol, active FROM vasp_directory WHERE country_code = $1 AND active = true`
	rows, err := r.db.QueryContext(ctx, query, countryCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []*models.VASPDirectoryEntry
	for rows.Next() {
		var e models.VASPDirectoryEntry
		rows.Scan(&e.VASPID, &e.Name, &e.CountryCode, &e.Endpoint, &e.PublicKey, &e.Protocol, &e.Active)
		entries = append(entries, &e)
	}
	return entries, nil
}
