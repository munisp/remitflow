/**
 * NfcPassport.ts
 * SPEC-wave15 §9 — typed wrapper over the native `NfcPassport` module
 * (Android: JMRTD-backed Kotlin module; iOS: NFCPassportReader-backed Swift
 * module). This is the canonical implementation of the contract consumed by
 * the KYC capture flow (wave-15 K6):
 *
 *   readPassport(mrz) -> NfcPassportData | throws NfcPassportError
 *
 * FAIL CLOSED: every failure path throws a typed error carrying a `code`.
 * Callers must route failures to manual_review — never silently proceed.
 */

import { NativeModules, Platform } from "react-native";

/** Error codes rejected by the native bridges. */
export type NfcPassportErrorCode =
  | "UNAVAILABLE" // device has no NFC / NFC disabled / no foreground activity
  | "USER_CANCEL" // user cancelled the NFC scan
  | "READ_ERROR" // tag lost, corrupt data group, timeout, invalid input
  | "BAC_FAILED" // wrong document number / dates (re-prompt the user)
  | "NOT_LINKED"; // native module not present in this build

export class NfcPassportError extends Error {
  readonly code: NfcPassportErrorCode;

  constructor(code: NfcPassportErrorCode, message: string) {
    super(message);
    this.name = "NfcPassportError";
    this.code = code;
  }
}

/** MRZ-derived BAC inputs. Dates are YYMMDD as printed in the MRZ. */
export interface NfcPassportMrz {
  /** Document number as printed (may contain '<' padding on some passports). */
  documentNumber: string;
  /** Date of birth, YYMMDD. */
  dateOfBirth: string;
  /** Date of expiry, YYMMDD. */
  dateOfExpiry: string;
}

/**
 * Raw chip data, base64-encoded. `aaSignature` is null when the chip does not
 * support Active Authentication (no DG15) — the server then reports
 * aaValid=false with an honest reason instead of failing the document.
 */
export interface NfcPassportData {
  /** Raw EF.DG1 file bytes (TLV-wrapped MRZ data group). */
  dg1: string;
  /** Portrait image bytes extracted from DG2 (JPEG or JPEG2000). */
  dg2Portrait: string;
  /** Raw EF.SOD file bytes (CMS SignedData security object). */
  sod: string;
  /** Active Authentication signature over `aaChallenge`, or null. */
  aaSignature: string | null;
  /** Optional extras used by the server for AA verification. */
  dg15?: string | null;
  aaChallenge?: string | null;
}

interface NativeNfcPassportModule {
  readPassport(
    documentNumber: string,
    dateOfBirth: string,
    dateOfExpiry: string,
  ): Promise<NfcPassportData>;
  cancelRead(): Promise<boolean>;
}

const KNOWN_CODES: readonly NfcPassportErrorCode[] = [
  "UNAVAILABLE",
  "USER_CANCEL",
  "READ_ERROR",
  "BAC_FAILED",
];

function getNativeModule(): NativeNfcPassportModule {
  const mod = (NativeModules as Record<string, unknown>).NfcPassport as
    | NativeNfcPassportModule
    | undefined;
  if (!mod || typeof mod.readPassport !== "function") {
    throw new NfcPassportError(
      "NOT_LINKED",
      `NfcPassport native module is not linked on ${Platform.OS}`,
    );
  }
  return mod;
}

function toNfcPassportError(err: unknown): NfcPassportError {
  if (err instanceof NfcPassportError) return err;
  const anyErr = err as { code?: string; message?: string } | null;
  const code = anyErr?.code;
  const message = anyErr?.message ?? "NFC passport read failed";
  if (code && (KNOWN_CODES as readonly string[]).includes(code)) {
    return new NfcPassportError(code as NfcPassportErrorCode, message);
  }
  return new NfcPassportError("READ_ERROR", message);
}

/** True if the native NFC passport module is linked in this build. */
export function isNfcPassportAvailable(): boolean {
  const mod = (NativeModules as Record<string, unknown>).NfcPassport;
  return !!mod && typeof (mod as NativeNfcPassportModule).readPassport === "function";
}

/**
 * Read an e-passport chip via NFC. Resolves with base64-encoded data groups,
 * or throws NfcPassportError with a stable `code` for routing decisions.
 */
export async function readPassport(mrz: NfcPassportMrz): Promise<NfcPassportData> {
  try {
    return await getNativeModule().readPassport(
      mrz.documentNumber,
      mrz.dateOfBirth,
      mrz.dateOfExpiry,
    );
  } catch (err) {
    throw toNfcPassportError(err);
  }
}

/**
 * Best-effort cancel of an in-flight read. On Android the pending
 * readPassport call rejects with USER_CANCEL; on iOS the CoreNFC system
 * sheet cannot be dismissed programmatically, so this resolves false.
 */
export async function cancelRead(): Promise<boolean> {
  try {
    return await getNativeModule().cancelRead();
  } catch {
    return false;
  }
}
