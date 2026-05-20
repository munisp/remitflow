import Foundation
import CoreML

/// AI-Powered Transaction Categorization Engine
/// Automatically categorizes transactions using machine learning and rule-based logic

class TransactionCategorizer {
    static let shared = TransactionCategorizer()
    
    // MARK: - Category Definitions
    
    enum Category: String, CaseIterable {
        case groceries = "Groceries"
        case dining = "Dining & Restaurants"
        case transportation = "Transportation"
        case utilities = "Utilities & Bills"
        case entertainment = "Entertainment"
        case shopping = "Shopping"
        case health = "Health & Fitness"
        case education = "Education"
        case travel = "Travel"
        case familySupport = "Family Support"
        case savings = "Savings & Investments"
        case subscriptions = "Subscriptions"
        case other = "Other"
        
        var icon: String {
            switch self {
            case .groceries: return "cart.fill"
            case .dining: return "fork.knife"
            case .transportation: return "car.fill"
            case .utilities: return "bolt.fill"
            case .entertainment: return "tv.fill"
            case .shopping: return "bag.fill"
            case .health: return "heart.fill"
            case .education: return "book.fill"
            case .travel: return "airplane"
            case .familySupport: return "house.fill"
            case .savings: return "banknote.fill"
            case .subscriptions: return "arrow.clockwise"
            case .other: return "ellipsis.circle.fill"
            }
        }
        
        var color: String {
            switch self {
            case .groceries: return "#4CAF50"
            case .dining: return "#FF9800"
            case .transportation: return "#2196F3"
            case .utilities: return "#FFC107"
            case .entertainment: return "#E91E63"
            case .shopping: return "#9C27B0"
            case .health: return "#F44336"
            case .education: return "#3F51B5"
            case .travel: return "#00BCD4"
            case .familySupport: return "#8BC34A"
            case .savings: return "#4CAF50"
            case .subscriptions: return "#FF5722"
            case .other: return "#9E9E9E"
            }
        }
    }
    
    // MARK: - Merchant Keywords Database
    
    private let merchantKeywords: [Category: [String]] = [
        .groceries: ["shoprite", "spar", "market", "supermarket", "grocery", "foodco", "justrite"],
        .dining: ["restaurant", "cafe", "pizza", "burger", "kfc", "dominos", "chicken republic", "sweet sensation"],
        .transportation: ["uber", "bolt", "taxi", "fuel", "petrol", "transport", "bus", "danfo"],
        .utilities: ["electric", "nepa", "ekedc", "water", "internet", "mtn", "glo", "airtel", "9mobile"],
        .entertainment: ["cinema", "netflix", "spotify", "movie", "game", "showmax", "dstv", "gotv"],
        .shopping: ["jumia", "konga", "mall", "boutique", "fashion", "clothing", "shoes"],
        .health: ["hospital", "pharmacy", "doctor", "clinic", "gym", "fitness", "medplus"],
        .education: ["school", "university", "course", "tuition", "book", "udemy", "coursera"],
        .travel: ["flight", "hotel", "booking", "airbnb", "airline", "arik", "air peace"],
        .familySupport: ["family", "parent", "mother", "father", "sibling", "relative"],
        .savings: ["investment", "savings", "stock", "crypto", "fund"],
        .subscriptions: ["subscription", "monthly", "annual", "membership", "premium"]
    ]
    
    // MARK: - Amount-Based Rules
    
    private let amountRules: [(range: ClosedRange<Double>, category: Category)] = [
        (50000...Double.infinity, .familySupport), // Large amounts likely family support
        (20000...49999, .travel), // Medium-high amounts could be travel
        (100...5000, .transportation) // Small amounts often transport
    ]
    
    // MARK: - Categorization Logic
    
    func categorize(transaction: Transaction) -> Category {
        // 1. Check for user-defined category
        if let userCategory = transaction.userDefinedCategory {
            return userCategory
        }
        
        // 2. Check merchant name against keywords
        if let merchantCategory = categorizeMerchant(transaction.merchant) {
            return merchantCategory
        }
        
        // 3. Check transaction description
        if let descriptionCategory = categorizeDescription(transaction.description) {
            return descriptionCategory
        }
        
        // 4. Apply amount-based rules
        if let amountCategory = categorizeByAmount(transaction.amount) {
            return amountCategory
        }
        
        // 5. Check for recurring patterns
        if let recurringCategory = categorizeRecurring(transaction) {
            return recurringCategory
        }
        
        // 6. Default to other
        return .other
    }
    
    private func categorizeMerchant(_ merchant: String) -> Category? {
        let lowercasedMerchant = merchant.lowercased()
        
        for (category, keywords) in merchantKeywords {
            for keyword in keywords {
                if lowercasedMerchant.contains(keyword) {
                    return category
                }
            }
        }
        
        return nil
    }
    
    private func categorizeDescription(_ description: String) -> Category? {
        let lowercasedDescription = description.lowercased()
        
        for (category, keywords) in merchantKeywords {
            for keyword in keywords {
                if lowercasedDescription.contains(keyword) {
                    return category
                }
            }
        }
        
        return nil
    }
    
    private func categorizeByAmount(_ amount: Double) -> Category? {
        for rule in amountRules {
            if rule.range.contains(amount) {
                return rule.category
            }
        }
        return nil
    }
    
    private func categorizeRecurring(_ transaction: Transaction) -> Category? {
        // Check if this is a recurring transaction
        if transaction.isRecurring {
            // Recurring transactions are likely subscriptions or utilities
            if transaction.amount < 10000 {
                return .subscriptions
            } else {
                return .utilities
            }
        }
        return nil
    }
    
    // MARK: - Batch Categorization
    
    func categorizeAll(_ transactions: [Transaction]) -> [Transaction] {
        return transactions.map { transaction in
            var categorized = transaction
            categorized.category = categorize(transaction: transaction)
            return categorized
        }
    }
    
    // MARK: - Learning from User Corrections
    
    private var userCorrections: [String: Category] = [:]
    
    func learn(merchant: String, category: Category) {
        userCorrections[merchant.lowercased()] = category
        // In production, this would be persisted to UserDefaults or a database
    }
    
    func applyLearning(to transaction: Transaction) -> Category {
        if let learnedCategory = userCorrections[transaction.merchant.lowercased()] {
            return learnedCategory
        }
        return categorize(transaction: transaction)
    }
}

// MARK: - Transaction Model

struct Transaction: Identifiable, Codable {
    let id: String
    let merchant: String
    let description: String
    let amount: Double
    let date: Date
    let isRecurring: Bool
    var category: TransactionCategorizer.Category?
    var userDefinedCategory: TransactionCategorizer.Category?
    
    init(id: String = UUID().uuidString,
         merchant: String,
         description: String,
         amount: Double,
         date: Date = Date(),
         isRecurring: Bool = false,
         category: TransactionCategorizer.Category? = nil,
         userDefinedCategory: TransactionCategorizer.Category? = nil) {
        self.id = id
        self.merchant = merchant
        self.description = description
        self.amount = amount
        self.date = date
        self.isRecurring = isRecurring
        self.category = category
        self.userDefinedCategory = userDefinedCategory
    }
}

// MARK: - Category Statistics

struct CategoryStatistics {
    let category: TransactionCategorizer.Category
    let totalAmount: Double
    let transactionCount: Int
    let percentage: Double
    let trend: Trend
    
    enum Trend {
        case increasing
        case decreasing
        case stable
        
        var icon: String {
            switch self {
            case .increasing: return "arrow.up.right"
            case .decreasing: return "arrow.down.right"
            case .stable: return "arrow.right"
            }
        }
        
        var color: String {
            switch self {
            case .increasing: return "#F44336"
            case .decreasing: return "#4CAF50"
            case .stable: return "#FFC107"
            }
        }
    }
}

extension Array where Element == Transaction {
    func categoryStatistics() -> [CategoryStatistics] {
        let totalAmount = self.reduce(0) { $0 + $1.amount }
        
        let grouped = Dictionary(grouping: self) { $0.category ?? .other }
        
        return grouped.map { category, transactions in
            let categoryTotal = transactions.reduce(0) { $0 + $1.amount }
            let percentage = (categoryTotal / totalAmount) * 100
            
            // Calculate trend (simplified - would compare to previous period in production)
            let trend: CategoryStatistics.Trend = .stable
            
            return CategoryStatistics(
                category: category,
                totalAmount: categoryTotal,
                transactionCount: transactions.count,
                percentage: percentage,
                trend: trend
            )
        }.sorted { $0.totalAmount > $1.totalAmount }
    }
}
