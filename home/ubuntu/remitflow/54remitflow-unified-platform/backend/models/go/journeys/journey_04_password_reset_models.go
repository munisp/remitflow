// Password Reset Database Models
// Journey: journey_04_password_reset
// GORM ORM Models

package models

import (
	"time"
	"gorm.io/gorm"
)


type PasswordResetToken struct {
	gorm.Model
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Status    string         `gorm:"size:50;default:pending" json:"status"`
	Metadata  string         `gorm:"type:jsonb" json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (m *PasswordResetToken) TableName() string {
	return "passwordresettokens"
}
