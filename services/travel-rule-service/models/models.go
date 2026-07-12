package models

import (
	"time"

	"github.com/google/uuid"
)

// TravelRuleRecord represents a FATF Recommendation 16 / IVMS101 travel rule record
type TravelRuleRecord struct {
	ID                  uuid.UUID  `json:"id" db:"id"`
	TransferID          string     `json:"transfer_id" db:"transfer_id"`
	Direction           string     `json:"direction" db:"direction"` // outbound | inbound
	Status              string     `json:"status" db:"status"`       // pending | sent | received | verified | rejected
	ThresholdUSD        float64    `json:"threshold_usd" db:"threshold_usd"`
	AmountUSD           float64    `json:"amount_usd" db:"amount_usd"`
	OriginatorVASP      VASPInfo   `json:"originator_vasp" db:"originator_vasp"`
	BeneficiaryVASP     VASPInfo   `json:"beneficiary_vasp" db:"beneficiary_vasp"`
	Originator          PersonInfo `json:"originator" db:"originator"`
	Beneficiary         PersonInfo `json:"beneficiary" db:"beneficiary"`
	IVMS101Payload      string     `json:"ivms101_payload,omitempty" db:"ivms101_payload"`
	EncryptedPayload    string     `json:"encrypted_payload,omitempty" db:"encrypted_payload"`
	VerificationResult  string     `json:"verification_result,omitempty" db:"verification_result"`
	SanctionsScreened   bool       `json:"sanctions_screened" db:"sanctions_screened"`
	SanctionsResult     string     `json:"sanctions_result,omitempty" db:"sanctions_result"`
	Protocol            string     `json:"protocol" db:"protocol"` // TRP | OpenVASP | Shyft | Notabene
	SentAt              *time.Time `json:"sent_at,omitempty" db:"sent_at"`
	ReceivedAt          *time.Time `json:"received_at,omitempty" db:"received_at"`
	VerifiedAt          *time.Time `json:"verified_at,omitempty" db:"verified_at"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at" db:"updated_at"`
}

type VASPInfo struct {
	Name        string `json:"name" db:"name"`
	LEICODE     string `json:"lei_code,omitempty" db:"lei_code"`
	BIC         string `json:"bic,omitempty" db:"bic"`
	CountryCode string `json:"country_code" db:"country_code"`
	Address     string `json:"address,omitempty" db:"address"`
	VASPType    string `json:"vasp_type" db:"vasp_type"` // exchange | wallet | custodian | bank
}

type PersonInfo struct {
	LegalName       string    `json:"legal_name" db:"legal_name"`
	DateOfBirth     string    `json:"date_of_birth,omitempty" db:"date_of_birth"`
	NationalID      string    `json:"national_id,omitempty" db:"national_id"`
	AccountNumber   string    `json:"account_number" db:"account_number"`
	AddressLine1    string    `json:"address_line1,omitempty" db:"address_line1"`
	City            string    `json:"city,omitempty" db:"city"`
	CountryCode     string    `json:"country_code" db:"country_code"`
	CustomerID      string    `json:"customer_id,omitempty" db:"customer_id"`
}

// IVMS101Message is the standard FATF IVMS101 message format
type IVMS101Message struct {
	Originator  IVMS101Person `json:"originator"`
	Beneficiary IVMS101Person `json:"beneficiary"`
	OriginatingVASP struct {
		OriginatingVASP IVMS101LegalPerson `json:"originatingVASP"`
	} `json:"originatingVASP"`
	BeneficiaryVASP struct {
		BeneficiaryVASP IVMS101LegalPerson `json:"beneficiaryVASP"`
	} `json:"beneficiaryVASP"`
	TransferPath *IVMS101TransferPath `json:"transferPath,omitempty"`
}

type IVMS101Person struct {
	OriginatorPersons  []IVMS101NaturalPerson `json:"originatorPersons,omitempty"`
	BeneficiaryPersons []IVMS101NaturalPerson `json:"beneficiaryPersons,omitempty"`
	AccountNumber      []string               `json:"accountNumber,omitempty"`
}

type IVMS101NaturalPerson struct {
	Name struct {
		NameIdentifier []struct {
			PrimaryIdentifier   string `json:"primaryIdentifier"`
			SecondaryIdentifier string `json:"secondaryIdentifier,omitempty"`
			NameIdentifierType  string `json:"nameIdentifierType"` // LEGL | MISC | MAID | NICK
		} `json:"nameIdentifier"`
	} `json:"name"`
	GeographicAddress []struct {
		AddressType    string `json:"addressType"` // HOME | BIZZ | GEOG
		StreetName     string `json:"streetName,omitempty"`
		TownName       string `json:"townName,omitempty"`
		Country        string `json:"country"`
	} `json:"geographicAddress,omitempty"`
	NationalIdentification *struct {
		NationalIdentifier     string `json:"nationalIdentifier"`
		NationalIdentifierType string `json:"nationalIdentifierType"` // ARNU | CCPT | RAID | DRLC | FIIN | TXID | SOCS | IDCD | LEIX | MISC
		CountryOfIssue         string `json:"countryOfIssue,omitempty"`
	} `json:"nationalIdentification,omitempty"`
	DateAndPlaceOfBirth *struct {
		DateOfBirth  string `json:"dateOfBirth"`
		PlaceOfBirth string `json:"placeOfBirth,omitempty"`
	} `json:"dateAndPlaceOfBirth,omitempty"`
}

type IVMS101LegalPerson struct {
	Name struct {
		NameIdentifier []struct {
			LegalPersonName               string `json:"legalPersonName"`
			LegalPersonNameIdentifierType string `json:"legalPersonNameIdentifierType"` // LEGL | SHRT | TRAD
		} `json:"nameIdentifier"`
	} `json:"name"`
	NationalIdentification *struct {
		NationalIdentifier     string `json:"nationalIdentifier"`
		NationalIdentifierType string `json:"nationalIdentifierType"` // LEIX | RAID | TXID | MISC
		CountryOfIssue         string `json:"countryOfIssue,omitempty"`
	} `json:"nationalIdentification,omitempty"`
	CountryOfRegistration string `json:"countryOfRegistration,omitempty"`
}

type IVMS101TransferPath struct {
	IntermediaryVASP []struct {
		IntermediaryVASP IVMS101LegalPerson `json:"intermediaryVASP"`
		Sequence         int                `json:"sequence"`
	} `json:"intermediaryVASP,omitempty"`
}

// CreateTravelRuleRequest is the API request body
type CreateTravelRuleRequest struct {
	TransferID      string     `json:"transfer_id" validate:"required"`
	AmountUSD       float64    `json:"amount_usd" validate:"required,gt=0"`
	Originator      PersonInfo `json:"originator" validate:"required"`
	Beneficiary     PersonInfo `json:"beneficiary" validate:"required"`
	OriginatorVASP  VASPInfo   `json:"originator_vasp" validate:"required"`
	BeneficiaryVASP VASPInfo   `json:"beneficiary_vasp" validate:"required"`
	Protocol        string     `json:"protocol" validate:"oneof=TRP OpenVASP Shyft Notabene"`
}

// TravelRuleEvent is published to Kafka
type TravelRuleEvent struct {
	EventType  string           `json:"event_type"` // travel_rule.created | travel_rule.sent | travel_rule.verified | travel_rule.rejected
	RecordID   string           `json:"record_id"`
	TransferID string           `json:"transfer_id"`
	Status     string           `json:"status"`
	AmountUSD  float64          `json:"amount_usd"`
	Timestamp  time.Time        `json:"timestamp"`
	Payload    *IVMS101Message  `json:"payload,omitempty"`
}

// SanctionsScreeningResult from OFAC/UN/EU screening
type SanctionsScreeningResult struct {
	Screened    bool      `json:"screened"`
	Clear       bool      `json:"clear"`
	Matches     []string  `json:"matches,omitempty"`
	ScreenedAt  time.Time `json:"screened_at"`
	Provider    string    `json:"provider"` // ComplyAdvantage | Chainalysis | Elliptic
}

// VASPDirectory entry for counterparty VASP lookup
type VASPDirectoryEntry struct {
	VASPID      string `json:"vasp_id"`
	Name        string `json:"name"`
	CountryCode string `json:"country_code"`
	Endpoint    string `json:"endpoint"`
	PublicKey   string `json:"public_key"`
	Protocol    string `json:"protocol"`
	Active      bool   `json:"active"`
}

const (
	FATF_THRESHOLD_USD = 1000.0 // FATF Recommendation 16 threshold

	StatusPending  = "pending"
	StatusSent     = "sent"
	StatusReceived = "received"
	StatusVerified = "verified"
	StatusRejected = "rejected"

	DirectionOutbound = "outbound"
	DirectionInbound  = "inbound"

	ProtocolTRP       = "TRP"
	ProtocolOpenVASP  = "OpenVASP"
	ProtocolShyft     = "Shyft"
	ProtocolNotabene  = "Notabene"
)
