import Foundation

/// Universal Search Engine - Find anything instantly
class UniversalSearchEngine {
    static let shared = UniversalSearchEngine()
    
    enum SearchResultType {
        case transaction, contact, beneficiary, merchant, category, helpArticle, quickAction
    }
    
    struct SearchResult: Identifiable {
        let id: String
        let type: SearchResultType
        let title: String
        let subtitle: String?
        let icon: String
        let relevanceScore: Double
        let data: Any
    }
    
    private var searchHistory: [String] = []
    
    func search(query: String, transactions: [Any] = [], contacts: [Any] = []) -> [SearchResult] {
        guard !query.isEmpty else { return [] }
        var results: [SearchResult] = []
        let lowercased = query.lowercased()
        
        // Search quick actions
        let actions = [
            ("Send Money", "send transfer pay", "paperplane.fill"),
            ("Add Funds", "add deposit fund", "plus.circle.fill"),
            ("Transactions", "history activity", "list.bullet"),
            ("Settings", "preferences account", "gearshape.fill")
        ]
        
        for action in actions {
            if action.0.lowercased().contains(lowercased) || action.1.contains(lowercased) {
                results.append(SearchResult(
                    id: UUID().uuidString,
                    type: .quickAction,
                    title: action.0,
                    subtitle: "Quick Action",
                    icon: action.2,
                    relevanceScore: 1.0,
                    data: action.0
                ))
            }
        }
        
        return results.sorted { $0.relevanceScore > $1.relevanceScore }
    }
    
    func addToHistory(_ query: String) {
        searchHistory.insert(query, at: 0)
        if searchHistory.count > 20 { searchHistory.removeLast() }
    }
    
    func getHistory() -> [String] { return searchHistory }
}
