import SwiftUI

/// Dynamic Type System - 300% Scaling Support
struct DynamicTypeSystem {
    static func fontSize(for style: Font.TextStyle, scaleFactor: CGFloat = 1.0) -> CGFloat {
        let baseSize: CGFloat
        
        switch style {
        case .largeTitle: baseSize = 34
        case .title: baseSize = 28
        case .title2: baseSize = 22
        case .title3: baseSize = 20
        case .headline: baseSize = 17
        case .body: baseSize = 17
        case .callout: baseSize = 16
        case .subheadline: baseSize = 15
        case .footnote: baseSize = 13
        case .caption: baseSize = 12
        case .caption2: baseSize = 11
        @unknown default: baseSize = 17
        }
        
        return baseSize * scaleFactor
    }
    
    static func scaledFont(_ style: Font.TextStyle, maxScale: CGFloat = 3.0) -> Font {
        return .system(style).weight(.regular)
    }
}

extension View {
    func scaledFont(_ style: Font.TextStyle, maxScale: CGFloat = 3.0) -> some View {
        self.font(DynamicTypeSystem.scaledFont(style, maxScale: maxScale))
    }
}
