/**
 * RemitFlow — ISO 20022 Message Builder Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  buildPacs008,
  buildPacs002,
  buildPacs004,
  parseISO20022Message,
  ISO20022_STATUS_CODES,
  RETURN_REASON_CODES,
} from "../integrations/mojaloop/iso20022";

const BASE_PACS008_PARAMS = {
  msgId: "MSG-001-TEST",
  endToEndId: "E2E-001",
  txId: "TX-001",
  amount: "100.00",
  currency: "USD",
  debtorName: "John Doe",
  debtorAccountId: "ACC-DEBTOR-001",
  debtorFsp: "remitflow",
  creditorName: "Jane Smith",
  creditorAccountId: "ACC-CREDITOR-001",
  creditorFsp: "access-bank",
};

describe("ISO 20022 Message Builder", () => {
  describe("buildPacs008 — FI to FI Customer Credit Transfer", () => {
    it("produces valid XML with required fields", () => {
      const xml = buildPacs008(BASE_PACS008_PARAMS);
      expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10"');
      expect(xml).toContain("<MsgId>MSG-001-TEST</MsgId>");
      expect(xml).toContain("<EndToEndId>E2E-001</EndToEndId>");
      expect(xml).toContain("<TxId>TX-001</TxId>");
      expect(xml).toContain('Ccy="USD"');
      expect(xml).toContain(">100.00<");
    });

    it("includes debtor and creditor information", () => {
      const xml = buildPacs008(BASE_PACS008_PARAMS);
      expect(xml).toContain("<Nm>John Doe</Nm>");
      expect(xml).toContain("<Nm>Jane Smith</Nm>");
      expect(xml).toContain("<Id>ACC-DEBTOR-001</Id>");
      expect(xml).toContain("<Id>ACC-CREDITOR-001</Id>");
    });

    it("includes FSP identifiers", () => {
      const xml = buildPacs008(BASE_PACS008_PARAMS);
      expect(xml).toContain("<Id>remitflow</Id>");
      expect(xml).toContain("<Id>access-bank</Id>");
    });

    it("includes optional purpose code when provided", () => {
      const xml = buildPacs008({ ...BASE_PACS008_PARAMS, purposeCode: "GDDS" });
      expect(xml).toContain("<Cd>GDDS</Cd>");
    });

    it("includes optional remittance info when provided", () => {
      const xml = buildPacs008({ ...BASE_PACS008_PARAMS, remittanceInfo: "Invoice #12345" });
      expect(xml).toContain("<Ustrd>Invoice #12345</Ustrd>");
    });

    it("defaults charge bearer to SHAR", () => {
      const xml = buildPacs008(BASE_PACS008_PARAMS);
      expect(xml).toContain("<ChrgBr>SHAR</ChrgBr>");
    });

    it("uses provided charge bearer", () => {
      const xml = buildPacs008({ ...BASE_PACS008_PARAMS, chargeBearer: "DEBT" });
      expect(xml).toContain("<ChrgBr>DEBT</ChrgBr>");
    });

    it("escapes XML special characters in names", () => {
      const xml = buildPacs008({ ...BASE_PACS008_PARAMS, debtorName: "O'Brien & Sons <Ltd>" });
      expect(xml).toContain("O&apos;Brien &amp; Sons &lt;Ltd&gt;");
      expect(xml).not.toContain("<Ltd>");
    });

    it("includes a UETR (UUID) in payment ID", () => {
      const xml = buildPacs008(BASE_PACS008_PARAMS);
      expect(xml).toContain("<UETR>");
      // UUID format: 8-4-4-4-12 hex chars
      const uetrMatch = xml.match(/<UETR>([0-9a-f-]{36})<\/UETR>/);
      expect(uetrMatch).not.toBeNull();
    });

    it("includes settlement method CLRG", () => {
      const xml = buildPacs008(BASE_PACS008_PARAMS);
      expect(xml).toContain("<SttlmMtd>CLRG</SttlmMtd>");
      expect(xml).toContain("<Cd>MOJALOOP</Cd>");
    });
  });

  describe("buildPacs002 — Payment Status Report", () => {
    it("produces valid XML for ACSC status", () => {
      const xml = buildPacs002({
        msgId: "STS-001",
        originalMsgId: "MSG-001-TEST",
        originalEndToEndId: "E2E-001",
        txStatus: "ACSC",
      });
      expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.002.001.12"');
      expect(xml).toContain("<TxSts>ACSC</TxSts>");
      expect(xml).toContain("<MsgId>STS-001</MsgId>");
    });

    it("includes status reason code when provided", () => {
      const xml = buildPacs002({
        msgId: "STS-002",
        originalMsgId: "MSG-002",
        originalEndToEndId: "E2E-002",
        txStatus: "RJCT",
        statusReasonCode: "AM04",
        statusReasonInfo: "Insufficient funds",
      });
      expect(xml).toContain("<Cd>AM04</Cd>");
      expect(xml).toContain("<AddtlInf>Insufficient funds</AddtlInf>");
    });

    it("supports all valid transaction statuses", () => {
      const statuses = ["ACCP", "ACSC", "ACSP", "RJCT", "PDNG"] as const;
      statuses.forEach((status) => {
        const xml = buildPacs002({
          msgId: `STS-${status}`,
          originalMsgId: "MSG-001",
          originalEndToEndId: "E2E-001",
          txStatus: status,
        });
        expect(xml).toContain(`<TxSts>${status}</TxSts>`);
      });
    });
  });

  describe("buildPacs004 — Payment Return", () => {
    it("produces valid XML for payment return", () => {
      const xml = buildPacs004({
        msgId: "RTN-001",
        originalMsgId: "MSG-001",
        originalEndToEndId: "E2E-001",
        returnAmount: "100.00",
        currency: "USD",
        returnReasonCode: "CUST",
        returnReasonInfo: "Customer requested return",
      });
      expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.004.001.11"');
      expect(xml).toContain("<Cd>CUST</Cd>");
      expect(xml).toContain('Ccy="USD"');
      expect(xml).toContain(">100.00<");
    });
  });

  describe("parseISO20022Message", () => {
    it("parses pacs.008 message type", () => {
      const xml = buildPacs008(BASE_PACS008_PARAMS);
      const parsed = parseISO20022Message(xml);
      expect(parsed.messageType).toBe("pacs.008.001.10");
      expect(parsed.msgId).toBe("MSG-001-TEST");
      expect(parsed.payload.amount).toBe("100.00");
      expect(parsed.payload.currency).toBe("USD");
      expect(parsed.payload.debtorName).toBe("John Doe");
    });

    it("parses pacs.002 message type", () => {
      const xml = buildPacs002({
        msgId: "STS-001",
        originalMsgId: "MSG-001",
        originalEndToEndId: "E2E-001",
        txStatus: "ACSC",
        statusReasonCode: "NARR",
      });
      const parsed = parseISO20022Message(xml);
      expect(parsed.messageType).toBe("pacs.002.001.12");
      expect(parsed.msgId).toBe("STS-001");
      expect(parsed.payload.txStatus).toBe("ACSC");
    });

    it("handles unknown message type gracefully", () => {
      const parsed = parseISO20022Message("<Document>invalid</Document>");
      expect(parsed.messageType).toBe("unknown");
      expect(parsed.msgId).toBe("");
    });
  });

  describe("Status code dictionaries", () => {
    it("ISO20022_STATUS_CODES covers all pacs.002 statuses", () => {
      expect(ISO20022_STATUS_CODES).toHaveProperty("ACCP");
      expect(ISO20022_STATUS_CODES).toHaveProperty("ACSC");
      expect(ISO20022_STATUS_CODES).toHaveProperty("RJCT");
      expect(ISO20022_STATUS_CODES).toHaveProperty("PDNG");
    });

    it("RETURN_REASON_CODES covers common return reasons", () => {
      expect(RETURN_REASON_CODES).toHaveProperty("AM04");
      expect(RETURN_REASON_CODES).toHaveProperty("CUST");
      expect(RETURN_REASON_CODES).toHaveProperty("DUPL");
      expect(RETURN_REASON_CODES).toHaveProperty("FRAD");
    });
  });
});
