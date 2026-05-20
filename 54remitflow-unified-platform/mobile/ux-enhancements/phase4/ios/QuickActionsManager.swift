import Foundation

/// Quick Actions Manager
class QuickActionsManager {
    static let shared = QuickActionsManager()
    
    struct QuickAction: Identifiable {
        let id: String
        let title: String
        let icon: String
        let color: String
        let action: ActionType
        
        enum ActionType {
            case sendMoney
            case addFunds
            case scanQR
            case requestMoney
            case payBills
            case buyAirtime
            case exchangeCurrency
            case viewCards
        }
    }
    
    func getQuickActions() -> [QuickAction] {
        return [
            QuickAction(id: "1", title: "Send Money", icon: "paperplane.fill", color: "#4CAF50", action: .sendMoney),
            QuickAction(id: "2", title: "Add Funds", icon: "plus.circle.fill", color: "#2196F3", action: .addFunds),
            QuickAction(id: "3", title: "Scan QR", icon: "qrcode.viewfinder", color: "#FF9800", action: .scanQR),
            QuickAction(id: "4", title: "Request Money", icon: "arrow.down.circle.fill", color: "#9C27B0", action: .requestMoney),
            QuickAction(id: "5", title: "Pay Bills", icon: "doc.text.fill", color: "#F44336", action: .payBills),
            QuickAction(id: "6", title: "Buy Airtime", icon: "phone.fill", color: "#00BCD4", action: .buyAirtime)
        ]
    }
    
    func getRecentActions() -> [QuickAction] {
        // Return most used actions
        return Array(getQuickActions().prefix(4))
    }
}
