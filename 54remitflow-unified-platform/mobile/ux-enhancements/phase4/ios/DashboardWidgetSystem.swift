import Foundation
import SwiftUI

/// Customizable Dashboard Widget System
class DashboardWidgetSystem: ObservableObject {
    static let shared = DashboardWidgetSystem()
    
    @Published var widgets: [DashboardWidget] = []
    
    enum WidgetType: String, Codable, CaseIterable {
        case balance = "Balance"
        case recentTransactions = "Recent Transactions"
        case quickActions = "Quick Actions"
        case spendingInsights = "Spending Insights"
        case monthlyTrends = "Monthly Trends"
        case subscriptions = "Subscriptions"
        case savingsGoals = "Savings Goals"
        case exchangeRates = "Exchange Rates"
    }
    
    struct DashboardWidget: Identifiable, Codable {
        let id: String
        let type: WidgetType
        var isEnabled: Bool
        var order: Int
        var size: WidgetSize
        
        enum WidgetSize: String, Codable {
            case small, medium, large
        }
    }
    
    init() {
        loadWidgets()
    }
    
    func loadWidgets() {
        if let data = UserDefaults.standard.data(forKey: "dashboardWidgets"),
           let decoded = try? JSONDecoder().decode([DashboardWidget].self, from: data) {
            widgets = decoded
        } else {
            // Default widgets
            widgets = [
                DashboardWidget(id: UUID().uuidString, type: .balance, isEnabled: true, order: 0, size: .large),
                DashboardWidget(id: UUID().uuidString, type: .quickActions, isEnabled: true, order: 1, size: .medium),
                DashboardWidget(id: UUID().uuidString, type: .recentTransactions, isEnabled: true, order: 2, size: .large),
                DashboardWidget(id: UUID().uuidString, type: .spendingInsights, isEnabled: true, order: 3, size: .medium)
            ]
        }
    }
    
    func saveWidgets() {
        if let encoded = try? JSONEncoder().encode(widgets) {
            UserDefaults.standard.set(encoded, forKey: "dashboardWidgets")
        }
    }
    
    func toggleWidget(_ widget: DashboardWidget) {
        if let index = widgets.firstIndex(where: { $0.id == widget.id }) {
            widgets[index].isEnabled.toggle()
            saveWidgets()
        }
    }
    
    func reorderWidgets(from source: IndexSet, to destination: Int) {
        widgets.move(fromOffsets: source, toOffset: destination)
        for (index, _) in widgets.enumerated() {
            widgets[index].order = index
        }
        saveWidgets()
    }
    
    func addWidget(type: WidgetType, size: DashboardWidget.WidgetSize = .medium) {
        let newWidget = DashboardWidget(
            id: UUID().uuidString,
            type: type,
            isEnabled: true,
            order: widgets.count,
            size: size
        )
        widgets.append(newWidget)
        saveWidgets()
    }
    
    func removeWidget(_ widget: DashboardWidget) {
        widgets.removeAll { $0.id == widget.id }
        saveWidgets()
    }
}
