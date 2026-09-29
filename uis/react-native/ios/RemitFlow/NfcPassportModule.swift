//
//  NfcPassportModule.swift
//  RemitFlow
//
//  SPEC-wave15 §9 — NFC e-passport (eMRTD) reader bridge.
//
//  Uses NFCPassportReader (MIT — see THIRD-PARTY-NOTICES.md) to perform BAC,
//  read DG1 (MRZ), DG2 (portrait), SOD, optional DG15, and Active
//  Authentication with a per-session random challenge.
//
//  JS contract (shared with the Android bridge):
//    NfcPassport.readPassport(documentNumber, dateOfBirthYYMMDD, dateOfExpiryYYMMDD)
//      resolves { dg1, dg2Portrait, sod, aaSignature } (base64; aaSignature may be null)
//      rejects  with code UNAVAILABLE | USER_CANCEL | READ_ERROR | BAC_FAILED
//
//  FAIL CLOSED: any read/parse error rejects the promise; the JS layer and
//  the server route the session to manual_review. Nothing is silently skipped.
//

import Foundation
import CoreNFC
import NFCPassportReader

@objc(NfcPassport)
class NfcPassportModule: NSObject {

  private static let ERR_UNAVAILABLE = "UNAVAILABLE"
  private static let ERR_USER_CANCEL = "USER_CANCEL"
  private static let ERR_READ_ERROR = "READ_ERROR"
  private static let ERR_BAC_FAILED = "BAC_FAILED"

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(readPassport:dateOfBirth:dateOfExpiry:resolver:rejecter:)
  func readPassport(_ documentNumber: String,
                    dateOfBirth: String,
                    dateOfExpiry: String,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {

    guard #available(iOS 13.0, *), NFCTagReaderSession.readingAvailable else {
      reject(Self.ERR_UNAVAILABLE, "NFC tag reading is not available on this device", nil)
      return
    }
    guard let mrzKey = Self.buildMRZKey(documentNumber: documentNumber,
                                        dateOfBirth: dateOfBirth,
                                        dateOfExpiry: dateOfExpiry) else {
      reject(Self.ERR_READ_ERROR, "Invalid MRZ fields (document number / YYMMDD dates)", nil)
      return
    }

    // Per-session random AA challenge — lets the server verify the chip's
    // Active Authentication response was produced live, not replayed.
    let aaChallenge = (0..<8).map { _ in UInt8.random(in: UInt8.min...UInt8.max) }

    let reader = PassportReader()
    Task {
      do {
        let passport = try await reader.readPassport(
          mrzKey: mrzKey,
          tags: [.COM, .SOD, .DG1, .DG2, .DG15],
          aaChallenge: aaChallenge,
          customDisplayMessage: { displayMessage in
            switch displayMessage {
            case .requestPresentPassport:
              return "Hold your iPhone near the passport cover."
            default:
              return nil
            }
          })

        guard
          let dg1 = passport.getDataGroup(.DG1),
          let dg2 = passport.getDataGroup(.DG2),
          let sod = passport.getDataGroup(.SOD)
        else {
          reject(Self.ERR_READ_ERROR, "Mandatory data groups (DG1/DG2/SOD) missing from chip", nil)
          return
        }

        // Portrait: raw image bytes (JPEG or JPEG2000) from DG2, falling back
        // to the whole DG2 payload if the face record cannot be parsed.
        let portraitBytes: [UInt8]
        if let dg2Parsed = dg2 as? DataGroup2, !dg2Parsed.imageData.isEmpty {
          portraitBytes = dg2Parsed.imageData
        } else {
          portraitBytes = dg2.data
        }

        let hasAA = passport.activeAuthenticationSupported &&
                    !passport.activeAuthenticationSignature.isEmpty

        let result: [String: Any?] = [
          "dg1": Data(dg1.data).base64EncodedString(),
          "dg2Portrait": Data(portraitBytes).base64EncodedString(),
          "sod": Data(sod.data).base64EncodedString(),
          "aaSignature": hasAA ? Data(passport.activeAuthenticationSignature).base64EncodedString() : nil,
          // Extra fields beyond the minimal contract; the server accepts them
          // optionally and needs them to verify Active Auth.
          "dg15": passport.getDataGroup(.DG15).map { Data($0.data).base64EncodedString() },
          "aaChallenge": hasAA ? Data(passport.activeAuthenticationChallenge).base64EncodedString() : nil,
          // Raw DG2 enables the server's SOD hash check for the portrait
          // data group (dg2Portrait alone cannot be hash-checked).
          "dg2": Data(dg2.data).base64EncodedString(),
        ]
        resolve(result.compactMapValues { $0 })
      } catch let error as NFCPassportReaderError {
        switch error {
        case .UserCanceled:
          reject(Self.ERR_USER_CANCEL, "Cancelled by user", error)
        case .InvalidMRZKey, .ResponseError:
          // BAC failure almost always means wrong MRZ digits.
          reject(Self.ERR_BAC_FAILED, "BAC failed — check document number / dates", error)
        case .NFCNotSupported:
          reject(Self.ERR_UNAVAILABLE, "NFC is not supported on this device", error)
        default:
          reject(Self.ERR_READ_ERROR, "NFC passport read failed: \(error.errorDescription ?? "\(error)")", error)
        }
      } catch let error as NSError {
        // CoreNFC surfaces user cancellation of the system sheet as an NSError.
        if error.domain == "NFCError" && (error.code == 200 || error.code == 201) {
          reject(Self.ERR_USER_CANCEL, "Cancelled by user", error)
        } else {
          reject(Self.ERR_READ_ERROR, "NFC passport read failed: \(error.localizedDescription)", error)
        }
      }
    }
  }

  /// Programmatic cancel: NFCPassportReader does not expose its
  /// NFCTagReaderSession, so the iOS system sheet cannot be dismissed from JS.
  /// Users cancel via the system sheet's own Cancel button (→ USER_CANCEL).
  /// Resolves false honestly instead of pretending to cancel.
  @objc(cancelRead:rejecter:)
  func cancelRead(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(false)
  }

  // MARK: - MRZ key derivation (ICAO 9303-3 check digits)

  /// Builds the BAC MRZ key: docNr(9, '<'-padded)+check + dob(6)+check + doe(6)+check.
  static func buildMRZKey(documentNumber: String, dateOfBirth: String, dateOfExpiry: String) -> String? {
    let docNr = documentNumber.uppercased()
    let dob = dateOfBirth
    let doe = dateOfExpiry

    guard !docNr.isEmpty, docNr.count <= 9,
          docNr.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "<") }),
          dob.count == 6, doe.count == 6,
          dob.allSatisfy({ $0.isNumber }), doe.allSatisfy({ $0.isNumber }) else {
      return nil
    }

    let paddedDocNr = docNr.padding(toLength: 9, withPad: "<", startingAt: 0)
    guard let docCheck = checkDigit(paddedDocNr),
          let dobCheck = checkDigit(dob),
          let doeCheck = checkDigit(doe) else {
      return nil
    }
    return "\(paddedDocNr)\(docCheck)\(dob)\(dobCheck)\(doe)\(doeCheck)"
  }

  /// ICAO 9303 mod-10 check digit with repeating 7-3-1 weights.
  static func checkDigit(_ input: String) -> Int? {
    let weights = [7, 3, 1]
    var sum = 0
    for (i, ch) in input.enumerated() {
      let value: Int
      switch ch {
      case "0"..."9": value = Int(ch.asciiValue! - Character("0").asciiValue!)
      case "A"..."Z": value = Int(ch.asciiValue! - Character("A").asciiValue!) + 10
      case "<": value = 0
      default: return nil
      }
      sum += value * weights[i % 3]
    }
    return sum % 10
  }
}
