package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func testRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(traceTenantMiddleware())
	r.GET("/healthz", healthz)
	r.POST("/returns/build", buildHandler)
	r.POST("/returns/submit", submitHandler)
	r.GET("/returns/status/:id", statusHandler)
	return r
}

func TestHealthz(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("healthz: got %d", w.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("healthz body: %v", err)
	}
	if body["service"] != SERVICE_NAME || body["status"] != "ok" {
		t.Errorf("unexpected healthz body: %v", body)
	}
}

func TestBuildHandlerUnknownType(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/returns/build",
		strings.NewReader(`{"tenantId":1,"returnType":"bogus","periodStart":"2026-09-01","periodEnd":"2026-09-07"}`))
	req.Header.Set("Content-Type", "application/json")
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown returnType: got %d, want 400", w.Code)
	}
}

func TestBuildHandlerFixtureMetadata(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/returns/build",
		strings.NewReader(`{"tenantId":42,"returnType":"extranet","periodStart":"2026-09-01","periodEnd":"2026-09-07","data":{"branches":[{"branchCode":"BR-1","stateCode":"LA"}]}}`))
	req.Header.Set("Content-Type", "application/json")
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("build: got %d body=%s", w.Code, w.Body.String())
	}
	var resp BuildResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse build response: %v", err)
	}
	if resp.FormatVersion != FixtureFormatVersion {
		t.Errorf("formatVersion = %q, want %q", resp.FormatVersion, FixtureFormatVersion)
	}
	notice := resp.Metadata["fixtureNotice"]
	if !strings.Contains(notice, "NOT CBN-conformance") {
		t.Errorf("fixtureNotice missing honest-adapter disclaimer: %q", notice)
	}
	// Trace header propagation.
	if w.Header().Get("X-Trace-Id") == "" {
		t.Error("expected X-Trace-Id response header")
	}
}

// TestSubmitSandbox: sandbox mode must return an explicit simulated marker.
func TestSubmitSandbox(t *testing.T) {
	returnsMode = "sandbox"
	defer func() { returnsMode = "sandbox" }()

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/returns/submit",
		strings.NewReader(`{"returnType":"fifx","payload":{"header":{"returnType":"fifx"}}}`))
	req.Header.Set("Content-Type", "application/json")
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("sandbox submit: got %d body=%s", w.Code, w.Body.String())
	}
	var resp SubmitResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse submit response: %v", err)
	}
	if !resp.Simulated {
		t.Error("sandbox submit must set simulated=true")
	}
	if !strings.HasPrefix(resp.AckRef, "SIM-") {
		t.Errorf("sandbox ackRef = %q, want SIM- prefix", resp.AckRef)
	}

	// Status endpoint must serve the stored record.
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/returns/status/"+resp.ID, nil)
	testRouter().ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("status: got %d body=%s", w2.Code, w2.Body.String())
	}
	var rec SubmissionRecord
	if err := json.Unmarshal(w2.Body.Bytes(), &rec); err != nil {
		t.Fatalf("parse status response: %v", err)
	}
	if rec.ID != resp.ID || !rec.Simulated || rec.AckRef != resp.AckRef {
		t.Errorf("status record mismatch: %+v", rec)
	}
}

// TestSubmitProductionWithoutCredentials: honest fail-closed 503.
func TestSubmitProductionWithoutCredentials(t *testing.T) {
	returnsMode = "production"
	extranetBaseURL = ""
	extranetToken = ""
	defer func() { returnsMode = "sandbox" }()

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/returns/submit",
		strings.NewReader(`{"returnType":"trms","payload":{"header":{"returnType":"trms"}}}`))
	req.Header.Set("Content-Type", "application/json")
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("production w/o creds: got %d, want 503", w.Code)
	}
	var resp errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse error response: %v", err)
	}
	if resp.Error != "UNAVAILABLE" || resp.Reason != "credentials not configured" {
		t.Errorf("unexpected error body: %+v", resp)
	}
}

func TestStatusNotFound(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/returns/status/RET-does-not-exist", nil)
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status 404: got %d", w.Code)
	}
}
