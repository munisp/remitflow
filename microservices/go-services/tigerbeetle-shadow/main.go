// RemitFlow — TigerBeetle Shadow Ledger Service (Go)
// ═══════════════════════════════════════════════════
// Read-only shadow replica of the TigerBeetle cluster: serves account and
// transfer lookups for reconciliation dashboards and auditors without
// touching the write path. Talks to the REAL cluster via the official
// tigerbeetle-go client (v0.16.63, matching the deployed server image).
//
// Endpoints:
//   GET /health                  — real cluster round-trip probe
//   GET /shadow/accounts/{id}    — account lookup (decimal u128 id)
//   GET /shadow/transfers/{id}   — transfer lookup (decimal u128 id)
//
// Environment:
//   TIGERBEETLE_ADDRESSES   comma-separated replica host:port list (required)
//   TIGERBEETLE_CLUSTER_ID  cluster id (default 0)
//   PORT                    listen port (default 8086)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	tb "github.com/tigerbeetle/tigerbeetle-go"
	tb_types "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
)

const (
	serviceName    = "tigerbeetle-shadow"
	requestTimeout = 5 * time.Second
)

var (
	startTime = time.Now()
	client    tb.Client
)

// ─── 128-bit id helpers ──────────────────────────────────────────────────────
// tb_types.Uint128 is a [16]byte big-endian array; convert explicitly via
// math/big so decimal API ids round-trip exactly (no float, no truncation).

func parseUint128(s string) (tb_types.Uint128, error) {
	var zero tb_types.Uint128
	s = strings.TrimSpace(s)
	if s == "" {
		return zero, fmt.Errorf("empty id")
	}
	bi, ok := new(big.Int).SetString(s, 10)
	if !ok || bi.Sign() < 0 {
		return zero, fmt.Errorf("id %q is not a non-negative decimal integer", s)
	}
	if bi.BitLen() > 128 {
		return zero, fmt.Errorf("id %q overflows u128", s)
	}
	var raw [16]byte
	bi.FillBytes(raw[:])
	return tb_types.Uint128(raw), nil
}

func uint128ToString(u tb_types.Uint128) string {
	raw := [16]byte(u)
	return new(big.Int).SetBytes(raw[:]).String()
}

// ─── JSON views ──────────────────────────────────────────────────────────────

type accountView struct {
	ID             string `json:"id"`
	DebitsPending  string `json:"debits_pending"`
	DebitsPosted   string `json:"debits_posted"`
	CreditsPending string `json:"credits_pending"`
	CreditsPosted  string `json:"credits_posted"`
	UserData128    string `json:"user_data_128"`
	UserData64     uint64 `json:"user_data_64"`
	UserData32     uint32 `json:"user_data_32"`
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
	Timestamp      uint64 `json:"timestamp"`
}

type transferView struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          string `json:"amount"`
	PendingID       string `json:"pending_id"`
	UserData128     string `json:"user_data_128"`
	UserData64      uint64 `json:"user_data_64"`
	UserData32      uint32 `json:"user_data_32"`
	Timeout         uint32 `json:"timeout"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags"`
	Timestamp       uint64 `json:"timestamp"`
}

func toAccountView(a tb_types.Account) accountView {
	return accountView{
		ID:             uint128ToString(a.ID),
		DebitsPending:  uint128ToString(a.DebitsPending),
		DebitsPosted:   uint128ToString(a.DebitsPosted),
		CreditsPending: uint128ToString(a.CreditsPending),
		CreditsPosted:  uint128ToString(a.CreditsPosted),
		UserData128:    uint128ToString(a.UserData128),
		UserData64:     a.UserData64,
		UserData32:     a.UserData32,
		Ledger:         a.Ledger,
		Code:           a.Code,
		Flags:          a.Flags,
		Timestamp:      a.Timestamp,
	}
}

func toTransferView(t tb_types.Transfer) transferView {
	return transferView{
		ID:              uint128ToString(t.ID),
		DebitAccountID:  uint128ToString(t.DebitAccountID),
		CreditAccountID: uint128ToString(t.CreditAccountID),
		Amount:          uint128ToString(t.Amount),
		PendingID:       uint128ToString(t.PendingID),
		UserData128:     uint128ToString(t.UserData128),
		UserData64:      t.UserData64,
		UserData32:      t.UserData32,
		Timeout:         t.Timeout,
		Ledger:          t.Ledger,
		Code:            t.Code,
		Flags:           t.Flags,
		Timestamp:       t.Timestamp,
	}
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// health performs a REAL cluster round-trip (lookup of the nil id is a cheap
// no-op query that still exercises the wire protocol). Never hardcoded.
func health(w http.ResponseWriter, _ *http.Request) {
	probe := map[string]any{"service": serviceName, "uptime_seconds": int(time.Since(startTime).Seconds())}
	if client == nil {
		probe["status"] = "unhealthy"
		probe["tigerbeetle"] = map[string]any{"connected": false, "error": "client not initialized"}
		writeJSON(w, http.StatusServiceUnavailable, probe)
		return
	}
	start := time.Now()
	// Zero id never exists — an empty result still proves the cluster answered.
	_, err := client.LookupAccounts([]tb_types.Uint128{{}})
	latency := time.Since(start).Milliseconds()
	if err != nil {
		probe["status"] = "unhealthy"
		probe["tigerbeetle"] = map[string]any{"connected": false, "error": err.Error(), "latency_ms": latency}
		writeJSON(w, http.StatusServiceUnavailable, probe)
		return
	}
	probe["status"] = "healthy"
	probe["tigerbeetle"] = map[string]any{"connected": true, "latency_ms": latency}
	writeJSON(w, http.StatusOK, probe)
}

func shadowAccount(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := parseUint128(idStr)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	accounts, err := client.LookupAccounts([]tb_types.Uint128{id})
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("tigerbeetle lookup failed: %v", err))
		return
	}
	if len(accounts) == 0 {
		writeErr(w, http.StatusNotFound, fmt.Sprintf("account %s not found in cluster", idStr))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"account": toAccountView(accounts[0])})
}

func shadowTransfer(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := parseUint128(idStr)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	transfers, err := client.LookupTransfers([]tb_types.Uint128{id})
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("tigerbeetle lookup failed: %v", err))
		return
	}
	if len(transfers) == 0 {
		writeErr(w, http.StatusNotFound, fmt.Sprintf("transfer %s not found in cluster", idStr))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transfer": toTransferView(transfers[0])})
}

// ─── Main ────────────────────────────────────────────────────────────────────

func main() {
	// Fail loudly on misconfiguration — a shadow service without a cluster
	// address would serve nothing but errors anyway.
	addressesRaw := os.Getenv("TIGERBEETLE_ADDRESSES")
	if addressesRaw == "" {
		fmt.Fprintln(os.Stderr, "FATAL: TIGERBEETLE_ADDRESSES must be set (comma-separated host:port list)")
		os.Exit(1)
	}
	addresses := []string{}
	for _, a := range strings.Split(addressesRaw, ",") {
		if a = strings.TrimSpace(a); a != "" {
			addresses = append(addresses, a)
		}
	}
	if len(addresses) == 0 {
		fmt.Fprintln(os.Stderr, "FATAL: TIGERBEETLE_ADDRESSES is set but empty")
		os.Exit(1)
	}

	clusterID := tb_types.ToUint128(0)
	if v := os.Getenv("TIGERBEETLE_CLUSTER_ID"); v != "" {
		id, err := parseUint128(v)
		if err != nil {
			fmt.Fprintf(os.Stderr, "FATAL: invalid TIGERBEETLE_CLUSTER_ID: %v\n", err)
			os.Exit(1)
		}
		clusterID = id
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8086"
	}

	var err error
	client, err = tb.NewClient(clusterID, addresses)
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: cannot construct TigerBeetle client: %v\n", err)
		os.Exit(1)
	}
	defer client.Close()
	fmt.Printf(`{"event":"startup","service":%q,"cluster_addresses":%q}`+"\n", serviceName, addressesRaw)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)
	mux.HandleFunc("GET /shadow/accounts/{id}", shadowAccount)
	mux.HandleFunc("GET /shadow/transfers/{id}", shadowTransfer)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: requestTimeout,
	}

	go func() {
		fmt.Printf(`{"event":"listening","service":%q,"port":%q}`+"\n", serviceName, port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "FATAL: http server: %v\n", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	fmt.Printf(`{"event":"shutdown","service":%q}`+"\n", serviceName)
}
