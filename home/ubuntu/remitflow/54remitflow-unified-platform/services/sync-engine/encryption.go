// Package sync provides end-to-end encryption for sync payloads
// Uses AES-256-GCM for authenticated encryption
package sync

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"golang.org/x/crypto/hkdf"
)

// EncryptionConfig configures encryption settings
type EncryptionConfig struct {
	Algorithm        string        `json:"algorithm"`         // AES-256-GCM
	KeyRotationDays  int           `json:"key_rotation_days"` // Days between key rotations
	NonceSize        int           `json:"nonce_size"`        // Nonce size in bytes
	EnableAtRest     bool          `json:"enable_at_rest"`    // Encrypt data at rest
	EnableInTransit  bool          `json:"enable_in_transit"` // Encrypt data in transit
}

// DefaultEncryptionConfig returns default encryption configuration
func DefaultEncryptionConfig() *EncryptionConfig {
	return &EncryptionConfig{
		Algorithm:        "AES-256-GCM",
		KeyRotationDays:  30,
		NonceSize:        12,
		EnableAtRest:     true,
		EnableInTransit:  true,
	}
}

// EncryptedPayload represents an encrypted sync payload
type EncryptedPayload struct {
	Version     uint8     `json:"version"`
	Algorithm   string    `json:"algorithm"`
	KeyID       string    `json:"key_id"`
	Nonce       []byte    `json:"nonce"`
	Ciphertext  []byte    `json:"ciphertext"`
	Tag         []byte    `json:"tag"`
	Timestamp   time.Time `json:"timestamp"`
	DeviceID    string    `json:"device_id,omitempty"`
}

// KeyInfo contains key metadata
type KeyInfo struct {
	ID        string    `json:"id"`
	Algorithm string    `json:"algorithm"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Active    bool      `json:"active"`
	Version   int       `json:"version"`
}

// SyncEncryptor handles encryption/decryption of sync payloads
type SyncEncryptor struct {
	mu           sync.RWMutex
	config       *EncryptionConfig
	currentKey   []byte
	currentKeyID string
	keyStore     map[string][]byte // keyID -> key
	keyInfo      map[string]*KeyInfo
	deviceID     string
}

// NewSyncEncryptor creates a new sync encryptor
func NewSyncEncryptor(config *EncryptionConfig, deviceID string) (*SyncEncryptor, error) {
	if config == nil {
		config = DefaultEncryptionConfig()
	}

	se := &SyncEncryptor{
		config:   config,
		keyStore: make(map[string][]byte),
		keyInfo:  make(map[string]*KeyInfo),
		deviceID: deviceID,
	}

	// Generate initial key
	if err := se.RotateKey(); err != nil {
		return nil, err
	}

	return se, nil
}

// RotateKey generates a new encryption key
func (se *SyncEncryptor) RotateKey() error {
	se.mu.Lock()
	defer se.mu.Unlock()

	// Generate new 256-bit key
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return fmt.Errorf("failed to generate key: %w", err)
	}

	// Generate key ID
	keyID := fmt.Sprintf("key-%d", time.Now().UnixNano())

	// Store key
	se.keyStore[keyID] = key
	se.keyInfo[keyID] = &KeyInfo{
		ID:        keyID,
		Algorithm: se.config.Algorithm,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().AddDate(0, 0, se.config.KeyRotationDays),
		Active:    true,
		Version:   len(se.keyStore),
	}

	// Mark old key as inactive
	if se.currentKeyID != "" {
		if info, ok := se.keyInfo[se.currentKeyID]; ok {
			info.Active = false
		}
	}

	se.currentKey = key
	se.currentKeyID = keyID

	return nil
}

// Encrypt encrypts a sync payload
func (se *SyncEncryptor) Encrypt(plaintext []byte) (*EncryptedPayload, error) {
	se.mu.RLock()
	key := se.currentKey
	keyID := se.currentKeyID
	se.mu.RUnlock()

	if key == nil {
		return nil, errors.New("no encryption key available")
	}

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM mode
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	// Generate nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Encrypt with authentication
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	// Extract tag (last 16 bytes of ciphertext in GCM)
	tagSize := gcm.Overhead()
	tag := ciphertext[len(ciphertext)-tagSize:]
	ciphertext = ciphertext[:len(ciphertext)-tagSize]

	return &EncryptedPayload{
		Version:    1,
		Algorithm:  se.config.Algorithm,
		KeyID:      keyID,
		Nonce:      nonce,
		Ciphertext: ciphertext,
		Tag:        tag,
		Timestamp:  time.Now(),
		DeviceID:   se.deviceID,
	}, nil
}

// Decrypt decrypts an encrypted payload
func (se *SyncEncryptor) Decrypt(payload *EncryptedPayload) ([]byte, error) {
	se.mu.RLock()
	key, ok := se.keyStore[payload.KeyID]
	se.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key not found: %s", payload.KeyID)
	}

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM mode
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	// Reconstruct ciphertext with tag
	ciphertextWithTag := append(payload.Ciphertext, payload.Tag...)

	// Decrypt
	plaintext, err := gcm.Open(nil, payload.Nonce, ciphertextWithTag, nil)
	if err != nil {
		return nil, fmt.Errorf("decryption failed: %w", err)
	}

	return plaintext, nil
}

// EncryptJSON encrypts a JSON-serializable object
func (se *SyncEncryptor) EncryptJSON(data interface{}) (*EncryptedPayload, error) {
	plaintext, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal data: %w", err)
	}
	return se.Encrypt(plaintext)
}

// DecryptJSON decrypts to a JSON object
func (se *SyncEncryptor) DecryptJSON(payload *EncryptedPayload, target interface{}) error {
	plaintext, err := se.Decrypt(payload)
	if err != nil {
		return err
	}
	return json.Unmarshal(plaintext, target)
}

// ImportKey imports an external key
func (se *SyncEncryptor) ImportKey(keyID string, key []byte, info *KeyInfo) error {
	se.mu.Lock()
	defer se.mu.Unlock()

	if len(key) != 32 {
		return errors.New("key must be 256 bits")
	}

	se.keyStore[keyID] = key
	se.keyInfo[keyID] = info

	return nil
}

// ExportKey exports a key (for key exchange)
func (se *SyncEncryptor) ExportKey(keyID string) ([]byte, *KeyInfo, error) {
	se.mu.RLock()
	defer se.mu.RUnlock()

	key, ok := se.keyStore[keyID]
	if !ok {
		return nil, nil, fmt.Errorf("key not found: %s", keyID)
	}

	info := se.keyInfo[keyID]
	return key, info, nil
}

// GetCurrentKeyID returns the current key ID
func (se *SyncEncryptor) GetCurrentKeyID() string {
	se.mu.RLock()
	defer se.mu.RUnlock()
	return se.currentKeyID
}

// GetKeyInfo returns key information
func (se *SyncEncryptor) GetKeyInfo(keyID string) (*KeyInfo, bool) {
	se.mu.RLock()
	defer se.mu.RUnlock()
	info, ok := se.keyInfo[keyID]
	return info, ok
}

// KeyExchange handles secure key exchange between devices
type KeyExchange struct {
	mu         sync.RWMutex
	privateKey *ecdh.PrivateKey
	publicKey  *ecdh.PublicKey
	sharedKeys map[string][]byte // deviceID -> shared key
}

// NewKeyExchange creates a new key exchange handler
func NewKeyExchange() (*KeyExchange, error) {
	curve := ecdh.P256()
	privateKey, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate key pair: %w", err)
	}

	return &KeyExchange{
		privateKey: privateKey,
		publicKey:  privateKey.PublicKey(),
		sharedKeys: make(map[string][]byte),
	}, nil
}

// GetPublicKey returns the public key for exchange
func (ke *KeyExchange) GetPublicKey() []byte {
	return ke.publicKey.Bytes()
}

// DeriveSharedKey derives a shared key from a peer's public key
func (ke *KeyExchange) DeriveSharedKey(deviceID string, peerPublicKeyBytes []byte) ([]byte, error) {
	ke.mu.Lock()
	defer ke.mu.Unlock()

	// Parse peer's public key
	curve := ecdh.P256()
	peerPublicKey, err := curve.NewPublicKey(peerPublicKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("invalid peer public key: %w", err)
	}

	// Perform ECDH
	sharedSecret, err := ke.privateKey.ECDH(peerPublicKey)
	if err != nil {
		return nil, fmt.Errorf("ECDH failed: %w", err)
	}

	// Derive key using HKDF
	hkdfReader := hkdf.New(sha256.New, sharedSecret, nil, []byte("sync-encryption-key"))
	derivedKey := make([]byte, 32)
	if _, err := io.ReadFull(hkdfReader, derivedKey); err != nil {
		return nil, fmt.Errorf("key derivation failed: %w", err)
	}

	ke.sharedKeys[deviceID] = derivedKey
	return derivedKey, nil
}

// GetSharedKey returns the shared key for a device
func (ke *KeyExchange) GetSharedKey(deviceID string) ([]byte, bool) {
	ke.mu.RLock()
	defer ke.mu.RUnlock()
	key, ok := ke.sharedKeys[deviceID]
	return key, ok
}

// DeviceAttestation handles device attestation for sync endpoints
type DeviceAttestation struct {
	mu              sync.RWMutex
	trustedDevices  map[string]*DeviceInfo
	attestationKeys map[string][]byte
}

// DeviceInfo contains device information
type DeviceInfo struct {
	DeviceID      string    `json:"device_id"`
	DeviceType    string    `json:"device_type"` // mobile, edge, server
	Platform      string    `json:"platform"`    // ios, android, linux
	PublicKey     []byte    `json:"public_key"`
	AttestationID string    `json:"attestation_id"`
	RegisteredAt  time.Time `json:"registered_at"`
	LastSeenAt    time.Time `json:"last_seen_at"`
	Trusted       bool      `json:"trusted"`
}

// NewDeviceAttestation creates a new device attestation handler
func NewDeviceAttestation() *DeviceAttestation {
	return &DeviceAttestation{
		trustedDevices:  make(map[string]*DeviceInfo),
		attestationKeys: make(map[string][]byte),
	}
}

// RegisterDevice registers a device for attestation
func (da *DeviceAttestation) RegisterDevice(info *DeviceInfo) error {
	da.mu.Lock()
	defer da.mu.Unlock()

	if info.DeviceID == "" {
		return errors.New("device ID required")
	}

	info.RegisteredAt = time.Now()
	info.LastSeenAt = time.Now()
	info.Trusted = false // Requires verification

	da.trustedDevices[info.DeviceID] = info

	return nil
}

// VerifyDevice verifies and trusts a device
func (da *DeviceAttestation) VerifyDevice(deviceID string, attestationToken []byte) error {
	da.mu.Lock()
	defer da.mu.Unlock()

	info, ok := da.trustedDevices[deviceID]
	if !ok {
		return fmt.Errorf("device not registered: %s", deviceID)
	}

	// Verify attestation token (simplified - in production, verify with attestation service)
	// For iOS: DeviceCheck API
	// For Android: SafetyNet/Play Integrity API
	if len(attestationToken) < 32 {
		return errors.New("invalid attestation token")
	}

	info.Trusted = true
	info.LastSeenAt = time.Now()
	info.AttestationID = base64.StdEncoding.EncodeToString(attestationToken[:16])

	return nil
}

// IsTrusted checks if a device is trusted
func (da *DeviceAttestation) IsTrusted(deviceID string) bool {
	da.mu.RLock()
	defer da.mu.RUnlock()

	info, ok := da.trustedDevices[deviceID]
	return ok && info.Trusted
}

// GetDeviceInfo returns device information
func (da *DeviceAttestation) GetDeviceInfo(deviceID string) (*DeviceInfo, bool) {
	da.mu.RLock()
	defer da.mu.RUnlock()
	info, ok := da.trustedDevices[deviceID]
	return info, ok
}

// UpdateLastSeen updates the last seen timestamp
func (da *DeviceAttestation) UpdateLastSeen(deviceID string) {
	da.mu.Lock()
	defer da.mu.Unlock()

	if info, ok := da.trustedDevices[deviceID]; ok {
		info.LastSeenAt = time.Now()
	}
}

// RevokeDevice revokes trust for a device
func (da *DeviceAttestation) RevokeDevice(deviceID string) {
	da.mu.Lock()
	defer da.mu.Unlock()

	if info, ok := da.trustedDevices[deviceID]; ok {
		info.Trusted = false
	}
}

// ListTrustedDevices returns all trusted devices
func (da *DeviceAttestation) ListTrustedDevices() []*DeviceInfo {
	da.mu.RLock()
	defer da.mu.RUnlock()

	devices := make([]*DeviceInfo, 0)
	for _, info := range da.trustedDevices {
		if info.Trusted {
			devices = append(devices, info)
		}
	}
	return devices
}

// SecureSyncChannel wraps encryption, key exchange, and attestation
type SecureSyncChannel struct {
	encryptor   *SyncEncryptor
	keyExchange *KeyExchange
	attestation *DeviceAttestation
	deviceID    string
}

// NewSecureSyncChannel creates a new secure sync channel
func NewSecureSyncChannel(deviceID string, config *EncryptionConfig) (*SecureSyncChannel, error) {
	encryptor, err := NewSyncEncryptor(config, deviceID)
	if err != nil {
		return nil, err
	}

	keyExchange, err := NewKeyExchange()
	if err != nil {
		return nil, err
	}

	return &SecureSyncChannel{
		encryptor:   encryptor,
		keyExchange: keyExchange,
		attestation: NewDeviceAttestation(),
		deviceID:    deviceID,
	}, nil
}

// EstablishChannel establishes a secure channel with a peer
func (ssc *SecureSyncChannel) EstablishChannel(peerDeviceID string, peerPublicKey []byte) error {
	// Derive shared key
	sharedKey, err := ssc.keyExchange.DeriveSharedKey(peerDeviceID, peerPublicKey)
	if err != nil {
		return err
	}

	// Import shared key for encryption
	keyID := fmt.Sprintf("shared-%s-%s", ssc.deviceID, peerDeviceID)
	return ssc.encryptor.ImportKey(keyID, sharedKey, &KeyInfo{
		ID:        keyID,
		Algorithm: "AES-256-GCM",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().AddDate(0, 0, 7), // 7 days
		Active:    true,
	})
}

// SendSecure encrypts and sends data securely
func (ssc *SecureSyncChannel) SendSecure(data interface{}) (*EncryptedPayload, error) {
	return ssc.encryptor.EncryptJSON(data)
}

// ReceiveSecure decrypts received data
func (ssc *SecureSyncChannel) ReceiveSecure(payload *EncryptedPayload, target interface{}) error {
	// Verify device is trusted
	if payload.DeviceID != "" && !ssc.attestation.IsTrusted(payload.DeviceID) {
		return fmt.Errorf("untrusted device: %s", payload.DeviceID)
	}

	return ssc.encryptor.DecryptJSON(payload, target)
}

// GetPublicKey returns the public key for key exchange
func (ssc *SecureSyncChannel) GetPublicKey() []byte {
	return ssc.keyExchange.GetPublicKey()
}

// RegisterDevice registers a device for attestation
func (ssc *SecureSyncChannel) RegisterDevice(info *DeviceInfo) error {
	return ssc.attestation.RegisterDevice(info)
}

// VerifyDevice verifies a device
func (ssc *SecureSyncChannel) VerifyDevice(deviceID string, token []byte) error {
	return ssc.attestation.VerifyDevice(deviceID, token)
}

// RotateKeys rotates encryption keys
func (ssc *SecureSyncChannel) RotateKeys() error {
	return ssc.encryptor.RotateKey()
}
