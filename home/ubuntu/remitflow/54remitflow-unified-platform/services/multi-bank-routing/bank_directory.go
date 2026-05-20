package multibank

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// NigerianBank represents a bank in the Nigerian banking system
type NigerianBank struct {
	Code            string  `json:"code"`             // NIBSS bank code (e.g., "058" for GTBank)
	Name            string  `json:"name"`             // Full bank name
	ShortName       string  `json:"short_name"`       // Short name (e.g., "GTB")
	NIPCode         string  `json:"nip_code"`         // NIP institution code
	SortCode        string  `json:"sort_code"`        // Sort code for the bank
	SwiftCode       string  `json:"swift_code"`       // SWIFT/BIC code
	Category        string  `json:"category"`         // commercial, microfinance, merchant, mobile_money
	HasDirectAPI    bool    `json:"has_direct_api"`   // Whether we have direct API integration
	HasOnUsTransfer bool    `json:"has_on_us"`        // Whether on-us transfers are supported
	IsActive        bool    `json:"is_active"`        // Whether bank is currently active
	AvgSuccessRate  float64 `json:"avg_success_rate"` // Historical success rate
	AvgLatencyMs    int     `json:"avg_latency_ms"`   // Average transfer latency
	DailyLimit      float64 `json:"daily_limit"`      // Daily transfer limit
	SingleTxnLimit  float64 `json:"single_txn_limit"` // Single transaction limit
	CutoffTime      string  `json:"cutoff_time"`      // Daily cutoff time (e.g., "22:00")
	WeekendEnabled  bool    `json:"weekend_enabled"`  // Whether weekend transfers are supported
}

// BankDirectory manages the directory of all Nigerian banks
type BankDirectory struct {
	banks       map[string]*NigerianBank // Keyed by bank code
	banksByName map[string]*NigerianBank // Keyed by short name
	redis       *redis.Client
	mu          sync.RWMutex
}

// NewBankDirectory creates a new bank directory
func NewBankDirectory(redisClient *redis.Client) *BankDirectory {
	bd := &BankDirectory{
		banks:       make(map[string]*NigerianBank),
		banksByName: make(map[string]*NigerianBank),
		redis:       redisClient,
	}
	bd.initializeNigerianBanks()
	return bd
}

// initializeNigerianBanks initializes the directory with all Nigerian banks
func (bd *BankDirectory) initializeNigerianBanks() {
	// Commercial Banks
	nigerianBanks := []*NigerianBank{
		// Tier 1 Banks (High Volume - Direct API Integration)
		{
			Code: "058", Name: "Guaranty Trust Bank", ShortName: "GTB",
			NIPCode: "058", SortCode: "058152000", SwiftCode: "GTBINGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.98, AvgLatencyMs: 500,
			DailyLimit: 50000000, SingleTxnLimit: 10000000,
			CutoffTime: "23:00", WeekendEnabled: true,
		},
		{
			Code: "044", Name: "Access Bank", ShortName: "ACCESS",
			NIPCode: "044", SortCode: "044150000", SwiftCode: "ABORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.97, AvgLatencyMs: 600,
			DailyLimit: 50000000, SingleTxnLimit: 10000000,
			CutoffTime: "23:00", WeekendEnabled: true,
		},
		{
			Code: "057", Name: "Zenith Bank", ShortName: "ZENITH",
			NIPCode: "057", SortCode: "057150000", SwiftCode: "ZEABORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.98, AvgLatencyMs: 450,
			DailyLimit: 50000000, SingleTxnLimit: 10000000,
			CutoffTime: "23:00", WeekendEnabled: true,
		},
		{
			Code: "033", Name: "United Bank for Africa", ShortName: "UBA",
			NIPCode: "033", SortCode: "033150000", SwiftCode: "UNABORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.96, AvgLatencyMs: 700,
			DailyLimit: 50000000, SingleTxnLimit: 10000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		{
			Code: "011", Name: "First Bank of Nigeria", ShortName: "FIRSTBANK",
			NIPCode: "011", SortCode: "011150000", SwiftCode: "FBABORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.95, AvgLatencyMs: 800,
			DailyLimit: 50000000, SingleTxnLimit: 10000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		// Tier 2 Banks (Medium Volume)
		{
			Code: "032", Name: "Union Bank of Nigeria", ShortName: "UNION",
			NIPCode: "032", SortCode: "032150000", SwiftCode: "UBNINGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.94, AvgLatencyMs: 900,
			DailyLimit: 30000000, SingleTxnLimit: 5000000,
			CutoffTime: "21:00", WeekendEnabled: true,
		},
		{
			Code: "035", Name: "Wema Bank", ShortName: "WEMA",
			NIPCode: "035", SortCode: "035150000", SwiftCode: "WABORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.93, AvgLatencyMs: 850,
			DailyLimit: 20000000, SingleTxnLimit: 5000000,
			CutoffTime: "21:00", WeekendEnabled: true,
		},
		{
			Code: "050", Name: "Ecobank Nigeria", ShortName: "ECOBANK",
			NIPCode: "050", SortCode: "050150000", SwiftCode: "EABORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.94, AvgLatencyMs: 750,
			DailyLimit: 30000000, SingleTxnLimit: 5000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		{
			Code: "076", Name: "Polaris Bank", ShortName: "POLARIS",
			NIPCode: "076", SortCode: "076150000", SwiftCode: "PABORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.92, AvgLatencyMs: 950,
			DailyLimit: 20000000, SingleTxnLimit: 5000000,
			CutoffTime: "21:00", WeekendEnabled: true,
		},
		{
			Code: "221", Name: "Stanbic IBTC Bank", ShortName: "STANBIC",
			NIPCode: "221", SortCode: "221150000", SwiftCode: "SBICNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.96, AvgLatencyMs: 600,
			DailyLimit: 40000000, SingleTxnLimit: 10000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		{
			Code: "214", Name: "First City Monument Bank", ShortName: "FCMB",
			NIPCode: "214", SortCode: "214150000", SwiftCode: "FCMBORNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.95, AvgLatencyMs: 700,
			DailyLimit: 30000000, SingleTxnLimit: 5000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		{
			Code: "039", Name: "Keystone Bank", ShortName: "KEYSTONE",
			NIPCode: "039", SortCode: "039150000", SwiftCode: "ABORNGLA",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.91, AvgLatencyMs: 1000,
			DailyLimit: 20000000, SingleTxnLimit: 5000000,
			CutoffTime: "21:00", WeekendEnabled: true,
		},
		{
			Code: "023", Name: "Citibank Nigeria", ShortName: "CITI",
			NIPCode: "023", SortCode: "023150000", SwiftCode: "CITINGLA",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.97, AvgLatencyMs: 500,
			DailyLimit: 100000000, SingleTxnLimit: 50000000,
			CutoffTime: "22:00", WeekendEnabled: false,
		},
		{
			Code: "082", Name: "Standard Chartered Bank", ShortName: "STANCHART",
			NIPCode: "082", SortCode: "082150000", SwiftCode: "SCBLNGLA",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.97, AvgLatencyMs: 550,
			DailyLimit: 100000000, SingleTxnLimit: 50000000,
			CutoffTime: "22:00", WeekendEnabled: false,
		},
		{
			Code: "215", Name: "Unity Bank", ShortName: "UNITY",
			NIPCode: "215", SortCode: "215150000", SwiftCode: "UNTYORNGLA",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.90, AvgLatencyMs: 1100,
			DailyLimit: 15000000, SingleTxnLimit: 3000000,
			CutoffTime: "20:00", WeekendEnabled: true,
		},
		{
			Code: "070", Name: "Fidelity Bank", ShortName: "FIDELITY",
			NIPCode: "070", SortCode: "070150000", SwiftCode: "FIDTNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.95, AvgLatencyMs: 650,
			DailyLimit: 30000000, SingleTxnLimit: 5000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		{
			Code: "301", Name: "Jaiz Bank", ShortName: "JAIZ",
			NIPCode: "301", SortCode: "301150000", SwiftCode: "JAABORNGLA",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.92, AvgLatencyMs: 900,
			DailyLimit: 10000000, SingleTxnLimit: 2000000,
			CutoffTime: "20:00", WeekendEnabled: false,
		},
		{
			Code: "068", Name: "Sterling Bank", ShortName: "STERLING",
			NIPCode: "068", SortCode: "068150000", SwiftCode: "NAMENGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.94, AvgLatencyMs: 750,
			DailyLimit: 25000000, SingleTxnLimit: 5000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		// Digital/Mobile Banks
		{
			Code: "100", Name: "Kuda Microfinance Bank", ShortName: "KUDA",
			NIPCode: "100", SortCode: "100150000", SwiftCode: "",
			Category: "microfinance", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.96, AvgLatencyMs: 400,
			DailyLimit: 5000000, SingleTxnLimit: 1000000,
			CutoffTime: "23:59", WeekendEnabled: true,
		},
		{
			Code: "999", Name: "OPay Digital Services", ShortName: "OPAY",
			NIPCode: "999", SortCode: "999150000", SwiftCode: "",
			Category: "mobile_money", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.97, AvgLatencyMs: 350,
			DailyLimit: 5000000, SingleTxnLimit: 1000000,
			CutoffTime: "23:59", WeekendEnabled: true,
		},
		{
			Code: "998", Name: "PalmPay", ShortName: "PALMPAY",
			NIPCode: "998", SortCode: "998150000", SwiftCode: "",
			Category: "mobile_money", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.96, AvgLatencyMs: 400,
			DailyLimit: 5000000, SingleTxnLimit: 1000000,
			CutoffTime: "23:59", WeekendEnabled: true,
		},
		{
			Code: "997", Name: "Moniepoint Microfinance Bank", ShortName: "MONIEPOINT",
			NIPCode: "997", SortCode: "997150000", SwiftCode: "",
			Category: "microfinance", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.97, AvgLatencyMs: 380,
			DailyLimit: 5000000, SingleTxnLimit: 1000000,
			CutoffTime: "23:59", WeekendEnabled: true,
		},
		// More Microfinance Banks
		{
			Code: "090", Name: "VFD Microfinance Bank", ShortName: "VFD",
			NIPCode: "090", SortCode: "090150000", SwiftCode: "",
			Category: "microfinance", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.93, AvgLatencyMs: 700,
			DailyLimit: 3000000, SingleTxnLimit: 500000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		{
			Code: "304", Name: "Providus Bank", ShortName: "PROVIDUS",
			NIPCode: "304", SortCode: "304150000", SwiftCode: "PRVDNGLA",
			Category: "commercial", HasDirectAPI: true, HasOnUsTransfer: true,
			IsActive: true, AvgSuccessRate: 0.94, AvgLatencyMs: 650,
			DailyLimit: 20000000, SingleTxnLimit: 5000000,
			CutoffTime: "22:00", WeekendEnabled: true,
		},
		{
			Code: "101", Name: "Titan Trust Bank", ShortName: "TITAN",
			NIPCode: "101", SortCode: "101150000", SwiftCode: "",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.92, AvgLatencyMs: 800,
			DailyLimit: 15000000, SingleTxnLimit: 3000000,
			CutoffTime: "21:00", WeekendEnabled: true,
		},
		{
			Code: "102", Name: "Globus Bank", ShortName: "GLOBUS",
			NIPCode: "102", SortCode: "102150000", SwiftCode: "",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.91, AvgLatencyMs: 850,
			DailyLimit: 15000000, SingleTxnLimit: 3000000,
			CutoffTime: "21:00", WeekendEnabled: true,
		},
		{
			Code: "103", Name: "SunTrust Bank", ShortName: "SUNTRUST",
			NIPCode: "103", SortCode: "103150000", SwiftCode: "",
			Category: "commercial", HasDirectAPI: false, HasOnUsTransfer: false,
			IsActive: true, AvgSuccessRate: 0.90, AvgLatencyMs: 900,
			DailyLimit: 10000000, SingleTxnLimit: 2000000,
			CutoffTime: "20:00", WeekendEnabled: true,
		},
	}

	bd.mu.Lock()
	defer bd.mu.Unlock()

	for _, bank := range nigerianBanks {
		bd.banks[bank.Code] = bank
		bd.banksByName[bank.ShortName] = bank
	}
}

// GetBank retrieves a bank by its code
func (bd *BankDirectory) GetBank(code string) (*NigerianBank, error) {
	bd.mu.RLock()
	defer bd.mu.RUnlock()

	bank, exists := bd.banks[code]
	if !exists {
		return nil, fmt.Errorf("bank with code %s not found", code)
	}
	return bank, nil
}

// GetBankByName retrieves a bank by its short name
func (bd *BankDirectory) GetBankByName(name string) (*NigerianBank, error) {
	bd.mu.RLock()
	defer bd.mu.RUnlock()

	bank, exists := bd.banksByName[name]
	if !exists {
		return nil, fmt.Errorf("bank with name %s not found", name)
	}
	return bank, nil
}

// GetAllBanks returns all banks in the directory
func (bd *BankDirectory) GetAllBanks() []*NigerianBank {
	bd.mu.RLock()
	defer bd.mu.RUnlock()

	banks := make([]*NigerianBank, 0, len(bd.banks))
	for _, bank := range bd.banks {
		banks = append(banks, bank)
	}
	return banks
}

// GetBanksWithDirectAPI returns banks that have direct API integration
func (bd *BankDirectory) GetBanksWithDirectAPI() []*NigerianBank {
	bd.mu.RLock()
	defer bd.mu.RUnlock()

	banks := make([]*NigerianBank, 0)
	for _, bank := range bd.banks {
		if bank.HasDirectAPI && bank.IsActive {
			banks = append(banks, bank)
		}
	}
	return banks
}

// GetBanksWithOnUs returns banks that support on-us transfers
func (bd *BankDirectory) GetBanksWithOnUs() []*NigerianBank {
	bd.mu.RLock()
	defer bd.mu.RUnlock()

	banks := make([]*NigerianBank, 0)
	for _, bank := range bd.banks {
		if bank.HasOnUsTransfer && bank.IsActive {
			banks = append(banks, bank)
		}
	}
	return banks
}

// UpdateBankMetrics updates the success rate and latency for a bank
func (bd *BankDirectory) UpdateBankMetrics(code string, successRate float64, latencyMs int) error {
	bd.mu.Lock()
	defer bd.mu.Unlock()

	bank, exists := bd.banks[code]
	if !exists {
		return fmt.Errorf("bank with code %s not found", code)
	}

	// Exponential moving average for metrics
	alpha := 0.1
	bank.AvgSuccessRate = alpha*successRate + (1-alpha)*bank.AvgSuccessRate
	bank.AvgLatencyMs = int(alpha*float64(latencyMs) + (1-alpha)*float64(bank.AvgLatencyMs))

	// Cache updated metrics in Redis
	if bd.redis != nil {
		ctx := context.Background()
		data, _ := json.Marshal(bank)
		bd.redis.Set(ctx, fmt.Sprintf("bank:metrics:%s", code), data, 24*time.Hour)
	}

	return nil
}

// IsWithinOperatingHours checks if a bank is within operating hours
func (bd *BankDirectory) IsWithinOperatingHours(code string) (bool, error) {
	bank, err := bd.GetBank(code)
	if err != nil {
		return false, err
	}

	now := time.Now()

	// Check weekend
	if !bank.WeekendEnabled && (now.Weekday() == time.Saturday || now.Weekday() == time.Sunday) {
		return false, nil
	}

	// Parse cutoff time
	cutoffHour := 22 // Default
	cutoffMin := 0
	fmt.Sscanf(bank.CutoffTime, "%d:%d", &cutoffHour, &cutoffMin)

	currentMinutes := now.Hour()*60 + now.Minute()
	cutoffMinutes := cutoffHour*60 + cutoffMin

	return currentMinutes < cutoffMinutes, nil
}

// ValidateAccountNumber validates a Nigerian bank account number format
func ValidateAccountNumber(accountNumber string) bool {
	// Nigerian account numbers are 10 digits
	if len(accountNumber) != 10 {
		return false
	}

	// Check if all characters are digits
	for _, c := range accountNumber {
		if c < '0' || c > '9' {
			return false
		}
	}

	return true
}

// BankAccountInfo represents validated bank account information
type BankAccountInfo struct {
	AccountNumber string `json:"account_number"`
	AccountName   string `json:"account_name"`
	BankCode      string `json:"bank_code"`
	BankName      string `json:"bank_name"`
	IsValid       bool   `json:"is_valid"`
	Currency      string `json:"currency"`
}
