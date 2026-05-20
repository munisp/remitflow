// DeviceAttestation.swift - Apple DeviceCheck & App Attest Integration
// Provides server-side device validation for fraud prevention

import Foundation
import DeviceCheck
import CryptoKit

// MARK: - Device Attestation Manager

@objc public class DeviceAttestationManager: NSObject {
    
    // MARK: - Singleton
    
    @objc public static let shared = DeviceAttestationManager()
    
    // MARK: - Properties
    
    private let dcDevice = DCDevice.current
    private var attestKeyId: String?
    private let serverURL = "https://api.agentbanking.com"
    
    // MARK: - Initialization
    
    private override init() {
        super.init()
    }
    
    // MARK: - DeviceCheck Token Generation
    
    /// Generates a DeviceCheck token for server-side validation
    /// This token can be used to verify device authenticity without identifying the user
    @objc public func generateDeviceToken(completion: @escaping (Data?, Error?) -> Void) {
        guard dcDevice.isSupported else {
            completion(nil, DeviceAttestationError.deviceCheckNotSupported)
            return
        }
        
        dcDevice.generateToken { token, error in
            if let error = error {
                print("[ATTESTATION] Failed to generate DeviceCheck token: \(error)")
                completion(nil, error)
                return
            }
            
            guard let token = token else {
                completion(nil, DeviceAttestationError.tokenGenerationFailed)
                return
            }
            
            print("[ATTESTATION] DeviceCheck token generated successfully")
            completion(token, nil)
        }
    }
    
    /// Sends DeviceCheck token to server for validation and bit state management
    @objc public func validateDeviceWithServer(completion: @escaping (Bool, Error?) -> Void) {
        generateDeviceToken { [weak self] token, error in
            guard let self = self, let token = token else {
                completion(false, error)
                return
            }
            
            self.sendTokenToServer(token: token, completion: completion)
        }
    }
    
    private func sendTokenToServer(token: Data, completion: @escaping (Bool, Error?) -> Void) {
        guard let url = URL(string: "\(serverURL)/security/device-check/validate") else {
            completion(false, DeviceAttestationError.invalidURL)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "device_token": token.base64EncodedString(),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(false, error)
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                completion(false, DeviceAttestationError.serverValidationFailed)
                return
            }
            
            // Parse server response
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let isValid = json["valid"] as? Bool {
                completion(isValid, nil)
            } else {
                completion(false, DeviceAttestationError.invalidServerResponse)
            }
        }.resume()
    }
    
    // MARK: - App Attest (iOS 14+)
    
    /// Generates an App Attest key for enhanced security
    /// App Attest provides cryptographic proof that requests come from a legitimate app
    @available(iOS 14.0, *)
    @objc public func generateAppAttestKey(completion: @escaping (String?, Error?) -> Void) {
        let service = DCAppAttestService.shared
        
        guard service.isSupported else {
            completion(nil, DeviceAttestationError.appAttestNotSupported)
            return
        }
        
        service.generateKey { keyId, error in
            if let error = error {
                print("[ATTESTATION] Failed to generate App Attest key: \(error)")
                completion(nil, error)
                return
            }
            
            guard let keyId = keyId else {
                completion(nil, DeviceAttestationError.keyGenerationFailed)
                return
            }
            
            self.attestKeyId = keyId
            print("[ATTESTATION] App Attest key generated: \(keyId)")
            completion(keyId, nil)
        }
    }
    
    /// Attests the key with Apple's servers
    @available(iOS 14.0, *)
    @objc public func attestKey(challenge: Data, completion: @escaping (Data?, Error?) -> Void) {
        guard let keyId = attestKeyId else {
            completion(nil, DeviceAttestationError.noKeyAvailable)
            return
        }
        
        let service = DCAppAttestService.shared
        
        // Create challenge hash
        let challengeHash = SHA256.hash(data: challenge)
        let challengeHashData = Data(challengeHash)
        
        service.attestKey(keyId, clientDataHash: challengeHashData) { attestation, error in
            if let error = error {
                print("[ATTESTATION] Key attestation failed: \(error)")
                completion(nil, error)
                return
            }
            
            guard let attestation = attestation else {
                completion(nil, DeviceAttestationError.attestationFailed)
                return
            }
            
            print("[ATTESTATION] Key attested successfully")
            completion(attestation, nil)
        }
    }
    
    /// Generates an assertion for a request
    @available(iOS 14.0, *)
    @objc public func generateAssertion(requestData: Data, completion: @escaping (Data?, Error?) -> Void) {
        guard let keyId = attestKeyId else {
            completion(nil, DeviceAttestationError.noKeyAvailable)
            return
        }
        
        let service = DCAppAttestService.shared
        
        // Create hash of request data
        let requestHash = SHA256.hash(data: requestData)
        let requestHashData = Data(requestHash)
        
        service.generateAssertion(keyId, clientDataHash: requestHashData) { assertion, error in
            if let error = error {
                print("[ATTESTATION] Assertion generation failed: \(error)")
                completion(nil, error)
                return
            }
            
            guard let assertion = assertion else {
                completion(nil, DeviceAttestationError.assertionFailed)
                return
            }
            
            print("[ATTESTATION] Assertion generated successfully")
            completion(assertion, nil)
        }
    }
    
    // MARK: - Full Attestation Flow
    
    /// Complete attestation flow for high-value transactions
    @available(iOS 14.0, *)
    @objc public func performFullAttestation(transactionData: Data, completion: @escaping (AttestationResult?, Error?) -> Void) {
        // Step 1: Get challenge from server
        getServerChallenge { [weak self] challenge, error in
            guard let self = self, let challenge = challenge else {
                completion(nil, error ?? DeviceAttestationError.challengeRequestFailed)
                return
            }
            
            // Step 2: Generate or retrieve key
            if self.attestKeyId == nil {
                self.generateAppAttestKey { keyId, error in
                    guard keyId != nil else {
                        completion(nil, error)
                        return
                    }
                    
                    // Step 3: Attest key
                    self.attestKey(challenge: challenge) { attestation, error in
                        guard let attestation = attestation else {
                            completion(nil, error)
                            return
                        }
                        
                        // Step 4: Generate assertion for transaction
                        self.generateAssertion(requestData: transactionData) { assertion, error in
                            guard let assertion = assertion else {
                                completion(nil, error)
                                return
                            }
                            
                            let result = AttestationResult(
                                keyId: self.attestKeyId!,
                                attestation: attestation,
                                assertion: assertion,
                                timestamp: Date()
                            )
                            
                            completion(result, nil)
                        }
                    }
                }
            } else {
                // Key already exists, just generate assertion
                self.generateAssertion(requestData: transactionData) { assertion, error in
                    guard let assertion = assertion else {
                        completion(nil, error)
                        return
                    }
                    
                    let result = AttestationResult(
                        keyId: self.attestKeyId!,
                        attestation: nil,
                        assertion: assertion,
                        timestamp: Date()
                    )
                    
                    completion(result, nil)
                }
            }
        }
    }
    
    private func getServerChallenge(completion: @escaping (Data?, Error?) -> Void) {
        guard let url = URL(string: "\(serverURL)/security/attestation/challenge") else {
            completion(nil, DeviceAttestationError.invalidURL)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(nil, error)
                return
            }
            
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let challengeString = json["challenge"] as? String,
                  let challenge = Data(base64Encoded: challengeString) else {
                completion(nil, DeviceAttestationError.invalidServerResponse)
                return
            }
            
            completion(challenge, nil)
        }.resume()
    }
    
    // MARK: - Risk Assessment
    
    /// Performs comprehensive device risk assessment
    @objc public func assessDeviceRisk(completion: @escaping (DeviceRiskAssessment) -> Void) {
        var riskScore = 0
        var riskFactors: [String] = []
        
        // Check DeviceCheck support
        if !dcDevice.isSupported {
            riskScore += 20
            riskFactors.append("DeviceCheck not supported")
        }
        
        // Check App Attest support (iOS 14+)
        if #available(iOS 14.0, *) {
            if !DCAppAttestService.shared.isSupported {
                riskScore += 15
                riskFactors.append("App Attest not supported")
            }
        } else {
            riskScore += 10
            riskFactors.append("iOS version below 14.0")
        }
        
        // Check jailbreak status
        if SecurityManager.shared.checkJailbreak() {
            riskScore += 50
            riskFactors.append("Jailbreak detected")
        }
        
        // Check debugger
        if SecurityManager.shared.checkDebugger() {
            riskScore += 30
            riskFactors.append("Debugger attached")
        }
        
        // Check integrity
        if !SecurityManager.shared.checkIntegrity() {
            riskScore += 40
            riskFactors.append("Integrity check failed")
        }
        
        let riskLevel: DeviceRiskLevel
        switch riskScore {
        case 0..<20:
            riskLevel = .low
        case 20..<50:
            riskLevel = .medium
        case 50..<80:
            riskLevel = .high
        default:
            riskLevel = .critical
        }
        
        let assessment = DeviceRiskAssessment(
            score: riskScore,
            level: riskLevel,
            factors: riskFactors,
            timestamp: Date(),
            deviceCheckSupported: dcDevice.isSupported,
            appAttestSupported: {
                if #available(iOS 14.0, *) {
                    return DCAppAttestService.shared.isSupported
                }
                return false
            }()
        )
        
        completion(assessment)
    }
}

// MARK: - Supporting Types

@objc public class AttestationResult: NSObject {
    @objc public let keyId: String
    @objc public let attestation: Data?
    @objc public let assertion: Data
    @objc public let timestamp: Date
    
    init(keyId: String, attestation: Data?, assertion: Data, timestamp: Date) {
        self.keyId = keyId
        self.attestation = attestation
        self.assertion = assertion
        self.timestamp = timestamp
    }
}

@objc public enum DeviceRiskLevel: Int {
    case low = 0
    case medium = 1
    case high = 2
    case critical = 3
}

@objc public class DeviceRiskAssessment: NSObject {
    @objc public let score: Int
    @objc public let level: DeviceRiskLevel
    @objc public let factors: [String]
    @objc public let timestamp: Date
    @objc public let deviceCheckSupported: Bool
    @objc public let appAttestSupported: Bool
    
    init(score: Int, level: DeviceRiskLevel, factors: [String], timestamp: Date, deviceCheckSupported: Bool, appAttestSupported: Bool) {
        self.score = score
        self.level = level
        self.factors = factors
        self.timestamp = timestamp
        self.deviceCheckSupported = deviceCheckSupported
        self.appAttestSupported = appAttestSupported
    }
}

// MARK: - Errors

enum DeviceAttestationError: Error, LocalizedError {
    case deviceCheckNotSupported
    case appAttestNotSupported
    case tokenGenerationFailed
    case keyGenerationFailed
    case noKeyAvailable
    case attestationFailed
    case assertionFailed
    case challengeRequestFailed
    case serverValidationFailed
    case invalidServerResponse
    case invalidURL
    
    var errorDescription: String? {
        switch self {
        case .deviceCheckNotSupported:
            return "DeviceCheck is not supported on this device"
        case .appAttestNotSupported:
            return "App Attest is not supported on this device"
        case .tokenGenerationFailed:
            return "Failed to generate DeviceCheck token"
        case .keyGenerationFailed:
            return "Failed to generate App Attest key"
        case .noKeyAvailable:
            return "No attestation key available"
        case .attestationFailed:
            return "Key attestation failed"
        case .assertionFailed:
            return "Assertion generation failed"
        case .challengeRequestFailed:
            return "Failed to get challenge from server"
        case .serverValidationFailed:
            return "Server validation failed"
        case .invalidServerResponse:
            return "Invalid response from server"
        case .invalidURL:
            return "Invalid server URL"
        }
    }
}
