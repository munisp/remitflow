import UIKit

/// 3D Touch Quick Actions
class ThreeDTouchActions {
    static let shared = ThreeDTouchActions()
    
    enum QuickActionType: String {
        case sendMoney = "SendMoney"
        case scanQR = "ScanQR"
        case viewBalance = "ViewBalance"
        case addFunds = "AddFunds"
    }
    
    func setupQuickActions() {
        let sendMoney = UIApplicationShortcutItem(
            type: QuickActionType.sendMoney.rawValue,
            localizedTitle: "Send Money",
            localizedSubtitle: "Quick transfer",
            icon: UIApplicationShortcutIcon(systemImageName: "paperplane.fill")
        )
        
        let scanQR = UIApplicationShortcutItem(
            type: QuickActionType.scanQR.rawValue,
            localizedTitle: "Scan QR",
            localizedSubtitle: "Pay with QR code",
            icon: UIApplicationShortcutIcon(systemImageName: "qrcode.viewfinder")
        )
        
        let viewBalance = UIApplicationShortcutItem(
            type: QuickActionType.viewBalance.rawValue,
            localizedTitle: "View Balance",
            localizedSubtitle: "Check wallet",
            icon: UIApplicationShortcutIcon(systemImageName: "creditcard.fill")
        )
        
        UIApplication.shared.shortcutItems = [sendMoney, scanQR, viewBalance]
    }
}
