/**
 * RemitFlow — ISO 20022 Message Builder for Mojaloop
 * ══════════════════════════════════════════════════════════════════════════════
 * Builds and parses ISO 20022 financial messages for Mojaloop interoperability:
 *
 *   pacs.008.001.10 — FI to FI Customer Credit Transfer (payment initiation)
 *   pacs.002.001.12 — FI to FI Payment Status Report (payment confirmation)
 *   pacs.004.001.11 — Payment Return (refund)
 *   camt.053.001.08 — Bank to Customer Statement (reconciliation)
 *   camt.056.001.09 — FI to FI Payment Cancellation Request
 *
 * Mojaloop uses ISO 20022 as its wire format for cross-border transfers
 * under the FSPIOP-ISO20022 API specification.
 */

import { randomUUID } from "crypto";
import { logger } from "../../_core/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Pacs008Params {
  msgId: string;
  endToEndId: string;
  txId: string;
  amount: string;
  currency: string;
  debtorName: string;
  debtorAccountId: string;
  debtorFsp: string;
  creditorName: string;
  creditorAccountId: string;
  creditorFsp: string;
  purposeCode?: string;
  remittanceInfo?: string;
  chargeBearer?: "DEBT" | "CRED" | "SHAR" | "SLEV";
}

export interface Pacs002Params {
  msgId: string;
  originalMsgId: string;
  originalEndToEndId: string;
  txStatus: "ACCP" | "ACSC" | "ACSP" | "RJCT" | "PDNG";
  statusReasonCode?: string;
  statusReasonInfo?: string;
  acceptanceDateTime?: Date;
}

export interface Pacs004Params {
  msgId: string;
  originalMsgId: string;
  originalEndToEndId: string;
  returnAmount: string;
  currency: string;
  returnReasonCode: string;
  returnReasonInfo?: string;
}

export interface ISO20022ParseResult {
  messageType: string;
  msgId: string;
  creationDateTime: string;
  payload: Record<string, unknown>;
}

// ── Message Builders ──────────────────────────────────────────────────────────

/**
 * Build a pacs.008.001.10 FI to FI Customer Credit Transfer message.
 * Used by RemitFlow to initiate cross-border payments via Mojaloop.
 */
export function buildPacs008(params: Pacs008Params): string {
  const now = new Date().toISOString();
  const chargeBearer = params.chargeBearer ?? "SHAR";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${escapeXml(params.msgId)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
        <ClrSys>
          <Cd>MOJALOOP</Cd>
        </ClrSys>
      </SttlmInf>
      <InstgAgt>
        <FinInstnId>
          <Othr>
            <Id>${escapeXml(params.debtorFsp)}</Id>
          </Othr>
        </FinInstnId>
      </InstgAgt>
      <InstdAgt>
        <FinInstnId>
          <Othr>
            <Id>${escapeXml(params.creditorFsp)}</Id>
          </Othr>
        </FinInstnId>
      </InstdAgt>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>${escapeXml(params.endToEndId)}</EndToEndId>
        <TxId>${escapeXml(params.txId)}</TxId>
        <UETR>${randomUUID()}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${escapeXml(params.currency)}">${escapeXml(params.amount)}</IntrBkSttlmAmt>
      <IntrBkSttlmDt>${now.slice(0, 10)}</IntrBkSttlmDt>
      <ChrgBr>${chargeBearer}</ChrgBr>
      <Dbtr>
        <Nm>${escapeXml(params.debtorName)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>${escapeXml(params.debtorAccountId)}</Id>
          </Othr>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <Othr>
            <Id>${escapeXml(params.debtorFsp)}</Id>
          </Othr>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <Othr>
            <Id>${escapeXml(params.creditorFsp)}</Id>
          </Othr>
        </FinInstnId>
      </CdtrAgt>
      <Cdtr>
        <Nm>${escapeXml(params.creditorName)}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <Othr>
            <Id>${escapeXml(params.creditorAccountId)}</Id>
          </Othr>
        </Id>
      </CdtrAcct>${params.purposeCode ? `
      <Purp>
        <Cd>${escapeXml(params.purposeCode)}</Cd>
      </Purp>` : ""}${params.remittanceInfo ? `
      <RmtInf>
        <Ustrd>${escapeXml(params.remittanceInfo)}</Ustrd>
      </RmtInf>` : ""}
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
}

/**
 * Build a pacs.002.001.12 FI to FI Payment Status Report.
 * Used by RemitFlow to confirm or reject incoming payment requests.
 */
export function buildPacs002(params: Pacs002Params): string {
  const now = new Date().toISOString();
  const acceptanceDt = params.acceptanceDateTime?.toISOString() ?? now;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.002.001.12"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FIToFIPmtStsRpt>
    <GrpHdr>
      <MsgId>${escapeXml(params.msgId)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
    </GrpHdr>
    <TxInfAndSts>
      <OrgnlEndToEndId>${escapeXml(params.originalEndToEndId)}</OrgnlEndToEndId>
      <OrgnlTxId>${escapeXml(params.originalMsgId)}</OrgnlTxId>
      <TxSts>${params.txStatus}</TxSts>${params.statusReasonCode ? `
      <StsRsnInf>
        <Rsn>
          <Cd>${escapeXml(params.statusReasonCode)}</Cd>
        </Rsn>${params.statusReasonInfo ? `
        <AddtlInf>${escapeXml(params.statusReasonInfo)}</AddtlInf>` : ""}
      </StsRsnInf>` : ""}
      <AccptncDtTm>${acceptanceDt}</AccptncDtTm>
    </TxInfAndSts>
  </FIToFIPmtStsRpt>
</Document>`;
}

/**
 * Build a pacs.004.001.11 Payment Return message.
 * Used for refunds and reversals.
 */
export function buildPacs004(params: Pacs004Params): string {
  const now = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.004.001.11"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <PmtRtr>
    <GrpHdr>
      <MsgId>${escapeXml(params.msgId)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <TxInf>
      <RtrId>${escapeXml(params.msgId)}</RtrId>
      <OrgnlEndToEndId>${escapeXml(params.originalEndToEndId)}</OrgnlEndToEndId>
      <OrgnlTxId>${escapeXml(params.originalMsgId)}</OrgnlTxId>
      <RtrAmt Ccy="${escapeXml(params.currency)}">${escapeXml(params.returnAmount)}</RtrAmt>
      <ChrgBr>SHAR</ChrgBr>
      <RtrRsnInf>
        <Rsn>
          <Cd>${escapeXml(params.returnReasonCode)}</Cd>
        </Rsn>${params.returnReasonInfo ? `
        <AddtlInf>${escapeXml(params.returnReasonInfo)}</AddtlInf>` : ""}
      </RtrRsnInf>
    </TxInf>
  </PmtRtr>
</Document>`;
}

// ── Message Parser ────────────────────────────────────────────────────────────

/**
 * Parse an incoming ISO 20022 XML message and extract key fields.
 */
export function parseISO20022Message(xmlString: string): ISO20022ParseResult {
  // Extract message type from xmlns
  const nsMatch = xmlString.match(/urn:iso:std:iso:20022:tech:xsd:([a-z0-9.]+)/);
  const messageType = nsMatch?.[1] ?? "unknown";

  // Extract MsgId
  const msgIdMatch = xmlString.match(/<MsgId>([^<]+)<\/MsgId>/);
  const msgId = msgIdMatch?.[1] ?? "";

  // Extract CreDtTm
  const dtMatch = xmlString.match(/<CreDtTm>([^<]+)<\/CreDtTm>/);
  const creationDateTime = dtMatch?.[1] ?? "";

  // Extract key fields based on message type
  const payload: Record<string, unknown> = {};

  if (messageType.startsWith("pacs.008")) {
    const endToEndMatch = xmlString.match(/<EndToEndId>([^<]+)<\/EndToEndId>/);
    const amtMatch = xmlString.match(/<IntrBkSttlmAmt[^>]*>([^<]+)<\/IntrBkSttlmAmt>/);
    const ccyMatch = xmlString.match(/IntrBkSttlmAmt Ccy="([^"]+)"/);
    const debtorMatch = xmlString.match(/<Dbtr>[\s\S]*?<Nm>([^<]+)<\/Nm>/);
    const creditorMatch = xmlString.match(/<Cdtr>[\s\S]*?<Nm>([^<]+)<\/Nm>/);

    payload.endToEndId = endToEndMatch?.[1];
    payload.amount = amtMatch?.[1];
    payload.currency = ccyMatch?.[1];
    payload.debtorName = debtorMatch?.[1];
    payload.creditorName = creditorMatch?.[1];
  } else if (messageType.startsWith("pacs.002")) {
    const statusMatch = xmlString.match(/<TxSts>([^<]+)<\/TxSts>/);
    const reasonMatch = xmlString.match(/<Cd>([^<]+)<\/Cd>/);
    payload.txStatus = statusMatch?.[1];
    payload.statusReasonCode = reasonMatch?.[1];
  }

  return { messageType, msgId, creationDateTime, payload };
}

// ── Mojaloop Transfer Initiator ───────────────────────────────────────────────

export async function initiateViaISO20022(params: Pacs008Params): Promise<{
  success: boolean;
  msgId: string;
  mojalooopTransferId?: string;
  error?: string;
}> {
  const xml = buildPacs008(params);

  try {
    const mojaloopUrl = process.env.MOJALOOP_CONNECTOR_URL ?? "http://mojaloop-connector:8113";

    const response = await fetch(`${mojaloopUrl}/iso20022/transfers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        "Accept": "application/xml",
        "FSPIOP-Source": params.debtorFsp,
        "FSPIOP-Destination": params.creditorFsp,
        "Date": new Date().toUTCString(),
      },
      body: xml,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ msgId: params.msgId, status: response.status, error: errorBody }, "[ISO20022] Mojaloop transfer initiation failed");
      return { success: false, msgId: params.msgId, error: `HTTP ${response.status}: ${errorBody}` };
    }

    const responseXml = await response.text();
    const parsed = parseISO20022Message(responseXml);

    logger.info({ msgId: params.msgId, status: parsed.payload.txStatus }, "[ISO20022] Mojaloop transfer initiated");

    return {
      success: true,
      msgId: params.msgId,
      mojalooopTransferId: parsed.payload.txId as string,
    };
  } catch (err) {
    logger.error({ msgId: params.msgId, err }, "[ISO20022] Mojaloop transfer initiation error");
    return {
      success: false,
      msgId: params.msgId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const ISO20022_STATUS_CODES: Record<string, string> = {
  ACCP: "Accepted Customer Profile — initial validation passed",
  ACSC: "Accepted Settlement Completed — funds transferred",
  ACSP: "Accepted Settlement In Process — settlement pending",
  RJCT: "Rejected — transfer declined",
  PDNG: "Pending — awaiting processing",
};

export const RETURN_REASON_CODES: Record<string, string> = {
  AC01: "Incorrect Account Number",
  AC03: "Invalid Creditor Account Number",
  AC04: "Closed Account Number",
  AC06: "Blocked Account",
  AM04: "Insufficient Funds",
  AM09: "Wrong Amount",
  BE04: "Missing Creditor Address",
  CUST: "Requested by Customer",
  DUPL: "Duplicate Payment",
  FRAD: "Fraudulent Origin",
  MD01: "No Mandate",
  NARR: "Narrative",
  NOAS: "No Answer from Customer",
  NOCM: "Not Compliant",
  RUTA: "Return Upon Unable to Apply",
};
