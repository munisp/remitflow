import Foundation

/// Spending Trends and Analytics Engine
/// Calculates insights, trends, and provides intelligent recommendations

class SpendingAnalytics {
    static let shared = SpendingAnalytics()
    
    // MARK: - Monthly Spending Trends
    
    struct MonthlyTrend {
        let month: Date
        let totalSpending: Double
        let categoryBreakdown: [TransactionCategorizer.Category: Double]
        let transactionCount: Int
        let averageTransaction: Double
        let comparisonToPrevious: Comparison
        
        struct Comparison {
            let percentageChange: Double
            let absoluteChange: Double
            let isIncrease: Bool
            
            var description: String {
                let direction = isIncrease ? "increase" : "decrease"
                return String(format: "%.1f%% %@ from last month", abs(percentageChange), direction)
            }
        }
    }
    
    func calculateMonthlyTrends(transactions: [Transaction], months: Int = 6) -> [MonthlyTrend] {
        let calendar = Calendar.current
        let now = Date()
        
        var trends: [MonthlyTrend] = []
        
        for monthOffset in 0..<months {
            guard let monthDate = calendar.date(byAdding: .month, value: -monthOffset, to: now),
                  let startOfMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: monthDate)),
                  let endOfMonth = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: startOfMonth) else {
                continue
            }
            
            let monthTransactions = transactions.filter { transaction in
                transaction.date >= startOfMonth && transaction.date <= endOfMonth
            }
            
            let totalSpending = monthTransactions.reduce(0) { $0 + $1.amount }
            let transactionCount = monthTransactions.count
            let averageTransaction = transactionCount > 0 ? totalSpending / Double(transactionCount) : 0
            
            // Category breakdown
            var categoryBreakdown: [TransactionCategorizer.Category: Double] = [:]
            for transaction in monthTransactions {
                let category = transaction.category ?? .other
                categoryBreakdown[category, default: 0] += transaction.amount
            }
            
            // Comparison to previous month
            let comparison: MonthlyTrend.Comparison
            if let previousTrend = trends.last {
                let absoluteChange = totalSpending - previousTrend.totalSpending
                let percentageChange = previousTrend.totalSpending > 0 ?
                    (absoluteChange / previousTrend.totalSpending) * 100 : 0
                comparison = MonthlyTrend.Comparison(
                    percentageChange: percentageChange,
                    absoluteChange: absoluteChange,
                    isIncrease: absoluteChange > 0
                )
            } else {
                comparison = MonthlyTrend.Comparison(percentageChange: 0, absoluteChange: 0, isIncrease: false)
            }
            
            trends.append(MonthlyTrend(
                month: startOfMonth,
                totalSpending: totalSpending,
                categoryBreakdown: categoryBreakdown,
                transactionCount: transactionCount,
                averageTransaction: averageTransaction,
                comparisonToPrevious: comparison
            ))
        }
        
        return trends.reversed()
    }
    
    // MARK: - Unusual Spending Detection
    
    struct UnusualSpending {
        let transaction: Transaction
        let reason: Reason
        let severity: Severity
        
        enum Reason {
            case unusuallyLarge
            case newMerchant
            case unusualCategory
            case frequencyAnomaly
            
            var description: String {
                switch self {
                case .unusuallyLarge: return "Unusually large transaction"
                case .newMerchant: return "First time at this merchant"
                case .unusualCategory: return "Unusual category for you"
                case .frequencyAnomaly: return "More frequent than usual"
                }
            }
        }
        
        enum Severity {
            case low, medium, high
            
            var color: String {
                switch self {
                case .low: return "#FFC107"
                case .medium: return "#FF9800"
                case .high: return "#F44336"
                }
            }
        }
    }
    
    func detectUnusualSpending(transactions: [Transaction]) -> [UnusualSpending] {
        var unusual: [UnusualSpending] = []
        
        // Calculate average transaction amount
        let averageAmount = transactions.reduce(0) { $0 + $1.amount } / Double(transactions.count)
        let stdDev = calculateStandardDeviation(values: transactions.map { $0.amount })
        
        // Get unique merchants
        let knownMerchants = Set(transactions.map { $0.merchant })
        
        for transaction in transactions {
            // Check for unusually large transactions (> 2 standard deviations)
            if transaction.amount > averageAmount + (2 * stdDev) {
                unusual.append(UnusualSpending(
                    transaction: transaction,
                    reason: .unusuallyLarge,
                    severity: .high
                ))
            }
            
            // Check for new merchants
            let previousTransactions = transactions.filter { $0.date < transaction.date }
            let previousMerchants = Set(previousTransactions.map { $0.merchant })
            if !previousMerchants.contains(transaction.merchant) {
                unusual.append(UnusualSpending(
                    transaction: transaction,
                    reason: .newMerchant,
                    severity: .low
                ))
            }
        }
        
        return unusual
    }
    
    private func calculateStandardDeviation(values: [Double]) -> Double {
        guard values.count > 1 else { return 0 }
        
        let mean = values.reduce(0, +) / Double(values.count)
        let squaredDifferences = values.map { pow($0 - mean, 2) }
        let variance = squaredDifferences.reduce(0, +) / Double(values.count - 1)
        return sqrt(variance)
    }
    
    // MARK: - Merchant Insights
    
    struct MerchantInsight {
        let merchant: String
        let totalSpent: Double
        let visitCount: Int
        let averageSpend: Double
        let lastVisit: Date
        let category: TransactionCategorizer.Category
    }
    
    func getMerchantInsights(transactions: [Transaction], limit: Int = 10) -> [MerchantInsight] {
        let grouped = Dictionary(grouping: transactions) { $0.merchant }
        
        return grouped.map { merchant, transactions in
            let totalSpent = transactions.reduce(0) { $0 + $1.amount }
            let visitCount = transactions.count
            let averageSpend = totalSpent / Double(visitCount)
            let lastVisit = transactions.map { $0.date }.max() ?? Date()
            let category = transactions.first?.category ?? .other
            
            return MerchantInsight(
                merchant: merchant,
                totalSpent: totalSpent,
                visitCount: visitCount,
                averageSpend: averageSpend,
                lastVisit: lastVisit,
                category: category
            )
        }
        .sorted { $0.totalSpent > $1.totalSpent }
        .prefix(limit)
        .map { $0 }
    }
    
    // MARK: - Subscription Detection
    
    struct Subscription {
        let merchant: String
        let amount: Double
        let frequency: Frequency
        let nextExpectedDate: Date
        let category: TransactionCategorizer.Category
        
        enum Frequency {
            case weekly, monthly, yearly
            
            var description: String {
                switch self {
                case .weekly: return "Weekly"
                case .monthly: return "Monthly"
                case .yearly: return "Yearly"
                }
            }
        }
    }
    
    func detectSubscriptions(transactions: [Transaction]) -> [Subscription] {
        var subscriptions: [Subscription] = []
        
        let grouped = Dictionary(grouping: transactions) { $0.merchant }
        
        for (merchant, merchantTransactions) in grouped {
            guard merchantTransactions.count >= 2 else { continue }
            
            let sortedTransactions = merchantTransactions.sorted { $0.date < $1.date }
            
            // Check for consistent amounts
            let amounts = sortedTransactions.map { $0.amount }
            let averageAmount = amounts.reduce(0, +) / Double(amounts.count)
            let isConsistentAmount = amounts.allSatisfy { abs($0 - averageAmount) < averageAmount * 0.1 }
            
            guard isConsistentAmount else { continue }
            
            // Check for regular intervals
            var intervals: [TimeInterval] = []
            for i in 1..<sortedTransactions.count {
                let interval = sortedTransactions[i].date.timeIntervalSince(sortedTransactions[i-1].date)
                intervals.append(interval)
            }
            
            let averageInterval = intervals.reduce(0, +) / Double(intervals.count)
            let isRegularInterval = intervals.allSatisfy { abs($0 - averageInterval) < averageInterval * 0.2 }
            
            guard isRegularInterval else { continue }
            
            // Determine frequency
            let frequency: Subscription.Frequency
            let daysInterval = averageInterval / (24 * 60 * 60)
            if daysInterval < 10 {
                frequency = .weekly
            } else if daysInterval < 40 {
                frequency = .monthly
            } else {
                frequency = .yearly
            }
            
            // Calculate next expected date
            let lastDate = sortedTransactions.last?.date ?? Date()
            let nextExpectedDate = lastDate.addingTimeInterval(averageInterval)
            
            subscriptions.append(Subscription(
                merchant: merchant,
                amount: averageAmount,
                frequency: frequency,
                nextExpectedDate: nextExpectedDate,
                category: sortedTransactions.first?.category ?? .subscriptions
            ))
        }
        
        return subscriptions.sorted { $0.amount > $1.amount }
    }
    
    // MARK: - Savings Opportunities
    
    struct SavingsOpportunity {
        let title: String
        let description: String
        let potentialSavings: Double
        let category: TransactionCategorizer.Category
        let priority: Priority
        
        enum Priority {
            case low, medium, high
            
            var color: String {
                switch self {
                case .low: return "#4CAF50"
                case .medium: return "#FF9800"
                case .high: return "#F44336"
                }
            }
        }
    }
    
    func identifySavingsOpportunities(transactions: [Transaction]) -> [SavingsOpportunity] {
        var opportunities: [SavingsOpportunity] = []
        
        // Detect unused subscriptions
        let subscriptions = detectSubscriptions(transactions: transactions)
        let now = Date()
        
        for subscription in subscriptions {
            if subscription.nextExpectedDate.timeIntervalSince(now) > 60 * 24 * 60 * 60 { // 60 days
                opportunities.append(SavingsOpportunity(
                    title: "Unused Subscription",
                    description: "You haven't used \(subscription.merchant) in 2 months",
                    potentialSavings: subscription.amount * 12, // Annual savings
                    category: subscription.category,
                    priority: .high
                ))
            }
        }
        
        // Detect high dining expenses
        let diningTransactions = transactions.filter { $0.category == .dining }
        let monthlyDining = diningTransactions.reduce(0) { $0 + $1.amount }
        if monthlyDining > 50000 {
            opportunities.append(SavingsOpportunity(
                title: "High Dining Expenses",
                description: "You're spending ₦\(Int(monthlyDining)) on dining out",
                potentialSavings: monthlyDining * 0.3, // 30% potential savings
                category: .dining,
                priority: .medium
            ))
        }
        
        return opportunities.sorted { $0.potentialSavings > $1.potentialSavings }
    }
    
    // MARK: - Spending Forecast
    
    func forecastSpending(transactions: [Transaction], months: Int = 3) -> [MonthlyTrend] {
        let trends = calculateMonthlyTrends(transactions: transactions, months: 6)
        
        guard trends.count >= 3 else { return [] }
        
        // Simple linear regression for forecasting
        let recentTrends = Array(trends.suffix(3))
        let averageGrowth = recentTrends.dropFirst().enumerated().map { index, trend in
            trend.comparisonToPrevious.percentageChange
        }.reduce(0, +) / Double(recentTrends.count - 1)
        
        var forecasts: [MonthlyTrend] = []
        var lastAmount = trends.last?.totalSpending ?? 0
        
        for monthOffset in 1...months {
            let forecastAmount = lastAmount * (1 + averageGrowth / 100)
            
            // Placeholder forecast - would use more sophisticated model in production
            forecasts.append(MonthlyTrend(
                month: Date().addingTimeInterval(TimeInterval(monthOffset * 30 * 24 * 60 * 60)),
                totalSpending: forecastAmount,
                categoryBreakdown: [:],
                transactionCount: 0,
                averageTransaction: 0,
                comparisonToPrevious: MonthlyTrend.Comparison(
                    percentageChange: averageGrowth,
                    absoluteChange: forecastAmount - lastAmount,
                    isIncrease: averageGrowth > 0
                )
            ))
            
            lastAmount = forecastAmount
        }
        
        return forecasts
    }
}
