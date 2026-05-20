// SecurityManager.swift - Production-grade iOS Security Module
// Implements OWASP MASVS L2 security controls

import Foundation
import Security
import LocalAuthentication
import CryptoKit
import IOSSecuritySuite
import TrustKit
import KeychainAccess

// MARK: - Security Configuration

struct SecurityConfig {
    static let certificatePinningEnabled = true
    static let jailbreakDetectionEnabled = true
    static let debuggerDetectionEnabled = true
    static let integrityCheckEnabled = true
    static let sessionTimeoutMinutes = 15
    static let maxFailedAttempts = 5
    static let biometricFallbackEnabled = true
}

// MARK: - Security Alert

struct SecurityAlert: Codable {
    let id: String
    let type: SecurityAlertType
    let severity: AlertSeverity
    let message: String
    let timestamp: Date
    var acknowledged: Bool
    
    enum SecurityAlertType: String, Codable {
        case jailbreakDetected = "JAILBREAK_DETECTED"
        case debuggerAttached = "DEBUGGER_ATTACHED"
        case tamperingDetected = "TAMPERING_DETECTED"
        case certificatePinningFailed = "CERTIFICATE_PINNING_FAILED"
        case suspiciousActivity = "SUSPICIOUS_ACTIVITY"
        case deviceCompromised = "DEVICE_COMPROMISED"
    }
    
    enum AlertSeverity: String, Codable {
        case low = "LOW"
        case medium = "MEDIUM"
        case high = "HIGH"
        case critical = "CRITICAL"
    }
}

// MARK: - Security Score

struct SecurityScore {
    let overall: Int
    let deviceSecurity: Int
    let networkSecurity: Int
    let dataSecurity: Int
    let authenticationSecurity: Int
    let transactionSecurity: Int
    
    var isProductionReady: Bool {
        return overall >= 80
    }
}

// MARK: - Security Manager

@objc public class SecurityManager: NSObject {
    
    // MARK: - Singleton
    
    @objc public static let shared = SecurityManager()
    
    // MARK: - Properties
    
    private let keychain = Keychain(service: "com.agentbanking.app")
        .accessibility(.whenUnlockedThisDeviceOnly)
        .authenticationPolicy(.biometryCurrentSet)
    
    private var sessionStartTime: Date?
    private var sessionTimer: Timer?
    private var alerts: [SecurityAlert] = []
    private var failedAttempts: Int = 0
    private var isDeviceCompromised: Bool = false
    
    // MARK: - Initialization
    
    private override init() {
        super.init()
    }
    
    // MARK: - Public Methods
    
    @objc public func initialize() {
        print("[SECURITY] Initializing iOS Security Manager...")
        
        // Configure TrustKit for certificate pinning
        configureCertificatePinning()
        
        // Perform initial security checks
        performSecurityChecks()
        
        // Start session monitoring
        startSessionMonitoring()
        
        print("[SECURITY] iOS Security Manager initialized")
    }
    
    // MARK: - Certificate Pinning (TrustKit)
    
    private func configureCertificatePinning() {
        guard SecurityConfig.certificatePinningEnabled else { return }
        
        let trustKitConfig: [String: Any] = [
            kTSKSwizzleNetworkDelegates: true,
            kTSKPinnedDomains: [
                "api.agentbanking.com": [
                    kTSKEnforcePinning: true,
                    kTSKIncludeSubdomains: true,
                    kTSKExpirationDate: "2026-12-31",
                    kTSKPublicKeyHashes: [
                        // Primary certificate hash
                        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        // Backup certificate hash
                        "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
                    ],
                    kTSKReportUris: ["https://api.agentbanking.com/security/pinning-report"]
                ],
                "auth.agentbanking.com": [
                    kTSKEnforcePinning: true,
                    kTSKIncludeSubdomains: false,
                    kTSKPublicKeyHashes: [
                        "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
                        "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD="
                    ]
                ],
                "payment.agentbanking.com": [
                    kTSKEnforcePinning: true,
                    kTSKIncludeSubdomains: false,
                    kTSKPublicKeyHashes: [
                        "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE=",
                        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF="
                    ]
                ]
            ]
        ]
        
        TrustKit.initSharedInstance(withConfiguration: trustKitConfig)
        
        // Set validation callback
        TrustKit.sharedInstance().pinningValidatorCallback = { result, hostname, policy in
            if result.finalTrustDecision == .shouldBlockConnection {
                self.handleCertificatePinningFailure(hostname: hostname)
            }
        }
        
        print("[SECURITY] Certificate pinning configured with TrustKit")
    }
    
    private func handleCertificatePinningFailure(hostname: String) {
        let alert = SecurityAlert(
            id: UUID().uuidString,
            type: .certificatePinningFailed,
            severity: .critical,
            message: "Certificate pinning failed for \(hostname)",
            timestamp: Date(),
            acknowledged: false
        )
        
        alerts.append(alert)
        
        // Report to backend
        reportSecurityEvent(type: "CERTIFICATE_PINNING_FAILURE", details: ["hostname": hostname])
        
        // Block all network requests to this host
        print("[SECURITY] CRITICAL: Certificate pinning failed for \(hostname)")
    }
    
    // MARK: - Jailbreak Detection (IOSSecuritySuite)
    
    @objc public func checkJailbreak() -> Bool {
        guard SecurityConfig.jailbreakDetectionEnabled else { return false }
        
        // Use IOSSecuritySuite for comprehensive jailbreak detection
        let jailbreakStatus = IOSSecuritySuite.amIJailbroken()
        
        if jailbreakStatus {
            isDeviceCompromised = true
            
            let alert = SecurityAlert(
                id: UUID().uuidString,
                type: .jailbreakDetected,
                severity: .critical,
                message: "Jailbroken device detected",
                timestamp: Date(),
                acknowledged: false
            )
            
            alerts.append(alert)
            reportSecurityEvent(type: "JAILBREAK_DETECTED", details: [:])
            
            print("[SECURITY] CRITICAL: Jailbroken device detected")
        }
        
        return jailbreakStatus
    }
    
    // MARK: - Debugger Detection
    
    @objc public func checkDebugger() -> Bool {
        guard SecurityConfig.debuggerDetectionEnabled else { return false }
        
        let debuggerAttached = IOSSecuritySuite.amIDebugged()
        
        if debuggerAttached {
            let alert = SecurityAlert(
                id: UUID().uuidString,
                type: .debuggerAttached,
                severity: .high,
                message: "Debugger attached to application",
                timestamp: Date(),
                acknowledged: false
            )
            
            alerts.append(alert)
            reportSecurityEvent(type: "DEBUGGER_ATTACHED", details: [:])
            
            print("[SECURITY] WARNING: Debugger attached")
        }
        
        return debuggerAttached
    }
    
    // MARK: - Integrity Check
    
    @objc public func checkIntegrity() -> Bool {
        guard SecurityConfig.integrityCheckEnabled else { return true }
        
        // Check for reverse engineering tools
        let reverseEngineered = IOSSecuritySuite.amIReverseEngineered()
        
        // Check for runtime manipulation
        let runtimeManipulated = IOSSecuritySuite.amIRuntimeHooked()
        
        // Check for proxy detection
        let proxyDetected = IOSSecuritySuite.amIProxied()
        
        let integrityCompromised = reverseEngineered || runtimeManipulated
        
        if integrityCompromised {
            isDeviceCompromised = true
            
            let alert = SecurityAlert(
                id: UUID().uuidString,
                type: .tamperingDetected,
                severity: .critical,
                message: "Application integrity compromised",
                timestamp: Date(),
                acknowledged: false
            )
            
            alerts.append(alert)
            reportSecurityEvent(type: "INTEGRITY_COMPROMISED", details: [
                "reverseEngineered": reverseEngineered,
                "runtimeManipulated": runtimeManipulated,
                "proxyDetected": proxyDetected
            ])
            
            print("[SECURITY] CRITICAL: Application integrity compromised")
        }
        
        return !integrityCompromised
    }
    
    // MARK: - Biometric Authentication
    
    @objc public func authenticateWithBiometrics(reason: String, completion: @escaping (Bool, Error?) -> Void) {
        let context = LAContext()
        var error: NSError?
        
        // Check if biometrics are available
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            if SecurityConfig.biometricFallbackEnabled {
                // Fallback to device passcode
                authenticateWithPasscode(reason: reason, completion: completion)
            } else {
                completion(false, error)
            }
            return
        }
        
        // Configure context
        context.localizedFallbackTitle = "Use PIN"
        context.localizedCancelTitle = "Cancel"
        
        // Perform biometric authentication
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, error in
            DispatchQueue.main.async {
                if success {
                    self.resetFailedAttempts()
                    self.logActivity(type: "BIOMETRIC_AUTH_SUCCESS")
                    completion(true, nil)
                } else {
                    self.incrementFailedAttempts()
                    self.logActivity(type: "BIOMETRIC_AUTH_FAILURE")
                    
                    if SecurityConfig.biometricFallbackEnabled {
                        self.authenticateWithPasscode(reason: reason, completion: completion)
                    } else {
                        completion(false, error)
                    }
                }
            }
        }
    }
    
    private func authenticateWithPasscode(reason: String, completion: @escaping (Bool, Error?) -> Void) {
        let context = LAContext()
        
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
            DispatchQueue.main.async {
                if success {
                    self.resetFailedAttempts()
                    self.logActivity(type: "PASSCODE_AUTH_SUCCESS")
                }
                completion(success, error)
            }
        }
    }
    
    // MARK: - Secure Storage (Keychain)
    
    @objc public func secureStore(key: String, value: String) throws {
        try keychain.set(value, key: key)
        print("[SECURITY] Stored value securely for key: \(key)")
    }
    
    @objc public func secureRetrieve(key: String) throws -> String? {
        return try keychain.get(key)
    }
    
    @objc public func secureDelete(key: String) throws {
        try keychain.remove(key)
        print("[SECURITY] Deleted secure value for key: \(key)")
    }
    
    // MARK: - Transaction Signing
    
    @objc public func signTransaction(transactionData: Data) throws -> Data {
        // Generate or retrieve signing key from Secure Enclave
        let privateKey = try getOrCreateSigningKey()
        
        // Sign the transaction data
        let signature = try SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            transactionData as CFData,
            nil
        )
        
        guard let signatureData = signature as Data? else {
            throw SecurityError.signingFailed
        }
        
        logActivity(type: "TRANSACTION_SIGNED")
        
        return signatureData
    }
    
    private func getOrCreateSigningKey() throws -> SecKey {
        let tag = "com.agentbanking.app.signing.key".data(using: .utf8)!
        
        // Try to retrieve existing key
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        
        if status == errSecSuccess, let key = item {
            return key as! SecKey
        }
        
        // Create new key in Secure Enclave
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            &accessError
        ) else {
            throw SecurityError.keyGenerationFailed
        }
        
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessControl as String: access
            ]
        ]
        
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw SecurityError.keyGenerationFailed
        }
        
        return privateKey
    }
    
    // MARK: - Session Management
    
    private func startSessionMonitoring() {
        sessionStartTime = Date()
        
        sessionTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.checkSessionTimeout()
        }
    }
    
    private func checkSessionTimeout() {
        guard let startTime = sessionStartTime else { return }
        
        let elapsed = Date().timeIntervalSince(startTime)
        let timeoutSeconds = Double(SecurityConfig.sessionTimeoutMinutes * 60)
        
        if elapsed >= timeoutSeconds {
            handleSessionTimeout()
        }
    }
    
    @objc public func resetSession() {
        sessionStartTime = Date()
        logActivity(type: "SESSION_RESET")
    }
    
    private func handleSessionTimeout() {
        logActivity(type: "SESSION_TIMEOUT")
        
        // Clear sensitive data
        clearSensitiveData()
        
        // Notify app to show re-authentication
        NotificationCenter.default.post(name: .sessionTimeout, object: nil)
        
        print("[SECURITY] Session timeout - re-authentication required")
    }
    
    private func clearSensitiveData() {
        // Clear any cached sensitive data
        UserDefaults.standard.removeObject(forKey: "cached_balance")
        UserDefaults.standard.removeObject(forKey: "cached_transactions")
        
        // Clear clipboard
        UIPasteboard.general.string = ""
    }
    
    // MARK: - Failed Attempts Tracking
    
    private func incrementFailedAttempts() {
        failedAttempts += 1
        
        if failedAttempts >= SecurityConfig.maxFailedAttempts {
            handleMaxFailedAttempts()
        }
    }
    
    private func resetFailedAttempts() {
        failedAttempts = 0
    }
    
    private func handleMaxFailedAttempts() {
        let alert = SecurityAlert(
            id: UUID().uuidString,
            type: .suspiciousActivity,
            severity: .high,
            message: "Maximum failed authentication attempts reached",
            timestamp: Date(),
            acknowledged: false
        )
        
        alerts.append(alert)
        reportSecurityEvent(type: "MAX_FAILED_ATTEMPTS", details: ["attempts": failedAttempts])
        
        // Lock the app temporarily
        NotificationCenter.default.post(name: .accountLocked, object: nil)
        
        print("[SECURITY] Account locked due to max failed attempts")
    }
    
    // MARK: - Security Score
    
    @objc public func calculateSecurityScore() -> SecurityScore {
        var deviceSecurity = 100
        var networkSecurity = 100
        var dataSecurity = 100
        var authenticationSecurity = 100
        var transactionSecurity = 100
        
        // Device security checks
        if checkJailbreak() {
            deviceSecurity -= 50
        }
        
        if checkDebugger() {
            deviceSecurity -= 20
        }
        
        if !checkIntegrity() {
            deviceSecurity -= 30
        }
        
        // Network security
        if !SecurityConfig.certificatePinningEnabled {
            networkSecurity -= 30
        }
        
        // Data security
        let secureEnclaveAvailable = checkSecureEnclaveAvailability()
        if !secureEnclaveAvailable {
            dataSecurity -= 20
        }
        
        // Authentication security
        let biometricsAvailable = checkBiometricsAvailability()
        if !biometricsAvailable {
            authenticationSecurity -= 20
        }
        
        // Transaction security
        if !SecurityConfig.certificatePinningEnabled {
            transactionSecurity -= 30
        }
        
        let overall = (deviceSecurity + networkSecurity + dataSecurity + authenticationSecurity + transactionSecurity) / 5
        
        return SecurityScore(
            overall: overall,
            deviceSecurity: deviceSecurity,
            networkSecurity: networkSecurity,
            dataSecurity: dataSecurity,
            authenticationSecurity: authenticationSecurity,
            transactionSecurity: transactionSecurity
        )
    }
    
    private func checkSecureEnclaveAvailability() -> Bool {
        return SecureEnclave.isAvailable
    }
    
    private func checkBiometricsAvailability() -> Bool {
        let context = LAContext()
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }
    
    // MARK: - Security Checks
    
    private func performSecurityChecks() {
        DispatchQueue.global(qos: .background).async {
            _ = self.checkJailbreak()
            _ = self.checkDebugger()
            _ = self.checkIntegrity()
            
            if self.isDeviceCompromised {
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .deviceCompromised, object: nil)
                }
            }
        }
    }
    
    // MARK: - Activity Logging
    
    private func logActivity(type: String) {
        let activity: [String: Any] = [
            "type": type,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "deviceId": UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        ]
        
        print("[SECURITY ACTIVITY] \(activity)")
        
        // Send to analytics
        // Analytics.logEvent("security_activity", parameters: activity)
    }
    
    // MARK: - Security Event Reporting
    
    private func reportSecurityEvent(type: String, details: [String: Any]) {
        var payload: [String: Any] = [
            "type": type,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "deviceId": UIDevice.current.identifierForVendor?.uuidString ?? "unknown",
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        ]
        
        payload.merge(details) { (_, new) in new }
        
        // Send to backend security endpoint
        guard let url = URL(string: "https://api.agentbanking.com/security/events") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        
        URLSession.shared.dataTask(with: request) { _, _, error in
            if let error = error {
                print("[SECURITY] Failed to report security event: \(error)")
            }
        }.resume()
    }
    
    // MARK: - Public Accessors
    
    @objc public func getAlerts() -> [SecurityAlert] {
        return alerts
    }
    
    @objc public func acknowledgeAlert(id: String) {
        if let index = alerts.firstIndex(where: { $0.id == id }) {
            alerts[index].acknowledged = true
        }
    }
    
    @objc public func isCompromised() -> Bool {
        return isDeviceCompromised
    }
}

// MARK: - Security Errors

enum SecurityError: Error {
    case keyGenerationFailed
    case signingFailed
    case encryptionFailed
    case decryptionFailed
    case authenticationFailed
}

// MARK: - Notification Names

extension Notification.Name {
    static let sessionTimeout = Notification.Name("com.agentbanking.sessionTimeout")
    static let accountLocked = Notification.Name("com.agentbanking.accountLocked")
    static let deviceCompromised = Notification.Name("com.agentbanking.deviceCompromised")
}
