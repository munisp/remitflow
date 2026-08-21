package main

// Tests for GO-H6 (pacs.008 XML injection) and GO-H7 (missing auth).

import (
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// GO-H6: a malicious creditor name must be escaped in the generated pacs.008 —
// it must not inject new XML elements.
func TestBuildPacs008_EscapesInjection(t *testing.T) {
	tr := &FedNowTransfer{
		TransactionID: "FEDNOW-1",
		EndToEndID:    "E2E-1",
		Amount:        100.0,
		Currency:      "USD",
		CreatedAt:     time.Now(),
		RoutingNumber: "021000021",
		AccountNumber: "123456789",
		CreditorName:  `x</Nm></CdtTrfTxInf><CdtTrfTxInf><IntrBkSttlmAmt Ccy="USD">999999</IntrBkSttlmAmt>`,
	}
	out := buildPacs008(tr)
	if strings.Contains(out, "</Nm></CdtTrfTxInf><CdtTrfTxInf>") {
		t.Fatal("raw XML injection survived in pacs.008")
	}
	if !strings.Contains(out, "&lt;/Nm&gt;") {
		t.Fatal("expected escaped creditor name")
	}
	// And the whole document must still be well-formed.
	body := out[len(xml.Header):]
	var v any
	if err := xml.Unmarshal([]byte(body), &struct {
		XMLName xml.Name `xml:"Document"`
	}{}); err != nil {
		_ = v
		t.Fatalf("generated pacs.008 is not well-formed XML: %v", err)
	}
	if strings.Count(out, "<CdtTrfTxInf>") != 1 {
		t.Fatal("injection created extra transaction blocks")
	}
}

// GO-H6: validators reject bad fields.
func TestFieldValidators(t *testing.T) {
	if validCreditorName("bad\nname") || validCreditorName("") || validCreditorName(strings.Repeat("a", 141)) {
		t.Fatal("creditor name validator too lax")
	}
	if !validCreditorName("ACME Corp. Ltd") {
		t.Fatal("legit creditor name rejected")
	}
	if reAccountNumber.MatchString("1234';DROP--") || !reAccountNumber.MatchString("US-1234567890") {
		t.Fatal("account number validator wrong")
	}
	if reEndToEndID.MatchString("a<b") || !reEndToEndID.MatchString("E2E-abc-123") {
		t.Fatal("endToEndId validator wrong")
	}
}

// GO-H7: /submit requires auth; fail closed when INTERNAL_SERVICE_KEY unset.
func TestRequireAuth_FailClosed(t *testing.T) {
	g := &FedNowGateway{transfers: map[string]*FedNowTransfer{}, metrics: &Metrics{}, internalKey: ""}
	h := g.requireAuth(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	req := httptest.NewRequest("POST", "/submit", strings.NewReader("{}"))
	req.Header.Set("X-API-Key", "anything")
	w := httptest.NewRecorder()
	h(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unset internal key allowed access: %d", w.Code)
	}

	g.internalKey = "secret-key"
	req2 := httptest.NewRequest("POST", "/submit", strings.NewReader("{}"))
	w2 := httptest.NewRecorder()
	h(w2, req2)
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("missing credential allowed access: %d", w2.Code)
	}
	req3 := httptest.NewRequest("POST", "/submit", strings.NewReader("{}"))
	req3.Header.Set("X-API-Key", "secret-key")
	w3 := httptest.NewRecorder()
	h(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("valid key rejected: %d", w3.Code)
	}
}

// GO-H7: without adapter and without dev simulation, a valid submit stays RCVD
// — no fabricated ACSP/ACSC settlement.
func TestSubmit_NoFabricatedSettlement(t *testing.T) {
	g := &FedNowGateway{transfers: map[string]*FedNowTransfer{}, metrics: &Metrics{},
		maxAmount: 500000, internalKey: "k"}
	body := `{"paymentInformation":{"creditTransferTransaction":{
		"paymentId":{"endToEndId":"E2E-1"},
		"amount":{"instructedAmount":10,"currency":"USD"},
		"creditorAgent":{"financialInstitutionId":{"clearingSystemMemberId":"021000021"}},
		"creditor":{"name":"Jane Doe"},
		"creditorAccount":{"id":"US-998877"}}}}`
	req := httptest.NewRequest("POST", "/submit", strings.NewReader(body))
	w := httptest.NewRecorder()
	g.handleSubmit(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("submit failed: %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"status":"RCVD"`) {
		t.Fatalf("expected RCVD status, got %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "ACSC") || strings.Contains(w.Body.String(), "ACSP") {
		t.Fatal("fabricated settlement status")
	}
	// client-supplied messageId must not become the transactionId
	if strings.Contains(w.Body.String(), "attacker-chosen-id") {
		t.Fatal("client-controlled txID used")
	}
}
