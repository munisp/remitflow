// Airtime Top-up Database Models
// Journey: journey_09_airtime_topup
// GORM ORM Models

package models

import (
	"time"
	"gorm.io/gorm"
)


type AirtimeTransaction struct {
	gorm.Model
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Status    string         `gorm:"size:50;default:pending" json:"status"`
	Metadata  string         `gorm:"type:jsonb" json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (m *AirtimeTransaction) TableName() string {
	return "airtimetransactions"
}
