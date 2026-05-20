import Foundation

/// Round-Up Savings Feature
class RoundUpSavings {
    static let shared = RoundUpSavings()
    
    struct RoundUpSettings {
        var isEnabled: Bool
        var roundUpMultiple: Double // 1.0, 5.0, 10.0
        var savingsGoal: Double?
        var currentSavings: Double
    }
    
    private var settings: RoundUpSettings
    
    init() {
        self.settings = RoundUpSettings(
            isEnabled: false,
            roundUpMultiple: 1.0,
            savingsGoal: nil,
            currentSavings: 0
        )
    }
    
    func calculateRoundUp(amount: Double) -> Double {
        let multiple = settings.roundUpMultiple
        let roundedUp = ceil(amount / multiple) * multiple
        return roundedUp - amount
    }
    
    func processTransaction(amount: Double) -> Double {
        guard settings.isEnabled else { return 0 }
        
        let roundUpAmount = calculateRoundUp(amount: amount)
        settings.currentSavings += roundUpAmount
        
        return roundUpAmount
    }
    
    func getSavingsProgress() -> Double {
        guard let goal = settings.savingsGoal, goal > 0 else { return 0 }
        return (settings.currentSavings / goal) * 100
    }
}
