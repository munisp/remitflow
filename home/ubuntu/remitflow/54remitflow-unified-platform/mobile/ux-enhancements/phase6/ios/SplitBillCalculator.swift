import Foundation

/// Split Bill Calculator
class SplitBillCalculator {
    struct SplitResult {
        let totalAmount: Double
        let numberOfPeople: Int
        let amountPerPerson: Double
        let tipPerPerson: Double
        let totalPerPerson: Double
        let splits: [PersonSplit]
    }
    
    struct PersonSplit {
        let name: String
        let amount: Double
        let hasPaid: Bool
    }
    
    func calculateEvenSplit(total: Double, people: Int, tipPercent: Double = 0) -> SplitResult {
        let tipAmount = total * (tipPercent / 100)
        let totalWithTip = total + tipAmount
        let perPerson = totalWithTip / Double(people)
        let tipPerPerson = tipAmount / Double(people)
        
        var splits: [PersonSplit] = []
        for i in 1...people {
            splits.append(PersonSplit(name: "Person \(i)", amount: perPerson, hasPaid: false))
        }
        
        return SplitResult(
            totalAmount: total,
            numberOfPeople: people,
            amountPerPerson: total / Double(people),
            tipPerPerson: tipPerPerson,
            totalPerPerson: perPerson,
            splits: splits
        )
    }
    
    func calculateCustomSplit(total: Double, customAmounts: [Double], tipPercent: Double = 0) -> SplitResult {
        let tipAmount = total * (tipPercent / 100)
        let totalWithTip = total + tipAmount
        
        let customTotal = customAmounts.reduce(0, +)
        
        var splits: [PersonSplit] = []
        for (index, amount) in customAmounts.enumerated() {
            let proportion = amount / customTotal
            let tipForPerson = tipAmount * proportion
            let totalForPerson = amount + tipForPerson
            
            splits.append(PersonSplit(
                name: "Person \(index + 1)",
                amount: totalForPerson,
                hasPaid: false
            ))
        }
        
        return SplitResult(
            totalAmount: total,
            numberOfPeople: customAmounts.count,
            amountPerPerson: total / Double(customAmounts.count),
            tipPerPerson: tipAmount / Double(customAmounts.count),
            totalPerPerson: totalWithTip / Double(customAmounts.count),
            splits: splits
        )
    }
}
