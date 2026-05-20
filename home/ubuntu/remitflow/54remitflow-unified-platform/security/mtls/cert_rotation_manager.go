// Package mtls provides mTLS certificate management with automatic rotation
package mtls

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// CertRotationConfig holds configuration for certificate rotation
type CertRotationConfig struct {
	// Certificate paths
	CertDir        string
	CACertPath     string
	CAKeyPath      string
	ServiceCertPath string
	ServiceKeyPath  string

	// Rotation settings
	CertValidityDays    int
	RotationThresholdDays int
	CheckIntervalMinutes int

	// Service identity
	ServiceName string
	ServiceDNS  []string
	ServiceIPs  []net.IP

	// Vault integration (optional)
	VaultEnabled  bool
	VaultAddr     string
	VaultRole     string
	VaultPKIPath  string
}

// DefaultConfig returns default configuration
func DefaultConfig() *CertRotationConfig {
	return &CertRotationConfig{
		CertDir:              os.Getenv("CERT_DIR"),
		CACertPath:           os.Getenv("CA_CERT_PATH"),
		CAKeyPath:            os.Getenv("CA_KEY_PATH"),
		ServiceCertPath:      os.Getenv("SERVICE_CERT_PATH"),
		ServiceKeyPath:       os.Getenv("SERVICE_KEY_PATH"),
		CertValidityDays:     30,
		RotationThresholdDays: 7,
		CheckIntervalMinutes: 60,
		ServiceName:          os.Getenv("SERVICE_NAME"),
		VaultEnabled:         os.Getenv("VAULT_ENABLED") == "true",
		VaultAddr:            os.Getenv("VAULT_ADDR"),
		VaultRole:            os.Getenv("VAULT_ROLE"),
		VaultPKIPath:         os.Getenv("VAULT_PKI_PATH"),
	}
}

// CertRotationManager manages mTLS certificates with automatic rotation
type CertRotationManager struct {
	config     *CertRotationConfig
	mu         sync.RWMutex
	tlsConfig  *tls.Config
	cert       *tls.Certificate
	caCertPool *x509.CertPool
	stopCh     chan struct{}
	callbacks  []func(*tls.Certificate)
}

// NewCertRotationManager creates a new certificate rotation manager
func NewCertRotationManager(config *CertRotationConfig) (*CertRotationManager, error) {
	if config == nil {
		config = DefaultConfig()
	}

	manager := &CertRotationManager{
		config:    config,
		stopCh:    make(chan struct{}),
		callbacks: make([]func(*tls.Certificate), 0),
	}

	// Load CA certificate pool
	if err := manager.loadCACertPool(); err != nil {
		return nil, fmt.Errorf("failed to load CA cert pool: %w", err)
	}

	// Load or generate service certificate
	if err := manager.loadOrGenerateCert(); err != nil {
		return nil, fmt.Errorf("failed to load/generate cert: %w", err)
	}

	// Create TLS config
	manager.tlsConfig = manager.createTLSConfig()

	return manager, nil
}

// loadCACertPool loads the CA certificate pool
func (m *CertRotationManager) loadCACertPool() error {
	m.caCertPool = x509.NewCertPool()

	// Load from file if specified
	if m.config.CACertPath != "" {
		caCert, err := os.ReadFile(m.config.CACertPath)
		if err != nil {
			return fmt.Errorf("failed to read CA cert: %w", err)
		}
		if !m.caCertPool.AppendCertsFromPEM(caCert) {
			return fmt.Errorf("failed to parse CA cert")
		}
	}

	// Also load system CAs
	systemPool, err := x509.SystemCertPool()
	if err == nil && systemPool != nil {
		for _, cert := range systemPool.Subjects() {
			m.caCertPool.AppendCertsFromPEM(cert)
		}
	}

	return nil
}

// loadOrGenerateCert loads existing cert or generates a new one
func (m *CertRotationManager) loadOrGenerateCert() error {
	// Try to load existing certificate
	if m.config.ServiceCertPath != "" && m.config.ServiceKeyPath != "" {
		cert, err := tls.LoadX509KeyPair(m.config.ServiceCertPath, m.config.ServiceKeyPath)
		if err == nil {
			// Check if cert needs rotation
			if !m.needsRotation(&cert) {
				m.cert = &cert
				log.Printf("Loaded existing certificate for %s", m.config.ServiceName)
				return nil
			}
			log.Printf("Certificate needs rotation for %s", m.config.ServiceName)
		}
	}

	// Generate new certificate
	return m.rotateCertificate()
}

// needsRotation checks if certificate needs rotation
func (m *CertRotationManager) needsRotation(cert *tls.Certificate) bool {
	if cert == nil || len(cert.Certificate) == 0 {
		return true
	}

	x509Cert, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return true
	}

	// Check if cert expires within threshold
	threshold := time.Now().Add(time.Duration(m.config.RotationThresholdDays) * 24 * time.Hour)
	return x509Cert.NotAfter.Before(threshold)
}

// rotateCertificate generates a new certificate
func (m *CertRotationManager) rotateCertificate() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	log.Printf("Rotating certificate for %s", m.config.ServiceName)

	var cert *tls.Certificate
	var err error

	if m.config.VaultEnabled {
		cert, err = m.generateCertFromVault()
	} else {
		cert, err = m.generateSelfSignedCert()
	}

	if err != nil {
		return fmt.Errorf("failed to generate certificate: %w", err)
	}

	// Save certificate to disk
	if err := m.saveCertificate(cert); err != nil {
		return fmt.Errorf("failed to save certificate: %w", err)
	}

	m.cert = cert

	// Notify callbacks
	for _, callback := range m.callbacks {
		go callback(cert)
	}

	log.Printf("Certificate rotated successfully for %s", m.config.ServiceName)
	return nil
}

// generateSelfSignedCert generates a self-signed certificate
func (m *CertRotationManager) generateSelfSignedCert() (*tls.Certificate, error) {
	// Generate private key
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate private key: %w", err)
	}

	// Generate serial number
	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("failed to generate serial number: %w", err)
	}

	// Certificate template
	notBefore := time.Now()
	notAfter := notBefore.Add(time.Duration(m.config.CertValidityDays) * 24 * time.Hour)

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization:       []string{"Remittance Platform"},
			OrganizationalUnit: []string{"Services"},
			CommonName:         m.config.ServiceName,
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
		DNSNames:              m.config.ServiceDNS,
		IPAddresses:           m.config.ServiceIPs,
	}

	// Add localhost for development
	if len(template.DNSNames) == 0 {
		template.DNSNames = []string{"localhost", m.config.ServiceName}
	}
	if len(template.IPAddresses) == 0 {
		template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	}

	// Load CA for signing if available
	var caCert *x509.Certificate
	var caKey interface{}

	if m.config.CAKeyPath != "" && m.config.CACertPath != "" {
		caCertPEM, err := os.ReadFile(m.config.CACertPath)
		if err == nil {
			block, _ := pem.Decode(caCertPEM)
			if block != nil {
				caCert, _ = x509.ParseCertificate(block.Bytes)
			}
		}

		caKeyPEM, err := os.ReadFile(m.config.CAKeyPath)
		if err == nil {
			block, _ := pem.Decode(caKeyPEM)
			if block != nil {
				caKey, _ = x509.ParseECPrivateKey(block.Bytes)
				if caKey == nil {
					caKey, _ = x509.ParsePKCS8PrivateKey(block.Bytes)
				}
			}
		}
	}

	// Sign certificate
	var certDER []byte
	if caCert != nil && caKey != nil {
		certDER, err = x509.CreateCertificate(rand.Reader, &template, caCert, &privateKey.PublicKey, caKey)
	} else {
		// Self-signed
		certDER, err = x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create certificate: %w", err)
	}

	// Encode to PEM
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyDER, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal private key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	// Create tls.Certificate
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to create X509 key pair: %w", err)
	}

	return &cert, nil
}

// generateCertFromVault generates a certificate using HashiCorp Vault PKI
func (m *CertRotationManager) generateCertFromVault() (*tls.Certificate, error) {
	// This would integrate with Vault PKI secrets engine
	// For now, fall back to self-signed
	log.Printf("Vault PKI integration not fully implemented, using self-signed cert")
	return m.generateSelfSignedCert()
}

// saveCertificate saves certificate to disk
func (m *CertRotationManager) saveCertificate(cert *tls.Certificate) error {
	if m.config.ServiceCertPath == "" || m.config.ServiceKeyPath == "" {
		return nil // No paths configured, skip saving
	}

	// Ensure directory exists
	certDir := filepath.Dir(m.config.ServiceCertPath)
	if err := os.MkdirAll(certDir, 0755); err != nil {
		return fmt.Errorf("failed to create cert directory: %w", err)
	}

	// Get certificate PEM
	x509Cert, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return fmt.Errorf("failed to parse certificate: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: x509Cert.Raw})

	// Get key PEM
	var keyPEM []byte
	switch key := cert.PrivateKey.(type) {
	case *ecdsa.PrivateKey:
		keyDER, err := x509.MarshalECPrivateKey(key)
		if err != nil {
			return fmt.Errorf("failed to marshal EC private key: %w", err)
		}
		keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	default:
		keyDER, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return fmt.Errorf("failed to marshal private key: %w", err)
		}
		keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	}

	// Write certificate
	if err := os.WriteFile(m.config.ServiceCertPath, certPEM, 0644); err != nil {
		return fmt.Errorf("failed to write certificate: %w", err)
	}

	// Write key with restricted permissions
	if err := os.WriteFile(m.config.ServiceKeyPath, keyPEM, 0600); err != nil {
		return fmt.Errorf("failed to write private key: %w", err)
	}

	return nil
}

// createTLSConfig creates a TLS configuration with the current certificate
func (m *CertRotationManager) createTLSConfig() *tls.Config {
	return &tls.Config{
		GetCertificate: func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
			m.mu.RLock()
			defer m.mu.RUnlock()
			return m.cert, nil
		},
		GetClientCertificate: func(info *tls.CertificateRequestInfo) (*tls.Certificate, error) {
			m.mu.RLock()
			defer m.mu.RUnlock()
			return m.cert, nil
		},
		ClientCAs:  m.caCertPool,
		RootCAs:    m.caCertPool,
		ClientAuth: tls.RequireAndVerifyClientCert,
		MinVersion: tls.VersionTLS12,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		},
	}
}

// GetTLSConfig returns the current TLS configuration
func (m *CertRotationManager) GetTLSConfig() *tls.Config {
	return m.tlsConfig
}

// GetServerTLSConfig returns TLS config for servers
func (m *CertRotationManager) GetServerTLSConfig() *tls.Config {
	config := m.createTLSConfig()
	config.ClientAuth = tls.RequireAndVerifyClientCert
	return config
}

// GetClientTLSConfig returns TLS config for clients
func (m *CertRotationManager) GetClientTLSConfig() *tls.Config {
	config := m.createTLSConfig()
	config.ClientAuth = tls.NoClientCert
	return config
}

// OnRotation registers a callback for certificate rotation events
func (m *CertRotationManager) OnRotation(callback func(*tls.Certificate)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callbacks = append(m.callbacks, callback)
}

// Start begins the automatic rotation check loop
func (m *CertRotationManager) Start(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(m.config.CheckIntervalMinutes) * time.Minute)
	defer ticker.Stop()

	log.Printf("Starting certificate rotation manager for %s (check interval: %d minutes)",
		m.config.ServiceName, m.config.CheckIntervalMinutes)

	for {
		select {
		case <-ctx.Done():
			log.Printf("Certificate rotation manager stopped for %s", m.config.ServiceName)
			return
		case <-m.stopCh:
			log.Printf("Certificate rotation manager stopped for %s", m.config.ServiceName)
			return
		case <-ticker.C:
			m.mu.RLock()
			needsRotation := m.needsRotation(m.cert)
			m.mu.RUnlock()

			if needsRotation {
				if err := m.rotateCertificate(); err != nil {
					log.Printf("Failed to rotate certificate: %v", err)
				}
			}
		}
	}
}

// Stop stops the rotation manager
func (m *CertRotationManager) Stop() {
	close(m.stopCh)
}

// ForceRotation forces immediate certificate rotation
func (m *CertRotationManager) ForceRotation() error {
	return m.rotateCertificate()
}

// GetCertificateInfo returns information about the current certificate
func (m *CertRotationManager) GetCertificateInfo() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.cert == nil || len(m.cert.Certificate) == 0 {
		return map[string]interface{}{"status": "no certificate"}
	}

	x509Cert, err := x509.ParseCertificate(m.cert.Certificate[0])
	if err != nil {
		return map[string]interface{}{"status": "invalid certificate", "error": err.Error()}
	}

	return map[string]interface{}{
		"subject":      x509Cert.Subject.CommonName,
		"issuer":       x509Cert.Issuer.CommonName,
		"serial":       x509Cert.SerialNumber.String(),
		"not_before":   x509Cert.NotBefore,
		"not_after":    x509Cert.NotAfter,
		"dns_names":    x509Cert.DNSNames,
		"ip_addresses": x509Cert.IPAddresses,
		"needs_rotation": m.needsRotation(m.cert),
	}
}

// mTLS HTTP client helper
type MTLSClient struct {
	manager *CertRotationManager
}

// NewMTLSClient creates a new mTLS HTTP client
func NewMTLSClient(manager *CertRotationManager) *MTLSClient {
	return &MTLSClient{manager: manager}
}

// GetHTTPTransport returns an HTTP transport configured for mTLS
func (c *MTLSClient) GetHTTPTransport() *http.Transport {
	return &http.Transport{
		TLSClientConfig: c.manager.GetClientTLSConfig(),
	}
}

// Import for http.Transport
import "net/http"
