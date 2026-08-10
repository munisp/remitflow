/**
 * RemitFlow — Mojaloop FSP Adapter
 * Implements the Mojaloop Open API v1.1 (FSPIOP) specification for interbank transfers.
 * Docs: https://docs.mojaloop.io/api-snippets/
 *
 * Endpoints used:
 *   POST /parties/{Type}/{ID}           — party lookup
 *   POST /quotes                        — quote request
 *   POST /transfers                     — transfer initiation
 *   GET  /transfers/{transferId}        — transfer status
 *   PUT  /transfers/{transferId}/error  — error callback
 *
 * Default sandbox: https://sandbox.mojaloop.io (public test environment)
 */

import crypto from "crypto";
import { circuitBreakers, CircuitOpenError } from "./services/circuitBreaker";
import { logger } from './_core/logger';

// ─── Configuration ────────────────────────────────────────────────────────────
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function mojaloopEnv(name: string, sandboxFallback: string): string {
  const val = process.env[name];
  if (val) return val;
  if (IS_PRODUCTION) {
    logger.error({ variable: name }, `[Mojaloop] CRITICAL: Missing ${name} in production — Mojaloop rail will be unavailable`);
    return "";
  }
  logger.warn({ variable: name }, `[Mojaloop] Using sandbox fallback for ${name} (development mode)`);
  return sandboxFallback;
}

const MOJALOOP_BASE_URL = mojaloopEnv("MOJALOOP_SWITCH_URL", "https://sandbox.mojaloop.io");
const MOJALOOP_FSP_ID = mojaloopEnv("MOJALOOP_FSP_ID", "remitflow-fsp");
const MOJALOOP_API_KEY = mojaloopEnv("MOJALOOP_API_KEY", "remitflow-sandbox-key");
const MOJALOOP_CALLBACK_URL =
  process.env.MOJALOOP_CALLBACK_URL ?? "https://remitflow.example.com/api/mojaloop/callback";

// ─── FSPIOP JWS keys ──────────────────────────────────────────────────────────
// MOJALOOP_JWS_PRIVATE_KEY — our RSA private key (PEM) used to sign outgoing requests.
// MOJALOOP_JWS_PUBLIC_KEY  — the switch's RSA public key (PEM) used to verify callbacks.
// Both accept literal PEM or a single-line env value with "\n" escapes.
function loadPemEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) return "";
  return raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : "";
}

const MOJALOOP_JWS_PRIVATE_KEY = loadPemEnv("MOJALOOP_JWS_PRIVATE_KEY");
const MOJALOOP_JWS_PUBLIC_KEY = loadPemEnv("MOJALOOP_JWS_PUBLIC_KEY");

if (IS_PRODUCTION && !MOJALOOP_JWS_PRIVATE_KEY) {
  logger.error("[Mojaloop] CRITICAL: MOJALOOP_JWS_PRIVATE_KEY is not set in production — outbound FSPIOP calls will fail closed");
}
if (IS_PRODUCTION && !MOJALOOP_JWS_PUBLIC_KEY) {
  logger.error("[Mojaloop] CRITICAL: MOJALOOP_JWS_PUBLIC_KEY is not set in production — inbound FSPIOP callbacks will be rejected");
}

/** Typed error for all Mojaloop rail failures. Never swallowed into fake success. */
export class MojaloopError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MojaloopError";
    this.code = code;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface MojaloopParty {
  partyIdType: "MSISDN" | "ACCOUNT_ID" | "EMAIL" | "PERSONAL_ID" | "BUSINESS" | "DEVICE" | "IBAN" | "ALIAS";
  partyIdentifier: string;
  fspId?: string;
  name?: string;
  personalInfo?: {
    complexName?: { firstName?: string; lastName?: string };
    dateOfBirth?: string;
  };
}

export interface MojaloopQuoteRequest {
  quoteId: string;
  transactionId: string;
  payee: MojaloopParty;
  payer: MojaloopParty;
  amountType: "SEND" | "RECEIVE";
  amount: { currency: string; amount: string };
  transactionType: {
    scenario: "TRANSFER" | "DEPOSIT" | "WITHDRAWAL" | "PAYMENT" | "REFUND";
    initiator: "PAYER" | "PAYEE";
    initiatorType: "CONSUMER" | "AGENT" | "BUSINESS" | "DEVICE";
  };
  note?: string;
}

export interface MojaloopTransferRequest {
  transferId: string;
  payeeFsp: string;
  payerFsp: string;
  amount: { currency: string; amount: string };
  ilpPacket: string;
  condition: string;
  expiration: string;
}

export interface MojaloopTransferResult {
  transferId: string;
  transferState: "RECEIVED" | "RESERVED" | "COMMITTED" | "ABORTED";
  completedTimestamp?: string;
  fulfilment?: string;
  errorInformation?: {
    errorCode: string;
    errorDescription: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateUUID(): string {
  return crypto.randomUUID();
}

// ─── ILPv4 packet serialization (IL-RFC-27) ──────────────────────────────────
// An ILP Prepare packet is:
//   type      UInt8   (12 = ILP Prepare)
//   length    UInt32BE (length of contents)
//   contents: amount    UInt64BE
//             expiresAt TIMESTAMP (17 bytes ASCII "YYYYMMDDHHMMSS.mmm", UTC)
//             condition OCTET STRING (32 bytes)
//             destination Address (VarOctetString)
//             data      OCTET STRING (VarOctetString)
// The FSPIOP ilpPacket field is the base64url encoding of this binary packet.

/** ISO-4217 minor-unit exponents for currencies on our Mojaloop corridors. */
const CURRENCY_DECIMALS: Record<string, number> = {
  NGN: 2, KES: 2, GHS: 2, TZS: 2, UGX: 0, ZAR: 2, XOF: 0, MWK: 2, ZMW: 2,
  USD: 2, EUR: 2, GBP: 2, INR: 2, BRL: 2,
};

/** Convert a decimal amount string to minor units (exact string math, no floats). */
export function toMinorUnits(amount: string, currency: string): bigint {
  const decimals = CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new MojaloopError("3201", `Invalid amount for ILP packet: "${amount}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new MojaloopError("3201", `Amount "${amount}" exceeds ${decimals} decimal places for ${currency}`);
  }
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || "0");
}

function writeVarOctetString(value: Buffer): Buffer {
  if (value.length > 255) {
    throw new MojaloopError("3200", "ILP field too long for single-byte length prefix");
  }
  return Buffer.concat([Buffer.from([value.length]), value]);
}

function formatIlpTimestamp(d: Date): Buffer {
  // TIMESTAMP per IL-RFC-27: "YYYYMMDDHHMMSS.mmm" in UTC — exactly 17 bytes
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const s =
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "." +
    pad(d.getUTCMilliseconds(), 3);
  return Buffer.from(s, "ascii");
}

export interface IlpPrepareParams {
  amountMinorUnits: bigint;
  /** ILP destination address, e.g. "g.fspid.account" */
  destination: string;
  /** 32-byte condition (= SHA-256 of the fulfillment) */
  condition: Buffer;
  expiresAt: Date;
  data?: Buffer;
}

/** Serialize a real ILPv4 Prepare packet (binary, per IL-RFC-27). */
export function serializeIlpPrepare(p: IlpPrepareParams): Buffer {
  if (p.condition.length !== 32) {
    throw new MojaloopError("3200", `ILP condition must be 32 bytes, got ${p.condition.length}`);
  }
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64BE(p.amountMinorUnits);
  const destination = Buffer.from(p.destination, "ascii");
  const contents = Buffer.concat([
    amount,
    formatIlpTimestamp(p.expiresAt),
    p.condition,
    writeVarOctetString(destination),
    writeVarOctetString(p.data ?? Buffer.alloc(0)),
  ]);
  const header = Buffer.alloc(5);
  header.writeUInt8(12, 0); // ILP Prepare
  header.writeUInt32BE(contents.length, 1);
  return Buffer.concat([header, contents]);
}

// ─── FSPIOP v1.1 JWS signing ──────────────────────────────────────────────────
// Per the FSPIOP API Definition v1.1 signature scheme:
//   protectedHeader = base64url(JSON({
//     alg: "RS256", "FSPIOP-URI", "FSPIOP-HTTP-Method",
//     "FSPIOP-Source", "FSPIOP-Destination"?, "Date"
//   }))
//   signingInput = protectedHeader + "." + base64url(payload)   (payload "" for GET)
//   signature    = base64url(RSA-SHA256(signingInput, privateKey))
//   FSPIOP-Signature header = protectedHeader + ".." + signature  (detached JWS)

function b64url(buf: Buffer | string): string {
  return (typeof buf === "string" ? Buffer.from(buf, "utf8") : buf).toString("base64url");
}

interface FSPIOPSigningContext {
  method: string;
  uri: string;
  source: string;
  destination?: string;
  date: string;
}

function buildProtectedHeader(ctx: FSPIOPSigningContext): string {
  const header: Record<string, string> = {
    alg: "RS256",
    "FSPIOP-URI": ctx.uri,
    "FSPIOP-HTTP-Method": ctx.method.toUpperCase(),
    "FSPIOP-Source": ctx.source,
  };
  if (ctx.destination) header["FSPIOP-Destination"] = ctx.destination;
  header["Date"] = ctx.date;
  return b64url(JSON.stringify(header));
}

function rsaSign(signingInput: string, privateKeyPem: string): string {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return signer.sign(privateKeyPem).toString("base64url");
}

/**
 * Produce the FSPIOP-Signature header value for an outgoing request.
 * Returns null only in non-production when no private key is configured.
 * Fails closed (throws) in production when the key is absent.
 */
function signFSPIOPRequest(ctx: FSPIOPSigningContext, payload: string): string | null {
  if (!MOJALOOP_JWS_PRIVATE_KEY) {
    if (IS_PRODUCTION) {
      throw new MojaloopError("2000", "MOJALOOP_JWS_PRIVATE_KEY is not configured — refusing to send unsigned FSPIOP request in production");
    }
    return null; // dev/simulator: switch does not verify signatures
  }
  const protectedHeader = buildProtectedHeader(ctx);
  const signature = rsaSign(`${protectedHeader}.${b64url(payload)}`, MOJALOOP_JWS_PRIVATE_KEY);
  return `${protectedHeader}..${signature}`;
}

export interface FSPIOPVerificationResult {
  valid: boolean;
  reason?: string;
  source?: string;
}

/**
 * Verify an inbound FSPIOP-Signature header against the switch's public key.
 * `payload` must be the exact raw request body string ("" for empty bodies).
 */
export function verifyFSPIOPSignature(opts: {
  signatureHeader: string | undefined | null;
  method: string;
  uri: string;
  payload: string;
  date?: string;
}): FSPIOPVerificationResult {
  if (!MOJALOOP_JWS_PUBLIC_KEY) {
    return { valid: false, reason: "No switch public key configured (MOJALOOP_JWS_PUBLIC_KEY)" };
  }
  const header = opts.signatureHeader;
  if (!header) return { valid: false, reason: "Missing FSPIOP-Signature header" };

  const parts = header.split(".");
  if (parts.length !== 3 || parts[1] !== "") {
    return { valid: false, reason: "Malformed FSPIOP-Signature (expected detached JWS compact form)" };
  }
  const [protectedHeaderB64, , signatureB64] = parts;

  let claims: Record<string, string>;
  try {
    claims = JSON.parse(Buffer.from(protectedHeaderB64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "Protected header is not valid base64url JSON" };
  }
  if (claims.alg !== "RS256") return { valid: false, reason: `Unsupported alg: ${claims.alg}` };
  if (claims["FSPIOP-HTTP-Method"] !== opts.method.toUpperCase()) {
    return { valid: false, reason: "FSPIOP-HTTP-Method mismatch" };
  }
  if (claims["FSPIOP-URI"] !== opts.uri) {
    return { valid: false, reason: `FSPIOP-URI mismatch (got ${claims["FSPIOP-URI"]}, want ${opts.uri})` };
  }

  const signingInput = `${protectedHeaderB64}.${b64url(opts.payload)}`;
  let ok = false;
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(signingInput);
    verifier.end();
    ok = verifier.verify(MOJALOOP_JWS_PUBLIC_KEY, Buffer.from(signatureB64, "base64url"));
  } catch (err: any) {
    return { valid: false, reason: `Signature verification error: ${err.message}` };
  }
  return ok
    ? { valid: true, source: claims["FSPIOP-Source"] }
    : { valid: false, reason: "RSA-SHA256 signature mismatch" };
}

/** True when inbound callbacks can be cryptographically verified. */
export function isFSPIOPVerificationConfigured(): boolean {
  return Boolean(MOJALOOP_JWS_PUBLIC_KEY);
}

function getMojaloopHeaders(opts: {
  method: string;
  uri: string;
  payload?: string;
  destination?: string;
  contentType?: string;
}): Record<string, string> {
  const date = new Date().toUTCString();
  const headers: Record<string, string> = {
    "Content-Type": opts.contentType ?? "application/vnd.interoperability.transfers+json;version=1.1",
    "Accept": "application/vnd.interoperability.transfers+json;version=1.1",
    "FSPIOP-Source": MOJALOOP_FSP_ID,
    "Date": date,
  };
  if (opts.destination) headers["FSPIOP-Destination"] = opts.destination;
  if (MOJALOOP_API_KEY) headers["Authorization"] = `Bearer ${MOJALOOP_API_KEY}`;

  const signature = signFSPIOPRequest(
    {
      method: opts.method,
      uri: opts.uri,
      source: MOJALOOP_FSP_ID,
      destination: opts.destination,
      date,
    },
    opts.payload ?? ""
  );
  if (signature) headers["FSPIOP-Signature"] = signature;
  return headers;
}

// ─── Party Lookup ─────────────────────────────────────────────────────────────
export async function lookupParty(
  partyIdType: MojaloopParty["partyIdType"],
  partyIdentifier: string
): Promise<{ found: boolean; party?: MojaloopParty; fspId?: string; error?: string }> {
  const uri = `/parties/${partyIdType}/${encodeURIComponent(partyIdentifier)}`;
  try {
    const url = `${MOJALOOP_BASE_URL}${uri}`;
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(url, {
      method: "GET",
      headers: getMojaloopHeaders({ method: "GET", uri }),
      signal: AbortSignal.timeout(10000),
    }));
    if (resp.status === 200) {
      const body = await resp.json() as any;
      return {
        found: true,
        party: body.party ?? body,
        fspId: body.party?.partyIdInfo?.fspId ?? body.fspId,
      };
    }
    if (resp.status === 404) {
      return { found: false, error: "Party not found in Mojaloop network" };
    }
    // Async callback pattern — 202 Accepted means lookup is in progress
    if (resp.status === 202) {
      return { found: true, party: { partyIdType, partyIdentifier }, fspId: "pending-callback" };
    }
    return { found: false, error: `Lookup failed with status ${resp.status}` };
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — skipping party lookup');
    } else {
      logger.warn({ data: err.message }, '[Mojaloop] Party lookup failed');
    }
    // Fail closed in ALL environments — never fabricate a party or FSP.
    return { found: false, error: `Mojaloop party lookup failed: ${err.message}` };
  }
}

// ─── Quote Request ────────────────────────────────────────────────────────────
export async function requestQuote(params: {
  payerMsisdn: string;
  payeeMsisdn: string;
  payerFspId: string;
  payeeFspId: string;
  amount: string;
  currency: string;
  note?: string;
}): Promise<{
  quoteId: string;
  transactionId: string;
  transferAmount: { currency: string; amount: string };
  payeeFspFee?: { currency: string; amount: string };
  payeeFspCommission?: { currency: string; amount: string };
  expiration: string;
  ilpPacket: string;
  condition: string;
  error?: string;
}> {
  const quoteId = generateUUID();
  const transactionId = generateUUID();

  const quoteRequest: MojaloopQuoteRequest = {
    quoteId,
    transactionId,
    payee: {
      partyIdType: "MSISDN",
      partyIdentifier: params.payeeMsisdn,
      fspId: params.payeeFspId,
    },
    payer: {
      partyIdType: "MSISDN",
      partyIdentifier: params.payerMsisdn,
      fspId: params.payerFspId,
    },
    amountType: "SEND",
    amount: { currency: params.currency, amount: params.amount },
    transactionType: {
      scenario: "TRANSFER",
      initiator: "PAYER",
      initiatorType: "CONSUMER",
    },
    note: params.note,
  };

  try {
    const payload = JSON.stringify(quoteRequest);
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}/quotes`, {
      method: "POST",
      headers: getMojaloopHeaders({
        method: "POST",
        uri: "/quotes",
        payload,
        destination: params.payeeFspId,
      }),
      body: payload,
      signal: AbortSignal.timeout(15000),
    }));

    if (resp.status === 200) {
      // Synchronous quote response — use ONLY values returned by the switch.
      const body = await resp.json() as any;
      if (!body.transferAmount || !body.ilpPacket || !body.condition) {
        throw new MojaloopError("2003", "Quote response missing transferAmount/ilpPacket/condition");
      }
      return {
        quoteId: body.quoteId ?? quoteId,
        transactionId: body.transactionId ?? transactionId,
        transferAmount: body.transferAmount,
        payeeFspFee: body.payeeFspFee,
        payeeFspCommission: body.payeeFspCommission,
        expiration: body.expiration ?? new Date(Date.now() + 60000).toISOString(),
        ilpPacket: body.ilpPacket,
        condition: body.condition,
      };
    }
    if (resp.status === 202) {
      // Async pattern: the real quote (fees, ilpPacket, condition) arrives via
      // PUT /quotes/{quoteId} callback. Return the pending correlation IDs —
      // fees and ILP fields are intentionally absent, never fabricated.
      return {
        quoteId,
        transactionId,
        transferAmount: { currency: params.currency, amount: params.amount },
        expiration: new Date(Date.now() + 60000).toISOString(),
        ilpPacket: "",
        condition: "",
      };
    }
    const errBody = await resp.text().catch(() => "");
    throw new MojaloopError(String(resp.status), `Quote request failed: ${resp.status} ${errBody}`);
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — quote unavailable');
    } else {
      logger.warn({ data: err.message }, '[Mojaloop] Quote request failed');
    }
    if (err instanceof MojaloopError) throw err;
    // Fail closed in ALL environments — never fabricate a quote.
    throw new MojaloopError("2000", `Mojaloop quote request failed: ${err.message}`);
  }
}

// ─── Transfer Initiation ──────────────────────────────────────────────────────
export async function initiateTransfer(params: {
  payerFspId: string;
  payeeFspId: string;
  amount: string;
  currency: string;
  ilpPacket: string;
  condition: string;
  expirationSeconds?: number;
}): Promise<MojaloopTransferResult> {
  const transferId = generateUUID();
  const expiration = new Date(
    Date.now() + (params.expirationSeconds ?? 30) * 1000
  ).toISOString();

  const transferRequest: MojaloopTransferRequest = {
    transferId,
    payeeFsp: params.payeeFspId,
    payerFsp: params.payerFspId,
    amount: { currency: params.currency, amount: params.amount },
    ilpPacket: params.ilpPacket,
    condition: params.condition,
    expiration,
  };

  try {
    const payload = JSON.stringify(transferRequest);
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}/transfers`, {
      method: "POST",
      headers: getMojaloopHeaders({
        method: "POST",
        uri: "/transfers",
        payload,
        destination: params.payeeFspId,
      }),
      body: payload,
      signal: AbortSignal.timeout(30000),
    }));

    if (resp.status === 200) {
      const body = await resp.json() as any;
      return {
        transferId: body.transferId ?? transferId,
        transferState: body.transferState ?? "COMMITTED",
        completedTimestamp: body.completedTimestamp ?? new Date().toISOString(),
        fulfilment: body.fulfilment,
      };
    }
    if (resp.status === 202) {
      // Async: transfer accepted, state will be updated via PUT /transfers/{transferId}
      return {
        transferId,
        transferState: "RESERVED",
        completedTimestamp: undefined,
      };
    }
    const errBody = await resp.json().catch(() => ({})) as any;
    return {
      transferId,
      transferState: "ABORTED",
      errorInformation: {
        errorCode: errBody.errorInformation?.errorCode ?? String(resp.status),
        errorDescription: errBody.errorInformation?.errorDescription ?? `Transfer failed: ${resp.status}`,
      },
    };
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — transfer unavailable');
    } else {
      logger.warn({ data: err.message }, '[Mojaloop] Transfer initiation failed');
    }
    return {
      transferId,
      transferState: "ABORTED",
      errorInformation: { errorCode: "5000", errorDescription: `Mojaloop transfer failed: ${err.message}` },
    };
  }
}

// ─── Transfer Status ──────────────────────────────────────────────────────────
export async function getTransferStatus(transferId: string): Promise<MojaloopTransferResult> {
  try {
    const uri = `/transfers/${transferId}`;
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}${uri}`, {
      method: "GET",
      headers: getMojaloopHeaders({ method: "GET", uri }),
      signal: AbortSignal.timeout(10000),
    }));
    if (resp.status === 200) {
      const body = await resp.json() as any;
      return {
        transferId: body.transferId ?? transferId,
        transferState: body.transferState ?? "COMMITTED",
        completedTimestamp: body.completedTimestamp,
        fulfilment: body.fulfilment,
      };
    }
    return { transferId, transferState: "ABORTED", errorInformation: { errorCode: String(resp.status), errorDescription: "Status check failed" } };
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ data: err.message }, '[Mojaloop] Circuit OPEN — status unavailable');
    }
    return { transferId, transferState: "ABORTED", errorInformation: { errorCode: "5000", errorDescription: `Status check failed: ${err.message}` } };
  }
}

// ─── FSP Participants List ────────────────────────────────────────────────────
export async function getFSPParticipants(): Promise<Array<{
  fspId: string;
  name: string;
  currency: string[];
  country: string;
  active: boolean;
}>> {
  try {
    const resp = await circuitBreakers.mojaloop.execute(() => fetch(`${MOJALOOP_BASE_URL}/participants`, {
      headers: getMojaloopHeaders({ method: "GET", uri: "/participants" }),
      signal: AbortSignal.timeout(8000),
    }));
    if (resp.ok) {
      const body = await resp.json() as any;
      return Array.isArray(body) ? body : body.participants ?? [];
    }
  } catch { /* fallback */ }

  logger.warn("[Mojaloop] Participants endpoint unavailable — returning empty list");
  return [];
}

// ─── ILP Fulfillment / Condition Matching ─────────────────────────────────────

/**
 * Generate an ILP condition and fulfillment pair for a transfer.
 * The condition is a SHA-256 hash of the fulfillment.
 * The fulfillment is revealed only when the transfer is committed.
 *
 * Per FSPIOP spec:
 *   condition  = BASE64URL(SHA256(fulfillment))
 *   fulfillment = 32 random bytes, BASE64URL-encoded
 */
export function generateIlpConditionPair(): { condition: string; fulfillment: string } {
  const fulfillmentBytes = crypto.randomBytes(32);
  const fulfillment = fulfillmentBytes.toString("base64url");
  const condition = crypto.createHash("sha256").update(fulfillmentBytes).digest("base64url");
  return { condition, fulfillment };
}

/**
 * Verify that a fulfillment matches a condition.
 * Used in the callback handler when Mojaloop switch returns the fulfillment.
 */
export function verifyIlpFulfillment(condition: string, fulfillment: string): boolean {
  try {
    const fulfillmentBytes = Buffer.from(fulfillment, "base64url");
    const computedCondition = crypto.createHash("sha256").update(fulfillmentBytes).digest("base64url");
    return computedCondition === condition;
  } catch {
    return false;
  }
}

/**
 * Generate a full ILPv4 Prepare packet for a transfer request.
 * Real binary serialization per IL-RFC-27 (no JSON payloads).
 * The condition commits to the fulfillment; both are returned so the caller
 * can store the fulfillment and reveal it only on commit.
 */
export function buildIlpPacket(params: {
  amount: string;
  currency: string;
  destinationFspId: string;
  destinationAccount: string;
  expirySeconds?: number;
  data?: Record<string, unknown>;
}): { ilpPacket: string; condition: string; fulfillment: string } {
  const { condition, fulfillment } = generateIlpConditionPair();
  const expiresAt = new Date(Date.now() + (params.expirySeconds || 30) * 1000);

  const packetBytes = serializeIlpPrepare({
    amountMinorUnits: toMinorUnits(params.amount, params.currency),
    destination: `g.${params.destinationFspId}.${params.destinationAccount}`,
    condition: Buffer.from(condition, "base64url"),
    expiresAt,
    data: params.data ? Buffer.from(JSON.stringify(params.data), "utf8") : undefined,
  });

  return { ilpPacket: packetBytes.toString("base64url"), condition, fulfillment };
}

// ─── Webhook Receiver (Mojaloop Callback Handlers) ───────────────────────────

export interface MojaloopCallback {
  transferId: string;
  transferState: "COMMITTED" | "ABORTED" | "RESERVED";
  fulfilment?: string;
  completedTimestamp?: string;
  errorInformation?: { errorCode: string; errorDescription: string };
}

/** Pending transfers awaiting callback — keyed by transferId */

// ── PostgreSQL persistence for pending transfers ─────────────────────────────
// Only serializable state (condition, expiry) is persisted — never resolve
// functions or timer handles. On startup, surviving rows are re-registered
// with fresh timeouts so callbacks arriving after a restart still match.

let _wtDb: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null = null;

async function _getWtDb() {
  if (_wtDb) return _wtDb;
  try {
    const { getDb } = await import("./db.js");
    _wtDb = await getDb();
    return _wtDb;
  } catch {
    return null;
  }
}

async function _persistPendingTransfer(transferId: string, condition: string, expiresAt: Date): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO mojaloop_pending_transfers (transfer_id, condition, expires_at, updated_at)
      VALUES (${transferId}, ${condition}, ${expiresAt.toISOString()}, NOW())
      ON CONFLICT (transfer_id) DO UPDATE
        SET condition = EXCLUDED.condition, expires_at = EXCLUDED.expires_at, updated_at = NOW()
    `);
  } catch (err: any) {
    logger.warn({ data: err.message }, "[Mojaloop] Failed to persist pending transfer (continuing in-memory)");
  }
}

async function _deletePendingTransfer(transferId: string): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM mojaloop_pending_transfers WHERE transfer_id = ${transferId}`);
  } catch { /* silent */ }
}

async function _loadPendingTransfer(transferId: string): Promise<{ condition: string; expiresAt: Date } | null> {
  const db = await _getWtDb();
  if (!db) return null;
  try {
    const { sql } = await import("drizzle-orm");
    const rows = await (db as any).execute(
      sql`SELECT condition, expires_at FROM mojaloop_pending_transfers WHERE transfer_id = ${transferId}`
    );
    const row = (rows as any[])[0];
    if (!row) return null;
    return { condition: row.condition, expiresAt: new Date(row.expires_at) };
  } catch {
    return null;
  }
}

async function _ensurePendingTransfersTable(): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      CREATE TABLE IF NOT EXISTS mojaloop_pending_transfers (
        transfer_id TEXT PRIMARY KEY,
        condition TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch { /* silent */ }
}

const pendingTransfers = new Map<string, {
  condition: string;
  /** undefined for entries restored after a process restart (no waiter) */
  resolve?: (result: MojaloopCallback) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/**
 * Re-register transfers that were pending when the process last stopped.
 * Each gets a fresh timeout for its remaining lifetime; callbacks that arrive
 * are matched, verified, and cleared even though the original waiter is gone.
 */
async function _restorePendingTransfers(): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    const rows = await (db as any).execute(
      sql`SELECT transfer_id, condition, expires_at FROM mojaloop_pending_transfers`
    );
    const now = Date.now();
    for (const row of rows as any[]) {
      const expiresAt = new Date(row.expires_at).getTime();
      const remainingMs = expiresAt - now;
      if (remainingMs <= 0) {
        await _deletePendingTransfer(row.transfer_id);
        continue;
      }
      const timeout = setTimeout(() => {
        pendingTransfers.delete(row.transfer_id);
        _deletePendingTransfer(row.transfer_id).catch(() => {});
        logger.warn(`[Mojaloop] Restored pending transfer expired: ${row.transfer_id}`);
      }, remainingMs);
      pendingTransfers.set(row.transfer_id, { condition: row.condition, timeout });
    }
    if ((rows as any[]).length > 0) {
      logger.info(`[Mojaloop] Restored ${(rows as any[]).length} pending transfer(s) from PostgreSQL`);
    }
  } catch (err: any) {
    logger.warn({ data: err.message }, "[Mojaloop] Could not restore pending transfers");
  }
}

// Initialize table and restore surviving pending transfers on module load
_ensurePendingTransfersTable()
  .then(() => _restorePendingTransfers())
  .catch(() => {});

/**
 * Register a transfer as pending, waiting for Mojaloop callback.
 * Returns a promise that resolves when the callback arrives (or times out).
 */
export function awaitTransferCallback(
  transferId: string,
  condition: string,
  timeoutMs = 30_000
): Promise<MojaloopCallback> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingTransfers.delete(transferId);

      _deletePendingTransfer(transferId).catch(() => {});
      resolve({
        transferId,
        transferState: "ABORTED",
        errorInformation: { errorCode: "5003", errorDescription: "Transfer callback timeout" },
      });
    }, timeoutMs);

    pendingTransfers.set(transferId, { condition, resolve, timeout });

    _persistPendingTransfer(transferId, condition, new Date(Date.now() + timeoutMs)).catch(() => {});
  });
}

/**
 * Handle an incoming Mojaloop callback (PUT /transfers/{id}).
 * Verifies ILP fulfillment before accepting.
 */
export function handleMojaloopCallback(callback: MojaloopCallback): { accepted: boolean; reason?: string } {
  const pending = pendingTransfers.get(callback.transferId);
  if (!pending) {
    logger.warn(`[Mojaloop] Received callback for unknown transfer: ${callback.transferId}`);
    return { accepted: false, reason: "Unknown transfer" };
  }

  clearTimeout(pending.timeout);
  pendingTransfers.delete(callback.transferId);

  _deletePendingTransfer(callback.transferId).catch(() => {});

  // Verify ILP fulfillment if present
  if (callback.fulfilment && !verifyIlpFulfillment(pending.condition, callback.fulfilment)) {
    logger.error(`[Mojaloop] ILP fulfillment mismatch for ${callback.transferId}`);
    pending.resolve?.({
      ...callback,
      transferState: "ABORTED",
      errorInformation: { errorCode: "5105", errorDescription: "ILP fulfillment mismatch" },
    });
    return { accepted: false, reason: "Fulfillment mismatch" };
  }

  if (pending.resolve) {
    pending.resolve(callback);
  } else {
    logger.info(`[Mojaloop] Callback matched restored pending transfer: ${callback.transferId} state=${callback.transferState}`);
  }
  return { accepted: true };
}

/**
 * Async variant of handleMojaloopCallback that can match transfers persisted
 * before a restart even when they were never restored to memory.
 */
export async function handleMojaloopCallbackPersistent(
  callback: MojaloopCallback
): Promise<{ accepted: boolean; reason?: string }> {
  const inMemory = handleMojaloopCallback(callback);
  if (inMemory.accepted || inMemory.reason !== "Unknown transfer") return inMemory;

  const row = await _loadPendingTransfer(callback.transferId);
  if (!row) return inMemory;

  if (callback.fulfilment && !verifyIlpFulfillment(row.condition, callback.fulfilment)) {
    logger.error(`[Mojaloop] ILP fulfillment mismatch for persisted transfer ${callback.transferId}`);
    await _deletePendingTransfer(callback.transferId);
    return { accepted: false, reason: "Fulfillment mismatch" };
  }
  await _deletePendingTransfer(callback.transferId);
  logger.info(`[Mojaloop] Callback matched persisted transfer: ${callback.transferId}`);
  return { accepted: true };
}
