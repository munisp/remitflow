import SwiftUI

/// Color Blind Mode Support
struct ColorBlindSupport {
    static func adjustColor(_ color: Color, for mode: AccessibilityManager.ColorBlindMode) -> Color {
        switch mode {
        case .none:
            return color
        case .protanopia:
            return adjustForProtanopia(color)
        case .deuteranopia:
            return adjustForDeuteranopia(color)
        case .tritanopia:
            return adjustForTritanopia(color)
        }
    }
    
    private static func adjustForProtanopia(_ color: Color) -> Color {
        // Red-blind: Reduce red channel
        return color.opacity(0.9)
    }
    
    private static func adjustForDeuteranopia(_ color: Color) -> Color {
        // Green-blind: Reduce green channel
        return color.opacity(0.9)
    }
    
    private static func adjustForTritanopia(_ color: Color) -> Color {
        // Blue-blind: Reduce blue channel
        return color.opacity(0.9)
    }
}

extension View {
    func colorBlindAdjusted() -> some View {
        let mode = AccessibilityManager.shared.colorBlindMode
        return self.foregroundColor(ColorBlindSupport.adjustColor(.primary, for: mode))
    }
}
