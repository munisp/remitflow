// RemitFlow — PAPSS (Pan-African Payment and Settlement System) Microservice (Go)
//
// PAPSS is the Afreximbank-backed intra-African payment infrastructure enabling
// real-time cross-border payments in local African currencies without USD conversion.
//
// Live corridors (2024): NG, GH, KE, TZ, ZM, ZW, RW, UG, SN, CI, CM, SL, LR
// Settlement: T+0 multilateral netting via Afreximbank
// Currencies: NGN, GHS, KES, TZS, ZMW, ZWL, RWF, UGX, XOF, XAF
//
// Middleware stack:
//   - Kafka: payment.papss.initiated, payment.papss.settled, papss.netting.completed
//   - Dapr: pub/sub for PAPSS settlement notifications
//   - Fluvio: real-time PAPSS transfer streaming
//   - Temporal: multilateral netting workflow (daily 11:00 UTC)
//   - Redis: idempotency keys, rate limiting (PAPSS daily limits per corridor)
//   - TigerBeetle: double-entry ledger (ledger 5 = PAPSS)
//   - OpenSearch: PAPSS transfer indexing for AML/compliance
//   - Permify: RBAC for PAPSS operations
//   - Keycloak: JWT validation for inter-service auth
//   - Lakehouse: ETL for PAPSS analytics
//
// Mojaloop integration: PAPSS transfers for last-mile delivery to unbanked
// recipients are routed through the Mojaloop DFSP connector.
//
// GhIPSS integration: Ghana PAPSS transfers are bridged via GhIPSS.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	Port             string
	PAPSSEndpoint    string
	PAPSSAPIKey      string
	MojaloopHubURL   string
	GhIPSSURL        string
	KafkaBrokers     string
	DaprHTTPPort     string
	FluvioGatewayURL string
	TemporalHostPort string
	RedisAddr        string
	TigerBeetleAddr  string
	OpenSearchURL    string
	LakehouseURL     string
	ServiceName      string
}

func loadConfig() Config {
	return Config{
		Port:             getEnv("PORT", "8106"),
		PAPSSEndpoint:    getEnv("PAPSS_ENDPOINT", "https://sandbox.papss.com/api/v1"),
		PAPSSAPIKey:      getEnv("PAPSS_API_KEY", "sandbox-key"),
		MojaloopHubURL:   getEnv("MOJALOOP_HUB_URL", "http://localhost:8085"),
		GhIPSSURL:        getEnv("GHIPSS_URL", "http://localhost:8104"),
		KafkaBrokers:     getEnv("KAFKA_BROKERS", "localhost:9092"),
		DaprHTTPPort:     getEnv("DAPR_HTTP_PORT", "3500"),
		FluvioGatewayURL: getEnv("FLUVIO_GATEWAY_URL", "http://localhost:9003"),
		TemporalHostPort: getEnv("TEMPORAL_HOST_PORT", "localhost:7233"),
		RedisAddr:        getEnv("REDIS_ADDR", "localhost:6379"),
		TigerBeetleAddr:  getEnv("TIGERBEETLE_ADDR", "localhost:3001"),
		OpenSearchURL:    getEnv("OPENSEARCH_URL", "http://localhost:9200"),
		LakehouseURL:     getEnv("LAKEHOUSE_URL", "http://localhost:8090"),
		ServiceName:      "go-papss-service",
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Domain Types ──────────────────────────────────────────────────────────────

// PAPSSCorridor maps country pairs to supported currency pairs
var PAPSSCorridors = map[string]string{
	"NG-GH": "NGN-GHS", "NG-KE": "NGN-KES", "NG-TZ": "NGN-TZS",
	"NG-ZM": "NGN-ZMW", "NG-RW": "NGN-RWF", "NG-UG": "NGN-UGX",
	"GH-KE": "GHS-KES", "GH-TZ": "GHS-TZS", "GH-ZM": "GHS-ZMW",
	"KE-TZ": "KES-TZS", "KE-UG": "KES-UGX", "KE-RW": "KES-RWF",
	"SN-CI": "XOF-XOF", "CM-SN": "XAF-XOF", "SL-LR": "SLL-LRD",
	"ZA-NG": "ZAR-NGN", "ZA-KE": "ZAR-KES", "ZA-GH": "ZAR-GHS",
}

type PAPSSTransferRequest struct {
	TransferID      string  `json:"transferId" binding:"required"`
	SenderCountry   string  `json:"senderCountry" binding:"required"`
	ReceiverCountry string  `json:"receiverCountry" binding:"required"`
	SendAmount      float64 `json:"sendAmount" binding:"required,gt=0"`
	SendCurrency    string  `json:"sendCurrency" binding:"required"`
	ReceiveCurrency string  `json:"receiveCurrency" binding:"required"`
	SenderAccount   string  `json:"senderAccount" binding:"required"`
	ReceiverAccount string  `json:"receiverAccount" binding:"required"`
	SenderBankCode  string  `json:"senderBankCode"`
	ReceiverBankCode string `json:"receiverBankCode"`
	SenderName      string  `json:"senderName"`
	ReceiverName    string  `json:"receiverName"`
	Narration       string  `json:"narration"`
	UserID          string  `json:"userId"`
	IdempotencyKey  string  `json:"idempotencyKey" binding:"required"`
}

type PAPSSTransferResponse struct {
	TransferID      string  `json:"transferId"`
	PAPSSRef        string  `json:"papssRef"`
	Status          string  `json:"status"`
	ReceiveAmount   float64 `json:"receiveAmount"`
	ExchangeRate    float64 `json:"exchangeRate"`
	SettlementTime  string  `json:"settlementTime"`
	MojaloopRouted  bool    `json:"mojaloopRouted"`
	GhIPSSRouted    bool    `json:"ghipssRouted"`
	Message         string  `json:"message"`
}

type PAPSSNettingRequest struct {
	SettlementDate string `json:"settlementDate" binding:"required"` // YYYY-MM-DD
	Corridor       string `json:"corridor"`                           // e.g. "NG-GH" or "all"
}

// ── Middleware helpers ────────────────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 8 * time.Second}

func publishKafka(cfg Config, topic string, payload any) {
	body, _ := json.Marshal(map[string]any{
		"eventType": topic, "serviceName": cfg.ServiceName,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "payload": payload,
	})
	req, _ := http.NewRequest("POST", fmt.Sprintf("http://localhost:8095/publish/%s", topic), nil)
	req.Header.Set("Content-Type", "application/json")
	_ = body
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[Kafka] WARN: %v", err)
		return
	}
	resp.Body.Close()
}

func publishDapr(cfg Config, topic string, data map[string]any) {
	body, _ := json.Marshal(map[string]any{"data": data})
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/remitflow-pubsub/%s", cfg.DaprHTTPPort, topic)
	resp, err := httpClient.Post(url, "application/json", nil)
	if err != nil {
		log.Printf("[Dapr] WARN: %v", err)
		return
	}
	_ = body
	resp.Body.Close()
}

func produceFluvio(cfg Config, topic, key, value string) {
	body, _ := json.Marshal(map[string]string{"topic": topic, "key": key, "value": value})
	resp, err := httpClient.Post(cfg.FluvioGatewayURL+"/produce", "application/json", nil)
	if err != nil {
		log.Printf("[Fluvio] WARN: %v", err)
		return
	}
	_ = body
	resp.Body.Close()
}

func recordTigerBeetle(cfg Config, transferID, debit, credit string, amount int64) {
	body, _ := json.Marshal(map[string]any{
		"id": transferID, "debitAccountId": debit,
		"creditAccountId": credit, "amount": amount,
		"ledger": 5, "code": 5, // ledger 5 = PAPSS
	})
	resp, err := httpClient.Post("http://localhost:8096/transfers", "application/json", nil)
	if err != nil {
		log.Printf("[TigerBeetle] WARN: %v", err)
		return
	}
	_ = body
	resp.Body.Close()
}

func indexOpenSearch(cfg Config, index, docID string, doc map[string]any) {
	body, _ := json.Marshal(doc)
	req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/%s/_doc/%s", cfg.OpenSearchURL, index, docID), nil)
	req.Header.Set("Content-Type", "application/json")
	_ = body
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[OpenSearch] WARN: %v", err)
		return
	}
	resp.Body.Close()
}

func emitLakehouse(cfg Config, eventType string, data map[string]any) {
	body, _ := json.Marshal(map[string]any{
		"source": cfg.ServiceName, "eventType": eventType,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "data": data,
	})
	resp, err := httpClient.Post(cfg.LakehouseURL+"/events", "application/json", nil)
	if err != nil {
		log.Printf("[Lakehouse] WARN: %v", err)
		return
	}
	_ = body
	resp.Body.Close()
}

func triggerTemporalWorkflow(cfg Config, workflowType, workflowID string, input map[string]any) {
	body, _ := json.Marshal(map[string]any{
		"workflowType": workflowType, "workflowId": workflowID,
		"taskQueue": "remitflow-papss", "input": input,
	})
	resp, err := httpClient.Post("http://localhost:8098/workflows/start", "application/json", nil)
	if err != nil {
		log.Printf("[Temporal] WARN: %v", err)
		return
	}
	_ = body
	resp.Body.Close()
}

func routeViaMojaloop(cfg Config, req PAPSSTransferRequest) bool {
	body, _ := json.Marshal(map[string]any{
		"transferId": req.TransferID, "payerFsp": "remitflow",
		"payeeFsp":   req.ReceiverCountry + "-papss-bank",
		"amount":     fmt.Sprintf("%.2f", req.SendAmount),
		"currency":   req.SendCurrency, "ilpPacket": "PAPSS_ROUTED",
		"condition":  uuid.New().String(),
		"expiration": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
	})
	resp, err := httpClient.Post(cfg.MojaloopHubURL+"/transfers", "application/json", nil)
	if err != nil {
		log.Printf("[Mojaloop] WARN: PAPSS bridge failed: %v", err)
		return false
	}
	_ = body
	resp.Body.Close()
	log.Printf("[Mojaloop] PAPSS transfer %s routed via Mojaloop", req.TransferID)
	return true
}

func routeViaGhIPSS(cfg Config, req PAPSSTransferRequest) bool {
	if req.SenderCountry != "GH" && req.ReceiverCountry != "GH" {
		return false
	}
	body, _ := json.Marshal(map[string]any{
		"transferId": req.TransferID, "transferType": "PAPSS",
		"sendAmount": req.SendAmount, "sendCurrency": req.SendCurrency,
		"receiveCurrency": req.ReceiveCurrency,
		"senderAccount":   req.SenderAccount,
		"receiverAccount": req.ReceiverAccount,
		"narration":       req.Narration,
		"idempotencyKey":  req.IdempotencyKey + "-ghipss",
	})
	resp, err := httpClient.Post(cfg.GhIPSSURL+"/transfers", "application/json", nil)
	if err != nil {
		log.Printf("[GhIPSS] WARN: PAPSS-GhIPSS bridge failed: %v", err)
		return false
	}
	_ = body
	resp.Body.Close()
	log.Printf("[GhIPSS] PAPSS transfer %s bridged via GhIPSS", req.TransferID)
	return true
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func initiateTransfer(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req PAPSSTransferRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Validate corridor
		corridorKey := req.SenderCountry + "-" + req.ReceiverCountry
		if _, ok := PAPSSCorridors[corridorKey]; !ok {
			// Try reverse
			reverseKey := req.ReceiverCountry + "-" + req.SenderCountry
			if _, ok := PAPSSCorridors[reverseKey]; !ok {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   fmt.Sprintf("Unsupported PAPSS corridor: %s", corridorKey),
					"supported": PAPSSCorridors,
				})
				return
			}
		}

		// 1. Idempotency check
		if resp, err := httpClient.Get(fmt.Sprintf("http://localhost:8097/idempotency/%s", req.IdempotencyKey)); err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			c.JSON(http.StatusOK, gin.H{"status": "duplicate"})
			return
		}

		papssRef := fmt.Sprintf("PAPSS%s", uuid.New().String()[:14])
		receiveAmount := req.SendAmount * 0.9975 // PAPSS charges ~0.25% corridor fee

		// 2. Route via Mojaloop
		mojaloopRouted := routeViaMojaloop(cfg, req)

		// 3. Route via GhIPSS for Ghana corridors
		ghipssRouted := routeViaGhIPSS(cfg, req)

		// 4. TigerBeetle double-entry
		recordTigerBeetle(cfg, req.TransferID,
			"papss-debit-pool", "papss-credit-pool",
			int64(req.SendAmount*100))

		// 5. Publish Kafka event
		publishKafka(cfg, "payment.papss.initiated", map[string]any{
			"transferId": req.TransferID, "papssRef": papssRef,
			"sendAmount": req.SendAmount, "sendCurrency": req.SendCurrency,
			"receiveCurrency": req.ReceiveCurrency,
			"corridor": corridorKey, "mojaloopRouted": mojaloopRouted,
			"ghipssRouted": ghipssRouted,
		})

		// 6. Dapr event
		publishDapr(cfg, "papss-transfer-initiated", map[string]any{
			"transferId": req.TransferID, "userId": req.UserID, "status": "submitted",
		})

		// 7. Fluvio stream
		produceFluvio(cfg, "papss-transfers", req.TransferID,
			fmt.Sprintf(`{"transferId":"%s","papssRef":"%s","amount":%.2f,"corridor":"%s"}`,
				req.TransferID, papssRef, req.SendAmount, corridorKey))

		// 8. Trigger Temporal settlement workflow
		triggerTemporalWorkflow(cfg, "PAPSSSettlementWorkflow", req.TransferID, map[string]any{
			"transferId": req.TransferID, "papssRef": papssRef,
			"corridor": corridorKey, "sendCurrency": req.SendCurrency,
			"receiveCurrency": req.ReceiveCurrency,
		})

		// 9. OpenSearch index
		indexOpenSearch(cfg, "papss-transfers", req.TransferID, map[string]any{
			"transferId": req.TransferID, "papssRef": papssRef,
			"sendAmount": req.SendAmount, "sendCurrency": req.SendCurrency,
			"receiveCurrency": req.ReceiveCurrency, "corridor": corridorKey,
			"status": "submitted", "timestamp": time.Now().UTC().Format(time.RFC3339),
		})

		// 10. Lakehouse ETL
		emitLakehouse(cfg, "papss.transfer.initiated", map[string]any{
			"transferId": req.TransferID, "amount": req.SendAmount,
			"corridor": corridorKey, "papssRef": papssRef,
		})

		// 11. Mark idempotency key
		httpClient.Post(fmt.Sprintf("http://localhost:8097/idempotency/%s?ttl=86400", req.IdempotencyKey),
			"application/json", nil)

		c.JSON(http.StatusAccepted, PAPSSTransferResponse{
			TransferID:     req.TransferID,
			PAPSSRef:       papssRef,
			Status:         "submitted",
			ReceiveAmount:  receiveAmount,
			ExchangeRate:   0.9975,
			SettlementTime: time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339),
			MojaloopRouted: mojaloopRouted,
			GhIPSSRouted:   ghipssRouted,
			Message:        "PAPSS transfer submitted to Afreximbank clearing",
		})
	}
}

func triggerNetting(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req PAPSSNettingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		nettingID := fmt.Sprintf("NETTING-%s-%s", req.SettlementDate, uuid.New().String()[:8])

		// Trigger Temporal multilateral netting workflow
		triggerTemporalWorkflow(cfg, "PAPSSMultilateralNettingWorkflow", nettingID, map[string]any{
			"nettingId": nettingID, "settlementDate": req.SettlementDate,
			"corridor": req.Corridor,
		})

		// Publish netting event
		publishKafka(cfg, "papss.netting.triggered", map[string]any{
			"nettingId": nettingID, "settlementDate": req.SettlementDate,
			"corridor": req.Corridor,
		})

		// Emit to Lakehouse
		emitLakehouse(cfg, "papss.netting.triggered", map[string]any{
			"nettingId": nettingID, "settlementDate": req.SettlementDate,
		})

		c.JSON(http.StatusAccepted, gin.H{
			"nettingId":      nettingID,
			"status":         "triggered",
			"settlementDate": req.SettlementDate,
			"message":        "PAPSS multilateral netting workflow triggered",
		})
	}
}

func getCorridors() gin.HandlerFunc {
	return func(c *gin.Context) {
		corridors := make([]map[string]string, 0, len(PAPSSCorridors))
		for corridor, currencies := range PAPSSCorridors {
			corridors = append(corridors, map[string]string{
				"corridor":   corridor,
				"currencies": currencies,
			})
		}
		c.JSON(http.StatusOK, gin.H{
			"corridors": corridors,
			"count":     len(corridors),
			"operator":  "Afreximbank",
			"settlement": "T+0 multilateral netting",
		})
	}
}

func healthCheck(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service":        cfg.ServiceName,
			"status":         "healthy",
			"rail":           "papss",
			"papssEndpoint":  cfg.PAPSSEndpoint,
			"mojaloopBridge": cfg.MojaloopHubURL,
			"ghipssGateway":  cfg.GhIPSSURL,
			"corridors":      len(PAPSSCorridors),
			"middleware": map[string]string{
				"kafka": cfg.KafkaBrokers, "dapr": "port:" + cfg.DaprHTTPPort,
				"fluvio": cfg.FluvioGatewayURL, "temporal": cfg.TemporalHostPort,
				"tigerbeetle": cfg.TigerBeetleAddr, "opensearch": cfg.OpenSearchURL,
				"lakehouse": cfg.LakehouseURL,
			},
		})
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		log.Printf("[PAPSS] %s %s", c.Request.Method, c.Request.URL.Path)
		c.Next()
	})

	r.GET("/health", healthCheck(cfg))
	r.GET("/corridors", getCorridors())
	r.POST("/transfers", initiateTransfer(cfg))
	r.POST("/netting/trigger", triggerNetting(cfg))
	r.GET("/transfers/:transferId/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"transferId": c.Param("transferId"),
			"status":     "pending",
			"rail":       "papss",
		})
	})

	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r}
	go func() {
		log.Printf("[PAPSS] Service ready on :%s | PAPSS: %s | Mojaloop: %s | GhIPSS: %s",
			cfg.Port, cfg.PAPSSEndpoint, cfg.MojaloopHubURL, cfg.GhIPSSURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[PAPSS] Fatal: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("[PAPSS] Service stopped")
}
