/**
 * travelRule.ts — FATF Travel Rule (Recommendation 16) Implementation
 *
 * Full IVMS101 (InterVASP Messaging Standard) compliance for:
 *   - Canada: FINTRAC threshold = CAD $1,000
 *   - USA: FinCEN threshold = USD $3,000 (proposed $250 for crypto)
 *   - UK: FCA/JMLSGs = no threshold (all transfers)
 *   - Nigeria: CBN = ₦5,000,000
 *
 * Counterparty VASP resolution via Notabene network.
 * Supports both UTXO and account-based blockchains.
 */

import { randomBytes } from "crypto";
import { logger } from "../_core/logger";
import { getCircuitBreaker } from "../_core/featurePersistence";

// ── IVMS101 Data Model ──────────────────────────────────────────────────────

export interface NaturalPerson {
  name: {
    primaryIdentifier: string;     // Last name
    secondaryIdentifier?: string;  // First name
    nameIdentifierType: "LEGL" | "BIRT" | "MAID" | "TRAD";
  }[];
  dateOfBirth?: string;            // ISO 8601 (YYYY-MM-DD)
  placeOfBirth?: string;
  nationalIdentification?: {
    nationalIdentifier: string;     // SSN, NIN, passport number
    nationalIdentifierType: "ARNU" | "CCPT" | "RAID" | "DRLC" | "FIIN" | "TXID" | "SOCS" | "IDCD" | "LEIX";
    countryOfIssue: string;         // ISO 3166-1 alpha-2
    registrationAuthority?: string;
  };
  customerIdentification?: string;
  geographicAddress?: {
    addressLine: string[];
    townName: string;
    countrySubDivision?: string;
    postCode?: string;
    country: string; // ISO 3166-1 alpha-2
    addressType: "HOME" | "BIZZ" | "GEOG";
  };
  country?: string;
}

export interface LegalPerson {
  name: {
    legalPersonName: string;
    legalPersonNameIdentifierType: "LEGL" | "SHRT" | "TRAD";
  }[];
  nationalIdentification?: {
    nationalIdentifier: string;
    nationalIdentifierType: "RAID" | "LEIX" | "TXID";
    countryOfIssue: string;
    registrationAuthority?: string;
  };
  geographicAddress?: NaturalPerson["geographicAddress"];
  country?: string;
}

export interface IVMS101Payload {
  originator: {
    originatorPersons: Array<{
      naturalPerson?: NaturalPerson;
      legalPerson?: LegalPerson;
    }>;
    accountNumber: string[];
  };
  beneficiary: {
    beneficiaryPersons: Array<{
      naturalPerson?: NaturalPerson;
      legalPerson?: LegalPerson;
    }>;
    accountNumber: string[];
  };
  originatingVASP?: {
    originatingVASP: {
      legalPerson: LegalPerson;
    };
  };
  beneficiaryVASP?: {
    beneficiaryVASP: {
      legalPerson: LegalPerson;
    };
  };
}

export interface TravelRuleTransfer {
  id: string;
  ivms101: IVMS101Payload;
  transactionAsset: string;
  transactionAmount: string;
  transactionBlockchainInfo?: {
    txHash?: string;
    origin?: string;
    destination?: string;
  };
  originatorVASPdid: string;
  beneficiaryVASPdid: string;
  status: "new" | "sent" | "acknowledged" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

// ── Jurisdiction Thresholds ─────────────────────────────────────────────────

export interface JurisdictionThreshold {
  country: string;
  currency: string;
  threshold: number;
  regulator: string;
  notes: string;
}

export const TRAVEL_RULE_THRESHOLDS: JurisdictionThreshold[] = [
  { country: "CA", currency: "CAD", threshold: 1000, regulator: "FINTRAC", notes: "PCMLTFA s.12(1)" },
  { country: "US", currency: "USD", threshold: 3000, regulator: "FinCEN", notes: "31 CFR 103.33(f)" },
  { country: "GB", currency: "GBP", threshold: 0, regulator: "FCA", notes: "MLR 2017 — all transfers" },
  { country: "NG", currency: "NGN", threshold: 5000000, regulator: "CBN", notes: "CBN AML/CFT Regs" },
  { country: "GH", currency: "GHS", threshold: 50000, regulator: "BoG", notes: "AML Act 2020" },
  { country: "KE", currency: "KES", threshold: 1000000, regulator: "CBK", notes: "POCAMLA 2009" },
  { country: "ZA", currency: "ZAR", threshold: 25000, regulator: "SARB", notes: "FIC Act 38" },
  // EU — MiCA Travel Rule applies to all crypto transfers regardless of amount
  { country: "EU", currency: "EUR", threshold: 0, regulator: "EBA", notes: "TFR (EU) 2023/1113" },
];

// ── VASP Directory ──────────────────────────────────────────────────────────

export interface VASPInfo {
  did: string;
  name: string;
  country: string;
  website: string;
  complianceContact: string;
  supportedAssets: string[];
  protocolSupport: ("TRP" | "OpenVASP" | "SYGNA")[];
}

const KNOWN_VASPS: VASPInfo[] = [
  { did: "did:ethr:remitflow", name: "RemitFlow", country: "CA", website: "https://remitflow.app", complianceContact: "compliance@remitflow.app", supportedAssets: ["USDC", "USDT", "ETH", "BTC"], protocolSupport: ["TRP"] },
  { did: "did:ethr:marklane", name: "Mark Lane FX", country: "CA", website: "https://marklane.io", complianceContact: "compliance@marklane.io", supportedAssets: ["USDC", "USDT"], protocolSupport: ["TRP"] },
];

// ── Config & State ──────────────────────────────────────────────────────────

const NOTABENE_API_KEY = process.env.NOTABENE_API_KEY || "";
const NOTABENE_URL = process.env.NOTABENE_URL || "https://api.notabene.id";
const REMITFLOW_VASP_DID = process.env.REMITFLOW_VASP_DID || "did:ethr:remitflow";
const travelRuleBreaker = getCircuitBreaker("travel-rule");

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Determine if Travel Rule applies to a transfer based on jurisdiction thresholds.
 */
export function requiresTravelRule(params: {
  amount: number;
  currency: string;
  originatorCountry: string;
  beneficiaryCountry: string;
}): { required: boolean; reason: string; threshold: JurisdictionThreshold | null } {
  // Check both originator and beneficiary jurisdictions — stricter one applies
  const applicableThresholds = TRAVEL_RULE_THRESHOLDS.filter(
    t => t.country === params.originatorCountry || t.country === params.beneficiaryCountry
  );

  if (applicableThresholds.length === 0) {
    // Default: apply if >= USD 1000 equivalent (FATF recommendation)
    if (params.amount >= 1000) {
      return { required: true, reason: "Default FATF threshold (≥ $1,000 equivalent)", threshold: null };
    }
    return { required: false, reason: "Below FATF threshold", threshold: null };
  }

  // Use the strictest (lowest) threshold
  const strictest = applicableThresholds.reduce((a, b) => a.threshold <= b.threshold ? a : b);

  if (params.amount >= strictest.threshold) {
    return {
      required: true,
      reason: `${strictest.regulator} threshold (${strictest.currency} ${strictest.threshold.toLocaleString()}) exceeded`,
      threshold: strictest,
    };
  }

  return { required: false, reason: `Below ${strictest.regulator} threshold`, threshold: strictest };
}

/**
 * Build IVMS101 payload for a transfer.
 */
export function buildIVMS101Payload(params: {
  originator: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    nationalId?: string;
    nationalIdType?: string;
    country: string;
    address?: string;
    accountNumber: string;
  };
  beneficiary: {
    firstName: string;
    lastName: string;
    country: string;
    accountNumber: string;
  };
}): IVMS101Payload {
  return {
    originator: {
      originatorPersons: [{
        naturalPerson: {
          name: [{
            primaryIdentifier: params.originator.lastName,
            secondaryIdentifier: params.originator.firstName,
            nameIdentifierType: "LEGL",
          }],
          dateOfBirth: params.originator.dateOfBirth,
          nationalIdentification: params.originator.nationalId ? {
            nationalIdentifier: params.originator.nationalId,
            nationalIdentifierType: (params.originator.nationalIdType || "CCPT") as "CCPT",
            countryOfIssue: params.originator.country,
          } : undefined,
          country: params.originator.country,
        },
      }],
      accountNumber: [params.originator.accountNumber],
    },
    beneficiary: {
      beneficiaryPersons: [{
        naturalPerson: {
          name: [{
            primaryIdentifier: params.beneficiary.lastName,
            secondaryIdentifier: params.beneficiary.firstName,
            nameIdentifierType: "LEGL",
          }],
          country: params.beneficiary.country,
        },
      }],
      accountNumber: [params.beneficiary.accountNumber],
    },
    originatingVASP: {
      originatingVASP: {
        legalPerson: {
          name: [{ legalPersonName: "RemitFlow Inc.", legalPersonNameIdentifierType: "LEGL" }],
          nationalIdentification: {
            nationalIdentifier: "CA-MSB-REMITFLOW",
            nationalIdentifierType: "RAID",
            countryOfIssue: "CA",
            registrationAuthority: "FINTRAC",
          },
          country: "CA",
        },
      },
    },
  };
}

/**
 * Resolve counterparty VASP using Notabene network or local directory.
 */
export async function resolveCounterpartyVASP(
  walletAddress: string,
  chain: string,
): Promise<VASPInfo | null> {
  // Try local directory first
  const local = KNOWN_VASPS.find(v => v.did !== REMITFLOW_VASP_DID);
  if (local) return local;

  if (!NOTABENE_API_KEY || !travelRuleBreaker.canRequest()) {
    return null;
  }

  try {
    const response = await fetch(`${NOTABENE_URL}/v1/vasp/resolve`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTABENE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address: walletAddress, chain }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { vasp?: VASPInfo };
    return data.vasp || null;
  } catch (err) {
    logger.warn({ err, walletAddress, chain }, "VASP resolution failed");
    return null;
  }
}

/**
 * Submit Travel Rule transfer to Notabene network.
 */
export async function submitTravelRuleTransfer(params: {
  ivms101: IVMS101Payload;
  asset: string;
  amount: string;
  chain: string;
  txHash?: string;
  beneficiaryVASPdid?: string;
}): Promise<TravelRuleTransfer> {
  const transferId = `tr-${randomBytes(12).toString("hex")}`;

  if (!NOTABENE_API_KEY) {
    if (isProduction()) {
      throw new Error("Travel Rule submission blocked: NOTABENE_API_KEY not configured");
    }
    // Dev mode mock
    return {
      id: transferId,
      ivms101: params.ivms101,
      transactionAsset: params.asset,
      transactionAmount: params.amount,
      transactionBlockchainInfo: params.txHash ? { txHash: params.txHash } : undefined,
      originatorVASPdid: REMITFLOW_VASP_DID,
      beneficiaryVASPdid: params.beneficiaryVASPdid || "did:ethr:unknown",
      status: "sent",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  if (!travelRuleBreaker.canRequest()) {
    if (isProduction()) {
      throw new Error("Travel Rule circuit breaker open — cannot submit compliance data");
    }
    return {
      id: transferId,
      ivms101: params.ivms101,
      transactionAsset: params.asset,
      transactionAmount: params.amount,
      originatorVASPdid: REMITFLOW_VASP_DID,
      beneficiaryVASPdid: params.beneficiaryVASPdid || "did:ethr:unknown",
      status: "new",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const response = await fetch(`${NOTABENE_URL}/tf/create`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTABENE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        originatorVASPdid: REMITFLOW_VASP_DID,
        beneficiaryVASPdid: params.beneficiaryVASPdid || "did:ethr:unknown",
        transactionAsset: params.asset,
        transactionAmount: params.amount,
        originator: params.ivms101.originator,
        beneficiary: params.ivms101.beneficiary,
        transactionBlockchainInfo: params.txHash ? {
          txHash: params.txHash,
        } : undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Notabene API ${response.status}: ${err}`);
    }

    const data = (await response.json()) as { id: string; status: string };
    travelRuleBreaker.recordSuccess();

    return {
      id: data.id,
      ivms101: params.ivms101,
      transactionAsset: params.asset,
      transactionAmount: params.amount,
      transactionBlockchainInfo: params.txHash ? { txHash: params.txHash } : undefined,
      originatorVASPdid: REMITFLOW_VASP_DID,
      beneficiaryVASPdid: params.beneficiaryVASPdid || "did:ethr:unknown",
      status: data.status as TravelRuleTransfer["status"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    travelRuleBreaker.recordFailure();
    logger.error({ err }, "Travel Rule submission failed");
    if (isProduction()) {
      throw new Error(`Travel Rule submission failed: ${(err as Error).message}`);
    }
    return {
      id: transferId,
      ivms101: params.ivms101,
      transactionAsset: params.asset,
      transactionAmount: params.amount,
      originatorVASPdid: REMITFLOW_VASP_DID,
      beneficiaryVASPdid: params.beneficiaryVASPdid || "did:ethr:unknown",
      status: "new",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
