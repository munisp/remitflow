// User Registration with KYC Database Models
// Journey: journey_01_registration
// GORM ORM Models

package models

import (
	"time"
	"gorm.io/gorm"
)


type User struct {
	gorm.Model
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Status    string         `gorm:"size:50;default:pending" json:"status"`
	Metadata  string         `gorm:"type:jsonb" json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (m *User) TableName() string {
	return "users"
}

type KYCDocument struct {
	gorm.Model
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Status    string         `gorm:"size:50;default:pending" json:"status"`
	Metadata  string         `gorm:"type:jsonb" json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (m *KYCDocument) TableName() string {
	return "kycdocuments"
}

type OTPVerification struct {
	gorm.Model
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Status    string         `gorm:"size:50;default:pending" json:"status"`
	Metadata  string         `gorm:"type:jsonb" json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (m *OTPVerification) TableName() string {
	return "otpverifications"
}
