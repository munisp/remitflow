import LocalAuthentication

/// Biometric Transaction Approval
class BiometricApproval {
    static let shared = BiometricApproval()
    
    func requireBiometricForTransaction(amount: Double, completion: @escaping (Bool, Error?) -> Void) {
        let context = LAContext()
        var error: NSError?
        
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            completion(false, error)
            return
        }
        
        let reason = "Approve transaction of ₦\(Int(amount).formatted())"
        
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, error in
            DispatchQueue.main.async {
                completion(success, error)
            }
        }
    }
}
